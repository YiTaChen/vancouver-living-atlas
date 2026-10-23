import * as THREE from 'three';
import type { CityEngine } from './engine';
import { firstVisibleObstacleHit } from './visible-obstacles';
import { inPolygon } from './geo';
import { FlightWorld } from './flight-world';
import {
  collisionTriangles,
  hitTriangles,
  isClosedCollisionMesh,
} from './flight-collision';
import {
  createRocket,
  launchRocket,
  stepRocket,
  crashRocket,
  resolveRocketContact,
  sampleRocketContact,
  rocketDirection,
  sampleRocketEffects,
  ROCKET_CONFIGS,
  type RocketKind,
  type RocketState,
  type RocketSupport,
  type RocketInput,
  type RocketContactLoad,
  type RocketImpactRecord,
} from './rocket-state';
import {
  EMPTY_ROCKET,
  type RocketSnapshot,
  type RocketView,
  type RocketSpaceFocus,
} from './rocket-snapshot';
import {
  createRocketModel,
  createRocketScaffold,
  disposeRocketObject,
} from './assets/rocket';
import type { RocketEffects, RocketAudio } from './rocket-effects';
import type { RocketSpace } from './rocket-space';

/** Exact rocket-only contact; city effects must damage this surface, not the launch origin. */
export type RocketCityContact = {
  source: 'building' | 'bridge' | 'landmark' | 'unknown';
  point: { x: number; y: number; z: number };
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  radius: number;
  speed: number;
  mass: number;
  initialOverlap: boolean;
  part?: RocketImpactRecord['part'];
  normal?: { x: number; y: number; z: number };
  penetration?: number;
  obstacleMass?: number;
  yieldProgress?: number;
  normalSpeed?: number;
  impactEnergy?: number;
  force?: number;
  surfaceVelocity?: { x: number; y: number; z: number };
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  polygon?: number[][][];
};
type RocketVolume =
  FlightWorld['cells'] extends Map<string, (infer V)[]> ? V : never;
type RocketSweep = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
  part?: RocketImpactRecord['part'];
};
type RocketContact = { volume?: RocketVolume; contact: RocketCityContact };
type RocketSurfaceGeometry = {
  sourceBounds: THREE.Box3;
  original: Float32Array | null;
  current: Float32Array | null;
  previous: Float32Array | null;
  deltaTime: number;
  revision: number;
  closed: boolean;
  orientation: number;
  volume: number;
  area: number;
};

/** One active mission. No launch assets are downloaded or compiled during ordinary city startup. */
export class RocketController {
  state: RocketState | null = null;
  active = false;
  placing = false;
  kind: RocketKind = 'small';
  view: RocketView = 'chase';
  onChange: (snapshot: RocketSnapshot) => void = () => {};
  private model: ReturnType<typeof createRocketModel> | null = null;
  private scaffold: THREE.Group | null = null;
  private effects: RocketEffects | null = null;
  private audio: RocketAudio | null = null;
  private space: RocketSpace | null = null;
  private world: FlightWorld | null = null;
  private missionHit: FlightWorld['hit'] | null = null;
  private supportVolumes: { bounds: THREE.Box3; originalTop: number }[] = [];
  private contactVolumes = new Map<
    RocketVolume,
    { originalTop: number; point: THREE.Vector3 }
  >();
  private initialContacts = new Map<RocketVolume, number>();
  private volumeWorlds = new WeakMap<RocketVolume, FlightWorld>();
  private surfaceKeys = new WeakMap<RocketVolume, string>();
  private surfaceGeometry = new Map<RocketVolume, RocketSurfaceGeometry>();
  private contactWarning = '';
  private damageFocus: THREE.Vector3 | null = null;
  private accidentFramed = false;
  private impactFocusBlend = 0;
  private loaded = false;
  private loadError = false;
  private generation = 0;
  private disposed = false;
  private accumulator = 0;
  private clock = 0;
  private published = 0;
  private auto = true;
  private stabilize = true;
  private throttle = 1;
  private inputEnabled = true;
  private keys = new Set<string>();
  private axes = { x: 0, y: 0 };
  private pointers = new Map<
    number,
    { x: number; y: number; sx: number; sy: number; moved: boolean }
  >();
  private gestureHadMultiple = false;
  private lookYaw = 0.6;
  private lookPitch = 0.26;
  private zoomScale = 1;
  private missionId = 0;
  private spaceFocus: RocketSpaceFocus = 'rocket';
  private chaseOffset = new THREE.Vector3();
  private chaseAnchorHeight = 0;
  private chaseInitialized = false;
  private focusOrientation = new THREE.Quaternion();
  private focusFov = 55;
  private focusTransition = false;
  private preview = '';
  private ring: THREE.Mesh;
  private cabin = new THREE.Group();
  private wasSpace = false;
  private saved: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    target: THREE.Vector3;
    near: number;
    far: number;
    fov: number;
  } | null = null;
  private requestAbort = false;
  private muted = false;
  private lastPickAt = 0;
  constructor(readonly e: CityEngine) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.7, 40),
      new THREE.MeshBasicMaterial({
        color: 0x98e5e8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 110;
    e.scene.add(this.ring);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.045, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x253846 }),
    );
    rim.position.z = -0.8;
    this.cabin.add(rim);
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.16, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x172c37 }),
    );
    panel.position.set(0, -0.43, -0.7);
    this.cabin.add(panel);
    this.cabin.visible = false;
    this.cabin.name = 'Rocket first-person observation capsule';
    e.camera.add(this.cabin);
    const c = e.renderer.domElement;
    c.addEventListener('pointerdown', this.down, true);
    c.addEventListener('wheel', this.wheel, { capture: true, passive: false });
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancelPointer);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.visibility);
  }
  get snapshot(): RocketSnapshot {
    const s = this.state;
    return {
      ...EMPTY_ROCKET,
      missionId: this.missionId,
      exists: !!s,
      active: this.active,
      placing: this.placing,
      kind: this.kind,
      phase: s?.phase ?? 'building',
      buildProgress: s?.buildProgress ?? 0,
      loaded: this.loaded,
      loadError: this.loadError,
      countdown: s?.countdown ?? 0,
      altitude: s?.altitude ?? 0,
      speed: s?.speed ?? 0,
      fuel: s ? s.fuel / ROCKET_CONFIGS[s.kind].fuelMass : 1,
      stage: s?.stage ?? 'boost',
      stageFuel: s
        ? s.stage === 'strap-on' || s.stage === 'strap-separating'
          ? s.strapFuel / (ROCKET_CONFIGS[s.kind].strapOns?.fuelMass || 1)
          : s.boosterAttached
            ? s.boosterFuel / ROCKET_CONFIGS[s.kind].stages.boost.fuelMass
            : s.upperFuel / ROCKET_CONFIGS[s.kind].stages.upper.fuelMass
        : 1,
      stageTransitionProgress: s
        ? s.stage === 'strap-separating'
          ? THREE.MathUtils.clamp(
              s.stageElapsed /
                (ROCKET_CONFIGS[s.kind].strapSeparationDuration || 0.8),
              0,
              1,
            )
          : s.stage === 'separating'
            ? THREE.MathUtils.clamp(
                s.stageElapsed / ROCKET_CONFIGS[s.kind].separationDuration,
                0,
                1,
              )
            : 0
        : 0,
      spaceFocus: this.spaceFocus,
      throttle: this.auto ? (s?.throttle ?? 0) : this.throttle,
      tilt: s
        ? (Math.acos(
            THREE.MathUtils.clamp(rocketDirection(s.attitude).y, -1, 1),
          ) *
            180) /
          Math.PI
        : 0,
      wind: s ? Math.hypot(s.wind.x, s.wind.z) : 0,
      pitch: s ? THREE.MathUtils.radToDeg(s.attitude.pitch) : 0,
      roll: s ? THREE.MathUtils.radToDeg(s.attitude.roll) : 0,
      verticalSpeed: s?.velocity.y ?? 0,
      auto: this.auto,
      stabilize: this.stabilize,
      support: this.placing
        ? this.preview || 'ground'
        : (s?.support.kind ?? 'ground'),
      supportIntegrity: s?.supportIntegrity ?? 1,
      supportCollapsed: s?.supportCollapsed ?? false,
      integrity: s?.integrity ?? 1,
      contactDamage: s?.contactDamage ?? 0,
      contactState: s?.contactState ?? 'none',
      contactImpact: s?.contactImpact ?? null,
      contactAge: s?.contactImpact
        ? Math.max(0, s.elapsed - s.contactImpact.time)
        : 0,
      groundSlopeGrade: s?.support.slopeGrade ?? 0,
      steepSurface: (s?.support.slopeGrade ?? 0) > 0.15,
      failureStage: s?.failureStage ?? 'none',
      failureAge: s?.wreckage
        ? Math.max(0, s.elapsed - (s.wreckage.explosionTime ?? s.wreckage.time))
        : 0,
      failureCause: s?.wreckage?.cause ?? '',
      vehicleFire: s?.fireIntensity ?? 0,
      vehicleHeat: s?.heat ?? 0,
      warning: this.placing
        ? this.preview
        : (s?.failureReason ?? this.contactWarning),
      view: this.view,
      damaged: this.effects?.damaged ?? 0,
      burning: this.effects?.burning ?? 0,
      debris: this.effects?.debris ?? 0,
    };
  }
  private notify() {
    if (!this.disposed) this.onChange(this.snapshot);
  }
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.clearInput();
  }
  clearInput = () => {
    this.keys.clear();
    this.axes = { x: 0, y: 0 };
    this.pointers.clear();
    this.gestureHadMultiple = false;
  };
  private visibility = () => {
    if (document.hidden) {
      this.clearInput();
      this.audio?.update(0, true);
    }
    this.accumulator = 0;
  };
  setAxes(x: number, y: number) {
    if (this.inputEnabled)
      this.axes = {
        x: Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0,
        y: Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0,
      };
  }
  setAuto(auto: boolean) {
    this.auto = auto;
    this.clearInput();
    this.notify();
  }
  setStabilize(on: boolean) {
    this.stabilize = on;
    this.notify();
  }
  setThrottle(value: number) {
    if (Number.isFinite(value))
      this.throttle = THREE.MathUtils.clamp(value, 0, 1);
    this.notify();
  }
  setView(view: RocketView) {
    this.view = view;
    this.lookYaw = view === 'first' ? 0 : 0.6;
    this.lookPitch = view === 'first' ? 0 : 0.26;
    this.notify();
  }
  setSpaceFocus(focus: RocketSpaceFocus) {
    if (!this.active || !this.wasSpace || !this.space) return;
    if (!['rocket', 'earth', 'sun', 'moon'].includes(focus)) return;
    if (this.spaceFocus === focus) return;
    this.focusOrientation.copy(this.space.camera.quaternion);
    this.focusFov = this.space.camera.fov;
    this.focusTransition = true;
    this.spaceFocus = focus;
    this.notify();
  }
  zoom(factor: number) {
    if (Number.isFinite(factor) && factor > 0) this.zoomDistance(factor);
  }
  private zoomDistance(factor: number) {
    this.zoomScale = THREE.MathUtils.clamp(this.zoomScale * factor, 0.5, 5);
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.audio?.update(0, true);
  }
  beginPlacement(kind: RocketKind) {
    if (this.disposed) return;
    this.returnToCity();
    this.clearMission();
    this.kind = kind;
    this.e.tesla?.deactivate();
    this.e.flight?.clear();
    this.e.placement?.cancel();
    this.e.travelReturn?.invalidate(true);
    this.e.closeBusVisit();
    if (this.e.navigation?.mode !== 'orbit') this.e.leaveTravelAtLocation();
    this.e.navigation?.setMode('orbit');
    this.e.settings.mode = 'orbit';
    this.e.controls.enabled = true;
    this.e.settings.autoRotate = this.e.controls.autoRotate = false;
    this.placing = true;
    this.preview = '';
    this.e.onRocketMode('orbit');
    this.notify();
  }
  cancelPlacement() {
    this.placing = false;
    this.ring.visible = false;
    this.clearInput();
    this.preview = '';
    this.notify();
  }
  private groundHeight(x: number, z: number) {
    const terrain = this.e.elevation(x, z);
    return this.e.data.roadSurface?.sample(x, z, terrain + 1.05) ?? terrain;
  }
  private supportAt(point: THREE.Vector3, roof = false): RocketSupport {
    const groundY = this.groundHeight(point.x, point.z),
      water = this.e.waterWorld?.at(point.x, point.z);
    if (roof) {
      const volume = (this.e.data.flightBuildingVolumes ?? []).find(
        (v: { polygon: number[][][]; maxY: number }) =>
          Math.abs(v.maxY - point.y) < 8 &&
          inPolygon([point.x, point.z], v.polygon),
      );
      const area = volume
        ? Math.abs(
            volume.polygon[0].reduce(
              (sum: number, a: number[], i: number, ring: number[][]) => {
                const b = ring[(i + 1) % ring.length];
                return sum + a[0] * b[1] - b[0] * a[1];
              },
              0,
            ),
          ) / 2
        : 100;
      return {
        kind:
          area < 380 || point.y - groundY < 13 ? 'roof-small' : 'roof-large',
        groundY,
      };
    }
    if (water)
      return {
        kind:
          water.kind === 'lake'
            ? 'lake'
            : /river/i.test(water.name)
              ? 'river'
              : 'ocean',
        groundY: water.level - 20,
      };
    // Terrain slope is sampled over the full vehicle footprint. The assembly plate never strengthens it.
    const radius = ROCKET_CONFIGS[this.kind].footprintRadius * 1.5;
    const heights = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ].map(([dx, dz]) => this.groundHeight(point.x + dx, point.z + dz));
    return {
      kind: 'ground',
      groundY,
      // Grade describes geometry; it is not the bearing capacity of earth.
      // Assembly levels ordinary roads rather than treating a few percent of
      // slope as a launch structure that can disappear under exhaust.
      strength: 1,
      slopeGrade: Math.hypot(
        (heights[0] - heights[1]) / (radius * 2),
        (heights[2] - heights[3]) / (radius * 2),
      ),
      slope: {
        x: (heights[0] - heights[1]) / (radius * 2),
        z: (heights[2] - heights[3]) / (radius * 2),
      },
    };
  }
  pick(sx: number, sy: number, commit = false) {
    if (!this.placing || !this.inputEnabled) return;
    const rect = this.e.renderer.domElement.getBoundingClientRect();
    if (sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom)
      return;
    const ray = new THREE.Raycaster();
    this.e.camera.updateMatrixWorld();
    ray.setFromCamera(
      new THREE.Vector2(
        ((sx - rect.left) / rect.width) * 2 - 1,
        1 - ((sy - rect.top) / rect.height) * 2,
      ),
      this.e.camera,
    );
    ray.far = 60000;
    const hit = ray.intersectObjects(
      this.e.placement?.groundMeshes ?? [],
      false,
    )[0];
    let point = hit?.point.clone(),
      distance = hit?.distance ?? Infinity,
      roof = false;
    if (this.e.waterWorld)
      for (const water of [
        this.e.waterWorld.sea,
        ...this.e.waterWorld.surfaces,
      ]) {
        const p = ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -water.level),
          new THREE.Vector3(),
        );
        if (
          p &&
          this.e.waterWorld.at(p.x, p.z)?.id === water.id &&
          p.distanceTo(ray.ray.origin) < distance
        ) {
          point = p;
          distance = p.distanceTo(ray.ray.origin);
        }
      }
    const obstacle = firstVisibleObstacleHit(ray, [
      this.e.buildings,
      this.e.landmarks,
    ]);
    if (obstacle && obstacle.distance < distance) {
      point = obstacle.point.clone();
      distance = obstacle.distance;
      roof = true;
      // Clicking a wall chooses the roof over that exact x/z, never a hidden ground point.
      const down = new THREE.Raycaster(
        new THREE.Vector3(point.x, 1500, point.z),
        new THREE.Vector3(0, -1, 0),
      );
      const top = firstVisibleObstacleHit(down, [
        this.e.buildings,
        this.e.landmarks,
      ]);
      if (top) point.y = top.point.y;
    }
    if (!point) {
      this.ring.visible = false;
      this.preview = '';
      this.notify();
      return;
    }
    const support = this.supportAt(point, roof);
    if (support.kind === 'ground')
      point.y = Math.max(point.y, support.groundY ?? point.y);
    this.preview = support.kind;
    this.ring.visible = true;
    this.ring.position.copy(point);
    this.ring.position.y += 0.35;
    this.ring.scale.setScalar(
      Math.max(1, (distance * 1.8) / rect.height) *
        (ROCKET_CONFIGS[this.kind].footprintRadius / 3.35),
    );
    (this.ring.material as THREE.MeshBasicMaterial).color.set(
      support.kind === 'ground' ? 0x98e5e8 : 0xffaf70,
    );
    this.notify();
    if (commit)
      this.start(this.kind, point.x, point.y + 0.45, point.z, support);
  }
  /** World-space entry also lets deterministic browser acceptance choose exact surfaces. */
  start(
    kind: RocketKind,
    x: number,
    y: number,
    z: number,
    support?: RocketSupport,
  ) {
    if (this.disposed || ![x, y, z].every(Number.isFinite)) return;
    if (this.active) this.returnToCity();
    this.clearMission();
    this.kind = kind;
    this.placing = false;
    this.missionId++;
    this.spaceFocus = 'rocket';
    this.focusTransition = false;
    this.focusFov = 55;
    this.chaseInitialized = false;
    this.ring.visible = false;
    this.e.tesla?.deactivate();
    this.e.flight?.clear();
    this.e.placement?.cancel();
    this.e.travelReturn?.invalidate(true);
    this.e.navigation?.setMode('orbit');
    this.e.completeLocalMapTransition();
    this.e.transition = null;
    this.saved = {
      position: this.e.camera.position.clone(),
      quaternion: this.e.camera.quaternion.clone(),
      target: this.e.controls.target.clone(),
      near: this.e.camera.near,
      far: this.e.camera.far,
      fov: this.e.camera.fov,
    };
    const launchSupport = support
      ? { ...support }
      : this.supportAt(
          new THREE.Vector3(x, y, z),
          y > this.groundHeight(x, z) + 4,
        );
    // A rendered terrain hit can lie below an overlapping asphalt triangle.
    // Ground the entire rig on the same real road surface used by collision.
    if (launchSupport.kind === 'ground') {
      const road = this.e.data.roadSurface?.sample(
        x,
        z,
        this.e.elevation(x, z) + 1.05,
      );
      if (road != null) {
        y = Math.max(y, road + 0.45);
        launchSupport.groundY = Math.max(launchSupport.groundY ?? road, road);
      }
    }
    this.state = createRocket(kind, x, y, z, launchSupport);
    this.model = createRocketModel(kind);
    this.model.group.position.set(x, y, z);
    this.model.build(this.state.phase === 'sinking' ? 1 : 0);
    this.e.scene.add(this.model.group);
    this.scaffold = createRocketScaffold(kind);
    this.scaffold.position.set(x, y, z);
    this.e.scene.add(this.scaffold);
    this.active = true;
    this.auto = true;
    this.stabilize = true;
    this.throttle = 1;
    this.view = 'chase';
    this.lookYaw = 0.6;
    this.lookPitch = 0.26;
    this.zoomScale = 1;
    this.e.settings.mode = 'rocket';
    this.e.controls.enabled = false;
    this.e.controls.autoRotate = false;
    this.e.onRocketMode('rocket');
    this.updateCamera(1);
    void this.retryLoad();
    this.notify();
  }
  async retryLoad() {
    if (!this.active || !this.state || this.disposed) return;
    this.loadError = false;
    this.loaded = false;
    const generation = ++this.generation;
    this.notify();
    try {
      const [fx, sky] = await Promise.all([
        import('./rocket-effects'),
        import('./rocket-space'),
      ]);
      if (
        generation !== this.generation ||
        this.disposed ||
        !this.active ||
        !this.state
      )
        return;
      // The model and cabin are owned by this controller. Detach them before
      // replacing a space environment so a retry never strands them in it.
      if (this.wasSpace && this.model) {
        this.e.scene.add(this.model.group);
        this.model.group.scale.setScalar(1);
        this.model.light.visible = true;
        this.e.camera.add(this.cabin);
        this.cabin.scale.setScalar(1);
        this.wasSpace = false;
      }
      this.effects?.dispose();
      this.audio?.dispose();
      this.space?.dispose();
      this.effects = new fx.RocketEffects(this.e, this.state);
      this.audio = new fx.RocketAudio();
      this.space = new sky.RocketSpace();
      this.world = new FlightWorld(this.e);
      this.prepareCollisionSurfaces();
      this.supportVolumes = [];
      if (this.state.support.kind.startsWith('roof')) {
        const origin = this.state.origin;
        const seen = new Set();
        for (const cell of this.world.cells.values())
          for (const volume of cell) {
            if (seen.has(volume)) continue;
            seen.add(volume);
            if (
              volume.polygon &&
              Math.abs(volume.bounds.max.y - (origin.y - 0.45)) < 4 &&
              inPolygon([origin.x, origin.z], volume.polygon)
            )
              this.supportVolumes.push({
                bounds: volume.bounds,
                originalTop: volume.bounds.max.y,
              });
          }
      }
      this.captureLaunchContacts();
      this.loaded = true;
      this.notify();
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        console.error('Rocket resources failed to load', error);
        this.loadError = true;
        this.notify();
      }
    }
  }
  launch() {
    if (
      !this.active ||
      !this.state ||
      !this.loaded ||
      this.state.phase !== 'ready'
    )
      return;
    this.audio?.start();
    this.state = launchRocket(this.state, this.auto ? 'auto' : 'manual');
    this.notify();
  }
  abort() {
    this.requestAbort = true;
    this.notify();
  }
  retry() {
    const s = this.state;
    if (s) this.start(s.kind, s.origin.x, s.origin.y, s.origin.z, s.support);
  }
  resetDamage() {
    this.effects?.dispose();
    this.effects = null;
    for (const shape of this.surfaceGeometry.values()) {
      shape.current = shape.original;
      shape.previous = shape.original;
      shape.deltaTime = 0;
      shape.revision = -1;
    }
    for (const [volume, contact] of this.contactVolumes)
      volume.bounds.max.y = contact.originalTop;
    this.contactVolumes.clear();
    if (this.state?.wreckage) {
      this.initialContacts.clear();
      this.contactWarning = '';
      for (const volume of this.supportVolumes)
        volume.bounds.max.y = volume.originalTop;
      this.supportVolumes = [];
    }
    const generation = this.generation,
      state = this.state;
    if (state && this.loaded)
      void import('./rocket-effects').then((fx) => {
        if (
          !this.disposed &&
          this.state === state &&
          this.generation === generation &&
          !this.effects
        ) {
          this.effects = new fx.RocketEffects(this.e, state);
          this.notify();
        }
      });
    this.notify();
  }
  returnToCity() {
    if (!this.active && !this.placing) return;
    const wasActive = this.active;
    this.cancelPlacement();
    this.active = false;
    this.audio?.update(0, true);
    this.clearInput();
    ++this.generation;
    // A mission owns transient city-instance overrides. Retire them before
    // normal traffic/LOD pools resume and recycle those slots for new actors.
    this.effects?.dispose();
    this.effects = null;
    this.audio?.dispose();
    this.audio = null;
    if (this.model) {
      this.e.scene.add(this.model.group);
      this.model.group.scale.setScalar(1);
      this.model.group.visible = false;
    }
    if (this.scaffold) this.scaffold.visible = false;
    this.wasSpace = false;
    this.cabin.visible = false;
    this.e.camera.add(this.cabin);
    this.cabin.scale.setScalar(1);
    this.space?.dispose();
    this.space = null;
    this.world = null;
    this.surfaceGeometry.clear();
    this.supportVolumes = [];
    this.contactVolumes.clear();
    this.initialContacts.clear();
    this.contactWarning = '';
    this.damageFocus = null;
    this.accidentFramed = false;
    this.impactFocusBlend = 0;
    this.loaded = this.loadError = false;
    this.accumulator = 0;
    this.requestAbort = false;
    if (wasActive && this.saved) {
      this.e.camera.position.copy(this.saved.position);
      this.e.camera.quaternion.copy(this.saved.quaternion);
      this.e.controls.target.copy(this.saved.target);
      this.e.camera.near = this.saved.near;
      this.e.camera.far = this.saved.far;
      this.e.camera.fov = this.saved.fov;
      this.e.camera.updateProjectionMatrix();
    }
    this.saved = null;
    this.e.settings.mode = 'orbit';
    this.e.controls.enabled = true;
    this.e.controls.update();
    this.e.onRocketMode('orbit');
    this.e.renderer.shadowMap.needsUpdate = true;
    this.notify();
  }
  private clearMission() {
    ++this.generation;
    this.effects?.dispose();
    this.effects = null;
    this.audio?.dispose();
    this.audio = null;
    this.space?.dispose();
    this.space = null;
    if (this.model) disposeRocketObject(this.model.group);
    if (this.scaffold) disposeRocketObject(this.scaffold);
    this.model = null;
    this.scaffold = null;
    this.state = null;
    this.world = null;
    this.surfaceGeometry.clear();
    this.supportVolumes = [];
    this.contactVolumes.clear();
    this.initialContacts.clear();
    this.contactWarning = '';
    this.damageFocus = null;
    this.accidentFramed = false;
    this.impactFocusBlend = 0;
    this.loaded = this.loadError = this.wasSpace = false;
    this.accumulator = 0;
    this.requestAbort = false;
  }
  /** Authored body/appendage capsules, including their swept movement this tick. */
  private collisionSweeps(
    before: RocketState,
    state: RocketState,
  ): RocketSweep[] {
    const config = ROCKET_CONFIGS[state.kind],
      direction = rocketDirection(state.attitude),
      previousDirection = rocketDirection(before.attitude),
      lower = state.boosterAttached
        ? 0
        : config.height * config.upperNozzleFraction,
      previousLower = before.boosterAttached
        ? 0
        : config.height * config.upperNozzleFraction,
      point = (s: RocketState, dir: typeof direction, height: number) =>
        new THREE.Vector3(
          s.position.x + dir.x * height,
          s.position.y + dir.y * height,
          s.position.z + dir.z * height,
        ),
      radius = config.radius * 0.75,
      sweeps: RocketSweep[] = [
        {
          from: point(state, direction, lower + config.radius),
          to: point(state, direction, config.height - config.radius),
          radius,
          part: state.boosterAttached ? 'core' : 'upper',
        },
      ];
    for (const t of [0.18, 0.5, 0.9])
      sweeps.push({
        from: point(
          before,
          previousDirection,
          previousLower + (config.height - previousLower) * t,
        ),
        to: point(state, direction, lower + (config.height - lower) * t),
        radius,
        part: state.boosterAttached ? 'core' : 'upper',
      });
    const rotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(direction.x, direction.y, direction.z),
      ),
      previousRotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(
          previousDirection.x,
          previousDirection.y,
          previousDirection.z,
        ),
      );
    for (const probe of this.model?.collisionSegments ?? []) {
      if (probe.strapOn && !state.strapAttached) continue;
      if (probe.booster && !state.boosterAttached) continue;
      const transform = (local: THREE.Vector3, previous = false) => {
        const position = previous ? before.position : state.position;
        return local
          .clone()
          .applyQuaternion(previous ? previousRotation : rotation)
          .add(new THREE.Vector3(position.x, position.y, position.z));
      };
      const from = transform(probe.from),
        to = transform(probe.to);
      sweeps.push(
        {
          from,
          to,
          radius: probe.radius,
          part: probe.strapOn ? 'strap-on' : 'appendage',
        },
        {
          from: transform(probe.from, true),
          to: from,
          radius: probe.radius,
          part: probe.strapOn ? 'strap-on' : 'appendage',
        },
        {
          from: transform(probe.to, true),
          to,
          radius: probe.radius,
          part: probe.strapOn ? 'strap-on' : 'appendage',
        },
      );
    }
    return sweeps;
  }
  private nearbyVolumes(bounds: THREE.Box3) {
    const volumes = new Set<RocketVolume>();
    for (
      let x = Math.floor(bounds.min.x / 80);
      x <= Math.floor(bounds.max.x / 80);
      x++
    )
      for (
        let z = Math.floor(bounds.min.z / 80);
        z <= Math.floor(bounds.max.z / 80);
        z++
      )
        for (const volume of this.world?.cells?.get(x + ',' + z) ?? [])
          volumes.add(volume);
    return volumes;
  }
  /** Private broad envelopes include genuine settled/sheared surfaces, never solid AABB contacts. */
  private prepareCollisionSurfaces() {
    const world = this.world;
    if (!world) return;
    this.surfaceGeometry.clear();
    const volumes = [...new Set([...world.cells.values()].flat())];
    for (const volume of volumes) {
      if (!volume.mesh && !volume.local) continue;
      const sourceBounds = volume.bounds.clone(),
        center = sourceBounds.getCenter(new THREE.Vector3()),
        base = Math.min(
          sourceBounds.min.y,
          this.groundHeight(center.x, center.z),
        ),
        height = Math.max(1, sourceBounds.max.y - base),
        padding = height * 0.2 + 5;
      this.surfaceGeometry.set(volume, {
        sourceBounds,
        original: null,
        current: null,
        previous: null,
        deltaTime: 0,
        revision: -1,
        closed: false,
        orientation: 1,
        volume: 0,
        area: 0,
      });
      volume.bounds.min.x -= padding;
      volume.bounds.max.x += padding;
      volume.bounds.min.z -= padding;
      volume.bounds.max.z += padding;
      volume.bounds.min.y = base - 5;
      volume.bounds.max.y += 3;
    }
    world.cells.clear();
    for (const volume of volumes) world.add(volume);
    // This adapter belongs only to this mission. Plane worlds and source meshes
    // retain their original implementation and buffers.
    const hit = (from: THREE.Vector3, to: THREE.Vector3, radius?: number) => {
      const r = radius ?? 1.1;
      const bounds = new THREE.Box3()
        .setFromPoints([from, to])
        .expandByScalar(r);
      for (const volume of this.nearbyVolumes(bounds))
        if (
          volume.bounds.intersectsBox(bounds) &&
          this.hitVolume(volume, from, to, r)
        )
          return true;
      return false;
    };
    world.hit = hit;
    this.missionHit = hit;
  }
  private originalSurface(volume: RocketVolume, shape: RocketSurfaceGeometry) {
    if (shape.original) return shape.original;
    let points: Float32Array;
    if (volume.mesh) {
      points = volume.triangles ?? collisionTriangles(volume.mesh);
      volume.triangles = points;
    } else {
      const box = volume.local!,
        matrix = volume.inverse!.clone().invert(),
        corners = [
          [box.min.x, box.min.y, box.min.z],
          [box.max.x, box.min.y, box.min.z],
          [box.max.x, box.max.y, box.min.z],
          [box.min.x, box.max.y, box.min.z],
          [box.min.x, box.min.y, box.max.z],
          [box.max.x, box.min.y, box.max.z],
          [box.max.x, box.max.y, box.max.z],
          [box.min.x, box.max.y, box.max.z],
        ].map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(matrix)),
        faces = [
          0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6,
          5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
        ];
      points = new Float32Array(faces.length * 3);
      faces.forEach((index, i) => corners[index].toArray(points, i * 3));
    }
    let signedVolume = 0,
      area = 0;
    const origin = new THREE.Vector3().fromArray(points),
      a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      cross = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 9) {
      a.fromArray(points, i);
      b.fromArray(points, i + 3);
      c.fromArray(points, i + 6);
      area += cross.copy(b).sub(a).cross(c.clone().sub(a)).length() * 0.5;
      a.sub(origin);
      b.sub(origin);
      c.sub(origin);
      signedVolume += a.dot(cross.copy(b).cross(c)) / 6;
    }
    shape.original = shape.current = shape.previous = points;
    shape.closed = volume.mesh
      ? (volume.closed ?? isClosedCollisionMesh(points))
      : true;
    shape.orientation = signedVolume < 0 ? -1 : 1;
    shape.volume = Math.abs(signedVolume);
    shape.area = area;
    return points;
  }
  private refreshCollisionSurfaces(sweeps: RocketSweep[]) {
    const union = new THREE.Box3();
    for (const sweep of sweeps)
      union.union(
        new THREE.Box3()
          .setFromPoints([sweep.from, sweep.to])
          .expandByScalar(sweep.radius),
      );
    for (const volume of this.nearbyVolumes(union)) {
      const shape = this.surfaceGeometry.get(volume);
      if (!shape || !volume.bounds.intersectsBox(union)) continue;
      const original = this.originalSurface(volume, shape),
        surface = this.effects?.collisionSurface?.(
          volume.mesh ?? volume,
          original,
        );
      shape.current = surface?.triangles ?? original;
      shape.previous = surface?.previousTriangles ?? shape.current;
      shape.deltaTime = surface?.deltaTime ?? 0;
      shape.revision = surface?.revision ?? -1;
      // Keep the original source envelope plus exact current bounds. Registration
      // already covers the maximum current deformation, so new cells are rare.
      if (surface && !volume.bounds.containsBox(surface.bounds)) {
        const old = volume.bounds.clone();
        volume.bounds.union(surface.bounds);
        for (
          let x = Math.floor(old.min.x / 80);
          x <= Math.floor(old.max.x / 80);
          x++
        )
          for (
            let z = Math.floor(old.min.z / 80);
            z <= Math.floor(old.max.z / 80);
            z++
          ) {
            const key = x + ',' + z,
              cell = this.world!.cells.get(key);
            if (cell)
              this.world!.cells.set(
                key,
                cell.filter((v) => v !== volume),
              );
          }
        this.world!.add(volume);
      }
    }
  }
  /** Exact segment/triangle closest pair. Every returned point lies on a real face. */
  private surfaceContactLoad(
    volume: RocketVolume,
    sweep: RocketSweep,
    state: RocketState,
  ): RocketContactLoad | undefined {
    const shape = this.surfaceGeometry.get(volume);
    if (!shape?.current) return undefined;
    const points = shape.current,
      delta = sweep.to.clone().sub(sweep.from),
      length = delta.length(),
      ray = new THREE.Ray(
        sweep.from,
        length > 1e-8
          ? delta.clone().divideScalar(length)
          : new THREE.Vector3(1, 0, 0),
      ),
      triangle = new THREE.Triangle(),
      nearest = new THREE.Vector3(),
      onRay = new THREE.Vector3(),
      bounds = new THREE.Box3()
        .setFromPoints([sweep.from, sweep.to])
        .expandByScalar(sweep.radius),
      triangleBounds = new THREE.Box3(),
      edge = new THREE.Line3();
    let bestDistance = Infinity,
      bestIndex = -1,
      bestAlong = Infinity;
    const axis = new THREE.Vector3(),
      point = new THREE.Vector3();
    const consider = (
      index: number,
      onAxis: THREE.Vector3,
      onTriangle: THREE.Vector3,
    ) => {
      const d = onAxis.distanceToSquared(onTriangle),
        along = onAxis.distanceToSquared(sweep.from);
      if (
        d > bestDistance + 1e-10 ||
        (Math.abs(d - bestDistance) <= 1e-10 && along >= bestAlong)
      )
        return;
      bestDistance = d;
      bestAlong = along;
      bestIndex = index;
      axis.copy(onAxis);
      point.copy(onTriangle);
    };
    for (let i = 0; i < points.length; i += 9) {
      triangle.a.fromArray(points, i);
      triangle.b.fromArray(points, i + 3);
      triangle.c.fromArray(points, i + 6);
      triangleBounds.setFromPoints([triangle.a, triangle.b, triangle.c]);
      if (!triangleBounds.intersectsBox(bounds)) continue;
      consider(
        i,
        sweep.from,
        triangle.closestPointToPoint(sweep.from, nearest),
      );
      consider(i, sweep.to, triangle.closestPointToPoint(sweep.to, nearest));
      if (length > 1e-8) {
        const hit = ray.intersectTriangle(
          triangle.a,
          triangle.b,
          triangle.c,
          false,
          nearest,
        );
        if (hit && hit.distanceToSquared(sweep.from) <= length * length)
          consider(i, hit, hit);
        for (const [a, b] of [
          [triangle.a, triangle.b],
          [triangle.b, triangle.c],
          [triangle.c, triangle.a],
        ]) {
          ray.distanceSqToSegment(a, b, onRay, nearest);
          if (onRay.distanceToSquared(sweep.from) <= length * length)
            consider(i, onRay, nearest);
          else
            consider(
              i,
              sweep.to,
              edge.set(a, b).closestPointToPoint(sweep.to, true, nearest),
            );
        }
      }
    }
    // A stationary capsule wholly inside a closed solid may have no nearby face.
    if (bestIndex < 0 && shape.closed)
      for (let i = 0; i < points.length; i += 9) {
        triangle.a.fromArray(points, i);
        triangle.b.fromArray(points, i + 3);
        triangle.c.fromArray(points, i + 6);
        consider(
          i,
          sweep.from,
          triangle.closestPointToPoint(sweep.from, nearest),
        );
      }
    if (bestIndex < 0) return undefined;
    triangle.a.fromArray(points, bestIndex);
    triangle.b.fromArray(points, bestIndex + 3);
    triangle.c.fromArray(points, bestIndex + 6);
    const normal = triangle.getNormal(new THREE.Vector3());
    if (normal.lengthSq() < 1e-10) return undefined;
    if (shape.closed) normal.multiplyScalar(shape.orientation);
    else {
      const side =
        bestDistance > 1e-10
          ? axis.clone().sub(point)
          : sweep.from.clone().sub(point);
      if (
        normal.dot(side) < -1e-8 ||
        (Math.abs(normal.dot(side)) <= 1e-8 &&
          normal.dot(
            new THREE.Vector3(
              state.velocity.x,
              state.velocity.y,
              state.velocity.z,
            ),
          ) > 0)
      )
        normal.negate();
    }
    const inside = shape.closed && axis.clone().sub(point).dot(normal) < -1e-8,
      distance = Math.sqrt(bestDistance),
      barycentric = triangle.getBarycoord(point, new THREE.Vector3()),
      previousPoint = new THREE.Vector3(),
      previous = shape.previous ?? points;
    if (barycentric && shape.deltaTime > 1e-6 && previous !== points) {
      previousPoint
        .addScaledVector(
          new THREE.Vector3().fromArray(previous, bestIndex),
          barycentric.x,
        )
        .addScaledVector(
          new THREE.Vector3().fromArray(previous, bestIndex + 3),
          barycentric.y,
        )
        .addScaledVector(
          new THREE.Vector3().fromArray(previous, bestIndex + 6),
          barycentric.z,
        );
    } else previousPoint.copy(point);
    const surfaceVelocity =
        shape.deltaTime > 1e-6
          ? point.clone().sub(previousPoint).divideScalar(shape.deltaTime)
          : new THREE.Vector3(),
      bridge =
        !!volume.local ||
        (this.e.data.flightBridgeSurfaceMeshes ?? []).includes(volume.mesh!),
      height = Math.max(
        0.1,
        shape.sourceBounds.max.y - shape.sourceBounds.min.y,
      ),
      mass = shape.closed
        ? shape.volume * 220
        : Math.min(shape.area, Math.PI * (sweep.radius * 2.5) ** 2) *
          (bridge ? 1000 : 350);
    return {
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      penetration: Math.max(0, sweep.radius + (inside ? distance : -distance)),
      obstacleMass: Math.max(10000, mass),
      yieldProgress: 0,
      surfaceVelocity: {
        x: surfaceVelocity.x,
        y: surfaceVelocity.y,
        z: surfaceVelocity.z,
      },
      source: bridge ? 'bridge' : 'landmark',
      part: sweep.part ?? 'core',
      objectHeight: height,
    };
  }
  /** Reuse the aircraft's exact narrow phase on one mission-owned volume. */
  private hitVolume(
    volume: RocketVolume,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
  ) {
    const shape = this.surfaceGeometry.get(volume);
    if (shape?.current)
      return (
        hitTriangles(shape.current, from, to, radius, shape.closed) ||
        (shape.closed && hitTriangles(shape.current, from, from, radius, true))
      );
    let query = this.volumeWorlds.get(volume);
    if (!query) {
      query = Object.create(this.world) as FlightWorld;
      query.cells = new Map();
      query.add(volume);
      this.volumeWorlds.set(volume, query);
    }
    return FlightWorld.prototype.hit.call(query, from, to, radius);
  }
  private contactPoint(volume: RocketVolume, sweep: RocketSweep) {
    const steps = Math.max(1, Math.ceil(sweep.from.distanceTo(sweep.to) / 0.7));
    for (let i = 0; i <= steps; i++) {
      const p = sweep.from.clone().lerp(sweep.to, i / steps);
      if (!this.hitVolume(volume, p, p, sweep.radius)) continue;
      if (volume.polygon) {
        for (const [dx, dz] of [
          [0, 0],
          [sweep.radius, 0],
          [-sweep.radius, 0],
          [0, sweep.radius],
          [0, -sweep.radius],
        ])
          if (inPolygon([p.x + dx, p.z + dz], volume.polygon))
            return new THREE.Vector3(
              p.x + dx,
              THREE.MathUtils.clamp(
                p.y,
                volume.bounds.min.y,
                volume.bounds.max.y,
              ),
              p.z + dz,
            );
      }
      return volume.bounds.clampPoint(p, new THREE.Vector3());
    }
    return volume.bounds.clampPoint(sweep.to, new THREE.Vector3());
  }
  /** Outward normal and overlap of the exact authored capsule against the prism. */
  private buildingContactLoad(
    volume: RocketVolume,
    sweep: RocketSweep,
    point: THREE.Vector3,
  ): RocketContactLoad {
    const b = volume.bounds,
      axis = new THREE.Line3(sweep.from, sweep.to).closestPointToPoint(
        point,
        true,
        new THREE.Vector3(),
      ),
      inside = inPolygon([axis.x, axis.z], volume.polygon!),
      edge = new THREE.Vector3();
    let distance = Infinity;
    for (const ring of volume.polygon!)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          q = ring[(i + 1) % ring.length],
          dx = q[0] - a[0],
          dz = q[1] - a[1],
          t = THREE.MathUtils.clamp(
            ((axis.x - a[0]) * dx + (axis.z - a[1]) * dz) /
              Math.max(1e-12, dx * dx + dz * dz),
            0,
            1,
          ),
          x = a[0] + dx * t,
          z = a[1] + dz * t,
          d = Math.hypot(axis.x - x, axis.z - z);
        if (d < distance) {
          distance = d;
          edge.set(x, axis.y, z);
        }
      }
    const normal = inside ? edge.clone().sub(axis) : axis.clone().sub(edge);
    normal.y = 0;
    if (normal.lengthSq() < 1e-12) normal.set(1, 0, 0);
    normal.normalize();
    const surfacePoint = new THREE.Vector3(
      edge.x,
      THREE.MathUtils.clamp(axis.y, b.min.y, b.max.y),
      edge.z,
    );
    let penetration = Math.max(
      0,
      sweep.radius + (inside ? distance : -distance),
    );
    const topDepth = sweep.radius + b.max.y - axis.y,
      bottomDepth = sweep.radius + axis.y - b.min.y;
    if (inside && topDepth >= 0 && topDepth < penetration) {
      normal.set(0, 1, 0);
      surfacePoint.set(axis.x, b.max.y, axis.z);
      penetration = topDepth;
    }
    if (inside && bottomDepth >= 0 && bottomDepth < penetration) {
      normal.set(0, -1, 0);
      surfacePoint.set(axis.x, b.min.y, axis.z);
      penetration = bottomDepth;
    }
    const originalTop = this.contactVolumes.get(volume)?.originalTop ?? b.max.y,
      height = Math.max(0.1, originalTop - b.min.y),
      area = Math.max(
        1,
        volume.polygon!.reduce((sum, ring, index) => {
          const a =
            Math.abs(
              ring.reduce((v, p, i) => {
                const q = ring[(i + 1) % ring.length];
                return v + p[0] * q[1] - q[0] * p[1];
              }, 0),
            ) * 0.5;
          return sum + (index ? -a : a);
        }, 0),
      );
    return {
      point: { x: surfacePoint.x, y: surfacePoint.y, z: surfacePoint.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      penetration,
      obstacleMass: Math.max(10000, area * height * 220),
      yieldProgress: THREE.MathUtils.clamp(
        (originalTop - b.max.y) / height,
        0,
        1,
      ),
      source: 'building',
      part: sweep.part ?? 'core',
      objectHeight: height,
    };
  }
  private impactRecord(
    contact: RocketCityContact,
    state: RocketState,
  ): RocketImpactRecord {
    const normal = contact.normal ?? { x: 0, y: 1, z: 0 };
    return {
      time: state.elapsed,
      point: { ...contact.point },
      normal: { ...normal },
      source: contact.source,
      part: contact.part ?? (state.boosterAttached ? 'core' : 'upper'),
      objectHeight: contact.bounds
        ? Math.max(0, contact.bounds.maxY - contact.bounds.minY)
        : 0,
      normalSpeed:
        contact.normalSpeed ??
        Math.max(
          0,
          -(
            state.velocity.x * normal.x +
            state.velocity.y * normal.y +
            state.velocity.z * normal.z
          ),
        ),
      severity: 1,
      fatal: true,
    };
  }
  private queryContacts(
    sweeps: RocketSweep[],
    state: RocketState,
  ): RocketContact[] {
    if (!this.world) return [];
    this.refreshCollisionSurfaces(sweeps);
    const result: RocketContact[] = [],
      seen = new Set<RocketVolume>(),
      seenSurfaces = new Set<string>();
    for (const sweep of sweeps) {
      const externalAdapter = this.world.hit !== this.missionHit;
      if (
        externalAdapter &&
        !this.world.hit(sweep.from, sweep.to, sweep.radius)
      )
        continue;
      const bounds = new THREE.Box3()
          .setFromPoints([sweep.from, sweep.to])
          .expandByScalar(sweep.radius),
        candidates = new Set<RocketVolume>();
      for (
        let x = Math.floor(bounds.min.x / 80);
        x <= Math.floor(bounds.max.x / 80);
        x++
      )
        for (
          let z = Math.floor(bounds.min.z / 80);
          z <= Math.floor(bounds.max.z / 80);
          z++
        )
          for (const volume of this.world.cells?.get(x + ',' + z) ?? [])
            candidates.add(volume);
      let identified = false;
      for (const volume of candidates) {
        if (seen.has(volume)) {
          identified = true;
          continue;
        }
        if (
          !volume.bounds.intersectsBox(bounds) ||
          !this.hitVolume(volume, sweep.from, sweep.to, sweep.radius)
        )
          continue;
        identified = true;
        // Pressure can settle a building before the vehicle ever touches it.
        // Resolve that real rendered surface before deciding this is an impact,
        // rather than discovering its shorter collider one frame too late.
        let p = volume.polygon
          ? this.contactPoint(volume, sweep)
          : sweep.from.clone();
        if (volume.polygon) {
          const top = this.effects?.supportCollisionHeight?.(p.x, p.z, state);
          if (top != null) {
            if (!this.contactVolumes.has(volume))
              this.contactVolumes.set(volume, {
                originalTop: volume.bounds.max.y,
                point: p.clone(),
              });
            volume.bounds.max.y = THREE.MathUtils.clamp(
              top,
              volume.bounds.min.y + 0.1,
              this.contactVolumes.get(volume)!.originalTop,
            );
            if (!this.hitVolume(volume, sweep.from, sweep.to, sweep.radius))
              continue;
            p = this.contactPoint(volume, sweep);
          }
        }
        if (seen.has(volume)) continue;
        seen.add(volume);
        if (volume.polygon) {
          let key = this.surfaceKeys.get(volume);
          if (!key) {
            key = JSON.stringify([
              volume.bounds.min.y,
              this.contactVolumes.get(volume)?.originalTop ??
                volume.bounds.max.y,
              volume.polygon,
            ]);
            this.surfaceKeys.set(volume, key);
          }
          if (seenSurfaces.has(key)) continue;
          seenSurfaces.add(key);
        }
        const b =
            this.surfaceGeometry.get(volume)?.sourceBounds ?? volume.bounds,
          load = volume.polygon
            ? this.buildingContactLoad(volume, sweep, p)
            : this.surfaceContactLoad(volume, sweep, state),
          metrics = load ? sampleRocketContact(state, load) : undefined;
        result.push({
          volume,
          contact: {
            source: volume.polygon
              ? 'building'
              : volume.local ||
                  (this.e.data.flightBridgeSurfaceMeshes ?? []).includes(
                    volume.mesh!,
                  )
                ? 'bridge'
                : 'landmark',
            point: load?.point ?? { x: p.x, y: p.y, z: p.z },
            from: { x: sweep.from.x, y: sweep.from.y, z: sweep.from.z },
            to: { x: sweep.to.x, y: sweep.to.y, z: sweep.to.z },
            radius: sweep.radius,
            speed: state.speed,
            mass: state.mass,
            initialOverlap: this.initialContacts.has(volume),
            part: sweep.part,
            normal: load?.normal,
            penetration: load?.penetration,
            obstacleMass: load?.obstacleMass,
            yieldProgress: load?.yieldProgress,
            normalSpeed: metrics?.normalSpeed,
            impactEnergy: metrics?.impactEnergy,
            force: metrics?.force,
            surfaceVelocity: load?.surfaceVelocity,
            bounds: {
              minX: b.min.x,
              maxX: b.max.x,
              minY: b.min.y,
              // Keep the source surface identity stable as its local collider settles.
              maxY: this.contactVolumes.get(volume)?.originalTop ?? b.max.y,
              minZ: b.min.z,
              maxZ: b.max.z,
            },
            polygon: volume.polygon,
          },
        });
        if (result.length >= 8) return result;
      }
      // Preserve collision with an external narrow-phase adapter even when it
      // cannot expose a building identity; it never receives launch grace.
      if (
        externalAdapter &&
        !identified &&
        !result.some(({ contact }) => contact.source === 'unknown')
      )
        result.push({
          contact: {
            source: 'unknown',
            point: { x: sweep.to.x, y: sweep.to.y, z: sweep.to.z },
            from: { x: sweep.from.x, y: sweep.from.y, z: sweep.from.z },
            to: { x: sweep.to.x, y: sweep.to.y, z: sweep.to.z },
            radius: sweep.radius,
            speed: state.speed,
            mass: state.mass,
            initialOverlap: false,
          },
        });
      if (result.length >= 8) return result;
    }
    return result;
  }
  private captureLaunchContacts() {
    this.initialContacts.clear();
    this.contactVolumes.clear();
    this.contactWarning = '';
    const state = this.state;
    if (!state || !['ground', 'platform'].includes(state.support.kind)) return;
    for (const { volume, contact } of this.queryContacts(
      this.collisionSweeps(state, state),
      state,
    ))
      if (volume?.polygon && contact.source === 'building')
        this.initialContacts.set(volume, 0);
    if (this.initialContacts.size)
      this.contactWarning =
        'Launch clearance obstructed: nearby buildings touch the assembled rocket.';
  }
  private syncContactVolumes(state: RocketState) {
    for (const [volume, contact] of this.contactVolumes) {
      const top = this.effects?.supportCollisionHeight?.(
        contact.point.x,
        contact.point.z,
        state,
      );
      if (top != null)
        volume.bounds.max.y = THREE.MathUtils.clamp(
          top,
          volume.bounds.min.y + 0.1,
          contact.originalTop,
        );
    }
  }
  update(rawDt: number) {
    if (!this.active || !this.state || !this.model || document.hidden) return;
    const dt = THREE.MathUtils.clamp(
      Number.isFinite(rawDt) ? rawDt : 0,
      0,
      0.1,
    );
    this.clock += dt;
    this.accumulator += dt;
    const held = (key: string) =>
      this.inputEnabled && this.keys.has(key) ? 1 : 0;
    if (held('KeyR') || held('KeyF'))
      this.throttle = THREE.MathUtils.clamp(
        this.throttle + dt * 0.4 * (held('KeyR') - held('KeyF')),
        0,
        1,
      );
    const input: RocketInput = {
      auto: this.auto,
      stabilize: this.stabilize,
      throttle: this.throttle,
      pitch:
        held('KeyW') +
        held('ArrowUp') -
        held('KeyS') -
        held('ArrowDown') -
        this.axes.y,
      roll:
        held('KeyD') +
        held('ArrowRight') -
        held('KeyA') -
        held('ArrowLeft') +
        this.axes.x,
      abort: this.requestAbort,
    };
    while (this.accumulator >= 1 / 60) {
      this.accumulator -= 1 / 60;
      const before = this.state;
      // Loading is part of construction: it cannot reach Ready before every required module succeeds.
      if (
        !this.loaded &&
        before.phase === 'building' &&
        before.buildProgress >= 0.98
      )
        continue;
      input.fireExposure = this.effects?.sampleVehicleHeat?.(before) ?? 0;
      this.state = stepRocket(before, input, 1 / 60);
      this.requestAbort = false;
      input.abort = false;
      let s = this.state;
      const config = ROCKET_CONFIGS[s.kind];
      // This mission owns these collider boxes. Follow the same settling roof
      // as the rendered building; nearby buildings keep their full collision.
      if (s.supportCollapsed)
        for (const volume of this.supportVolumes) {
          const top = this.effects?.supportCollisionHeight?.(
            s.origin.x,
            s.origin.z,
            s,
          );
          const t = THREE.MathUtils.clamp(s.supportCollapseElapsed / 2.6, 0, 1);
          const progress = 0.035 + 0.965 * t * t * (3 - 2 * t);
          volume.bounds.max.y = THREE.MathUtils.clamp(
            top ??
              volume.bounds.min.y +
                (volume.originalTop - volume.bounds.min.y) *
                  (1 - 0.925 * progress),
            volume.bounds.min.y + 0.1,
            volume.originalTop,
          );
        }
      this.syncContactVolumes(s);
      if (
        (s.phase === 'ignition' ||
          s.phase === 'flight' ||
          s.phase === 'aborted' ||
          s.phase === 'falling') &&
        s.position.y < 1500 &&
        this.world
      ) {
        const contacts = this.queryContacts(this.collisionSweeps(before, s), s);
        this.contactWarning = '';
        let collided = false;
        let impact: RocketImpactRecord | undefined;
        const crushing = new Set<RocketVolume>(),
          gradedPhase =
            s.supportCollapsed ||
            s.phase === 'falling' ||
            (s.kind === 'super-heavy' &&
              (s.phase === 'ignition' || s.phase === 'flight')),
          gradedContact = (contact: RocketCityContact) =>
            gradedPhase && contact.source !== 'unknown' && !!contact.normal,
          gradedContacts = contacts.filter(({ contact }) =>
            gradedContact(contact),
          ).length;
        for (const { volume, contact } of contacts) {
          if (gradedContact(contact) && contact.normal) {
            const metrics = sampleRocketContact(s, {
              point: contact.point,
              normal: contact.normal,
              penetration: contact.penetration ?? 0,
              obstacleMass: contact.obstacleMass ?? s.mass,
              yieldProgress: contact.yieldProgress ?? 0,
              surfaceVelocity: contact.surfaceVelocity,
            });
            contact.normalSpeed = metrics.normalSpeed;
            contact.impactEnergy = metrics.impactEnergy;
            contact.force = metrics.force;
          }
          if (gradedContact(contact) && contact.force != null)
            contact.force /= Math.max(1, gradedContacts);
          this.effects?.receiveCollision?.(contact, s, 1 / 60);
          if (volume?.polygon && !this.contactVolumes.has(volume))
            this.contactVolumes.set(volume, {
              originalTop: contact.bounds?.maxY ?? volume.bounds.max.y,
              point: new THREE.Vector3(
                contact.point.x,
                contact.point.y,
                contact.point.z,
              ),
            });
          if (gradedContact(contact) && contact.normal) {
            s = resolveRocketContact(
              s,
              {
                point: contact.point,
                normal: contact.normal,
                penetration: contact.penetration ?? 0,
                obstacleMass: contact.obstacleMass ?? s.mass,
                yieldProgress: contact.yieldProgress ?? 0,
                source: contact.source,
                surfaceVelocity: contact.surfaceVelocity,
                part: contact.part,
                objectHeight: contact.bounds
                  ? contact.bounds.maxY - contact.bounds.minY
                  : 0,
              },
              1 / (60 * Math.max(1, gradedContacts)),
            );
            this.state = s;
            this.contactWarning =
              s.contactState === 'compression'
                ? `The rocket is pushing against a ${contact.source}.`
                : `The rocket is scraping a ${contact.source}.`;
            if (s.wreckage) break;
            continue;
          }
          const age = volume ? this.initialContacts.get(volume) : undefined;
          const canCrush =
            s.kind !== 'super-heavy' &&
            contact.source === 'building' &&
            age != null &&
            age < 2.5 &&
            s.flightElapsed <= 2.5 &&
            s.speed < 25 &&
            s.altitude < 18 &&
            (s.phase === 'ignition' || s.phase === 'flight');
          if (canCrush && volume) {
            crushing.add(volume);
            this.contactWarning =
              'Launch clearance obstructed: the rocket is crushing against a building.';
          } else if (s.phase !== 'ignition') {
            collided = true;
            impact ??= this.impactRecord(contact, s);
          }
        }
        // Scout and Atlas retain their existing launch-contact response.
        // Buildings already touching the assembled vehicle can yield under a
        // low-speed shove. This bounded contact response costs velocity and
        // structure; a strong wall that remains after 2.5s is still fatal.
        if (crushing.size && s.phase === 'flight') {
          for (const volume of crushing)
            this.initialContacts.set(
              volume,
              this.initialContacts.get(volume)! + 1 / 60,
            );
          s.position.x =
            before.position.x + (s.position.x - before.position.x) * 0.35;
          s.position.y =
            before.position.y + (s.position.y - before.position.y) * 0.35;
          s.position.z =
            before.position.z + (s.position.z - before.position.z) * 0.35;
          s.velocity.x *= 0.82;
          s.velocity.y *= 0.82;
          s.velocity.z *= 0.82;
          s.altitude = Math.max(0, s.position.y - s.origin.y);
          s.speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
          s.integrity = Math.max(0, s.integrity - (0.07 * crushing.size) / 60);
          if (s.integrity <= 0) collided = true;
        }
        const direction = rocketDirection(s.attitude),
          lower = s.boosterAttached
            ? 0
            : config.height * config.upperNozzleFraction,
          bodyBase = new THREE.Vector3(
            s.position.x + direction.x * (lower + config.radius),
            s.position.y + direction.y * (lower + config.radius),
            s.position.z + direction.z * (lower + config.radius),
          ),
          bodyTip = new THREE.Vector3(
            s.position.x + direction.x * (config.height - config.radius),
            s.position.y + direction.y * (config.height - config.radius),
            s.position.z + direction.z * (config.height - config.radius),
          ),
          noseImpact =
            direction.y < 0 &&
            bodyTip.y <
              this.world.surface(bodyTip.x, bodyTip.z).height +
                config.radius * 0.5,
          lowest = bodyBase.y < bodyTip.y ? bodyBase : bodyTip;
        if (
          collided ||
          noseImpact ||
          (s.altitude > 3 &&
            lowest.y < this.world.surface(lowest.x, lowest.z).height)
        ) {
          const groundPoint = noseImpact ? bodyTip : lowest;
          impact ??= {
            time: s.elapsed,
            point: {
              x: groundPoint.x,
              y: this.world.surface(groundPoint.x, groundPoint.z).height,
              z: groundPoint.z,
            },
            normal: { x: 0, y: 1, z: 0 },
            source: 'terrain',
            part: s.boosterAttached ? 'core' : 'upper',
            objectHeight: 0,
            normalSpeed: Math.max(0, -s.velocity.y),
            severity: 1,
            fatal: true,
          };
          this.state = crashRocket(
            s,
            impact.source === 'terrain'
              ? 'The rocket struck the ground.'
              : s.supportCollapsed
                ? 'The falling rocket struck a city structure.'
                : `The rocket struck a ${impact.source}.`,
            impact,
          );
        }
      }
    }
    const s = this.state,
      dir = rocketDirection(s.attitude),
      q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dir.x, dir.y, dir.z).normalize(),
      );
    this.model.group.quaternion.copy(q);
    this.model.build(s.phase === 'sinking' ? 1 : s.buildProgress);
    this.model.stage(s);
    this.model.fire(sampleRocketEffects(s).engine, this.clock);
    this.damageFocus = this.model.damage(s, (x, z) =>
      Math.max(
        this.world?.surface(x, z).height ?? this.e.elevation(x, z),
        this.effects?.supportCollisionHeight?.(x, z, s) ?? -Infinity,
      ),
    );
    const strike = s.contactImpact,
      strikeAge = strike ? s.elapsed - strike.time : Infinity,
      targetStrikeBlend = strike?.fatal && strikeAge < 1.4 ? 0.65 : 0;
    this.impactFocusBlend +=
      (targetStrikeBlend - this.impactFocusBlend) * (1 - Math.exp(-dt * 4));
    if (strike?.fatal && this.damageFocus && this.impactFocusBlend > 0.001)
      this.damageFocus.lerp(
        new THREE.Vector3(strike.point.x, strike.point.y, strike.point.z),
        this.impactFocusBlend,
      );
    if ((s.phase === 'falling' || s.wreckage) && !this.accidentFramed) {
      this.accidentFramed = true;
      this.setView('chase');
      this.lookPitch = Math.max(this.lookPitch, 0.65);
      this.setSpaceFocus('rocket');
    }
    this.model.group.visible =
      !(this.view === 'first' && this.active) &&
      this.spaceFocus !== 'sun' &&
      this.spaceFocus !== 'moon';
    if (!this.wasSpace)
      this.model.group.position.set(s.position.x, s.position.y, s.position.z);
    if (this.scaffold) {
      this.scaffold.visible = ['building', 'ready', 'countdown'].includes(
        s.phase,
      );
      if (s.phase === 'sinking') this.scaffold.position.y = s.position.y;
    }
    this.effects?.update(dt, s, this.damageFocus);
    this.audio?.update(
      sampleRocketEffects(s).engine * Math.max(0.06, 1 - s.altitude / 45000),
      this.muted || !this.inputEnabled,
    );
    this.updateCamera(dt);
    if (this.clock - this.published >= 0.1) {
      this.published = this.clock;
      this.notify();
    }
  }
  private updateCamera(dt: number) {
    const s = this.state;
    if (!s || !this.model) return;
    const config = ROCKET_CONFIGS[s.kind],
      camera = this.e.camera,
      p = new THREE.Vector3(s.position.x, s.position.y, s.position.z),
      q = this.model.group.quaternion;
    if (this.view === 'first') {
      camera.position
        .copy(p)
        .add(new THREE.Vector3(0, config.height * 0.84, 0).applyQuaternion(q));
      camera.quaternion
        .copy(q)
        .multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.PI / 2 + this.lookPitch,
              this.lookYaw,
              0,
              'YXZ',
            ),
          ),
        );
      camera.near = 0.04;
      camera.fov = 68;
    } else {
      const centerHeight = config.height * (s.boosterAttached ? 0.45 : 0.72),
        distance =
          config.cameraDistance *
          this.zoomScale *
          (s.boosterAttached ? 1 : 0.64) *
          (s.wreckage
            ? 1 + Math.min(0.35, (s.elapsed - s.wreckage.time) * 0.09)
            : 1),
        offset = new THREE.Vector3(
          Math.sin(this.lookYaw) * Math.cos(this.lookPitch) * distance,
          Math.sin(this.lookPitch) * distance,
          Math.cos(this.lookYaw) * Math.cos(this.lookPitch) * distance,
        );
      const focus =
        this.damageFocus?.clone() ??
        p.clone().add(new THREE.Vector3(0, centerHeight, 0).applyQuaternion(q));
      // In a city a clear orbit at liftoff can end behind a tower as the
      // vehicle falls. Choose a nearby open viewing ray, retaining the same
      // damped offset so the observation camera never snaps between buildings.
      if (
        this.accidentFramed &&
        this.world &&
        s.altitude < 1500 &&
        this.world.hit(focus, focus.clone().add(offset), 0.5)
      ) {
        let best: THREE.Vector3 | null = null;
        let cost = Infinity;
        let yaw = this.lookYaw,
          pitch = this.lookPitch;
        for (const elevation of [this.lookPitch, 0.85, 1.05, 1.25])
          for (const angle of [0, -0.6, 0.6, -1.2, 1.2, Math.PI]) {
            const candidate = new THREE.Vector3(
              Math.sin(this.lookYaw + angle) * Math.cos(elevation) * distance,
              Math.sin(elevation) * distance,
              Math.cos(this.lookYaw + angle) * Math.cos(elevation) * distance,
            );
            const score =
              Math.abs(angle) + Math.abs(elevation - this.lookPitch) * 2;
            if (
              score >= cost ||
              this.world.hit(focus, focus.clone().add(candidate), 0.5)
            )
              continue;
            best = candidate;
            cost = score;
            yaw = this.lookYaw + angle;
            pitch = elevation;
          }
        if (best) {
          offset.copy(best);
          this.lookYaw = yaw;
          this.lookPitch = pitch;
        }
      }
      // Follow translation in the rocket frame. Smoothing an absolute world
      // position trails a fast vehicle by velocity / damping; variable render
      // deltas then turn the changing lag into violent screen-space bobbing.
      // Only the player's orbit offset and the staging composition are damped.
      if (!this.chaseInitialized) {
        this.chaseOffset.copy(offset);
        this.chaseAnchorHeight = centerHeight;
        this.chaseInitialized = true;
      } else {
        const blend = 1 - Math.exp(-dt * 6);
        this.chaseOffset.lerp(offset, blend);
        this.chaseAnchorHeight +=
          (centerHeight - this.chaseAnchorHeight) * blend;
      }
      const target =
        this.damageFocus?.clone() ??
        p
          .clone()
          .add(
            new THREE.Vector3(0, this.chaseAnchorHeight, 0).applyQuaternion(q),
          );
      camera.position.copy(target).add(this.chaseOffset);
      if (s.altitude < 200)
        camera.position.y = Math.max(
          camera.position.y,
          this.e.elevation(camera.position.x, camera.position.z) + 3,
        );
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.near = 0.2;
      camera.fov = 55;
    }
    const shake =
      this.view === 'first' ? sampleRocketEffects(s).shake * 0.035 : 0;
    camera.position.x += Math.sin(this.clock * 39) * shake;
    camera.position.y += Math.sin(this.clock * 47) * shake;
    camera.far = 120000;
    camera.updateProjectionMatrix();
    if (this.damageFocus) this.e.controls.target.copy(this.damageFocus);
    else this.e.controls.target.copy(p).y += config.height * 0.4;
    this.cabin.visible = this.view === 'first';
    if (s.altitude >= 15000 && this.space) {
      if (!this.wasSpace) {
        this.space.scene.add(this.model.group);
        this.model.group.position.set(0, 0, 0);
        this.model.group.scale.setScalar(1e-5);
        this.model.light.visible = false;
        this.wasSpace = true;
      }
      this.space.update(
        s.altitude,
        s.elapsed,
        camera.aspect,
        this.view === 'first',
        this.lookYaw,
        this.lookPitch,
      );
      // Preserve actual attitude, player look and camera framing across the scene handoff.
      this.space.camera.position
        .copy(camera.position)
        .sub(p)
        .multiplyScalar(1e-5);
      this.space.camera.quaternion.copy(camera.quaternion);
      let fov = camera.fov;
      if (this.spaceFocus !== 'rocket') {
        const focus =
          this.spaceFocus === 'earth'
            ? null
            : this.space.getCelestialFocus(this.spaceFocus);
        const target = focus?.target ?? this.space.getHorizonTarget();
        const desired = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(
            this.space.camera.position,
            target,
            new THREE.Vector3(0, 1, 0),
          ),
        );
        this.focusOrientation.slerp(desired, 1 - Math.exp(-dt * 4));
        this.space.camera.quaternion.copy(this.focusOrientation);
        fov = focus?.fovDegrees ?? 55;
      } else if (this.focusTransition) {
        this.focusOrientation.slerp(camera.quaternion, 1 - Math.exp(-dt * 5));
        this.space.camera.quaternion.copy(this.focusOrientation);
        if (this.focusOrientation.angleTo(camera.quaternion) < 0.001)
          this.focusTransition = false;
      }
      this.focusFov += (fov - this.focusFov) * (1 - Math.exp(-dt * 4));
      this.space.camera.fov = this.focusFov;
      this.space.camera.near = this.view === 'first' ? 0.0000004 : 0.00001;
      this.space.camera.updateProjectionMatrix();
      this.space.scene.add(this.space.camera);
      this.space.camera.updateMatrixWorld();
      this.space.camera.add(this.cabin);
      this.cabin.scale.setScalar(1e-5);
    }
  }
  renderSpace() {
    if (!this.active || !this.wasSpace || !this.space) return false;
    this.e.renderer.render(this.space.scene, this.space.camera);
    return true;
  }
  beforeRender() {
    this.effects?.beforeRender();
  }
  afterRender() {
    this.effects?.afterRender();
  }
  private down = (ev: PointerEvent) => {
    if (
      (!this.active && !this.placing) ||
      !this.inputEnabled ||
      ev.button !== 0
    )
      return;
    this.pointers.set(ev.pointerId, {
      x: ev.clientX,
      y: ev.clientY,
      sx: ev.clientX,
      sy: ev.clientY,
      moved: false,
    });
    if (this.pointers.size > 1) this.gestureHadMultiple = true;
    if (this.active) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  };
  private move = (ev: PointerEvent) => {
    const p = this.pointers.get(ev.pointerId);
    if (!this.inputEnabled) return;
    if (p && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) >= 8)
      p.moved = true;
    if (this.placing) {
      if (performance.now() - this.lastPickAt > 70) {
        this.lastPickAt = performance.now();
        this.pick(ev.clientX, ev.clientY);
      }
      return;
    }
    if (!p || !this.active || !this.inputEnabled) return;
    if (this.pointers.size > 1) {
      const pair = [...this.pointers.values()].slice(0, 2),
        previous = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      p.x = ev.clientX;
      p.y = ev.clientY;
      const next = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      if (previous > 4 && next > 4) this.zoomDistance(previous / next);
      return;
    }
    if (this.spaceFocus !== 'rocket') this.setSpaceFocus('rocket');
    this.lookYaw -= (ev.clientX - p.x) * 0.005;
    this.lookPitch = THREE.MathUtils.clamp(
      this.lookPitch + (ev.clientY - p.y) * 0.004,
      this.view === 'first' ? -2.8 : -1.4,
      this.view === 'first' ? 2.8 : 1.4,
    );
    p.x = ev.clientX;
    p.y = ev.clientY;
  };
  private up = (ev: PointerEvent) => {
    const p = this.pointers.get(ev.pointerId),
      tap =
        !!p && !p.moved && !this.gestureHadMultiple && this.pointers.size === 1;
    this.pointers.delete(ev.pointerId);
    if (
      tap &&
      this.placing &&
      this.inputEnabled &&
      Math.hypot(ev.clientX - p!.sx, ev.clientY - p!.sy) < 8
    )
      this.pick(ev.clientX, ev.clientY, true);
    if (this.pointers.size === 0) this.gestureHadMultiple = false;
  };
  private cancelPointer = (ev: PointerEvent) => {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size === 0) this.gestureHadMultiple = false;
  };
  private wheel = (ev: WheelEvent) => {
    if (!this.active || !this.inputEnabled || !Number.isFinite(ev.deltaY))
      return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    this.zoomScale = THREE.MathUtils.clamp(
      this.zoomScale * Math.exp(ev.deltaY * 0.001),
      0.5,
      5,
    );
  };
  private keyDown = (ev: KeyboardEvent) => {
    if (
      (!this.active && !this.placing) ||
      !this.inputEnabled ||
      ev.ctrlKey ||
      ev.altKey ||
      ev.metaKey ||
      (ev.target instanceof HTMLElement &&
        !!ev.target.closest(
          'input,select,textarea,[role="slider"],[contenteditable="true"]',
        ))
    )
      return;
    if (
      ev.target instanceof HTMLElement &&
      ev.target.closest('button,a,[role="button"],[role="radio"]') &&
      (ev.code === 'Space' || ev.code === 'Enter')
    )
      return;
    if (ev.code === 'Escape') {
      if (this.placing) this.cancelPlacement();
      else this.returnToCity();
      return;
    }
    if (!this.active) return;
    if (
      [
        'KeyW',
        'KeyS',
        'KeyA',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'KeyR',
        'KeyF',
        'Space',
      ].includes(ev.code)
    ) {
      ev.preventDefault();
      this.keys.add(ev.code);
    }
    if (ev.repeat) return;
    if (ev.code === 'Space') this.launch();
    if (ev.code === 'KeyC')
      this.setView(this.view === 'first' ? 'chase' : 'first');
    if (ev.code === 'KeyM') this.setAuto(!this.auto);
    if (ev.code === 'KeyX') this.abort();
  };
  private keyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.code);
  };
  destroy() {
    if (this.disposed) return;
    this.returnToCity();
    this.disposed = true;
    this.clearMission();
    disposeRocketObject(this.ring);
    disposeRocketObject(this.cabin);
    const c = this.e.renderer.domElement;
    c.removeEventListener('pointerdown', this.down, true);
    c.removeEventListener('wheel', this.wheel, true);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancelPointer);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
