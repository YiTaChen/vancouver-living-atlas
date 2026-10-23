import * as THREE from 'three';
import type { CityEngine } from './engine';
import {
  sampleRocketEffects,
  rocketDirection,
  ROCKET_CONFIGS,
  type RocketKind,
  type RocketState,
} from './rocket-state';
import { disposeRocketObject } from './assets/rocket';
import type { ForestTree } from './detailed-trees';
import type { RocketCityContact } from './rocket-controller';

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
  collapseElapsed: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dirtyPosition: boolean;
  dirtyColor: boolean;
  fragmentsStage: number;
  contact?: THREE.Vector3;
};
type BuildingSurface = {
  mesh: THREE.Mesh;
  source: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  damage: THREE.BufferAttribute | THREE.InstancedBufferAttribute;
  position: Float32Array | null;
  world: Float32Array | null;
  areas: (DamagedPart | null)[];
  matrix: THREE.Matrix4;
  shared: boolean;
  version: number;
  stateKey: string;
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
  pressure: number;
  fall: number;
  bend: THREE.Matrix4;
  fromBase: THREE.Matrix4;
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
const unit = (n: number) => Math.max(0, Math.min(1, n));
type EffectProfile = {
  buildings: number;
  trees: number;
  flying: number;
  fragments: number;
  exhaustRate: number;
  fireRate: number;
  impactSpeed: number;
  explosionCount: number;
  treeFall: number;
};
const EFFECT_PROFILES: Readonly<Record<RocketKind, EffectProfile>> = {
  small: {
    buildings: 48,
    trees: 28,
    flying: 48,
    fragments: 64,
    exhaustRate: 65,
    fireRate: 55,
    impactSpeed: 65,
    explosionCount: 75,
    treeFall: 0.35,
  },
  large: {
    buildings: 48,
    trees: 28,
    flying: 48,
    fragments: 64,
    exhaustRate: 130,
    fireRate: 85,
    impactSpeed: 90,
    explosionCount: 125,
    treeFall: 0.7,
  },
  'super-heavy': {
    buildings: 96,
    trees: 56,
    flying: 96,
    fragments: 96,
    exhaustRate: 260,
    fireRate: 150,
    impactSpeed: 90,
    explosionCount: 225,
    treeFall: 0.7,
  },
};

/** Shared settlement curve: initial sag, then a readable 2.6-second floor collapse. */
export function rocketSupportCollapseProgress(elapsed: number) {
  const t = unit(Math.max(0, elapsed) / 2.6);
  return 0.035 + 0.965 * t * t * (3 - 2 * t);
}

function buildingTop(part: BodyPart, collapse: number) {
  return part.minY + (part.maxY - part.minY) * (1 - collapse * 0.925);
}

function supportsRocket(damage: DamagedPart, state: RocketState) {
  const b = damage.bounds;
  return (
    state.supportCollapsed &&
    (state.support.kind === 'roof-small' ||
      state.support.kind === 'roof-large') &&
    state.origin.x >= b.minX &&
    state.origin.x <= b.maxX &&
    state.origin.z >= b.minZ &&
    state.origin.z <= b.maxZ
  );
}

// Closest distance between the vehicle axis and a tree's vertical flame capsule.
// Finite segments keep a burning forest below a high vehicle from heating it.
function flameDistance(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  x: number,
  bottom: number,
  z: number,
  top: number,
) {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az,
    vy = top - bottom,
    wx = ax - x,
    wy = ay - bottom,
    wz = az - z,
    a = ux * ux + uy * uy + uz * uz,
    b = uy * vy,
    c = vy * vy,
    d = ux * wx + uy * wy + uz * wz,
    e = vy * wy,
    denominator = a * c - b * b;
  let s = denominator > 1e-8 ? unit((b * e - c * d) / denominator) : 0;
  const t = c > 1e-8 ? unit((b * s + e) / c) : 0;
  s = a > 1e-8 ? unit((b * t - d) / a) : 0;
  return Math.hypot(wx + s * ux, wy + s * uy - t * vy, wz + s * uz);
}

/** Local, bounded visual response. Shared city assets and source geography stay owned by the city. */
export class RocketEffects {
  readonly group = new THREE.Group();
  damaged = 0;
  burning = 0;
  debris = 0;
  private parts: DamagedPart[] = [];
  private contactParts: DamagedPart[] = [];
  private contacts = new Set<string>();
  private surfaceVersion = 0;
  private surfaceVertices = 0;
  private surfaceInstances = 0;
  private buildingSurfaces = new Map<THREE.Mesh, BuildingSurface>();
  private buildingMaterials = new Map<THREE.Material, THREE.Material>();
  private surfaceRestores: {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    appliedGeometry: THREE.BufferGeometry;
    appliedMaterial: THREE.Material | THREE.Material[];
  }[] = [];
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
    dust: boolean;
  }[];
  private spawn = 0;
  private vehicleSpawn = 0;
  private next = 0;
  private dustNext = 0;
  private dustSpawn = 0;
  private dustAlive = 0;
  private time = 0;
  private scanAt = 0;
  private eventId = 0;
  private restoredAfterFailure: boolean;
  private readonly profile: EffectProfile;
  private readonly strength: number;
  private shadowAt = -Infinity;
  private scorch: THREE.Mesh;
  private shock: THREE.Mesh;
  private shockAge = 99;
  private shockPower = 1;
  private savedGround: THREE.Vector3;
  private lastState: RocketState;
  private fragmentTransform = new THREE.Object3D();
  private vehicleAnchor = new THREE.Vector3();
  private treeInstance = new THREE.Matrix4();
  private treeLocal = new THREE.Matrix4();
  private groundOutwash: THREE.InstancedMesh | null = null;
  private outwashPower = { value: 0 };
  private outwashTime = { value: 0 };
  private outwashTransform = new THREE.Object3D();
  private groundContacts = Array.from({ length: 5 }, () => new THREE.Vector3());
  private groundContactCount = 0;
  constructor(
    private e: CityEngine,
    state: RocketState,
  ) {
    this.lastState = state;
    // A recreated consumer (city repair/resource retry) starts at the current
    // snapshot. Past impacts and fuel bursts must not play a second time.
    this.eventId = state.events.at(-1)?.id ?? 0;
    this.restoredAfterFailure = !!state.wreckage;
    this.profile = EFFECT_PROFILES[state.kind];
    this.strength = ROCKET_CONFIGS[state.kind].effectStrength;
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
        .slice(0, this.profile.buildings)
        .map((part: BodyPart) => {
          const position = new Float32Array(
            (pos.array as Float32Array).subarray(
              part.start * 3,
              (part.start + part.count) * 3,
            ),
          );
          const bounds = {
            minX: Infinity,
            maxX: -Infinity,
            minZ: Infinity,
            maxZ: -Infinity,
          };
          for (let i = 0; i < position.length; i += 3) {
            bounds.minX = Math.min(bounds.minX, position[i]);
            bounds.maxX = Math.max(bounds.maxX, position[i]);
            bounds.minZ = Math.min(bounds.minZ, position[i + 2]);
            bounds.maxZ = Math.max(bounds.maxZ, position[i + 2]);
          }
          return {
            part,
            position,
            bounds,
            color: new Float32Array(
              (color.array as Float32Array).subarray(
                part.start * 3,
                (part.start + part.count) * 3,
              ),
            ),
            exposure: 0,
            collapse: 0,
            collapseElapsed: -1,
            dirtyPosition: false,
            dirtyColor: false,
            fragmentsStage: 0,
          };
        });
    }
    this.rubble = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6e655b, roughness: 1 }),
      this.profile.fragments,
    );
    this.rubble.count = 0;
    this.rubble.frustumCulled = false;
    this.rubble.name = `Rocket building debris (${this.profile.fragments} slot limit)`;
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rubble);
    const n =
      state.kind === 'super-heavy'
        ? e.compatibleGraphics
          ? 240
          : e.settings.quality === 'balanced'
            ? 360
            : 600
        : e.compatibleGraphics || e.settings.quality === 'balanced'
          ? 160
          : 420;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.outwashTime,
        uScale: {
          value: e.container.clientHeight * 0.55 * Math.sqrt(this.strength),
        },
      },
      vertexShader:
        'attribute float aLife; varying float vLife; uniform float uScale; void main(){vLife=aLife;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(uScale*(aLife< -2.?34.:(abs(aLife)>1.?4.:9.))/max(2.,-p.z),1.,aLife< -2.?260.:110.);}',
      fragmentShader:
        'varying float vLife;uniform float uTime;void main(){vec2 p=(gl_PointCoord-.5)*2.;float d=length(p);if(d>1.||vLife==0.)discard;bool dust=vLife< -2.;bool hot=vLife>1.;float a=dust?-vLife-2.:(hot?vLife-1.:abs(vLife));float curl=.72+.28*sin(p.x*8.+sin(p.y*6.+uTime*1.7)*2.-uTime*2.);vec3 smoke=dust?mix(vec3(.24,.19,.14),vec3(.59,.48,.35),curl):(vLife<0.?mix(vec3(.12,.15,.17),vec3(.42,.43,.43),a):mix(vec3(.50,.55,.59),vec3(.84,.88,.90),a));vec3 c=hot?mix(vec3(1.,.18,.02),vec3(1.,.86,.4),a):smoke;gl_FragColor=vec4(c,(1.-smoothstep(dust?.05:.15,1.,d))*a*(dust?.78*curl:.65));}',
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
      dust: false,
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
    this.scorch.name = 'Rocket ground scorch footprint';
    this.scorch.position.copy(this.savedGround);
    this.scorch.position.y += 0.35;
    this.group.add(this.scorch);
    if (state.kind === 'super-heavy') {
      // Forty fading ribbons share one draw call. The five jets hit the local
      // surface and turn outward; they are not a giant fireball under the city.
      this.groundOutwash = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          blending: THREE.AdditiveBlending,
          uniforms: { uPower: this.outwashPower, uTime: this.outwashTime },
          vertexShader:
            'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
          fragmentShader: `
            uniform float uPower; uniform float uTime; varying vec2 vUv;
            void main(){
              float forward=1.-vUv.y;
              float curl=.16*sin(forward*17.-uTime*8.)+.07*sin(forward*35.+uTime*11.);
              float edge=max(0.,1.-abs((vUv.x-.5)*2.-curl)/max(.16,1.-forward*.7));
              float tail=1.-smoothstep(.15,1.,forward);
              float pulse=.65+.35*sin(forward*34.-uTime*23.+sin(vUv.x*19.+uTime*7.));
              vec3 color=mix(vec3(1.,.44,.045),vec3(.72,.075,.004),forward);
              gl_FragColor=vec4(color,pow(edge,1.5)*tail*pulse*uPower*.85);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        }),
        40,
      );
      this.groundOutwash.name = 'Titan five-jet ground flame outwash';
      this.groundOutwash.count = 0;
      this.groundOutwash.frustumCulled = false;
      this.groundOutwash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.groundOutwash);
    }
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
      .slice(0, this.profile.trees)) {
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
        pressure: 0,
        fall: 0,
        bend: new THREE.Matrix4(),
        fromBase: new THREE.Matrix4().makeTranslation(-t.x, -t.y, -t.z),
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
  /** A real collision damages the contacted city surface before the vehicle response. */
  receiveCollision(contact: RocketCityContact, state: RocketState, dt: number) {
    if (!contact.bounds || this.restoredAfterFailure) return;
    this.lastState = state;
    const b = contact.bounds;
    let damage = [...this.parts, ...this.contactParts].find(
      (d) =>
        Math.abs(d.bounds.minX - b.minX) < 0.2 &&
        Math.abs(d.bounds.maxX - b.maxX) < 0.2 &&
        Math.abs(d.bounds.minZ - b.minZ) < 0.2 &&
        Math.abs(d.bounds.maxZ - b.maxZ) < 0.2 &&
        Math.abs(d.part.minY - b.minY) < 0.2,
    );
    if (!damage && contact.source === 'building' && this.body) {
      const position = this.body.geometry.getAttribute('position');
      const part = (this.e.data.rocketBuildingParts ?? []).find(
        (p: BodyPart) => {
          if (Math.abs(p.minY - b.minY) > 0.2) return false;
          let minX = Infinity,
            maxX = -Infinity,
            minZ = Infinity,
            maxZ = -Infinity;
          for (let i = p.start; i < p.start + p.count; i++) {
            minX = Math.min(minX, position.getX(i));
            maxX = Math.max(maxX, position.getX(i));
            minZ = Math.min(minZ, position.getZ(i));
            maxZ = Math.max(maxZ, position.getZ(i));
          }
          return (
            Math.abs(minX - b.minX) < 0.2 &&
            Math.abs(maxX - b.maxX) < 0.2 &&
            Math.abs(minZ - b.minZ) < 0.2 &&
            Math.abs(maxZ - b.maxZ) < 0.2
          );
        },
      );
      if (part && this.parts.length >= this.profile.buildings) {
        const replace = this.parts.findLastIndex(
          (d) => !d.contact && d.exposure === 0 && d.collapse === 0,
        );
        if (replace >= 0) this.parts.splice(replace, 1);
      }
      if (part && this.parts.length < this.profile.buildings) {
        const color = this.body.geometry.getAttribute('color');
        damage = {
          part,
          position: new Float32Array(
            (position.array as Float32Array).subarray(
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
          bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
          exposure: 0,
          collapse: 0,
          collapseElapsed: -1,
          dirtyPosition: false,
          dirtyColor: false,
          fragmentsStage: 0,
        };
        this.parts.push(damage);
        this.surfaceVersion++;
      }
    }
    if (
      !damage &&
      contact.source !== 'building' &&
      this.contactParts.length < 8
    ) {
      damage = {
        part: {
          key: `${contact.source}:${b.minX}:${b.minZ}`,
          center: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2],
          minY: b.minY,
          maxY: b.maxY,
          start: 0,
          count: 0,
        },
        position: new Float32Array(),
        color: new Float32Array(),
        bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
        exposure: 0,
        collapse: 0,
        collapseElapsed: -1,
        dirtyPosition: false,
        dirtyColor: false,
        fragmentsStage: 0,
      };
      this.contactParts.push(damage);
      this.surfaceVersion++;
    }
    if (!damage) return;
    const load = Math.min(4, Math.sqrt(Math.max(0, contact.mass) / 120000)),
      severity = unit(contact.speed / 50 + load * 0.12),
      engine = sampleRocketEffects(state).engine;
    damage.exposure = Math.min(
      1,
      Math.max(damage.exposure, 0.32 + severity * 0.2) +
        Math.max(0, Math.min(0.1, dt)) * (0.35 + load * 0.3 + engine * 0.45),
    );
    damage.dirtyColor = true;
    damage.collapse = Math.max(
      damage.collapse,
      Math.min(0.2, 0.3 / Math.max(1, damage.part.maxY - damage.part.minY)),
    );
    damage.dirtyPosition = true;
    damage.contact = new THREE.Vector3(
      contact.point.x,
      contact.point.y,
      contact.point.z,
    );
    const key = `${damage.part.key}:${damage.part.start}:${damage.part.minY}`;
    if (!this.contacts.has(key)) {
      this.contacts.add(key);
      const first = this.fragments.length;
      this.emitBuildingFragments(
        damage,
        Math.max(0.45, severity * this.strength),
        this.strength > 1 ? 8 : 4,
      );
      for (let i = first; i < this.fragments.length; i++) {
        this.fragments[i].p
          .copy(damage.contact)
          .add(
            new THREE.Vector3(
              (rand(i + 31) - 0.5) * contact.radius,
              (rand(i + 32) - 0.5) * contact.radius,
              (rand(i + 33) - 0.5) * contact.radius,
            ),
          );
      }
      for (let i = 0; i < 12; i++)
        this.emit(
          contact.point.x,
          contact.point.y,
          contact.point.z,
          0.4 + severity,
          false,
          true,
        );
    }
    this.damaged = [...this.parts, ...this.contactParts].filter(
      (d) => d.exposure > 0.12,
    ).length;
  }
  /** Local forest feedback; the number of fires elsewhere never heats this vehicle. */
  sampleVehicleHeat(state: RocketState): number {
    const config = ROCKET_CONFIGS[state.kind],
      direction = rocketDirection(state.attitude),
      lower = config.height * (state.boosterAttached ? 0.08 : 0.46),
      upper = config.height * 0.94;
    let unheated = 1;
    for (const tree of this.trees) {
      if (tree.heat <= 0.13) continue;
      const distance = flameDistance(
        state.position.x + direction.x * lower,
        state.position.y + direction.y * lower,
        state.position.z + direction.z * lower,
        state.position.x + direction.x * upper,
        state.position.y + direction.y * upper,
        state.position.z + direction.z * upper,
        tree.x,
        tree.y + 0.5,
        tree.z,
        tree.y + tree.h * 1.1,
      );
      const radius = 10 + tree.h * 0.35,
        falloff = unit(1 - Math.max(0, distance - config.radius) / radius),
        intensity = unit((tree.heat - 0.13) / 0.4);
      unheated *= 1 - intensity * falloff * falloff;
    }
    return unit(1 - unheated);
  }
  /** Deformed local roof height for a swept support collision; null outside damaged parts. */
  supportCollisionHeight(
    x: number,
    z: number,
    state: RocketState = this.lastState,
  ): number | null {
    let height: number | null = null;
    for (const damage of [...this.parts, ...this.contactParts]) {
      const b = damage.bounds;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const supporting =
        !this.restoredAfterFailure && supportsRocket(damage, state);
      const collapse = supporting
        ? Math.max(
            damage.collapse,
            rocketSupportCollapseProgress(state.supportCollapseElapsed),
          )
        : damage.collapse;
      if (!supporting && collapse <= 0) continue;
      height = Math.max(
        height ?? -Infinity,
        buildingTop(damage.part, collapse),
      );
    }
    return height;
  }
  private emit(
    x: number,
    y: number,
    z: number,
    power: number,
    hot: boolean,
    soot = false,
    rise = false,
    groundDust = false,
  ) {
    const reserved =
        (this.groundContactCount || this.dustAlive > 0) &&
        !this.lastState.wreckage &&
        this.lastState.fireIntensity <= 0 &&
        (this.lastState.phase === 'ignition' ||
          this.lastState.phase === 'flight')
          ? Math.floor(this.particles.length * 0.4)
          : 0,
      index =
        groundDust && reserved
          ? this.particles.length - reserved + (this.dustNext++ % reserved)
          : this.next % (this.particles.length - reserved),
      p = this.particles[index],
      k = ++this.next;
    if (p.dust && p.age < p.life)
      this.dustAlive = Math.max(0, this.dustAlive - 1);
    p.p.set(x, y, z);
    p.age = 0;
    p.life = hot ? 0.4 + rand(k) * 0.6 : 2 + rand(k) * 4;
    p.hot = hot;
    p.soot = soot;
    p.dust = false;
    const a = rand(k + 9) * Math.PI * 2,
      speed = (3 + rand(k + 3) * 15) * power;
    p.v.set(
      Math.cos(a) * speed,
      hot && !rise ? -5 - rand(k) * 12 : 4 + rand(k) * 8,
      Math.sin(a) * speed,
    );
    return p;
  }
  private emitBuildingFragments(d: DamagedPart, power: number, requested = 2) {
    const count = Math.min(
        requested,
        this.profile.fragments - this.fragments.length,
      ),
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
          d.part.minY +
            height * (1 - d.collapse * 0.925) * (0.2 + rand(k + 2) * 0.75),
          d.part.center[1] + (rand(k + 3) - 0.5) * 8,
        ),
        v: new THREE.Vector3(
          (dx / distance) * speed,
          (4 + rand(k + 4) * 13) * Math.sqrt(this.strength),
          (dz / distance) * speed,
        ),
        age: 0,
        size: new THREE.Vector3(
          0.3 + rand(k + 5) * 1.4,
          0.2 + rand(k + 6) * 0.8,
          0.4 + rand(k + 7),
        ).multiplyScalar(Math.sqrt(this.strength)),
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
  private updateVehicleEffects(
    dt: number,
    state: RocketState,
    anchor?: THREE.Vector3 | null,
  ) {
    const config = ROCKET_CONFIGS[state.kind],
      wreckage = state.wreckage,
      center = this.vehicleAnchor;
    if (anchor && wreckage) center.copy(anchor);
    else if (wreckage) {
      const t = Math.max(0, state.elapsed - wreckage.time);
      center.set(
        wreckage.position.x + wreckage.velocity.x * t,
        Math.max(
          state.support.groundY ?? this.savedGround.y,
          wreckage.position.y + wreckage.velocity.y * t - 4.905 * t * t,
        ),
        wreckage.position.z + wreckage.velocity.z * t,
      );
    } else center.set(state.position.x, state.position.y, state.position.z);

    for (const event of state.events) {
      if (event.id <= this.eventId) continue;
      this.eventId = event.id;
      const exploded = event.type === 'exploded',
        impact = event.type === 'impact',
        rupture = event.type === 'ruptured';
      if (!exploded && !impact && !rupture) continue;
      // The event stores the true collision/burnup position; after breakup the
      // model can supply the moving fragment centroid for a delayed fuel burst.
      const x = exploded && wreckage ? center.x : event.position.x,
        y = exploded && wreckage ? center.y : event.position.y,
        z = exploded && wreckage ? center.z : event.position.z,
        severity = impact
          ? unit(event.magnitude / this.profile.impactSpeed)
          : 0.4,
        count = exploded
          ? Math.min(this.particles.length, this.profile.explosionCount)
          : Math.round((10 + severity * 38) * this.strength);
      for (let i = 0; i < count; i++) {
        const spark = !exploded && impact && severity > 0.28 && i % 9 === 0,
          hot = exploded ? i % 2 === 0 : spark,
          particle = this.emit(
            x,
            y + (impact ? 0.5 : 0),
            z,
            (exploded ? 1.7 : 0.25 + severity) * this.strength,
            hot,
            true,
            true,
          ),
          k = this.next,
          speed =
            (exploded ? 12 + rand(k + 2) * 24 : 2 + severity * 14) *
            this.strength;
        particle.v.y = exploded
          ? (rand(k + 4) - 0.3) * speed
          : 1 + rand(k + 4) * speed * 0.5;
        if (spark) particle.life = 0.12 + rand(k + 3) * 0.25;
        if (exploded && hot) particle.life = 0.55 + rand(k + 3) * 0.9;
      }
      if (impact || exploded) {
        this.shockAge = 0;
        this.shockPower =
          (exploded ? 1 : 0.15 + severity * 0.55) * this.strength;
        this.shock.position.set(x, y + 0.5, z);
      }
    }

    const intensity = unit(state.fireIntensity);
    if (intensity <= 0 || state.phase === 'sinking') return;
    const direction = rocketDirection(state.attitude);
    this.vehicleSpawn += dt * this.profile.fireRate * this.strength * intensity;
    while (this.vehicleSpawn >= 1) {
      this.vehicleSpawn--;
      const k = this.next + 1,
        offset = wreckage
          ? 0
          : config.height *
            ((state.boosterAttached ? 0.1 : 0.47) +
              rand(k) * (state.boosterAttached ? 0.75 : 0.4)),
        angle = rand(k + 7) * Math.PI * 2,
        radius = config.radius * (0.65 + rand(k + 3) * 0.35),
        particle = this.emit(
          center.x + direction.x * offset + Math.cos(angle) * radius,
          center.y +
            direction.y * offset +
            (wreckage ? rand(k + 2) * config.radius : 0),
          center.z + direction.z * offset + Math.sin(angle) * radius,
          (0.12 + intensity * 0.2) * this.strength,
          this.next % 3 === 0,
          true,
          true,
        );
      if (!wreckage) {
        particle.v.x += state.velocity.x * 0.18;
        particle.v.y += state.velocity.y * 0.18;
        particle.v.z += state.velocity.z * 0.18;
      }
    }
  }
  private updateGroundOutwash(s: RocketState, exposure: number) {
    if (!this.groundOutwash) return;
    this.groundContactCount = 0;
    this.groundOutwash.count = 0;
    this.outwashPower.value = Math.min(1, exposure * 1.35);
    this.outwashTime.value = this.time;
    const direction = rocketDirection(s.attitude);
    if (exposure < 0.025 || direction.y < 0.25) return;
    const config = ROCKET_CONFIGS[s.kind],
      q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(direction.x, direction.y, direction.z),
      ),
      count = s.strapAttached ? 5 : 1;
    let nearestContact = Infinity;
    for (let source = 0; source < count; source++) {
      const angle = ((source - 1) * Math.PI) / 2,
        radius = source ? config.radius * 1.7 : 0,
        contact = this.groundContacts[source];
      contact
        .set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
        .applyQuaternion(q)
        .add(new THREE.Vector3(s.position.x, s.position.y, s.position.z));
      const nozzle = contact.clone(),
        ray = new THREE.Vector3(direction.x, direction.y, direction.z),
        heightAt = (x: number, z: number) => {
          const terrain = this.e.elevation?.(x, z) ?? this.savedGround.y,
            ground =
              this.e.data.roadSurface?.sample(x, z, terrain + 1.05) ?? terrain;
          return Math.max(
            ground,
            // Building-part rectangles can include open courtyards. They
            // describe a supporting roof only for an actual rooftop launch.
            s.support.kind.startsWith('roof')
              ? (this.supportCollisionHeight(x, z, s) ?? -Infinity)
              : -Infinity,
          );
        };
      // A tilted nozzle lands away from its own x/z. Re-sample there so a
      // nearby slope or collapsing roof cannot leave the footprint floating.
      for (let iteration = 0; iteration < 3; iteration++) {
        const drop =
          Math.max(0, nozzle.y - heightAt(contact.x, contact.z)) / direction.y;
        contact.copy(nozzle).addScaledVector(ray, -drop);
      }
      contact.y = heightAt(contact.x, contact.z) + 0.45;
      const reach = config.height * (source ? 0.5 : 0.7),
        distance = contact.distanceTo(nozzle);
      // Pressure and drifting dust outlive direct flame impingement. A jet
      // that no longer reaches the surface must stop painting fire on it.
      if (distance > reach) continue;
      nearestContact = Math.min(nearestContact, distance / reach);
      this.groundContacts[this.groundContactCount].copy(contact);
      for (let spoke = 0; spoke < 8; spoke++) {
        const a = (spoke * Math.PI) / 4 + source * 0.17,
          length = (18 + Math.sqrt(exposure) * 30) * (source ? 0.72 : 1),
          transform = this.outwashTransform;
        transform.position.set(
          contact.x + Math.sin(a) * length * 0.43,
          contact.y + spoke * 0.008,
          contact.z + Math.cos(a) * length * 0.43,
        );
        transform.rotation.set(0, a, 0);
        transform.scale.set(3 + Math.sqrt(exposure) * 7, 1, length);
        transform.updateMatrix();
        this.groundOutwash.setMatrixAt(
          this.groundContactCount * 8 + spoke,
          transform.matrix,
        );
      }
      this.groundContactCount++;
    }
    this.outwashPower.value *= Math.sqrt(Math.max(0, 1 - nearestContact));
    this.groundOutwash.count = this.groundContactCount * 8;
    this.groundOutwash.instanceMatrix.needsUpdate = true;
  }
  update(dt: number, s: RocketState, vehicleAnchor?: THREE.Vector3 | null) {
    this.lastState = s;
    this.time += dt;
    const f = sampleRocketEffects(s),
      config = ROCKET_CONFIGS[s.kind];
    if (s.phase === 'ignition' && this.shockAge > 90) {
      this.shockAge = 0;
      this.shockPower = Math.sqrt(this.strength);
    }
    this.shockAge += dt;
    const shockScale =
      this.shockAge * config.blastRadius * 1.5 * this.shockPower;
    this.shock.scale.setScalar(Math.max(0.01, shockScale));
    (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(
      0,
      0.45 * this.shockPower * (1 - this.shockAge / 1.5),
    );
    if (f.groundExposure > 0.01) {
      (this.scorch.material as THREE.MeshBasicMaterial).opacity = Math.min(
        Math.min(0.9, 0.72 * Math.sqrt(this.strength)),
        (this.scorch.material as THREE.MeshBasicMaterial).opacity +
          dt * 0.12 * this.strength,
      );
      this.scorch.scale.setScalar(
        Math.max(1, config.heatRadius * 0.7 * Math.sqrt(this.strength)),
      );
      for (const d of this.parts) {
        const distance = Math.hypot(
          Math.max(d.bounds.minX - s.origin.x, 0, s.origin.x - d.bounds.maxX),
          Math.max(d.bounds.minZ - s.origin.z, 0, s.origin.z - d.bounds.maxZ),
        );
        const falloff = Math.max(0, 1 - distance / (f.blastRadius + 10));
        // Low domestic buildings fail sooner; towers receive scorch and limited facade damage.
        const weakness =
          d.part.maxY - d.part.minY < 14
            ? 1
            : this.strength > 1
              ? 0.25 + 0.45 * Math.max(0, 1 - distance / 35)
              : 0.17;
        const exposure = Math.min(
          1,
          d.exposure +
            f.groundExposure * falloff * dt * weakness * 0.6 * this.strength,
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
              Math.max(0, 1 - distance / config.heatRadius) *
              this.strength,
        );
      }
    }
    for (const d of [...this.parts, ...this.contactParts]) {
      const supporting = !this.restoredAfterFailure && supportsRocket(d, s);
      if (supporting && d.exposure < 1) {
        d.exposure = 1;
        d.dirtyColor = true;
      }
      const target = Math.max(0, (d.exposure - 0.22) / 0.78);
      if (target > 0) {
        d.collapseElapsed = supporting
          ? s.supportCollapseElapsed
          : Math.max(0, d.collapseElapsed) + dt;
      }
      const collapse =
        target * rocketSupportCollapseProgress(Math.max(0, d.collapseElapsed));
      if (collapse > d.collapse + 0.00001) {
        d.collapse = collapse;
        d.dirtyPosition = true;
      }
      const stage =
        d.collapse > 0.65 ? 3 : d.collapse > 0.25 ? 2 : d.collapse > 0 ? 1 : 0;
      while (d.fragmentsStage < stage) {
        d.fragmentsStage++;
        this.emitBuildingFragments(
          d,
          f.groundExposure * this.strength,
          d.fragmentsStage === 3 ? 3 : 2,
        );
        for (let i = 0; i < 3; i++)
          this.emit(
            d.part.center[0],
            buildingTop(d.part, d.collapse),
            d.part.center[1],
            0.25,
            false,
          );
      }
    }
    this.damaged = [...this.parts, ...this.contactParts].filter(
      (d) => d.exposure > 0.12,
    ).length;
    this.burning = this.trees.filter((t) => t.heat > 0.13).length;
    for (const t of this.trees) {
      // Once lit, the local fuel continues burning after the exhaust moves away.
      if (t.heat > 0.13) t.heat = Math.min(1, t.heat + dt * 0.035);
      t.mesh.visible = t.heat > 0.13;
      t.mesh.position.y = t.y + t.h * 0.4;
      t.mesh.scale.set(
        1 + t.heat * 1.3,
        (t.h / 5) *
          (0.65 + t.heat * 0.35) *
          (1 + Math.sin(this.time * 15 + t.x) * 0.12),
        1 + t.heat,
      );
      t.charred.visible = t.heat > 0.3;
      const distance = Math.hypot(t.x - s.origin.x, t.z - s.origin.z);
      if (this.strength > 1) {
        t.pressure = Math.max(
          t.pressure,
          f.groundExposure *
            Math.max(0, 1 - distance / config.blastRadius) *
            this.strength,
        );
      }
      if (t.charred.visible || t.pressure > 0.01) {
        const pressureFall =
          this.strength > 1
            ? f.groundExposure *
              Math.max(0, 1 - distance / config.blastRadius) *
              this.strength *
              this.profile.treeFall
            : 0;
        t.fall = Math.min(
          1.35,
          t.fall +
            dt *
              (pressureFall ||
                f.groundExposure *
                  Math.max(0, 1 - distance / config.blastRadius) *
                  this.profile.treeFall),
        );
        const angle = Math.atan2(t.x - s.origin.x, t.z - s.origin.z);
        t.charred.rotation.set(
          Math.cos(angle) * t.fall,
          0,
          -Math.sin(angle) * t.fall,
        );
        t.charred.updateMatrix();
        t.bend.copy(t.charred.matrix).multiply(t.fromBase);
      }
      if (t.mesh.visible && rand(this.next + this.time) > 0.55)
        this.emit(t.x, t.y + 3, t.z, 0.3, false, true);
    }
    this.updateVehicleEffects(dt, s, vehicleAnchor);
    this.updateGroundOutwash(s, f.groundExposure);
    this.dustSpawn = this.groundContactCount
      ? Math.min(8, this.dustSpawn + dt * 50 * Math.sqrt(f.engine))
      : 0;
    if (f.engine > 0.03 && s.altitude < 14000) {
      this.spawn +=
        dt *
        this.profile.exhaustRate *
        this.strength *
        f.engine *
        Math.exp(-s.altitude / 1200);
      while (this.spawn > 1) {
        this.spawn--;
        const angle = rand(this.next + 17) * Math.PI * 2,
          radius =
            this.strength > 1 ? rand(this.next + 27) * config.radius * 1.4 : 0;
        const contact =
          this.groundContactCount && this.dustSpawn >= 1 && this.next % 3 !== 0
            ? this.groundContacts[this.next % this.groundContactCount]
            : null;
        const particle = this.emit(
          contact ? contact.x : s.position.x + Math.cos(angle) * radius,
          contact
            ? contact.y
            : Math.max(this.savedGround.y + 1, s.position.y - 3),
          contact ? contact.z : s.position.z + Math.sin(angle) * radius,
          f.engine * this.strength,
          s.kind !== 'super-heavy' && this.next % 4 === 0,
          false,
          false,
          !!contact,
        );
        if (contact) {
          this.dustSpawn--;
          particle.dust = true;
          this.dustAlive++;
          particle.hot = false;
          particle.life = 3.5 + rand(this.next + 12) * 2;
          const speed =
            (18 + rand(this.next + 41) * 29) * Math.sqrt(this.strength);
          particle.v.set(
            Math.cos(angle) * speed,
            1.5 + rand(this.next + 4) * 5,
            Math.sin(angle) * speed,
          );
        }
      }
    }
    this.dustAlive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.alphas[i] = 0;
        continue;
      }
      if (p.dust) this.dustAlive++;
      p.v.y += dt * (p.hot ? -3 : p.dust ? 2.4 : 1.5);
      if (p.dust) {
        const drag = Math.exp(-dt * 0.42),
          turn = Math.sin(p.age * 5 + i) * dt * 0.18,
          vx = p.v.x;
        p.v.x = (p.v.x - p.v.z * turn) * drag;
        p.v.z = (p.v.z + vx * turn) * drag;
      }
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < this.savedGround.y + 0.5) {
        p.p.y = this.savedGround.y + 0.5;
        p.v.y = Math.abs(p.v.y) * 0.3;
      }
      this.positions[i * 3] = p.p.x;
      this.positions[i * 3 + 1] = p.p.y;
      this.positions[i * 3 + 2] = p.p.z;
      const alpha = Math.max(0.001, 1 - p.age / p.life);
      this.alphas[i] = p.dust
        ? -2 - alpha
        : ((p.hot ? 1 : 0) + alpha) * (p.soot && !p.hot ? -1 : 1);
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
  /** Bend the original healthy tree geometry, then let its LOD owner restore it after this draw. */
  private bendTreeSlot(
    tree: BurntTree,
    mesh: THREE.InstancedMesh,
    index: number,
  ) {
    mesh.updateWorldMatrix(true, false);
    mesh.getMatrixAt(index, this.treeInstance);
    this.treeLocal.copy(mesh.matrixWorld).invert();
    this.treeInstance
      .premultiply(mesh.matrixWorld)
      .premultiply(tree.bend)
      .premultiply(this.treeLocal);
    this.overrideSlot(mesh, index, this.treeInstance);
  }
  private damageMaterial(source: THREE.Material) {
    const cached = this.buildingMaterials.get(source);
    if (cached) return cached;
    const material = source.clone(),
      compile = source.onBeforeCompile.bind(source),
      key = source.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      if (
        !shader.vertexShader.includes('#include <begin_vertex>') ||
        !shader.fragmentShader.includes('#include <opaque_fragment>')
      )
        return;
      shader.vertexShader =
        'attribute float aRocketDamage; varying float vRocketDamage;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRocketDamage=aRocketDamage;',
      );
      shader.fragmentShader =
        'varying float vRocketDamage;\n' + shader.fragmentShader;
      // Apply only to this mission-owned material, after glass and night emission.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb*=mix(vec3(1.),vec3(.18,.15,.13),clamp(vRocketDamage,0.,1.));',
      );
    };
    material.customProgramCacheKey = () => key + ':rocket-local-damage-v1';
    this.buildingMaterials.set(source, material);
    return material;
  }
  private releaseSurface(surface: BuildingSurface) {
    if (surface.mesh instanceof THREE.InstancedMesh)
      this.surfaceInstances -= surface.damage.count;
    if (surface.shared) {
      // These attributes/index remain city-owned. Dispose only our added buffer.
      for (const name of Object.keys(surface.geometry.attributes))
        if (name !== 'aRocketDamage') surface.geometry.deleteAttribute(name);
      surface.geometry.setIndex(null);
    } else this.surfaceVertices -= surface.damage.count;
    surface.geometry.dispose();
    this.buildingSurfaces.delete(surface.mesh);
  }
  private surfaceFor(mesh: THREE.Mesh): BuildingSurface | null {
    const instanced = mesh instanceof THREE.InstancedMesh;
    let surface = this.buildingSurfaces.get(mesh);
    if (
      surface?.source === mesh.geometry &&
      (!instanced || surface.damage.count === mesh.instanceMatrix.count)
    )
      return surface;
    if (surface) this.releaseSurface(surface);
    const source = mesh.geometry,
      position = source.getAttribute('position');
    if (!position || !position.count) return null;
    const shared = instanced || mesh === this.body;
    if (
      mesh !== this.body &&
      (this.buildingSurfaces.size >= 32 ||
        (!shared && this.surfaceVertices + position.count > 240000) ||
        (instanced &&
          (mesh.instanceMatrix.count > 4096 ||
            this.surfaceInstances + mesh.instanceMatrix.count > 4096)))
    )
      return null;
    const geometry = shared ? new THREE.BufferGeometry() : source.clone();
    if (shared) {
      for (const [name, attribute] of Object.entries(source.attributes))
        geometry.setAttribute(name, attribute);
      geometry.setIndex(source.index);
      geometry.groups = source.groups.map((g) => ({ ...g }));
      geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
      geometry.boundingBox = source.boundingBox?.clone() ?? null;
      geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
    }
    const count = instanced ? mesh.instanceMatrix.count : position.count,
      damage = instanced
        ? new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
        : new THREE.BufferAttribute(new Float32Array(count), 1);
    damage.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRocketDamage', damage);
    surface = {
      mesh,
      source,
      geometry,
      damage,
      position: shared
        ? null
        : new Float32Array(position.array as ArrayLike<number>),
      world: shared ? null : new Float32Array(position.count * 3),
      areas: [],
      matrix: new THREE.Matrix4(),
      shared,
      version: -1,
      stateKey: '',
    };
    if (!shared) this.surfaceVertices += position.count;
    if (instanced) this.surfaceInstances += count;
    this.buildingSurfaces.set(mesh, surface);
    return surface;
  }
  private areaAt(x: number, y: number, z: number, areas: DamagedPart[]) {
    let chosen: DamagedPart | null = null;
    for (const d of areas) {
      const b = d.bounds;
      if (
        x < b.minX - 1.5 ||
        x > b.maxX + 1.5 ||
        z < b.minZ - 1.5 ||
        z > b.maxZ + 1.5 ||
        y < d.part.minY - 1.5 ||
        y > d.part.maxY + 1.5
      )
        continue;
      if (!chosen || d.part.minY > chosen.part.minY) chosen = d;
    }
    return chosen;
  }
  private applyBuildingSurfaces() {
    const areas = [...this.parts, ...this.contactParts],
      affected = areas.filter((d) => d.exposure > 0.01 || d.collapse > 0);
    if (!affected.length) return;
    for (const surface of this.buildingSurfaces.values()) {
      let root: THREE.Object3D = surface.mesh;
      while (root.parent) root = root.parent;
      if (root !== this.e.scene || surface.mesh.geometry !== surface.source)
        this.releaseSurface(surface);
    }
    const contacts = affected.flatMap((d) => (d.contact ? [d.contact] : [])),
      candidates: { mesh: THREE.Mesh; distance: number }[] = [],
      intersects = (bounds: THREE.Box3) =>
        affected.some(
          (d) =>
            bounds.max.x >= d.bounds.minX - 2 &&
            bounds.min.x <= d.bounds.maxX + 2 &&
            bounds.max.z >= d.bounds.minZ - 2 &&
            bounds.min.z <= d.bounds.maxZ + 2 &&
            bounds.max.y >= d.part.minY &&
            bounds.min.y <= d.part.maxY,
        ),
      bounds = new THREE.Box3(),
      roots = [
        this.e.buildings,
        ...(this.e.landmarks?.children ?? []).filter((holder) => {
          const detail = this.e.landmarkDetails?.find(
            (d) => d.holder === holder,
          );
          return !detail || intersects(detail.bounds);
        }),
      ];
    for (const root of roots)
      root?.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh) || object === this.body) return;
        if (
          object instanceof THREE.InstancedMesh &&
          object.instanceMatrix.count > 4096
        )
          return;
        object.updateWorldMatrix(true, false);
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (object instanceof THREE.InstancedMesh) bounds.setFromObject(object);
        else if (object.geometry.boundingBox)
          bounds
            .copy(object.geometry.boundingBox)
            .applyMatrix4(object.matrixWorld);
        else return;
        if (intersects(bounds))
          candidates.push({
            mesh: object,
            distance: contacts.length
              ? Math.min(
                  ...contacts.map((point) => bounds.distanceToPoint(point)),
                )
              : bounds.distanceToPoint(this.savedGround),
          });
      });
    candidates.sort((a, b) => a.distance - b.distance);
    const meshes: THREE.Mesh[] = this.body ? [this.body] : [];
    let vertices = 0,
      instances = 0;
    for (const { mesh } of candidates) {
      if (meshes.length >= 32) break;
      if (mesh instanceof THREE.InstancedMesh) {
        const count = mesh.instanceMatrix.count;
        if (count > 4096 || instances + count > 4096) continue;
        instances += count;
      } else {
        const count = mesh.geometry.getAttribute('position')?.count ?? 0;
        if (vertices + count > 240000) continue;
        vertices += count;
      }
      meshes.push(mesh);
    }
    const selected = new Set(meshes);
    for (const surface of this.buildingSurfaces.values())
      if (!selected.has(surface.mesh)) this.releaseSurface(surface);
    const usedMaterials = new Set<THREE.Material>();
    for (const surface of this.buildingSurfaces.values())
      for (const material of Array.isArray(surface.mesh.material)
        ? surface.mesh.material
        : [surface.mesh.material])
        usedMaterials.add(material);
    for (const [source, material] of this.buildingMaterials)
      if (!usedMaterials.has(source)) {
        material.dispose();
        this.buildingMaterials.delete(source);
      }
    const stateKey = areas
      .map((d) => `${d.exposure.toFixed(5)}:${d.collapse.toFixed(5)}`)
      .join(';');
    let instanceBudget = 4096;
    for (const mesh of meshes) {
      const surface = this.surfaceFor(mesh);
      if (!surface) continue;
      const damage = surface.damage;
      mesh.updateWorldMatrix(true, false);
      const dirty =
        surface.stateKey !== stateKey ||
        surface.version !== this.surfaceVersion ||
        !surface.matrix.equals(mesh.matrixWorld);
      if (dirty || mesh instanceof THREE.InstancedMesh) damage.array.fill(0);
      if (mesh === this.body && dirty) {
        for (const d of this.parts) {
          (damage.array as Float32Array).fill(
            d.exposure,
            d.part.start,
            d.part.start + d.part.count,
          );
        }
      } else if (mesh instanceof THREE.InstancedMesh) {
        const matrix = new THREE.Matrix4(),
          world = new THREE.Matrix4(),
          deformation = new THREE.Matrix4(),
          inverse = mesh.matrixWorld.clone().invert(),
          point = new THREE.Vector3();
        const center =
          mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ??
          new THREE.Vector3();
        for (
          let i = 0;
          i < mesh.count && instanceBudget > 0;
          i++, instanceBudget--
        ) {
          mesh.getMatrixAt(i, matrix);
          world.multiplyMatrices(mesh.matrixWorld, matrix);
          point.copy(center).applyMatrix4(world);
          const d = this.areaAt(point.x, point.y, point.z, affected);
          if (!d) continue;
          damage.setX(i, d.exposure);
          const c = d.collapse;
          deformation.set(
            1,
            c * 0.16,
            0,
            -d.part.minY * c * 0.16,
            0,
            1 - c * 0.925,
            0,
            d.part.minY * c * 0.925,
            0,
            c * 0.08,
            1,
            -d.part.minY * c * 0.08,
            0,
            0,
            0,
            1,
          );
          this.overrideSlot(
            mesh,
            i,
            world.premultiply(deformation).premultiply(inverse),
          );
        }
      } else if (mesh !== this.body && dirty) {
        const source = surface.position!,
          world = surface.world!,
          point = new THREE.Vector3(),
          inverse = mesh.matrixWorld.clone().invert(),
          position = surface.geometry.getAttribute(
            'position',
          ) as THREE.BufferAttribute;
        if (
          surface.version !== this.surfaceVersion ||
          !surface.matrix.equals(mesh.matrixWorld)
        ) {
          surface.matrix.copy(mesh.matrixWorld);
          surface.version = this.surfaceVersion;
          surface.areas.length = damage.count;
          for (let i = 0; i < damage.count; i++) {
            point.fromArray(source, i * 3).applyMatrix4(mesh.matrixWorld);
            point.toArray(world, i * 3);
            surface.areas[i] = this.areaAt(point.x, point.y, point.z, areas);
          }
        }
        for (let i = 0; i < damage.count; i++) {
          const d = surface.areas[i];
          point.fromArray(world, i * 3);
          if (d) {
            const lift = Math.max(0, point.y - d.part.minY),
              shift = d.collapse * lift * 0.16;
            point.x += shift;
            point.z += shift * 0.5;
            point.y = d.part.minY + lift * (1 - d.collapse * 0.925);
            damage.setX(i, d.exposure);
          }
          point.applyMatrix4(inverse);
          position.setXYZ(i, point.x, point.y, point.z);
        }
        position.needsUpdate = true;
        surface.geometry.computeBoundingBox();
        surface.geometry.computeBoundingSphere();
      }
      if (dirty || mesh instanceof THREE.InstancedMesh)
        damage.needsUpdate = true;
      surface.stateKey = stateKey;
      surface.matrix.copy(mesh.matrixWorld);
      surface.version = this.surfaceVersion;
      const material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => this.damageMaterial(m))
        : this.damageMaterial(mesh.material);
      this.surfaceRestores.push({
        mesh,
        geometry: mesh.geometry,
        material: mesh.material,
        appliedGeometry: surface.geometry,
        appliedMaterial: material,
      });
      mesh.geometry = surface.geometry;
      mesh.material = material;
    }
  }
  /** Called after city LOD/traffic updates, then restored after the draw. This never hijacks their instance ownership. */
  beforeRender() {
    if (this.restoreSlots.length || this.surfaceRestores.length)
      this.afterRender();
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
            const shift = d.collapse * lift * 0.16,
              height = d.part.maxY - d.part.minY,
              settled = Math.max(
                lift * 0.075,
                lift - height * d.collapse * 0.925,
              );
            if (d.dirtyPosition)
              pos.setXYZ(
                d.part.start + i,
                d.position[j] + shift,
                d.part.minY + settled,
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
    this.applyBuildingSurfaces();
    if (
      f.groundExposure > 0.12 &&
      this.time - this.scanAt > 0.3 &&
      this.flying.length < this.profile.flying
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
          for (
            let i = 0;
            i < object.count && this.flying.length < this.profile.flying;
            i++
          ) {
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
    const affectedTrees = this.trees.filter(
        (t) => t.charred.visible || t.pressure > 0.01,
      ),
      hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const t of affectedTrees)
      for (const slot of t.source.slots ?? [])
        if (slot.index < slot.mesh.count) {
          if (t.charred.visible)
            this.overrideSlot(slot.mesh, slot.index, hidden);
          else this.bendTreeSlot(t, slot.mesh, slot.index);
        }
    // Near-camera detailed-tree slots are recycled by their owner. Resolve the
    // current spatial match for this draw instead of retaining a stale LOD slot.
    if (affectedTrees.length)
      this.e.detailedTrees?.group.traverse((object) => {
        if (!(object instanceof THREE.InstancedMesh) || !object.visible) return;
        object.updateWorldMatrix(true, false);
        const matrix = new THREE.Matrix4(),
          point = new THREE.Vector3();
        for (let i = 0; i < object.count; i++) {
          if (this.restoredKeys.has(object.uuid + ':' + i)) continue;
          object.getMatrixAt(i, matrix);
          if (Math.abs(matrix.determinant()) < 1e-9) continue;
          point.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
          const tree = affectedTrees.find(
            (t) =>
              Math.hypot(t.x - point.x, t.z - point.z) <
                Math.max(1.5, t.h * 0.17) &&
              point.y >= t.y - 2 &&
              point.y < t.y + t.h + 5,
          );
          if (tree) {
            if (tree.charred.visible) this.overrideSlot(object, i, hidden);
            else this.bendTreeSlot(tree, object, i);
          }
        }
      });
    if (
      (shadowChanged ||
        (f.groundExposure > 0.12 &&
          (this.flying.length > 0 || affectedTrees.length > 0))) &&
      this.time - this.shadowAt > 0.35
    ) {
      this.shadowAt = this.time;
      this.e.renderer.shadowMap.needsUpdate = true;
    }
  }
  afterRender() {
    for (const restore of this.surfaceRestores) {
      if (restore.mesh.geometry === restore.appliedGeometry)
        restore.mesh.geometry = restore.geometry;
      if (restore.mesh.material === restore.appliedMaterial)
        restore.mesh.material = restore.material;
    }
    this.surfaceRestores.length = 0;
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
          d.collapseElapsed = -1;
          d.dirtyPosition = d.dirtyColor = false;
          d.fragmentsStage = 0;
        }
    }
    this.fragments.length = 0;
    this.rubble.count = 0;
    this.flying.length = 0;
    for (const surface of this.buildingSurfaces.values())
      this.releaseSurface(surface);
    for (const material of this.buildingMaterials.values()) material.dispose();
    this.buildingMaterials.clear();
    this.contactParts.length = 0;
    this.contacts.clear();
    this.surfaceVersion++;
    this.launched.clear();
    this.eventId = this.lastState.events.at(-1)?.id ?? 0;
    this.spawn = 0;
    this.dustSpawn = 0;
    this.dustNext = 0;
    this.dustAlive = 0;
    this.vehicleSpawn = 0;
    this.shockAge = 99;
    this.groundContactCount = 0;
    this.outwashPower.value = 0;
    if (this.groundOutwash) this.groundOutwash.count = 0;
    for (const t of this.trees) {
      t.heat = t.pressure = t.fall = 0;
      t.bend.identity();
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
