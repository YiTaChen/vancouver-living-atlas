import * as THREE from 'three';
import type { CityEngine } from './engine';
import {
  sampleRocketEffects,
  ROCKET_CONFIGS,
  type RocketState,
} from './rocket-state';
import { disposeRocketObject } from './assets/rocket';
import type { ForestTree } from './detailed-trees';

type BodyPart = {
  key: string;
  center: [number, number];
  minY: number;
  maxY: number;
  start: number;
  count: number;
};
type DamagedPart = {
  part: BodyPart;
  position: Float32Array;
  color: Float32Array;
  exposure: number;
  collapse: number;
  dirtyPosition: boolean;
  dirtyColor: boolean;
  fragmentsEmitted: boolean;
};
type FlyingSlot = {
  mesh: THREE.InstancedMesh;
  index: number;
  start: THREE.Matrix4;
  age: number;
  vx: number;
  vy: number;
  vz: number;
  ground: number;
};
type BurntTree = {
  source: ForestTree;
  x: number;
  y: number;
  z: number;
  h: number;
  heat: number;
  fall: number;
  mesh: THREE.Mesh;
  charred: THREE.Group;
};
type BuildingFragment = {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  size: THREE.Vector3;
  rotation: THREE.Euler;
  spin: THREE.Vector3;
  ground: number;
};
const rand = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Local, bounded visual response. Shared city assets and source geography stay owned by the city. */
export class RocketEffects {
  readonly group = new THREE.Group();
  damaged = 0;
  burning = 0;
  debris = 0;
  private parts: DamagedPart[] = [];
  private body: THREE.Mesh | null;
  private flying: FlyingSlot[] = [];
  private launched = new Set<string>();
  private restoreSlots: {
    mesh: THREE.InstancedMesh;
    index: number;
    matrix: THREE.Matrix4;
  }[] = [];
  private restoredKeys = new Set<string>();
  private restoreCulling = new Map<THREE.InstancedMesh, boolean>();
  private trees: BurntTree[] = [];
  private rubble: THREE.InstancedMesh;
  private fragments: BuildingFragment[] = [];
  private smoke: THREE.Points;
  private positions: Float32Array;
  private alphas: Float32Array;
  private particles: {
    p: THREE.Vector3;
    v: THREE.Vector3;
    age: number;
    life: number;
    hot: boolean;
    soot: boolean;
  }[];
  private spawn = 0;
  private next = 0;
  private time = 0;
  private scanAt = 0;
  private crashed = false;
  private shadowAt = -Infinity;
  private scorch: THREE.Mesh;
  private shock: THREE.Mesh;
  private shockAge = 99;
  private savedGround: THREE.Vector3;
  private lastState: RocketState;
  private fragmentTransform = new THREE.Object3D();
  constructor(
    private e: CityEngine,
    state: RocketState,
  ) {
    this.lastState = state;
    this.savedGround = new THREE.Vector3(
      state.origin.x,
      state.support.groundY ?? state.origin.y,
      state.origin.z,
    );
    this.body = e.data.rocketBuildingMesh ?? null;
    const r = ROCKET_CONFIGS[state.kind].blastRadius;
    if (this.body) {
      const pos = this.body.geometry.getAttribute('position'),
        color = this.body.geometry.getAttribute('color');
      this.parts = (e.data.rocketBuildingParts ?? [])
        .filter(
          (p: BodyPart) =>
            Math.hypot(
              p.center[0] - state.origin.x,
              p.center[1] - state.origin.z,
            ) <
            r + 30,
        )
        .sort(
          (a: BodyPart, b: BodyPart) =>
            Math.hypot(
              a.center[0] - state.origin.x,
              a.center[1] - state.origin.z,
            ) -
            Math.hypot(
              b.center[0] - state.origin.x,
              b.center[1] - state.origin.z,
            ),
        )
        .slice(0, 48)
        .map((part: BodyPart) => ({
          part,
          position: new Float32Array(
            (pos.array as Float32Array).subarray(
              part.start * 3,
              (part.start + part.count) * 3,
            ),
          ),
          color: new Float32Array(
            (color.array as Float32Array).subarray(
              part.start * 3,
              (part.start + part.count) * 3,
            ),
          ),
          exposure: 0,
          collapse: 0,
          dirtyPosition: false,
          dirtyColor: false,
          fragmentsEmitted: false,
        }));
    }
    this.rubble = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6e655b, roughness: 1 }),
      64,
    );
    this.rubble.count = 0;
    this.rubble.frustumCulled = false;
    this.rubble.name = 'Rocket building debris (64 slot limit)';
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rubble);
    const n =
      e.compatibleGraphics || e.settings.quality === 'balanced' ? 160 : 420;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: e.container.clientHeight * 0.55 } },
      vertexShader:
        'attribute float aLife; varying float vLife; uniform float uScale; void main(){vLife=aLife;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(uScale*(abs(aLife)>1.?4.:9.)/max(2.,-p.z),1.,110.);}',
      fragmentShader:
        'varying float vLife;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.||vLife==0.)discard;bool hot=vLife>1.;float a=hot?vLife-1.:abs(vLife);vec3 smoke=vLife<0.?mix(vec3(.12,.15,.17),vec3(.42,.43,.43),a):mix(vec3(.50,.55,.59),vec3(.84,.88,.90),a);vec3 c=hot?mix(vec3(1.,.18,.02),vec3(1.,.86,.4),a):smoke;gl_FragColor=vec4(c,(1.-smoothstep(.15,1.,d))*a*.65);}',
    });
    this.smoke = new THREE.Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
    this.particles = Array.from({ length: n }, () => ({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      age: 999,
      life: 1,
      hot: false,
      soot: false,
    }));
    this.scorch = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x171611,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorch.position.copy(this.savedGround);
    this.scorch.position.y += 0.35;
    this.group.add(this.scorch);
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xe9c698,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.copy(this.savedGround);
    this.shock.position.y += 0.65;
    this.group.add(this.shock);
    const fireGeometry = new THREE.ConeGeometry(1, 5, 7),
      fireMaterial = new THREE.MeshBasicMaterial({
        color: 0xff791b,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    const bark = new THREE.CylinderGeometry(0.18, 0.32, 1, 7),
      crown = new THREE.ConeGeometry(1, 1, 7);
    const charMaterial = new THREE.MeshStandardMaterial({
      color: 0x29231c,
      roughness: 1,
    });
    for (const t of (e.detailedTrees?.trees ?? [])
      .filter((t) => Math.hypot(t.x - state.origin.x, t.z - state.origin.z) < r)
      .sort(
        (a, b) =>
          Math.hypot(a.x - state.origin.x, a.z - state.origin.z) -
          Math.hypot(b.x - state.origin.x, b.z - state.origin.z),
      )
      .slice(0, 28)) {
      const mesh = new THREE.Mesh(fireGeometry, fireMaterial);
      mesh.position.set(t.x, t.y + 2, t.z);
      mesh.visible = false;
      this.group.add(mesh);
      const charred = new THREE.Group(),
        trunk = new THREE.Mesh(bark, charMaterial),
        canopy = new THREE.Mesh(crown, charMaterial);
      trunk.scale.y = t.h * 0.75;
      trunk.position.y = t.h * 0.375;
      canopy.scale.set(t.h * 0.16, t.h * 0.5, t.h * 0.16);
      canopy.position.y = t.h * 0.65;
      charred.add(trunk, canopy);
      charred.position.set(t.x, t.y, t.z);
      charred.visible = false;
      this.group.add(charred);
      this.trees.push({
        source: t,
        x: t.x,
        y: t.y,
        z: t.z,
        h: t.h,
        heat: 0,
        fall: 0,
        mesh,
        charred,
      });
    }
    // Dispose even when there were no nearby trees; these shared resources
    // otherwise would never become children of the session-owned group.
    if (!this.trees.length) {
      fireGeometry.dispose();
      fireMaterial.dispose();
      bark.dispose();
      crown.dispose();
      charMaterial.dispose();
    }
    this.group.name = 'Rocket local heat / pressure / pooled particles';
    e.scene.add(this.group);
  }
  private emit(
    x: number,
    y: number,
    z: number,
    power: number,
    hot: boolean,
    soot = false,
  ) {
    const p = this.particles[this.next++ % this.particles.length],
      k = this.next;
    p.p.set(x, y, z);
    p.age = 0;
    p.life = hot ? 0.4 + rand(k) * 0.6 : 2 + rand(k) * 4;
    p.hot = hot;
    p.soot = soot;
    const a = rand(k + 9) * Math.PI * 2,
      speed = (3 + rand(k + 3) * 15) * power;
    p.v.set(
      Math.cos(a) * speed,
      hot ? -5 - rand(k) * 12 : 4 + rand(k) * 8,
      Math.sin(a) * speed,
    );
  }
  private emitBuildingFragments(d: DamagedPart, power: number) {
    const count = Math.min(5, 64 - this.fragments.length),
      height = d.part.maxY - d.part.minY;
    const dx = d.part.center[0] - this.lastState.origin.x,
      dz = d.part.center[1] - this.lastState.origin.z,
      distance = Math.max(1, Math.hypot(dx, dz));
    for (let i = 0; i < count; i++) {
      const k = this.fragments.length + 31,
        speed = (5 + rand(k) * 11) * Math.max(0.4, power);
      this.fragments.push({
        p: new THREE.Vector3(
          d.part.center[0] + (rand(k + 1) - 0.5) * 8,
          d.part.minY + height * (0.2 + rand(k + 2) * 0.75),
          d.part.center[1] + (rand(k + 3) - 0.5) * 8,
        ),
        v: new THREE.Vector3(
          (dx / distance) * speed,
          4 + rand(k + 4) * 13,
          (dz / distance) * speed,
        ),
        age: 0,
        size: new THREE.Vector3(
          0.3 + rand(k + 5) * 1.4,
          0.2 + rand(k + 6) * 0.8,
          0.4 + rand(k + 7),
        ),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(
          rand(k + 8) * 4,
          rand(k + 9) * 3,
          rand(k + 10) * 5,
        ),
        ground: d.part.minY + 0.2,
      });
      this.rubble.setColorAt(
        this.fragments.length - 1,
        new THREE.Color().setRGB(
          0.25 + rand(k) * 0.3,
          0.22 + rand(k) * 0.24,
          0.2 + rand(k) * 0.2,
        ),
      );
    }
    this.rubble.count = this.fragments.length;
    if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
  }
  update(dt: number, s: RocketState) {
    this.lastState = s;
    this.time += dt;
    const f = sampleRocketEffects(s),
      config = ROCKET_CONFIGS[s.kind];
    if (s.phase === 'ignition' && this.shockAge > 90) this.shockAge = 0;
    this.shockAge += dt;
    const shockScale = this.shockAge * config.blastRadius * 1.5;
    this.shock.scale.setScalar(Math.max(0.01, shockScale));
    (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(
      0,
      0.45 * (1 - this.shockAge / 1.5),
    );
    if (f.groundExposure > 0.01) {
      (this.scorch.material as THREE.MeshBasicMaterial).opacity = Math.min(
        0.72,
        (this.scorch.material as THREE.MeshBasicMaterial).opacity + dt * 0.12,
      );
      this.scorch.scale.setScalar(Math.max(1, config.heatRadius * 0.7));
      for (const d of this.parts) {
        const distance = Math.hypot(
          d.part.center[0] - s.origin.x,
          d.part.center[1] - s.origin.z,
        );
        const falloff = Math.max(0, 1 - distance / (f.blastRadius + 10));
        // Low domestic buildings fail sooner; towers receive scorch and limited facade damage.
        const weakness = d.part.maxY - d.part.minY < 14 ? 1 : 0.17;
        const exposure = Math.min(
          1,
          d.exposure + f.groundExposure * falloff * dt * weakness * 0.6,
        );
        if (exposure !== d.exposure) d.dirtyColor = true;
        d.exposure = exposure;
      }
      for (const t of this.trees) {
        const distance = Math.hypot(t.x - s.origin.x, t.z - s.origin.z);
        t.heat = Math.min(
          1,
          t.heat +
            dt *
              f.groundExposure *
              Math.max(0, 1 - distance / config.heatRadius),
        );
      }
    }
    for (const d of this.parts) {
      if (
        s.supportCollapsed &&
        Math.hypot(
          d.part.center[0] - s.origin.x,
          d.part.center[1] - s.origin.z,
        ) < 18 &&
        d.exposure < 1
      ) {
        d.exposure = 1;
        d.dirtyColor = true;
      }
      const target = Math.max(0, (d.exposure - 0.22) / 0.78),
        difference = target - d.collapse;
      if (Math.abs(difference) > 0.0001) {
        d.collapse += difference * Math.min(1, dt * 2);
        d.dirtyPosition = true;
      }
      if (d.exposure > 0.2 && !d.fragmentsEmitted) {
        d.fragmentsEmitted = true;
        this.emitBuildingFragments(d, f.groundExposure);
      }
    }
    this.damaged = this.parts.filter((d) => d.exposure > 0.12).length;
    this.burning = this.trees.filter((t) => t.heat > 0.13).length;
    for (const t of this.trees) {
      t.mesh.visible = t.heat > 0.13;
      t.mesh.scale.set(
        1 + t.heat * 1.3,
        1 + Math.sin(this.time * 15 + t.x) * 0.22,
        1 + t.heat,
      );
      t.charred.visible = t.heat > 0.3;
      if (t.charred.visible) {
        const distance = Math.hypot(t.x - s.origin.x, t.z - s.origin.z);
        t.fall = Math.min(
          1.35,
          t.fall +
            dt *
              f.groundExposure *
              Math.max(0, 1 - distance / config.blastRadius) *
              (s.kind === 'large' ? 0.7 : 0.35),
        );
        const angle = Math.atan2(t.x - s.origin.x, t.z - s.origin.z);
        t.charred.rotation.set(
          Math.cos(angle) * t.fall,
          0,
          -Math.sin(angle) * t.fall,
        );
      }
      if (t.mesh.visible && rand(this.next + this.time) > 0.55)
        this.emit(t.x, t.y + 3, t.z, 0.3, false, true);
    }
    if (s.phase === 'crashed' && !this.crashed) {
      this.crashed = true;
      this.shockAge = 0;
      this.shock.position.set(s.position.x, s.position.y + 0.5, s.position.z);
      for (let i = 0; i < Math.min(100, this.particles.length); i++)
        this.emit(
          s.position.x,
          s.position.y + 3,
          s.position.z,
          2,
          i % 3 === 0,
          true,
        );
    }
    if (f.engine > 0.03 && s.altitude < 14000) {
      this.spawn +=
        dt *
        (s.kind === 'large' ? 130 : 65) *
        f.engine *
        Math.exp(-s.altitude / 1200);
      while (this.spawn > 1) {
        this.spawn--;
        this.emit(
          s.position.x,
          Math.max(this.savedGround.y + 1, s.position.y - 3),
          s.position.z,
          f.engine,
          this.next % 4 === 0,
        );
      }
    }
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.alphas[i] = 0;
        continue;
      }
      p.v.y += dt * (p.hot ? -3 : 1.5);
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < this.savedGround.y + 0.5) {
        p.p.y = this.savedGround.y + 0.5;
        p.v.y = Math.abs(p.v.y) * 0.3;
      }
      this.positions[i * 3] = p.p.x;
      this.positions[i * 3 + 1] = p.p.y;
      this.positions[i * 3 + 2] = p.p.z;
      this.alphas[i] =
        ((p.hot ? 1 : 0) + Math.max(0.001, 1 - p.age / p.life)) *
        (p.soot && !p.hot ? -1 : 1);
    }
    this.smoke.geometry.attributes.position.needsUpdate =
      this.smoke.geometry.attributes.aLife.needsUpdate = true;
    this.flying.forEach((p) => (p.age += dt));
    for (let i = 0; i < this.fragments.length; i++) {
      const p = this.fragments[i];
      p.age += dt;
      if (p.p.y > p.ground || p.v.y > 0) {
        p.v.y -= 9.81 * dt;
        p.p.addScaledVector(p.v, dt);
        p.rotation.x += p.spin.x * dt;
        p.rotation.y += p.spin.y * dt;
        p.rotation.z += p.spin.z * dt;
        if (p.p.y <= p.ground) {
          p.p.y = p.ground;
          p.v.set(0, 0, 0);
        }
      }
      this.fragmentTransform.position.copy(p.p);
      this.fragmentTransform.rotation.copy(p.rotation);
      this.fragmentTransform.scale.copy(p.size);
      this.fragmentTransform.updateMatrix();
      this.rubble.setMatrixAt(i, this.fragmentTransform.matrix);
    }
    if (this.fragments.length) this.rubble.instanceMatrix.needsUpdate = true;
    this.debris = this.flying.length + this.fragments.length;
  }
  private overrideSlot(
    mesh: THREE.InstancedMesh,
    index: number,
    matrix: THREE.Matrix4,
  ) {
    const key = mesh.uuid + ':' + index;
    if (!this.restoredKeys.has(key)) {
      const original = new THREE.Matrix4();
      mesh.getMatrixAt(index, original);
      this.restoreSlots.push({ mesh, index, matrix: original });
      this.restoredKeys.add(key);
    }
    if (!this.restoreCulling.has(mesh)) {
      this.restoreCulling.set(mesh, mesh.frustumCulled);
      mesh.frustumCulled = false;
    }
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.addUpdateRange(index * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
  /** Called after city LOD/traffic updates, then restored after the draw. This never hijacks their instance ownership. */
  beforeRender() {
    if (this.restoreSlots.length) this.afterRender();
    const s = this.lastState,
      f = sampleRocketEffects(s);
    let shadowChanged = false;
    if (this.body) {
      const pos = this.body.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute,
        color = this.body.geometry.getAttribute(
          'color',
        ) as THREE.BufferAttribute;
      for (const d of this.parts)
        if (d.dirtyPosition || d.dirtyColor) {
          for (let i = 0; i < d.part.count; i++) {
            const j = i * 3,
              originalY = d.position[j + 1],
              lift = Math.max(0, originalY - d.part.minY);
            const shift = d.collapse * lift * 0.16;
            if (d.dirtyPosition)
              pos.setXYZ(
                d.part.start + i,
                d.position[j] + shift,
                d.part.minY + lift * (1 - d.collapse * 0.93),
                d.position[j + 2] + shift * 0.5,
              );
            if (d.dirtyColor)
              color.setXYZ(
                d.part.start + i,
                d.color[j] * (1 - d.exposure * 0.75),
                d.color[j + 1] * (1 - d.exposure * 0.8),
                d.color[j + 2] * (1 - d.exposure * 0.8),
              );
          }
          if (d.dirtyPosition) {
            pos.addUpdateRange(d.part.start * 3, d.part.count * 3);
            pos.needsUpdate = true;
            shadowChanged = true;
          }
          if (d.dirtyColor) {
            color.addUpdateRange(d.part.start * 3, d.part.count * 3);
            color.needsUpdate = true;
          }
          d.dirtyPosition = d.dirtyColor = false;
        }
    }
    if (
      f.groundExposure > 0.12 &&
      this.time - this.scanAt > 0.3 &&
      this.flying.length < 48
    ) {
      this.scanAt = this.time;
      const groups = [
        this.e.traffic?.vehicleAssets.group,
        this.e.traffic?.mesh,
        this.e.traffic?.cabins,
        this.e.scene.getObjectByName('Nearby sidewalk pedestrians'),
        this.e.scene.getObjectByName(
          'Source-selected downtown street furniture',
        ),
      ];
      for (const root of groups)
        root?.traverse((object) => {
          if (!(object instanceof THREE.InstancedMesh) || !object.visible)
            return;
          object.updateWorldMatrix(true, false);
          for (let i = 0; i < object.count && this.flying.length < 48; i++) {
            const key = object.uuid + ':' + i;
            if (this.launched.has(key)) continue;
            const matrix = new THREE.Matrix4();
            object.getMatrixAt(i, matrix);
            const p = new THREE.Vector3()
                .setFromMatrixPosition(matrix)
                .applyMatrix4(object.matrixWorld),
              dx = p.x - s.origin.x,
              dz = p.z - s.origin.z,
              d = Math.hypot(dx, dz);
            if (
              d > f.blastRadius ||
              Math.abs(p.y - this.savedGround.y) > 25 ||
              Math.abs(matrix.determinant()) < 1e-9
            )
              continue;
            this.launched.add(key);
            const strength = (1 - d / f.blastRadius) * f.debrisImpulse;
            this.flying.push({
              mesh: object,
              index: i,
              start: new THREE.Matrix4().multiplyMatrices(
                object.matrixWorld,
                matrix,
              ),
              age: 0,
              vx: (dx / Math.max(1, d)) * strength,
              vy: strength * 0.7 + 3,
              vz: (dz / Math.max(1, d)) * strength,
              ground: p.y,
            });
          }
        });
    }
    for (const p of this.flying) {
      if (p.index >= p.mesh.count) continue;
      const t = Math.min(7, p.age),
        m = p.start.clone(),
        a = t * 1.8;
      const rotate = new THREE.Matrix4().makeRotationZ(a);
      m.multiply(rotate);
      m.elements[12] += p.vx * t;
      m.elements[14] += p.vz * t;
      m.elements[13] = Math.max(p.ground, p.ground + p.vy * t - 4.905 * t * t);
      p.mesh.updateWorldMatrix(true, false);
      m.premultiply(new THREE.Matrix4().copy(p.mesh.matrixWorld).invert());
      this.overrideSlot(p.mesh, p.index, m);
    }
    const burnt = this.trees.filter((t) => t.charred.visible),
      hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const t of burnt)
      for (const slot of t.source.slots ?? [])
        if (slot.index < slot.mesh.count)
          this.overrideSlot(slot.mesh, slot.index, hidden);
    // Near-camera detailed-tree slots are recycled by their owner. Resolve the
    // current spatial match for this draw instead of retaining a stale LOD slot.
    if (burnt.length)
      this.e.detailedTrees?.group.traverse((object) => {
        if (!(object instanceof THREE.InstancedMesh) || !object.visible) return;
        object.updateWorldMatrix(true, false);
        const matrix = new THREE.Matrix4(),
          point = new THREE.Vector3();
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, matrix);
          if (Math.abs(matrix.determinant()) < 1e-9) continue;
          point.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
          if (
            burnt.some(
              (t) =>
                Math.hypot(t.x - point.x, t.z - point.z) <
                  Math.max(1.5, t.h * 0.17) &&
                point.y >= t.y - 2 &&
                point.y < t.y + t.h + 5,
            )
          )
            this.overrideSlot(object, i, hidden);
        }
      });
    if (
      (shadowChanged ||
        (f.groundExposure > 0.12 &&
          (this.flying.length > 0 || burnt.length > 0))) &&
      this.time - this.shadowAt > 0.35
    ) {
      this.shadowAt = this.time;
      this.e.renderer.shadowMap.needsUpdate = true;
    }
  }
  afterRender() {
    for (const p of this.restoreSlots) {
      p.mesh.setMatrixAt(p.index, p.matrix);
      p.mesh.instanceMatrix.addUpdateRange(p.index * 16, 16);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [mesh, value] of this.restoreCulling) mesh.frustumCulled = value;
    this.restoreSlots.length = 0;
    this.restoredKeys.clear();
    this.restoreCulling.clear();
  }
  reset() {
    this.afterRender();
    if (this.body) {
      const pos = this.body.geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute,
        col = this.body.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (const d of this.parts)
        if (d.exposure > 0 || d.collapse > 0) {
          for (let i = 0; i < d.part.count; i++) {
            const j = i * 3;
            pos.setXYZ(
              d.part.start + i,
              d.position[j],
              d.position[j + 1],
              d.position[j + 2],
            );
            col.setXYZ(
              d.part.start + i,
              d.color[j],
              d.color[j + 1],
              d.color[j + 2],
            );
          }
          pos.addUpdateRange(d.part.start * 3, d.part.count * 3);
          col.addUpdateRange(d.part.start * 3, d.part.count * 3);
          pos.needsUpdate = col.needsUpdate = true;
          d.exposure = d.collapse = 0;
          d.dirtyPosition = d.dirtyColor = d.fragmentsEmitted = false;
        }
    }
    this.fragments.length = 0;
    this.rubble.count = 0;
    this.flying.length = 0;
    this.launched.clear();
    this.crashed = false;
    this.spawn = 0;
    this.shockAge = 99;
    for (const t of this.trees) {
      t.heat = t.fall = 0;
      t.mesh.visible = t.charred.visible = false;
    }
    for (const p of this.particles) p.age = p.life;
    this.alphas.fill(0);
    this.smoke.geometry.attributes.aLife.needsUpdate = true;
    (this.scorch.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.shock.material as THREE.MeshBasicMaterial).opacity = 0;
    this.damaged = this.burning = this.debris = 0;
    this.e.renderer.shadowMap.needsUpdate = true;
  }
  dispose() {
    this.reset();
    disposeRocketObject(this.group);
    this.parts.length = this.flying.length = this.trees.length = 0;
  }
}

/** Synthesized rumble: starts only inside a Launch click, no audio download or autoplay. */
export class RocketAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  start() {
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
      if (this.source) return;
      const buffer = this.context.createBuffer(
          1,
          this.context.sampleRate * 2,
          this.context.sampleRate,
        ),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = rand(i) * 2 - 1;
      this.source = this.context.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.source
        .connect(filter)
        .connect(this.gain)
        .connect(this.context.destination);
      this.source.start();
    } catch {
      /* Audio availability never blocks a flight. */
    }
  }
  update(power: number, muted = false) {
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(
        muted ? 0 : power * 0.28,
        this.context.currentTime,
        0.15,
      );
  }
  dispose() {
    this.source?.stop();
    this.source?.disconnect();
    this.source = null;
    if (this.context) void this.context.close();
    this.context = null;
  }
}
