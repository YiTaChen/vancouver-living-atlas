import * as THREE from 'three';
import type { CityEngine } from './engine';
import {
  SkyTrainJourney,
  SKYTRAIN_STATIONS,
  skyTrainStation,
  type LineId,
  type StationId,
  type SkyTrainDirection,
} from './skytrain-network';
import {
  SkyTrainStations,
  trainStopFor,
  stationWorldPose,
  validateRuntimeStation,
  type RuntimeStationData,
  type SkyTrainStationOwner,
  type StationPoint,
} from './skytrain-stations';
import { SkyTrainRideTrain } from './skytrain-ride-train';
import {
  loadSkyTrainRoutes,
  adaptSkyTrainStationFrame,
  SkyTrainRidePath,
  type SkyTrainRouteData,
} from './skytrain-ride-path';
import type { SkyTrainTravelSnapshot } from './skytrain-travel-types';
import { safeTouchAxis } from './touch-input';

export const EMPTY_SKYTRAIN_TRAVEL: SkyTrainTravelSnapshot = {
  phase: 'idle',
  stationId: null,
  lineId: null,
  plannedLineId: null,
  destinationId: 'main-street-science-world',
  nextStationId: null,
  level: 'concourse',
  doorsOpen: false,
  canBoard: false,
  canAlight: false,
  canExit: false,
  canChangeLevel: false,
  speedMps: 0,
  travelProgress: 0,
  error: null,
};
const UP = new THREE.Vector3(0, 1, 0);
const keyFor = (line: LineId, from: StationId, to: StationId) =>
  `${line}:${from}:${to}`;
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="listbox"]',
    ),
  );

/** One authority for the walking passenger, local station floor and moving
 * train frame. The city's ordinary vehicle navigation never consumes these floors. */
export class SkyTrainTravel {
  readonly stations: SkyTrainStations;
  readonly train = new SkyTrainRideTrain();
  private owner: SkyTrainStationOwner | null = null;
  private phase: SkyTrainTravelSnapshot['phase'] = 'idle';
  private station: StationId | null = null;
  private destination: StationId = 'main-street-science-world';
  private line: LineId = 'expo';
  private direction: SkyTrainDirection = 'eastbound';
  private level: 'concourse' | 'platform' = 'concourse';
  private foot: StationPoint | null = null;
  private journey: SkyTrainJourney | null = null;
  private routeData: SkyTrainRouteData | null = null;
  private readonly paths = new Map<string, SkyTrainRidePath>();
  private readonly metadata = new Map<StationId, RuntimeStationData>();
  private generation = 0;
  private disposed = false;
  private inputEnabled = true;
  private busy = false;
  private error: string | null = null;
  private keys = new Set<string>();
  private axes = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = -0.03;
  private lookYaw = 0;
  private drag: { id: number; x: number; y: number } | null = null;
  private walkDistance = 0;
  private tube: THREE.Group | null = null;
  private pathKey = '';
  private readonly life = new AbortController();
  onChange = () => {};
  constructor(private readonly city: CityEngine) {
    this.stations = new SkyTrainStations({
      heightAt: (x, z) => city.elevation(x, z),
      scene: city.scene,
      fetchStation: async (id, signal) => {
        const response = await fetch(`/models/skytrain-stations/${id}.json`, {
          signal,
        });
        if (!response.ok) throw new Error('Station unavailable');
        const data = validateRuntimeStation(await response.json(), id);
        if (!this.routeData) throw new Error('Route unavailable');
        return adaptSkyTrainStationFrame(data, this.routeData);
      },
    });
    city.scene.add(this.train.group);
    this.train.group.visible = false;
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.visibility);
    const canvas = city.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerEnd);
    canvas.addEventListener('pointercancel', this.pointerEnd);
    canvas.addEventListener('lostpointercapture', this.pointerEnd);
  }
  get active() {
    return this.phase !== 'idle' && this.phase !== 'error';
  }
  get aboard() {
    return this.journey?.snapshot().aboard ?? false;
  }
  get speedMps() {
    return this.journey?.snapshot().speedMps ?? 0;
  }
  get underground() {
    if (!this.active) return false;
    const p = this.city.camera.position;
    return p.y < this.city.elevation(p.x, p.z) - 0.35;
  }
  get pose() {
    return this.active ? this.city.controls.target : null;
  }
  snapshot(): SkyTrainTravelSnapshot {
    const j = this.journey?.snapshot(),
      owner = this.owner,
      foot = this.foot;
    let canChangeLevel = false,
      canExit = false,
      nearDoor = false;
    if (owner && foot && this.phase === 'station' && !this.busy) {
      const access = owner.accessPoint(
        this.level === 'concourse' ? 'entry' : 'platform',
        this.line,
        this.direction,
      );
      canChangeLevel = distance(foot.position, access.position) < 2.5;
      canExit =
        this.level === 'concourse' &&
        distance(
          foot.position,
          owner.entry(this.line, this.direction).position,
        ) < 3 &&
        Boolean(this.exitPoint());
      nearDoor =
        this.level === 'platform' &&
        distance(
          foot.position,
          owner.boardingPoint(this.line, this.direction).position,
        ) < 2;
    }
    const canBoard = Boolean(
      j?.canBoard &&
      nearDoor &&
      j.lineId === this.line &&
      j.directionName === this.direction &&
      this.train.ready &&
      this.trainAtPlatform() &&
      this.train.doorsClear &&
      this.inputEnabled &&
      !this.busy,
    );
    const canAlight = Boolean(
      j?.canAlight &&
      owner &&
      this.station === j.currentStation &&
      this.trainAtPlatform() &&
      this.train.doorsClear &&
      !this.busy &&
      this.inputEnabled,
    );
    return {
      phase: this.phase,
      stationId: this.station,
      lineId: this.station ? this.line : null,
      plannedLineId: j?.lineId ?? null,
      destinationId: this.destination,
      nextStationId: j?.nextStation ?? null,
      level: this.level,
      doorsOpen: Boolean(this.train.ready && this.train.doorsClear),
      canBoard,
      canAlight,
      canExit,
      canLeave: canExit,
      canChangeLevel,
      speedMps: j?.speedMps ?? 0,
      travelProgress: j?.progress ?? 0,
      error: this.error,
      busy: this.busy,
      transferAt: j?.itinerary.transferStation ?? null,
      availableLines: this.station ? skyTrainStation(this.station).lines : [],
      hint: this.busy
        ? 'wait'
        : this.phase === 'riding'
          ? canAlight
            ? 'alight'
            : 'wait'
          : canBoard
            ? 'board'
            : j &&
                (j.lineId !== this.line || j.directionName !== this.direction)
              ? 'transfer'
              : this.level === 'concourse'
                ? canChangeLevel
                  ? 'choose-destination'
                  : 'approach-access'
                : 'approach-door',
    };
  }
  private publish() {
    if (!this.disposed) this.onChange();
  }
  private updateBuildingReplacement() {
    const uniform = this.city.uniforms?.skyTrainReplacement;
    if (!uniform) return;
    const seed =
      this.active && this.owner?.data.id === 'main-street-science-world'
        ? this.city.data.buildingProfiles?.get('osm-structure-303')?.seed
        : undefined;
    if (Number.isFinite(seed) && this.owner)
      uniform.value.set(seed, this.owner.origin[0], this.owner.origin[2], 170);
    else uniform.value.set(-1, 0, 0, 0);
  }
  private trainAtPlatform() {
    if (!this.owner || this.train.serviceLine !== this.line) return false;
    const stop = this.owner.trainStop(this.line, this.direction);
    const expected = stationWorldPose(
      this.owner.data,
      (x, z) => this.city.elevation(x, z),
      stop.position,
      stop.quaternion,
    );
    return (
      this.train.group.position.distanceToSquared(
        new THREE.Vector3(...expected.position),
      ) < 0.0025 &&
      this.train.group.quaternion.angleTo(
        new THREE.Quaternion(...expected.quaternion),
      ) < 0.005
    );
  }
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.clearInput();
  }
  setTouchAxes(x: number, y: number) {
    this.axes =
      this.active && this.inputEnabled
        ? { x: safeTouchAxis(x), y: safeTouchAxis(y) }
        : { x: 0, y: 0 };
  }
  clearInput = () => {
    this.keys.clear();
    this.axes = { x: 0, y: 0 };
    this.drag = null;
  };
  private visibility = () => {
    if (document.hidden) this.clearInput();
  };
  async enter(id: StationId) {
    if (
      this.disposed ||
      this.active ||
      !SKYTRAIN_STATIONS.some((s) => s.id === id) ||
      !this.city.closeBusVisit()
    )
      return false;
    const generation = ++this.generation;
    this.phase = 'loading';
    this.busy = true;
    this.error = null;
    this.station = id;
    this.city.tesla?.deactivate();
    this.city.flight?.clear();
    this.city.placement?.cancel();
    this.city.navigation?.setMode('orbit');
    this.city.navigation?.blur();
    this.city.transition = null;
    this.city.settings = {
      ...this.city.settings,
      mode: 'walk',
      autoRotate: false,
    };
    this.city.controls.enabled = false;
    this.city.onTravelResume('walk');
    this.clearInput();
    this.publish();
    try {
      this.routeData ??= await loadSkyTrainRoutes(this.life.signal);
      const descriptions = await Promise.all(
        SKYTRAIN_STATIONS.map((s) => this.stations.describe(s.id)),
      );
      if (this.disposed || generation !== this.generation) return false;
      descriptions.forEach((data) => this.metadata.set(data.id, data));
      this.buildPaths();
      if (this.destination === id)
        this.destination =
          id === 'waterfront' ? 'main-street-science-world' : 'waterfront';
      this.createJourney();
      this.line = this.journey!.snapshot().lineId;
      this.direction = this.journey!.snapshot().directionName;
      this.owner = await this.stations.load(
        id,
        this.line,
        this.city.settings.quality,
      );
      if (this.disposed || generation !== this.generation) return false;
      this.foot = this.owner.spawn('entry', this.line, this.direction);
      this.yaw = this.foot.yaw;
      if (
        !(await this.train.load(
          this.line,
          this.city.settings.quality,
          this.city.compatibleGraphics,
        ))
      )
        throw new Error('Train unavailable');
      if (this.disposed || generation !== this.generation) return false;
      this.placeAtStation();
      this.train.group.visible = true;
      this.level = 'concourse';
      this.updateCamera();
      // Compile this consist with the city's actual lighting while the loading
      // state is visible, rather than compiling a newly visible cabin on board.
      await this.city.renderer.compileAsync?.(
        this.train.group,
        this.city.camera,
        this.city.scene,
      );
      if (this.disposed || generation !== this.generation) return false;
      this.phase = 'station';
      this.busy = false;
      this.city.renderer.domElement.focus({ preventScroll: true });
      this.publish();
      return true;
    } catch {
      if (this.disposed || generation !== this.generation) return false;
      this.busy = false;
      this.error = 'unavailable';
      this.phase = 'error';
      this.updateBuildingReplacement();
      this.train.group.visible = false;
      this.stations.hide();
      this.city.settings = {
        ...this.city.settings,
        mode: 'orbit',
        autoRotate: false,
      };
      this.city.controls.enabled = true;
      this.city.onLocalOrbit();
      this.publish();
      return false;
    }
  }
  private buildPaths() {
    this.paths.clear();
    for (const segment of this.routeData!.segments) {
      const a = this.metadata.get(segment.from)!,
        b = this.metadata.get(segment.to)!;
      const direction = a.platforms.find(
        (p) =>
          p.line === segment.lineId &&
          p.direction ===
            (segment.lineId === 'expo'
              ? SKYTRAIN_STATIONS.findIndex((s) => s.id === segment.from) <
                SKYTRAIN_STATIONS.findIndex((s) => s.id === segment.to)
                ? 'eastbound'
                : 'westbound'
              : segment.from === 'waterfront' ||
                  segment.to === 'yaletown-roundhouse'
                ? 'southbound'
                : 'northbound'),
      )?.direction;
      if (!direction) throw new Error('Missing directional platform');
      const pose = (data: RuntimeStationData) => {
        const stop = trainStopFor(data, segment.lineId, direction);
        const world = stationWorldPose(
          data,
          (x, z) => this.city.elevation(x, z),
          stop.position,
          stop.quaternion,
        );
        return {
          position: new THREE.Vector3(...world.position),
          quaternion: new THREE.Quaternion().fromArray(world.quaternion),
          motionSign: stop.motionSign,
        };
      };
      this.paths.set(
        keyFor(segment.lineId, segment.from, segment.to),
        new SkyTrainRidePath(
          this.routeData!,
          segment.lineId,
          segment.from,
          segment.to,
          pose(a),
          pose(b),
        ),
      );
    }
  }
  private createJourney() {
    this.journey = new SkyTrainJourney(this.station!, this.destination, {
      segmentSeconds: (from, to, line) =>
        Math.max(
          30,
          Math.min(
            180,
            (this.paths.get(keyFor(line, from, to))?.length ?? 900) / 11.5,
          ),
        ),
    });
  }
  chooseDestination(id: StationId) {
    if (this.aboard || this.busy || !SKYTRAIN_STATIONS.some((s) => s.id === id))
      return false;
    this.destination = id;
    if (this.phase === 'station') this.createJourney();
    this.publish();
    return true;
  }
  async goPlatform() {
    if (
      !this.snapshot().canChangeLevel ||
      this.level !== 'concourse' ||
      !this.journey
    )
      return false;
    const j = this.journey.snapshot();
    if (j.phase === 'complete') return false;
    this.busy = true;
    this.clearInput();
    this.publish();
    try {
      // Walking can change the passenger's platform line before the loaded
      // train changes. Only the actual visual owner proves which service is ready.
      const needsTrain =
        !this.train.ready || this.train.serviceLine !== j.lineId;
      if (
        needsTrain &&
        !(await this.train.load(
          j.lineId,
          this.city.settings.quality,
          this.city.compatibleGraphics,
        ))
      )
        throw new Error('Train unavailable');
      if (this.disposed) return false;
      if (needsTrain)
        await this.city.renderer.compileAsync?.(
          this.train.group,
          this.city.camera,
          this.city.scene,
        );
      if (this.disposed) return false;
      this.line = j.lineId;
      this.direction = j.directionName;
      this.foot = this.owner!.accessPoint(
        'platform',
        this.line,
        this.direction,
      );
      this.yaw = this.foot.yaw;
      const door = this.owner!.boardingPoint(
        this.line,
        this.direction,
      ).position;
      this.yaw = Math.atan2(
        door[0] - this.foot.position[0],
        door[2] - this.foot.position[2],
      );
      this.level = 'platform';
      this.placeAtStation();
      this.lookYaw = 0;
      this.updateCamera();
      return true;
    } catch {
      this.error = 'unavailable';
      return false;
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  goConcourse() {
    if (!this.snapshot().canChangeLevel || this.level !== 'platform')
      return false;
    this.foot = this.owner!.spawn('entry', this.line, this.direction);
    this.yaw = this.foot.yaw;
    this.level = 'concourse';
    this.clearInput();
    this.lookYaw = 0;
    this.updateCamera();
    this.publish();
    return true;
  }
  board() {
    if (!this.snapshot().canBoard || !this.journey?.board()) return false;
    this.phase = 'riding';
    this.lookYaw = 0;
    this.clearInput();
    this.updateCamera();
    this.publish();
    return true;
  }
  alight() {
    if (!this.snapshot().canAlight || !this.journey) return false;
    const station = this.journey.snapshot().currentStation;
    this.foot = this.owner!.boardingPoint(this.line, this.direction);
    if (!this.journey.alight()) return false;
    this.station = station;
    this.phase = 'station';
    this.level = 'platform';
    this.yaw = this.foot.yaw;
    this.lookYaw = 0;
    this.clearInput();
    this.placeAtStation();
    this.updateCamera();
    this.publish();
    return true;
  }
  private exitPoint() {
    if (!this.owner || !this.city.navigation) return null;
    const origin = this.owner.toWorld(
      this.owner.entry(this.line, this.direction),
    );
    // Exit onto freshly verified city pavement; never reuse another station's
    // underground identity or infer a bridge/roof from a nearby height.
    for (const radius of [1, 3, 6, 10, 16, 24, 36, 52, 72])
      for (let i = 0; i < 16; i++) {
        const x = origin[0] + Math.cos((i * Math.PI) / 8) * radius,
          z = origin[2] + Math.sin((i * Math.PI) / 8) * radius;
        if (
          !this.city.navigation.clearGround(x, z, 'walk', true) ||
          this.city.interiors?.height(x, z) !== undefined ||
          this.city.data.travelSurfaces
            ?.lookup(x, z)
            .some((hit: { surfaceId: string }) => hit.surfaceId !== 'ground')
        )
          continue;
        const y = this.city.navigation.groundHeight(x, z);
        if (Number.isFinite(y))
          return {
            x,
            y,
            z,
            yaw: this.owner.yaw,
            surface: 'ground' as const,
            surfaceId: 'ground',
            layer: 0,
            name: this.owner.data.name,
            snappedDistance: radius,
          };
      }
    return null;
  }
  leave() {
    if (!this.snapshot().canExit || this.aboard) return false;
    const point = this.exitPoint();
    if (!point) return false;
    this.phase = 'idle';
    this.updateBuildingReplacement();
    this.busy = false;
    this.station = null;
    this.journey = null;
    this.clearInput();
    this.train.group.visible = false;
    this.stations.hide();
    this.clearTube();
    this.city.navigation!.startAt('walk', point);
    this.city.settings = {
      ...this.city.settings,
      mode: 'walk',
      autoRotate: false,
    };
    this.city.onTravelResume('walk');
    this.publish();
    return true;
  }
  interact() {
    const s = this.snapshot();
    if (s.canAlight) return this.alight();
    if (s.canBoard) return this.board();
    if (s.canChangeLevel) {
      if (this.level === 'platform') return this.goConcourse();
      void this.goPlatform();
      return true;
    }
    return false;
  }
  private placeAtStation() {
    if (!this.owner) return;
    this.updateBuildingReplacement();
    const stop = this.owner.trainStop(this.line, this.direction),
      world = stationWorldPose(
        this.owner.data,
        (x, z) => this.city.elevation(x, z),
        stop.position,
        stop.quaternion,
      );
    this.train.group.position.fromArray(world.position);
    this.train.group.quaternion.fromArray(world.quaternion);
    this.train.group.updateMatrixWorld(true);
  }
  update(dt: number) {
    if (
      !this.active ||
      this.busy ||
      document.hidden ||
      this.city.pageSuspended ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      return;
    dt = Math.min(dt, 0.1);
    let j = this.journey?.snapshot();
    if (j) {
      const canAdvance = !(
        j.phase === 'boarding' &&
        j.aboard &&
        !this.train.doorsClosed
      );
      if (canAdvance) j = this.journey!.update(dt);
      const samePlatform =
        j.lineId === this.line &&
        j.directionName === this.direction &&
        this.station === j.currentStation &&
        this.trainAtPlatform() &&
        j.phase !== 'riding';
      const stop = this.owner?.trainStop(this.line, this.direction);
      this.train.setDoors(
        Boolean(j.doorsOpen && samePlatform),
        stop?.doorSide ?? 'left',
        dt,
      );
      if (j.phase === 'riding' && j.aboard) {
        const key = keyFor(j.lineId, j.segmentFromStation, j.segmentToStation),
          path = this.paths.get(key)!;
        if (key !== this.pathKey) {
          this.pathKey = key;
          this.buildTunnel(path);
        }
        const pose = path.sample(j.progress);
        this.train.group.position.copy(pose.position);
        this.train.group.quaternion.copy(pose.quaternion);
        this.train.group.updateMatrixWorld(true);
        if (this.owner) this.owner.group.visible = j.progress < 0.08;
      } else if (
        j.phase === 'arrived' &&
        j.aboard &&
        this.station !== j.currentStation
      ) {
        this.busy = true;
        void this.arrive(j.currentStation);
        return;
      }
    }
    if (
      this.phase === 'station' &&
      this.owner &&
      this.foot &&
      this.inputEnabled
    ) {
      const left = Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
        right = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight'));
      this.yaw += (left - right - this.axes.x) * 1.65 * dt;
      const forward =
        Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
        Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) +
        this.axes.y;
      const amount = THREE.MathUtils.clamp(forward, -1, 1) * 2.5 * dt;
      const before = this.foot.position;
      this.foot = this.owner.walk(
        this.foot,
        Math.sin(this.yaw) * amount,
        Math.cos(this.yaw) * amount,
      );
      this.walkDistance += distance(before, this.foot.position);
      const candidates = this.owner.data.platforms.filter(
        (p) => p.surfaceId === this.foot!.surfaceId,
      );
      const floorPlatform =
        candidates.find(
          (p) => p.line === this.line && p.direction === this.direction,
        ) ?? candidates[0];
      if (floorPlatform) {
        this.level = 'platform';
        this.line = floorPlatform.line;
        this.direction = floorPlatform.direction;
      } else if (
        this.owner.data.entrances.some(
          (e) => e.surfaceId === this.foot!.surfaceId,
        )
      )
        this.level = 'concourse';
      this.owner.setBoardingOpen(
        this.line,
        this.direction,
        Boolean(
          j?.doorsOpen && this.train.doorsClear && this.trainAtPlatform(),
        ),
      );
    }
    this.updateCamera();
  }
  private async arrive(id: StationId) {
    const generation = this.generation;
    this.clearInput();
    try {
      const owner = await this.stations.load(
        id,
        this.line,
        this.city.settings.quality,
      );
      if (this.disposed || generation !== this.generation) return;
      this.owner = owner;
      this.station = id;
      this.placeAtStation();
      this.clearTube();
      this.pathKey = '';
      this.updateCamera();
    } catch {
      this.error = 'unavailable';
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  private updateCamera() {
    if (!this.active || !this.owner) return;
    let eye: THREE.Vector3, yaw: number;
    if (this.aboard) {
      eye = this.train.eye.clone().applyMatrix4(this.train.group.matrixWorld);
      yaw =
        new THREE.Euler().setFromQuaternion(this.train.group.quaternion, 'YXZ')
          .y +
        this.train.facingYaw +
        this.lookYaw;
    } else if (this.foot) {
      eye = new THREE.Vector3(...this.owner.toWorld(this.foot)).addScaledVector(
        UP,
        1.65,
      );
      yaw = this.owner.yaw + this.yaw + this.lookYaw;
    } else return;
    const direction = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(yaw) * Math.cos(this.pitch),
    );
    this.city.camera.position.copy(eye);
    this.city.camera.lookAt(eye.clone().add(direction));
    this.city.controls.target.copy(eye).addScaledVector(direction, 0.8);
    this.city.controls.enabled = false;
    if (this.city.navigation) {
      this.city.navigation.position.copy(eye).addScaledVector(UP, -1.65);
      this.city.navigation.walker.group.visible = false;
    }
  }
  private buildTunnel(path: SkyTrainRidePath) {
    this.clearTube();
    const group = new THREE.Group();
    group.name = 'SkyTrain active geographic tunnel';
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length > 2) {
        const curve = new THREE.CatmullRomCurve3(run),
          geometry = new THREE.TubeGeometry(
            curve,
            Math.max(8, run.length * 2),
            3.5,
            8,
            false,
          ),
          material = new THREE.MeshBasicMaterial({
            color: 0x18242b,
            side: THREE.BackSide,
          });
        group.add(new THREE.Mesh(geometry, material));
      }
      run = [];
    };
    const count = Math.ceil(path.length / 8);
    for (let i = 0; i <= count; i++) {
      const p = path.curve.getPointAt(i / count),
        underground = p.y + 3.6 < this.city.elevation(p.x, p.z);
      if (underground && i * 8 > 45 && (count - i) * 8 > 45)
        run.push(p.clone().add(new THREE.Vector3(0, 1.4, 0)));
      else flush();
    }
    flush();
    this.tube = group;
    this.city.scene.add(group);
  }
  private clearTube() {
    if (!this.tube) return;
    this.tube.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
    this.tube.removeFromParent();
    this.tube = null;
  }
  private keyDown = (event: KeyboardEvent) => {
    if (
      !this.active ||
      !this.inputEnabled ||
      this.busy ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      editable(event.target)
    )
      return;
    if (event.code === 'KeyE' && !event.repeat) {
      event.preventDefault();
      this.interact();
      return;
    }
    if (
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(event.code)
    ) {
      event.preventDefault();
      if (!event.repeat || this.keys.has(event.code)) this.keys.add(event.code);
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private pointerDown = (event: PointerEvent) => {
    if (
      !this.active ||
      !this.inputEnabled ||
      this.busy ||
      event.button !== 0 ||
      this.drag
    )
      return;
    this.city.renderer.domElement.focus({ preventScroll: true });
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.city.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id || !this.inputEnabled)
      return;
    this.lookYaw -= (event.clientX - this.drag.x) * 0.004;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - (event.clientY - this.drag.y) * 0.003,
      -1.2,
      1.2,
    );
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    event.preventDefault();
    this.updateCamera();
  };
  private pointerEnd = (event: PointerEvent) => {
    if (this.drag?.id === event.pointerId) this.drag = null;
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = 'idle';
    this.updateBuildingReplacement();
    ++this.generation;
    this.life.abort();
    this.clearInput();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.visibility);
    const canvas = this.city.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerEnd);
    canvas.removeEventListener('pointercancel', this.pointerEnd);
    canvas.removeEventListener('lostpointercapture', this.pointerEnd);
    this.stations.dispose();
    this.train.dispose();
    this.clearTube();
    this.paths.clear();
    this.metadata.clear();
  }
}
