import * as THREE from 'three';
import type { CityEngine } from './engine';
import { firstVisibleObstacleHit } from './visible-obstacles';
import { inPolygon } from './geo';
import { FlightWorld } from './flight-world';
import {
  createRocket,
  launchRocket,
  stepRocket,
  crashRocket,
  rocketDirection,
  sampleRocketEffects,
  ROCKET_CONFIGS,
  type RocketKind,
  type RocketState,
  type RocketSupport,
  type RocketInput,
} from './rocket-state';
import {
  EMPTY_ROCKET,
  type RocketSnapshot,
  type RocketView,
} from './rocket-snapshot';
import {
  createRocketModel,
  createRocketScaffold,
  disposeRocketObject,
} from './assets/rocket';
import type { RocketEffects, RocketAudio } from './rocket-effects';
import type { RocketSpace } from './rocket-space';

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
      warning: this.placing ? this.preview : (s?.failureReason ?? ''),
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
  private supportAt(point: THREE.Vector3, roof = false): RocketSupport {
    const groundY = this.e.elevation(point.x, point.z),
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
    const radius = ROCKET_CONFIGS[this.kind].radius * 1.5;
    const heights = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ].map(([dx, dz]) => this.e.elevation(point.x + dx, point.z + dz));
    return {
      kind: 'ground',
      groundY,
      strength: Math.max(
        0.22,
        1 - (Math.max(...heights) - Math.min(...heights)) / (radius * 1.7),
      ),
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
    this.preview = support.kind;
    this.ring.visible = true;
    this.ring.position.copy(point);
    this.ring.position.y += 0.35;
    this.ring.scale.setScalar(
      Math.max(1, (distance * 1.8) / rect.height) *
        (this.kind === 'large' ? 2 : 1),
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
    this.state = createRocket(
      kind,
      x,
      y,
      z,
      support ??
        this.supportAt(
          new THREE.Vector3(x, y, z),
          y > this.e.elevation(x, z) + 4,
        ),
    );
    this.model = createRocketModel(kind);
    this.model.group.position.set(x, y, z);
    this.model.build(this.state.phase === 'sinking' ? 1 : 0);
    this.e.scene.add(this.model.group);
    this.scaffold = createRocketScaffold(kind === 'large');
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
    this.loaded = this.loadError = this.wasSpace = false;
    this.accumulator = 0;
    this.requestAbort = false;
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
      this.state = stepRocket(before, input, 1 / 60);
      this.requestAbort = false;
      input.abort = false;
      const s = this.state,
        config = ROCKET_CONFIGS[s.kind];
      if (
        (s.phase === 'flight' || s.phase === 'aborted') &&
        s.position.y < 1500 &&
        this.world
      ) {
        const direction = rocketDirection(s.attitude),
          previousDir = rocketDirection(before.attitude);
        const bodyBase = new THREE.Vector3(
          s.position.x + direction.x * config.radius,
          s.position.y + direction.y * config.radius,
          s.position.z + direction.z * config.radius,
        );
        const bodyTip = new THREE.Vector3(
          s.position.x + direction.x * (config.height - config.radius),
          s.position.y + direction.y * (config.height - config.radius),
          s.position.z + direction.z * (config.height - config.radius),
        );
        // Check the whole current body as well as temporal sweeps: three point
        // probes alone can straddle a thin bridge deck or the edge of a roof.
        const collided =
          this.world.hit(bodyBase, bodyTip, config.radius * 0.75) ||
          [0.18, 0.5, 0.9].some((t) =>
            this.world!.hit(
              new THREE.Vector3(
                before.position.x + previousDir.x * config.height * t,
                before.position.y + previousDir.y * config.height * t,
                before.position.z + previousDir.z * config.height * t,
              ),
              new THREE.Vector3(
                s.position.x + direction.x * config.height * t,
                s.position.y + direction.y * config.height * t,
                s.position.z + direction.z * config.height * t,
              ),
              config.radius * 0.75,
            ),
          );
        const noseImpact =
          direction.y < 0 &&
          bodyTip.y <
            this.world.surface(bodyTip.x, bodyTip.z).height +
              config.radius * 0.5;
        if (
          collided ||
          noseImpact ||
          (s.altitude > 3 &&
            s.position.y <
              this.world.surface(s.position.x, s.position.z).height)
        )
          this.state = crashRocket(s, 'collision');
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
    this.model.fire(sampleRocketEffects(s).engine, this.clock);
    this.model.group.visible =
      s.phase !== 'crashed' && !(this.view === 'first' && this.active);
    if (!this.wasSpace)
      this.model.group.position.set(s.position.x, s.position.y, s.position.z);
    if (this.scaffold) {
      this.scaffold.visible = ['building', 'ready', 'countdown'].includes(
        s.phase,
      );
      if (s.phase === 'sinking') this.scaffold.position.y = s.position.y;
    }
    this.effects?.update(dt, s);
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
      const distance = config.cameraDistance * this.zoomScale,
        offset = new THREE.Vector3(
          Math.sin(this.lookYaw) * Math.cos(this.lookPitch) * distance,
          Math.sin(this.lookPitch) * distance + config.height * 0.4,
          Math.cos(this.lookYaw) * Math.cos(this.lookPitch) * distance,
        );
      const target = p
        .clone()
        .add(new THREE.Vector3(0, config.height * 0.45, 0));
      const wanted = p.clone().add(offset);
      wanted.y = Math.max(wanted.y, this.e.elevation(wanted.x, wanted.z) + 3);
      camera.position.lerp(wanted, 1 - Math.exp(-dt * 7));
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.near = 0.2;
      camera.fov = 55;
    }
    const shake =
      sampleRocketEffects(s).shake * (this.e.compatibleGraphics ? 0.1 : 0.22);
    camera.position.x += Math.sin(this.clock * 39) * shake;
    camera.position.y += Math.sin(this.clock * 47) * shake;
    camera.far = 120000;
    camera.updateProjectionMatrix();
    this.e.controls.target.copy(p).y += config.height * 0.4;
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
