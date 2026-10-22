import * as THREE from 'three';
import type { CityEngine } from './engine';

export const DRIFT_EFFECT_CAPACITY = { marks: 384, smoke: 96 } as const;
type Point = readonly number[];
type Pose = {
  id: string;
  position: Point;
  quaternion: Point;
  wheels: readonly Point[];
  intensity: number;
  speed: number;
  surfaceId: string;
  layer?: number;
};
const CLASSIC_TYRES = [
  [-1.02, -0.2, -1.4],
  [1.02, -0.2, -1.4],
];
const ROADSTER_TYRES = [
  [-0.94, -0.2, -1.4],
  [0.94, -0.2, -1.4],
];
const finite = (p: Point, length: number) =>
  p.length === length &&
  p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7);

/** Presentation only. Two fixed buffers, no decals/textures, scene lights,
 * per-wheel objects or simulation writes. Every track endpoint is checked
 * against the actual motor-road floor, independently of visible smoke. */
export class VehicleDriftEffects {
  readonly marks: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly smoke: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly markPositions = new Float32Array(
    DRIFT_EFFECT_CAPACITY.marks * 18,
  );
  private readonly markAlphas = new Float32Array(
    DRIFT_EFFECT_CAPACITY.marks * 6,
  );
  private readonly markLife = new Float32Array(DRIFT_EFFECT_CAPACITY.marks);
  private readonly markStrength = new Float32Array(DRIFT_EFFECT_CAPACITY.marks);
  private readonly smokePositions = new Float32Array(
    DRIFT_EFFECT_CAPACITY.smoke * 3,
  );
  private readonly smokeVelocity = new Float32Array(
    DRIFT_EFFECT_CAPACITY.smoke * 3,
  );
  private readonly smokeAlphas = new Float32Array(DRIFT_EFFECT_CAPACITY.smoke);
  private readonly smokeSizes = new Float32Array(DRIFT_EFFECT_CAPACITY.smoke);
  private readonly smokeLife = new Float32Array(DRIFT_EFFECT_CAPACITY.smoke);
  private readonly smokeDuration = new Float32Array(
    DRIFT_EFFECT_CAPACITY.smoke,
  );
  private readonly previous = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly connected = [false, false];
  private readonly wheel = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly origin = new THREE.Vector3();
  private markCursor = 0;
  private markPeak = 0;
  private activeMarks = 0;
  private smokeCount = 0;
  private markBudget = DRIFT_EFFECT_CAPACITY.marks as number;
  private smokeBudget = DRIFT_EFFECT_CAPACITY.smoke as number;
  private fadeSeconds = 18;
  private cooldown = 0;
  private identity = '';
  private disposed = false;
  private seed = 0x51de;
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  constructor(private readonly e: CityEngine) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.markPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.markAlphas, 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const uv = new Float32Array(DRIFT_EFFECT_CAPACITY.marks * 12);
    for (let i = 0; i < DRIFT_EFFECT_CAPACITY.marks; i++)
      uv.set([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], i * 12);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setDrawRange(0, 0);
    this.marks = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide,
        vertexShader: `attribute float aAlpha; varying float vAlpha; varying vec2 vUv;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
          vAlpha=aAlpha*(1.0-smoothstep(90.0,160.0,-p.z));vUv=uv;}`,
        fragmentShader: `varying float vAlpha;varying vec2 vUv;
        void main(){float edge=smoothstep(0.0,0.16,vUv.x)*smoothstep(0.0,0.16,1.0-vUv.x);
          float alpha=vAlpha*edge;if(alpha<0.005)discard;gl_FragColor=vec4(0.025,0.029,0.032,alpha);}`,
      }),
    );
    const particles = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['position', this.smokePositions, 3],
      ['aAlpha', this.smokeAlphas, 1],
      ['aSize', this.smokeSizes, 1],
    ] as const)
      particles.setAttribute(
        name,
        new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage),
      );
    particles.setDrawRange(0, 0);
    this.smoke = new THREE.Points(
      particles,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uScale: { value: 600 },
          uShade: { value: 1 },
          uPerspective: { value: 1 },
        },
        vertexShader: `attribute float aAlpha,aSize;uniform float uScale,uPerspective;varying float vAlpha;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(aSize*uScale/mix(1.0,max(1.0,-p.z),uPerspective),1.0,52.0);
          vAlpha=aAlpha*(1.0-smoothstep(65.0,110.0,-p.z));}`,
        fragmentShader: `uniform float uShade;varying float vAlpha;
        void main(){float mask=1.0-smoothstep(0.05,1.0,length(gl_PointCoord*2.0-1.0));
          float alpha=mask*vAlpha;if(alpha<0.005)discard;gl_FragColor=vec4(vec3(0.64,0.67,0.69)*uShade,alpha);}`,
      }),
    );
    this.marks.name = 'Bounded road tyre skid ribbons';
    this.smoke.name = 'Bounded rear tyre drift smoke';
    this.marks.frustumCulled = this.smoke.frustumCulled = false;
    this.marks.visible = this.smoke.visible = false;
    e.scene.add(this.marks, this.smoke);
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }

  private pose(): Pose | null {
    if (this.e.settings.mode === 'tesla') {
      const p = this.e.tesla?.driftContact;
      return p && p.intensity > 0.025 && p.wheelContacts
        ? {
            id: 'tesla',
            position: p.position,
            quaternion: p.quaternion,
            wheels: p.wheelContacts.filter((v) => v[2] < 0),
            intensity: p.intensity,
            speed: p.speedMps,
            surfaceId: p.identity?.surfaceId ?? p.surfaceId,
            layer: p.identity?.layer,
          }
        : null;
    }
    const nav = this.e.navigation;
    if (
      this.e.settings.mode !== 'drive' ||
      nav?.mode !== 'drive' ||
      nav.driftIntensity <= 0.025
    )
      return null;
    return {
      id: 'drive:' + nav.carModel,
      position: nav.position.toArray(),
      quaternion: nav.car.quaternion.toArray(),
      wheels: nav.carModel === 'classic' ? CLASSIC_TYRES : ROADSTER_TYRES,
      intensity: nav.driftIntensity,
      speed: nav.speed,
      surfaceId: nav.surfaceId ?? 'ground',
      layer: nav.surfaceLayer,
    };
  }

  private floor(
    x: number,
    z: number,
    expected: number,
    id: string,
    layer?: number,
  ) {
    if (id === 'ground') return this.e.data.roadSurface?.sample(x, z, expected);
    return this.e.data.travelSurfaces
      ?.lookup(x, z)
      .find(
        (p: {
          surfaceId: string;
          layer: number;
          y: number;
          allowedModes: readonly string[];
        }) =>
          p.surfaceId === id &&
          (layer === undefined || p.layer === layer) &&
          p.allowedModes.includes('drive') &&
          Math.abs(p.y - expected) < 0.3,
      )?.y;
  }

  private mark(from: THREE.Vector3, to: THREE.Vector3, intensity: number) {
    const dx = to.x - from.x,
      dz = to.z - from.z,
      distance = Math.hypot(dx, dz);
    if (distance < 0.08) return;
    const x = (-dz / distance) * 0.105,
      z = (dx / distance) * 0.105;
    const slot = this.markCursor++ % this.markBudget,
      offset = slot * 18;
    this.markPositions.set(
      [
        from.x - x,
        from.y + 0.018,
        from.z - z,
        from.x + x,
        from.y + 0.018,
        from.z + z,
        to.x - x,
        to.y + 0.018,
        to.z - z,
        from.x + x,
        from.y + 0.018,
        from.z + z,
        to.x + x,
        to.y + 0.018,
        to.z + z,
        to.x - x,
        to.y + 0.018,
        to.z - z,
      ],
      offset,
    );
    this.markLife[slot] = this.fadeSeconds;
    this.markStrength[slot] = 0.16 + intensity * 0.34;
    this.markPeak = Math.max(this.markPeak, slot + 1);
    this.marks.geometry.getAttribute('position').needsUpdate = true;
  }

  private continuous(from: THREE.Vector3, to: THREE.Vector3, pose: Pose) {
    if (pose.surfaceId === 'ground')
      return (
        this.e.data.roadSurface?.coversSegment(
          [from.x, from.z],
          [to.x, to.z],
          (from.y + to.y) / 2,
          Math.abs(to.y - from.y) / 2 + 0.2,
        ) === true
      );
    const samples = Math.ceil(from.distanceTo(to) / 0.25);
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const expected = from.y + (to.y - from.y) * t;
      const floor = this.floor(
        from.x + (to.x - from.x) * t,
        from.z + (to.z - from.z) * t,
        expected,
        pose.surfaceId,
        pose.layer,
      );
      if (floor === undefined || Math.abs(floor - expected) > 0.2) return false;
    }
    return true;
  }

  private puff(point: THREE.Vector3, intensity: number) {
    if (this.reducedMotion || this.smokeCount >= this.smokeBudget) return;
    const i = this.smokeCount++,
      k = i * 3;
    this.smokePositions.set([point.x, point.y + 0.1, point.z], k);
    this.smokeVelocity.set(
      [
        (this.random() - 0.5) * 0.6,
        0.4 + intensity * 0.4,
        (this.random() - 0.5) * 0.6,
      ],
      k,
    );
    this.smokeLife[i] = this.smokeDuration[i] = 0.65 + this.random() * 0.65;
    this.smokeSizes[i] = 0.22 + intensity * 0.12;
    this.smokeAlphas[i] = 0;
  }

  update(dt: number) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const quality = this.e.settings.quality;
    const low = quality === 'balanced' || this.e.compatibleGraphics;
    const medium = quality === 'high';
    this.markBudget = this.e.compatibleGraphics
      ? 48
      : low
        ? 96
        : medium
          ? 192
          : DRIFT_EFFECT_CAPACITY.marks;
    this.smokeBudget = this.e.compatibleGraphics
      ? 12
      : low
        ? 24
        : medium
          ? 48
          : DRIFT_EFFECT_CAPACITY.smoke;
    this.fadeSeconds = low ? 8 : medium ? 12 : 18;
    this.smokeCount = Math.min(this.smokeCount, this.smokeBudget);
    this.markPeak = Math.min(this.markPeak, this.markBudget);
    this.markCursor %= this.markBudget;
    for (let i = this.markBudget; i < this.markLife.length; i++)
      this.markLife[i] = 0;
    this.cooldown -= dt;
    const pose = dt <= 0.15 ? this.pose() : null;
    if (
      !pose ||
      !finite(pose.position, 3) ||
      !finite(pose.quaternion, 4) ||
      !Number.isFinite(pose.intensity) ||
      !Number.isFinite(pose.speed) ||
      pose.speed < 3.2 ||
      pose.wheels.length !== 2 ||
      Math.abs(pose.quaternion.reduce((n, v) => n + v * v, 0) - 1) > 0.02
    ) {
      this.identity = '';
      this.connected.fill(false);
    } else {
      const id = pose.id + ':' + pose.surfaceId + ':' + pose.layer;
      if (id !== this.identity) this.connected.fill(false);
      this.identity = id;
      if (this.cooldown <= 0) {
        this.cooldown = low ? 0.1 : medium ? 0.065 : 0.045;
        this.origin.fromArray(pose.position);
        this.rotation.fromArray(pose.quaternion).normalize();
        const intensity = THREE.MathUtils.clamp(pose.intensity, 0, 1);
        for (let i = 0; i < 2; i++) {
          if (!finite(pose.wheels[i], 3)) {
            this.connected[i] = false;
            continue;
          }
          this.wheel
            .fromArray(pose.wheels[i])
            .applyQuaternion(this.rotation)
            .add(this.origin);
          const y = this.floor(
            this.wheel.x,
            this.wheel.z,
            this.wheel.y,
            pose.surfaceId,
            pose.layer,
          );
          if (
            y === undefined ||
            !Number.isFinite(y) ||
            Math.abs(y - this.wheel.y) > 0.3
          ) {
            this.connected[i] = false;
            continue;
          }
          this.wheel.y = y;
          const distance = this.wheel.distanceTo(this.previous[i]);
          // Discontinuous entry/teleport or a departed road starts a new ribbon.
          if (
            this.connected[i] &&
            distance < 6 &&
            distance > 0.08 &&
            this.continuous(this.previous[i], this.wheel, pose)
          )
            this.mark(this.previous[i], this.wheel, intensity);
          this.puff(this.wheel, intensity);
          this.previous[i].copy(this.wheel);
          this.connected[i] = true;
        }
      }
    }
    this.activeMarks = 0;
    for (let i = 0; i < this.markPeak; i++) {
      this.markLife[i] = Math.max(0, this.markLife[i] - dt);
      if (this.markLife[i] > 0) this.activeMarks++;
      const alpha = this.markStrength[i] * Math.min(1, this.markLife[i] / 4);
      this.markAlphas.fill(alpha, i * 6, i * 6 + 6);
    }
    this.marks.geometry.setDrawRange(0, this.markPeak * 6);
    this.marks.geometry.getAttribute('aAlpha').needsUpdate = true;
    this.marks.visible = this.activeMarks > 0;
    const step = Math.min(dt, 0.1);
    let i = 0;
    while (i < this.smokeCount) {
      this.smokeLife[i] -= dt;
      if (this.smokeLife[i] <= 0) {
        const last = --this.smokeCount;
        for (const data of [this.smokePositions, this.smokeVelocity])
          data.copyWithin(i * 3, last * 3, last * 3 + 3);
        for (const data of [
          this.smokeAlphas,
          this.smokeSizes,
          this.smokeLife,
          this.smokeDuration,
        ])
          data[i] = data[last];
        continue;
      }
      for (let axis = 0; axis < 3; axis++)
        this.smokePositions[i * 3 + axis] +=
          this.smokeVelocity[i * 3 + axis] * step;
      const age = 1 - this.smokeLife[i] / this.smokeDuration[i];
      this.smokeAlphas[i] = Math.min(1, age * 6) * (1 - age) * 0.2;
      this.smokeSizes[i] += step * 0.28;
      i++;
    }
    const camera = this.e.camera as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera;
    this.smoke.material.uniforms.uPerspective.value =
      camera instanceof THREE.OrthographicCamera ? 0 : 1;
    this.smoke.material.uniforms.uScale.value =
      camera instanceof THREE.PerspectiveCamera
        ? 300 / Math.tan((camera.fov * Math.PI) / 360)
        : camera instanceof THREE.OrthographicCamera
          ? (512 * camera.zoom) / Math.max(1, camera.top - camera.bottom)
          : 600;
    const hour = this.e.clock?.hour ?? 14;
    this.smoke.material.uniforms.uShade.value =
      hour < 7 || hour > 19 ? 0.28 : 1;
    this.smoke.geometry.setDrawRange(0, this.smokeCount);
    for (const attribute of Object.values(this.smoke.geometry.attributes))
      attribute.needsUpdate = true;
    this.smoke.visible = this.smokeCount > 0;
  }

  stats() {
    return {
      capacity: DRIFT_EFFECT_CAPACITY,
      markBudget: this.markBudget,
      smokeBudget: this.smokeBudget,
      marks: this.activeMarks,
      smoke: this.smokeCount,
      drawCalls: Number(this.marks.visible) + Number(this.smoke.visible),
      bufferBytes: [
        this.markPositions,
        this.markAlphas,
        this.markLife,
        this.markStrength,
        this.smokePositions,
        this.smokeVelocity,
        this.smokeAlphas,
        this.smokeSizes,
        this.smokeLife,
        this.smokeDuration,
        this.marks.geometry.getAttribute('uv').array,
      ].reduce((n, a) => n + a.byteLength, 0),
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeMarks = this.smokeCount = 0;
    this.connected.fill(false);
    for (const object of [this.marks, this.smoke]) {
      object.visible = false;
      object.removeFromParent();
      object.geometry.dispose();
      object.material.dispose();
    }
  }
}
