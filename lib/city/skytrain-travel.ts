import * as THREE from 'three';
import {
  stationRailEnvelope,
  type StationRailEnvelope,
} from './skytrain-station-rail-envelope';
import type { CityEngine } from './engine';
import {
  SkyTrainJourney,
  SKYTRAIN_STATIONS,
  skyTrainStation,
  skyTrainSegmentLength,
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
  type StationSeat,
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
import { clampTravelPitch } from './travel-camera-collision';
import { setMainSkyTrainGuideway } from './skytrain-guideway-clearance';
import type { InteractionCandidate } from './proximity-interactions';
import type { CabinPoint, PassengerSeat } from './skytrain-passenger-space';

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
  train = new SkyTrainRideTrain();
  protected owner: SkyTrainStationOwner | null = null;
  protected phase: SkyTrainTravelSnapshot['phase'] = 'idle';
  protected station: StationId | null = null;
  protected destination: StationId = 'main-street-science-world';
  protected line: LineId = 'expo';
  protected direction: SkyTrainDirection = 'eastbound';
  protected level: 'concourse' | 'platform' = 'concourse';
  protected foot: StationPoint | null = null;
  protected cabinFoot: CabinPoint | null = null;
  protected cabinSeat: PassengerSeat | null = null;
  protected cabinStand: CabinPoint | null = null;
  protected stationSeat: StationSeat | null = null;
  protected avatarSeated = false;
  protected journey: SkyTrainJourney | null = null;
  protected routeData: SkyTrainRouteData | null = null;
  protected readonly paths = new Map<string, SkyTrainRidePath>();
  protected readonly metadata = new Map<StationId, RuntimeStationData>();
  protected generation = 0;
  protected disposed = false;
  protected inputEnabled = true;
  protected busy = false;
  protected error: string | null = null;
  protected keys = new Set<string>();
  protected axes = { x: 0, y: 0 };
  protected yaw = 0;
  protected pitch = -0.03;
  protected lookYaw = 0;
  protected readonly passengerEye = new THREE.Vector3();
  protected readonly passengerQuaternion = new THREE.Quaternion();
  protected readonly passengerEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  protected drag: { id: number; x: number; y: number } | null = null;
  protected walkDistance = 0;
  protected tube: THREE.Group | null = null;
  protected pathKey = '';
  protected arrivalPreparation: {
    id: StationId;
    generation: number;
    ready: boolean;
    promise: Promise<SkyTrainStationOwner | null>;
  } | null = null;
  protected readonly life = new AbortController();
  onChange = () => {};
  constructor(protected readonly city: CityEngine) {
    this.stations = new SkyTrainStations({
      heightAt: (x, z) => city.elevation(x, z),
      streetHeightAt: (x, z) =>
        city.navigation?.groundHeight(x, z) ?? city.elevation(x, z),
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
  get passengerSeated() {
    return Boolean(this.cabinSeat || this.stationSeat);
  }
  /** Carriage-local displacement prevents rail motion from becoming footsteps. */
  get soundscapeFootsteps() {
    const position = this.aboard ? this.cabinFoot : this.interactionOrigin;
    if (!this.active || !position) return undefined;
    return {
      position: [...position] as [number, number, number],
      space: `skytrain:${this.line}:${this.aboard ? 'cabin' : `${this.station}:${this.level}`}`,
      surface: this.aboard ? ('metal' as const) : ('pavement' as const),
      active: this.inputEnabled && !this.busy && !this.passengerSeated,
    };
  }
  /** Feet datum used by the common proximity registry, independent of camera. */
  get interactionOrigin(): [number, number, number] | null {
    if (!this.active || this.busy) return null;
    if (this.aboard && this.cabinFoot)
      return this.train.passengerPointToWorld(
        this.cabinSeat?.position ?? this.cabinFoot,
      );
    if (this.owner && this.foot)
      return this.owner.toWorld(this.stationSeat?.position ?? this.foot);
    return null;
  }
  interactionCandidates(): readonly InteractionCandidate[] {
    if (!this.active || this.disposed || this.busy || !this.inputEnabled)
      return [];
    if (this.passengerSeated) {
      const origin = this.interactionOrigin;
      if (!origin) return [];
      return [
        {
          id: 'skytrain:stand',
          kind: 'seat',
          action: 'stand',
          anchor: [origin[0], origin[1] + 0.95, origin[2]],
          proximityPoint: origin,
          range: 1.5,
          priority: 100,
          canInteract: () =>
            this.active &&
            this.inputEnabled &&
            !this.busy &&
            this.passengerSeated,
          execute: () => this.stand(),
        },
      ];
    }
    if (this.aboard && this.cabinFoot && this.train.passengerSpace) {
      const space = this.train.passengerSpace;
      return space.seats
        .filter((seat) => space.canSit(seat, this.cabinFoot!))
        .map((seat) => {
          const anchor = this.train.passengerPointToWorld([
            seat.position[0],
            seat.position[1] + seat.seatHeight + 0.85,
            seat.position[2],
          ]);
          return {
            id: `skytrain:cabin:${seat.id}`,
            kind: 'seat' as const,
            action: 'sit',
            anchor,
            proximityPoint: this.train.passengerPointToWorld(seat.position),
            range: 1.45,
            canInteract: () =>
              this.aboard &&
              !this.passengerSeated &&
              this.inputEnabled &&
              !this.busy &&
              this.train.passengerSpace === space &&
              Boolean(this.cabinFoot && space.canSit(seat, this.cabinFoot)),
            execute: () => this.sitCabin(seat),
          };
        });
    }
    const owner = this.owner,
      foot = this.foot;
    if (!owner || !foot || this.phase !== 'station') return [];
    return owner
      .benchSeats()
      .filter((seat) => owner.canApproachSeat(seat, foot))
      .map((seat) => {
        const position = owner.toWorld(seat.position);
        return {
          id: `skytrain:station:${owner.data.id}:${seat.id}`,
          kind: 'seat' as const,
          action: 'sit',
          anchor: [
            position[0],
            position[1] + seat.seatHeight + 0.85,
            position[2],
          ] as [number, number, number],
          proximityPoint: owner.toWorld(seat.stand),
          range: 1.1,
          canInteract: () =>
            this.owner === owner &&
            this.phase === 'station' &&
            !this.passengerSeated &&
            this.inputEnabled &&
            !this.busy &&
            Boolean(
              this.foot &&
              owner.canApproachSeat(seat, this.foot) &&
              owner.isClearFoot(seat.stand),
            ),
          execute: () => this.sitStation(owner, seat),
        };
      });
  }
  protected sitCabin(seat: PassengerSeat) {
    const space = this.train.passengerSpace;
    if (
      !this.aboard ||
      this.passengerSeated ||
      !this.inputEnabled ||
      this.busy ||
      !space ||
      !this.cabinFoot ||
      !space.seats.includes(seat) ||
      !space.canSit(seat, this.cabinFoot)
    )
      return false;
    const viewedYaw = this.yaw + this.lookYaw;
    this.cabinStand = [...this.cabinFoot];
    this.cabinSeat = seat;
    this.yaw = seat.yaw;
    this.lookYaw = viewedYaw - seat.yaw;
    this.clearInput();
    this.updateCamera();
    this.publish();
    return true;
  }
  protected sitStation(owner: SkyTrainStationOwner, seat: StationSeat) {
    if (
      this.owner !== owner ||
      this.phase !== 'station' ||
      this.passengerSeated ||
      !this.inputEnabled ||
      this.busy ||
      !this.foot ||
      !owner.canApproachSeat(seat, this.foot) ||
      !owner.isClearFoot(seat.stand)
    )
      return false;
    const viewedYaw = this.yaw + this.lookYaw;
    this.stationSeat = seat;
    this.yaw = seat.yaw;
    this.lookYaw = viewedYaw - seat.yaw;
    this.clearInput();
    this.updateCamera();
    this.publish();
    return true;
  }
  stand() {
    if (
      !this.passengerSeated ||
      !this.active ||
      this.busy ||
      !this.inputEnabled
    )
      return false;
    if (this.cabinSeat) {
      if (
        !this.cabinStand ||
        !this.train.passengerSpace?.clear(this.cabinStand)
      )
        return false;
      this.cabinFoot = [...this.cabinStand];
      this.cabinSeat = null;
      this.cabinStand = null;
    } else if (this.stationSeat) {
      if (!this.owner?.isClearFoot(this.stationSeat.stand)) return false;
      this.foot = {
        ...this.stationSeat.stand,
        position: [...this.stationSeat.stand.position],
      };
      this.stationSeat = null;
    }
    this.clearInput();
    this.lookYaw = 0;
    this.updateCamera();
    this.publish();
    return true;
  }
  protected resetSeat() {
    this.cabinSeat = null;
    this.cabinStand = null;
    this.stationSeat = null;
    this.cabinFoot = null;
    this.city.navigation?.walker.setSeated?.(false);
    this.avatarSeated = false;
  }
  get speedMps() {
    const j = this.journey?.snapshot();
    if (!j || j.phase !== 'riding') return 0;
    const path = this.paths.get(
      keyFor(j.lineId, j.segmentFromStation, j.segmentToStation),
    );
    if (!path) return 0;
    return (
      (j.speedMps * path.length) /
      skyTrainSegmentLength(j.segmentFromStation, j.segmentToStation, j.lineId)
    );
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
    if (
      owner &&
      foot &&
      this.phase === 'station' &&
      !this.busy &&
      !this.passengerSeated
    ) {
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
      !this.passengerSeated &&
      this.nearCabinDoor() &&
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
      speedMps: this.speedMps,
      travelProgress: j?.progress ?? 0,
      error: this.error,
      busy: this.busy,
      seated: this.passengerSeated,
      canWalkCabin:
        this.aboard && !this.passengerSeated && !this.busy && this.inputEnabled,
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
  protected publish() {
    if (!this.disposed) this.onChange();
  }
  protected updateBuildingReplacement() {
    const uniform = this.city.uniforms?.skyTrainReplacement;
    const main =
      this.active &&
      !this.error &&
      this.owner?.data.id === 'main-street-science-world';
    const seed = main
      ? this.city.data.buildingProfiles?.get('osm-structure-303')?.seed
      : undefined;
    if (uniform && Number.isFinite(seed) && this.owner)
      uniform.value.set(seed, this.owner.origin[0], this.owner.origin[2], 170);
    else uniform?.value.set(-1, 0, 0, 0);
    if (this.city.uniforms)
      setMainSkyTrainGuideway(
        this.city.uniforms,
        main && this.owner
          ? {
              origin: this.owner.origin,
              yaw: this.owner.yaw,
              railY: this.owner.toWorld(
                this.owner.trainStop('expo', 'westbound').position,
              )[1],
            }
          : null,
        this.city.data.buildingProfiles?.get('133436')?.seed,
      );
  }
  protected nearCabinDoor() {
    if (!this.cabinFoot || !this.owner) return false;
    const door = this.owner.passengerDoor(this.line, this.direction);
    return distance(this.cabinFoot, door) < 1.5;
  }
  protected trainAtPlatform() {
    if (
      !this.owner ||
      this.train.serviceLine !== this.line ||
      !this.train.stationAligned
    )
      return false;
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
  protected visibility = () => {
    if (document.hidden) this.clearInput();
  };
  async enter(id: StationId) {
    if (
      this.disposed ||
      this.active ||
      !SKYTRAIN_STATIONS.some((s) => s.id === id) ||
      (this.city.navigation?.walkSeat &&
        !this.city.navigation.leaveWalkSeat()) ||
      !this.city.closeBusVisit()
    )
      return false;
    const generation = ++this.generation;
    this.arrivalPreparation = null;
    this.resetSeat();
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
      await this.precompile(this.train.group);
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
  protected buildPaths() {
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
          (x, z) => this.city.elevation(x, z),
          [a, b]
            .map((data) =>
              stationRailEnvelope(data, segment.lineId, direction, (x, z) =>
                this.city.elevation(x, z),
              ),
            )
            .filter(
              (envelope): envelope is StationRailEnvelope => envelope !== null,
            ),
        ),
      );
    }
  }
  protected createJourney() {
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
      if (needsTrain) await this.precompile(this.train.group);
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
      this.updateBuildingReplacement();
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
    this.cabinFoot = this.train.passengerSpace?.doorSpawn(
      this.owner!.trainStop(this.line, this.direction).doorSide,
    ) ?? [0, this.train.floorAboveRail, 0];
    this.yaw = this.train.facingYaw;
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
    this.resetSeat();
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
  protected exitPoint() {
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
    this.resetSeat();
    this.phase = 'idle';
    this.arrivalPreparation = null;
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
  protected placeAtStation() {
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
    this.train.resetCarFrames();
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
        this.train.setPathPose(path, j.progress);
        if (this.owner)
          this.owner.group.visible =
            this.owner.data.id === j.segmentToStation
              ? Boolean(
                  this.arrivalPreparation?.id === j.segmentToStation &&
                  this.arrivalPreparation.ready,
                )
              : j.progress < 0.08;
        if (j.progress > 0.15) void this.prepareArrival(j.segmentToStation);
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
      !this.passengerSeated &&
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
    if (
      this.aboard &&
      this.cabinFoot &&
      !this.passengerSeated &&
      this.inputEnabled
    ) {
      const left = Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
      const right = Number(
        this.keys.has('KeyD') || this.keys.has('ArrowRight'),
      );
      this.yaw += (left - right - this.axes.x) * 1.65 * dt;
      const forward =
        Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
        Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) +
        this.axes.y;
      const amount = THREE.MathUtils.clamp(forward, -1, 1) * 1.8 * dt;
      this.cabinFoot =
        this.train.passengerSpace?.walk(
          this.cabinFoot,
          Math.sin(this.yaw) * amount,
          Math.cos(this.yaw) * amount,
        ) ?? this.cabinFoot;
    }
    this.updateCamera();
  }
  protected prepareArrival(id: StationId) {
    const generation = this.generation;
    if (
      this.arrivalPreparation?.id === id &&
      this.arrivalPreparation.generation === generation
    )
      return this.arrivalPreparation.promise;
    const preparation = {
      id,
      generation,
      ready: false,
      promise: Promise.resolve<SkyTrainStationOwner | null>(null),
    };
    this.arrivalPreparation = preparation;
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      this.arrivalPreparation === preparation &&
      this.aboard &&
      this.journey?.snapshot().segmentToStation === id;
    preparation.promise = (async () => {
      try {
        // The source is already behind the passenger and hidden. The station
        // owner swaps exactly one GPU interior, ahead of the untubed approach.
        const owner = await this.stations.load(
          id,
          this.line,
          this.city.settings.quality,
        );
        if (!current()) return null;
        this.owner = owner;
        owner.group.visible = false;
        this.updateBuildingReplacement();
        await this.precompile(owner.group);
        if (!current()) return null;
        preparation.ready = true;
        owner.group.visible = true;
        return owner;
      } catch {
        // Keep the moving passenger attached to the train. Arrival can retry
        // this exact station; failed preparation never opens an early exit.
        return null;
      }
    })();
    return preparation.promise;
  }
  protected async precompile(subtree: THREE.Object3D) {
    const visible = subtree.visible;
    let pending: Promise<unknown> | undefined;
    subtree.visible = true;
    try {
      // Three gathers lights synchronously. Compile the whole scene so each
      // visible light is counted once and city materials get the new cabin /
      // station lighting variant too. Restore visibility before any frame can
      // expose a destination whose asynchronous shader work is still pending.
      pending = this.city.prepareScenePrograms();
    } finally {
      subtree.visible = visible;
    }
    await pending;
  }
  protected async arrive(id: StationId) {
    const generation = this.generation;
    this.clearInput();
    try {
      let owner = await this.prepareArrival(id);
      if (this.disposed || generation !== this.generation) return;
      if (!owner) {
        this.arrivalPreparation = null;
        owner = await this.prepareArrival(id);
      }
      if (this.disposed || generation !== this.generation) return;
      if (!owner || owner.data.id !== id)
        throw new Error('Station unavailable');
      this.owner = owner;
      this.arrivalPreparation = null;
      this.station = id;
      owner.group.visible = true;
      this.placeAtStation();
      this.clearTube();
      this.pathKey = '';
      this.updateCamera();
    } catch {
      this.error = 'unavailable';
      this.updateBuildingReplacement();
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  protected updateCamera() {
    if (!this.active || !this.owner) return;
    // Entry suspends street navigation in orbit mode, whose 2 m near plane
    // would cut away nearby cabin geometry and reject close seat prompts.
    // Street navigation resumes ownership (including its projection) on exit.
    if (this.city.camera.near !== 0.05 || this.city.camera.fov !== 65) {
      this.city.camera.near = 0.05;
      this.city.camera.fov = 65;
      this.city.camera.updateProjectionMatrix();
    }
    let eye: THREE.Vector3, yaw: number;
    const footWorld = new THREE.Vector3();
    const avatarQuaternion = new THREE.Quaternion();
    let seatHeight = 0.46;
    if (this.aboard) {
      const local = this.cabinSeat?.position ?? this.cabinFoot;
      if (local)
        this.train.setPassengerLocal(
          local,
          this.cabinSeat?.eyeHeight ?? 1.65,
          this.cabinSeat?.eyeOffsetXZ,
        );
      this.train.passengerWorldPose(
        this.passengerEye,
        this.passengerQuaternion,
      );
      eye = this.passengerEye;
      footWorld.fromArray(
        this.train.passengerPointToWorld(
          local ?? [0, this.train.floorAboveRail, 0],
        ),
      );
      avatarQuaternion
        .copy(this.passengerQuaternion)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw));
      yaw =
        this.passengerEuler.setFromQuaternion(this.passengerQuaternion, 'YXZ')
          .y +
        this.yaw +
        this.lookYaw;
      seatHeight = this.cabinSeat?.seatHeight ?? 0.46;
    } else if (this.foot) {
      footWorld.fromArray(
        this.owner.toWorld(this.stationSeat?.position ?? this.foot),
      );
      avatarQuaternion
        .copy(this.owner.group.quaternion)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw));
      if (this.stationSeat) {
        // A verified aisle-side camera shows the seated person and bench without
        // moving the person or using another station floor as an orbit target.
        eye = new THREE.Vector3(
          ...this.owner.toWorld(this.stationSeat.stand),
        ).addScaledVector(UP, 1.25);
        yaw = this.owner.yaw + this.yaw + Math.PI + this.lookYaw;
        seatHeight = this.stationSeat.seatHeight;
      } else {
        eye = footWorld.clone().addScaledVector(UP, 1.65);
        yaw = this.owner.yaw + this.yaw + this.lookYaw;
      }
    } else return;
    const pitch = this.stationSeat ? -0.32 + this.pitch : this.pitch;
    const direction = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    );
    this.city.camera.position.copy(eye);
    this.city.camera.lookAt(eye.clone().add(direction));
    this.owner.updateCutaway(
      this.city.camera.position,
      this.aboard
        ? null
        : (this.stationSeat?.position[1] ?? this.foot?.position[1] ?? null),
    );
    this.city.controls.target.copy(eye).addScaledVector(direction, 0.8);
    this.city.controls.enabled = false;
    const navigation = this.city.navigation;
    if (navigation) {
      navigation.position.copy(footWorld);
      const walker = navigation.walker;
      if (this.avatarSeated !== this.passengerSeated) {
        walker.setSeated?.(this.passengerSeated, seatHeight);
        this.avatarSeated = this.passengerSeated;
      }
      walker.group.position.copy(footWorld);
      walker.group.quaternion.copy(avatarQuaternion);
      // The occupied cabin uses its original first-person eye. Keep its body
      // attached in a seated pose, with ordinary first-person self hiding.
      walker.group.visible = Boolean(this.stationSeat);
      if (this.passengerSeated) walker.update?.(0, false);
    }
  }
  protected buildTunnel(path: SkyTrainRidePath) {
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
    let previousStructure: boolean | null = null;
    const stationBoundary = (
      from: number,
      to: number,
      fromStructure: boolean,
    ) => {
      let a = from,
        b = to;
      for (let step = 0; step < 20; step++) {
        const mid = (a + b) / 2,
          pose = path.sample(mid),
          covered = path.hasStationRailStructure(
            pose.position,
            pose.quaternion,
          );
        if (covered === fromStructure) a = mid;
        else b = mid;
      }
      // Start on the outside of the real source structure. Sharing this edge
      // avoids an unlined eight-metre sampling gap without inserting a larger
      // circular tunnel into the maintained station roof.
      return path.sample(fromStructure ? b : a).position.clone();
    };
    for (let i = 0; i <= count; i++) {
      const p = path.curve.getPointAt(i / count),
        distanceAlong = (i / count) * path.length,
        underground = p.y + 3.6 < this.city.elevation(p.x, p.z),
        stationStructure = path.hasStationRailStructure(
          p,
          path.sample(i / count).quaternion,
        );
      if (
        i > 0 &&
        previousStructure !== stationStructure &&
        (stationStructure || previousStructure)
      ) {
        const boundary = stationBoundary(
          (i - 1) / count,
          i / count,
          Boolean(previousStructure),
        );
        if (
          boundary.y + 3.6 < this.city.elevation(boundary.x, boundary.z) &&
          distanceAlong > 32 &&
          path.length - distanceAlong > 32
        )
          run.push(boundary.add(new THREE.Vector3(0, 1.4, 0)));
        if (stationStructure) flush();
      }
      // Canada platforms plus their authored rail buffers cover 47 m. Start
      // within 40 m at this sampling interval, leaving an overlap at both
      // portals instead of exposing a narrow strip of the outside world.
      if (
        underground &&
        !stationStructure &&
        distanceAlong > 32 &&
        path.length - distanceAlong > 32
      )
        run.push(p.clone().add(new THREE.Vector3(0, 1.4, 0)));
      else flush();
      previousStructure = stationStructure;
    }
    flush();
    this.tube = group;
    this.city.scene.add(group);
  }
  protected clearTube() {
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
  protected keyDown = (event: KeyboardEvent) => {
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
  protected keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  protected pointerDown = (event: PointerEvent) => {
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
  protected pointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id || !this.inputEnabled)
      return;
    this.lookYaw -= (event.clientX - this.drag.x) * 0.004;
    this.pitch = clampTravelPitch(
      this.pitch - (event.clientY - this.drag.y) * 0.003,
    );
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    event.preventDefault();
    this.updateCamera();
  };
  protected pointerEnd = (event: PointerEvent) => {
    if (this.drag?.id === event.pointerId) this.drag = null;
  };
  dispose() {
    this.resetSeat();
    if (this.disposed) return;
    this.disposed = true;
    this.resetSeat();
    this.phase = 'idle';
    this.arrivalPreparation = null;
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
