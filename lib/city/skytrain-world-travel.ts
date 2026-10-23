import * as THREE from 'three';
import { SkyTrainTravel } from './skytrain-travel';
import type { CityEngine } from './engine';
import { project } from './geo';
import { firstPerson, zoomTravel } from './travel-camera';
import {
  SkyTrainWorldExteriors,
  type WorldSkyTrainExterior,
} from './skytrain-world-exterior';
import { setMainSkyTrainGuideway } from './skytrain-guideway-clearance';
import {
  SKYTRAIN_STATIONS,
  type StationId,
  type LineId,
  type SkyTrainDirection,
} from './skytrain-network';
import {
  stationWorldPose,
  trainStopFor,
  type StationBoardingDoor,
  type StationConnection,
  type StationPoint,
  type SkyTrainStationOwner,
} from './skytrain-stations';
import {
  loadSkyTrainRoutes,
  type SkyTrainStopPose,
} from './skytrain-ride-path';
import { SkyTrainRideTrain } from './skytrain-ride-train';
import {
  WorldSkyTrainRun,
  type WorldSkyTrainData,
  type WorldSkyTrainRoute,
  type WorldSkyTrainRunSnapshot,
} from './skytrain-world-service';
import { SkyTrainWorldPath, SkyTrainTerminalPath } from './skytrain-world-path';
import type { SkyTrainMotionPath } from './skytrain-motion-path';
import {
  applySkyTrainWorldOpenings,
  type SkyTrainWorldOpenings,
} from './skytrain-world-openings';
import { travelLookDirection } from './travel-camera-collision';
import type { SkyTrainTravelSnapshot } from './skytrain-travel-types';
import type { InteractionCandidate } from './proximity-interactions';
import {
  stationConstructionPortals,
  type StationConstructionPortal,
} from './skytrain-construction-access';
import { SkyTrainConstructionVisuals } from './skytrain-construction-visuals';

interface ServiceTrain {
  id: string;
  run: WorldSkyTrainRun;
  state: WorldSkyTrainRunSnapshot;
  proxy: THREE.Group;
  exterior: WorldSkyTrainExterior;
  cars: THREE.Object3D[];
  detail: SkyTrainRideTrain | null;
  loading: boolean;
  prepared: boolean;
  retryAt: number;
  lastNear: number;
  path: SkyTrainMotionPath | null;
  progress: number;
}
interface GroundOpeningMaterial {
  references: number;
  restore: (() => void) | undefined;
  disposed: () => void;
}
const UP = new THREE.Vector3(0, 1, 0);
const pair = (line: LineId, from: StationId, to: StationId) =>
  `${line}:${from}:${to}`;
const separation = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Geographic service and passenger ownership are independent. No selected
 * destination, panel, proximity trigger or passenger starts a train clock. */
export class SkyTrainWorldTravel extends SkyTrainTravel {
  ready = false;
  private openings: SkyTrainWorldOpenings | null = null;
  private readonly groundOpeningMaterials = new Map<
    THREE.Material,
    GroundOpeningMaterial
  >();
  private readonly previewTrain = this.train;
  private worldData: WorldSkyTrainData | null = null;
  private fleet: ServiceTrain[] = [];
  private occupied: ServiceTrain | null = null;
  private readonly worldPaths = new Map<string, SkyTrainMotionPath>();
  private readonly terminalPaths = new Map<string, SkyTrainMotionPath>();
  private loadingWorld: Promise<void> | null = null;
  private worldTime = 0;
  private nextPublish = 0;
  private distanceView = 4;
  private overviewAnchor: THREE.Vector3 | null = null;
  private overviewMoved = false;
  private readonly constructionAccess = new Map<
    SkyTrainStationOwner,
    readonly StationConstructionPortal[]
  >();
  private readonly constructionVisuals = new Map<
    SkyTrainStationOwner,
    SkyTrainConstructionVisuals
  >();
  private readonly constructionFocus = new THREE.Vector3();
  private readonly lightSources = new WeakMap<
    THREE.Object3D,
    THREE.PointLight[]
  >();
  private readonly lightPool = Array.from(
    { length: 4 },
    () => new THREE.PointLight(0xe8f5ff, 0, 18, 2),
  );
  private readonly exteriors = new SkyTrainWorldExteriors();
  private readonly poseScratch = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  private readonly inverseProxyMatrix = new THREE.Matrix4();
  private readonly carWorldMatrix = new THREE.Matrix4();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly doorCache = new WeakMap<
    SkyTrainStationOwner,
    Map<string, readonly StationBoardingDoor[]>
  >();
  constructor(city: CityEngine) {
    super(city);
    // The legacy controller's unused preview is never exposed to the world.
    this.train.group.visible = false;
    for (const light of this.lightPool) {
      light.name = 'Bounded transit lighting';
      this.city.scene.add(light);
    }
    city.renderer.domElement.addEventListener('wheel', this.worldWheel, {
      capture: true,
      passive: false,
    });
  }
  get aboard() {
    return this.occupied !== null;
  }
  get speedMps() {
    return this.occupied?.state.speedMps ?? 0;
  }
  load() {
    if (this.loadingWorld) return this.loadingWorld;
    this.loadingWorld = this.loadWorld();
    return this.loadingWorld;
  }
  private async loadWorld() {
    try {
      const response = await fetch('/data/transit/skytrain-world-routes.json', {
        signal: this.life.signal,
      });
      if (!response.ok) throw new Error('SkyTrain world service unavailable');
      const data = (await response.json()) as WorldSkyTrainData;
      if (data.schema !== 1 || data.routes.length !== 4)
        throw new Error('Invalid SkyTrain world service');
      this.routeData = await loadSkyTrainRoutes(this.life.signal);
      for (const station of SKYTRAIN_STATIONS)
        this.metadata.set(station.id, await this.stations.describe(station.id));
      if (this.disposed) return;
      this.buildPaths();
      this.worldData = data;
      for (const route of data.routes) {
        for (let i = 0; i < route.segments.length; i++) {
          const from = route.stops[i].stationId,
            to = route.stops[i + 1].stationId;
          const core =
            from && to
              ? this.paths.get(pair(route.lineId, from, to))
              : undefined;
          this.worldPaths.set(
            `${route.sourceTripId}:${i}`,
            core ??
              new SkyTrainWorldPath(
                route,
                i,
                this.stopPose(route, i),
                this.stopPose(route, i + 1),
                (x, z) => this.city.elevation(x, z),
              ),
          );
        }
        const returning = data.routes.find(
          (r) => r.lineId === route.lineId && r.direction !== route.direction,
        )!;
        this.terminalPaths.set(
          route.sourceTripId,
          new SkyTrainTerminalPath(
            this.stopPose(route, route.stops.length - 1),
            this.stopPose(returning, 0),
            route.lineId,
          ),
        );
      }
      for (const line of ['expo', 'canada'] as const) {
        const routes = data.routes.filter((r) => r.lineId === line),
          cycle = new WorldSkyTrainRun(routes[0], routes[1])
            .cycleDurationSeconds;
        const count = Math.ceil(cycle / 180);
        for (let i = 0; i < count; i++) {
          const run = new WorldSkyTrainRun(
              routes[0],
              routes[1],
              (i * cycle) / count,
            ),
            exterior = this.exteriors.create(line),
            proxy = exterior.group,
            cars = exterior.cars;
          proxy.name = `Scheduled ${line} train ${i}`;
          this.city.scene.add(proxy);
          this.fleet.push({
            id: `${line}-${i}`,
            run,
            state: run.snapshot(),
            proxy,
            exterior,
            cars,
            detail: null,
            loading: false,
            prepared: false,
            retryAt: 0,
            lastNear: 0,
            path: null,
            progress: 0,
          });
        }
      }
      this.ready = true;
      this.openings = applySkyTrainWorldOpenings(
        [
          this.city.terrain,
          this.city.roads,
          this.city.buildings,
          this.city.landmarks,
        ],
        this.city.water ? [this.city.water] : [],
      );
      this.bindGroundOpeningMaterials();
      // Retain the seven actual geographic stations. Construction is spread
      // over turns; a camera change never disposes the station under a rider.
      for (const station of SKYTRAIN_STATIONS) {
        if (this.disposed) return;
        const owner = await this.stations.ensure(
          station.id,
          this.city.settings.quality,
        );
        this.captureLights(owner.group);
        // Restored interiors have complete walking routes. Construction
        // shortcuts belong only to the legacy provisional station layouts.
        if (!owner.geometryData.authoredInterior) {
          try {
            const portals = stationConstructionPortals(
              owner,
              (x, z) =>
                this.city.navigation?.groundHeight(x, z) ??
                this.city.elevation(x, z),
            );
            const visuals = new SkyTrainConstructionVisuals(owner, portals);
            this.constructionAccess.set(owner, portals);
            this.constructionVisuals.set(owner, visuals);
          } catch (error) {
            // An optional shortcut must not prevent the other geographic stations
            // and their autonomous service from loading.
            this.error = `Construction access unavailable: ${station.name}`;
            console.warn(this.error, error);
          }
        }
        this.openings.update(this.stations.owners);
        this.syncViewCutaway();
        this.updateBuildingReplacement();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      this.publish();
    } catch (error) {
      if (!this.disposed) {
        this.error =
          error instanceof Error ? error.message : 'Transit unavailable';
        this.publish();
      }
    }
  }
  protected updateBuildingReplacement() {
    const main = this.stations.get('main-street-science-world'),
      seed = this.city.data.buildingProfiles?.get('osm-structure-303')?.seed;
    if (main && Number.isFinite(seed))
      this.city.uniforms.skyTrainReplacement.value.set(
        seed!,
        main.origin[0],
        main.origin[2],
        170,
      );
    else this.city.uniforms.skyTrainReplacement.value.set(-1, 0, 0, 0);
    setMainSkyTrainGuideway(
      this.city.uniforms,
      main
        ? {
            origin: main.origin,
            yaw: main.yaw,
            railY: main.toWorld(
              main.trainStop('expo', 'westbound').position,
            )[1],
          }
        : null,
      this.city.data.buildingProfiles?.get('133436')?.seed,
    );
  }
  prepareCityGeometry(group: THREE.Object3D) {
    this.openings?.refresh([group]);
  }
  serviceFocus() {
    if (!this.ready) return null;
    const visible = this.fleet.find(
      (vehicle) =>
        vehicle.state.route.lineId === 'expo' &&
        Math.abs(vehicle.proxy.position.x) < 4200 &&
        Math.abs(vehicle.proxy.position.z) < 4200 &&
        vehicle.proxy.position.y >
          this.city.elevation(
            vehicle.proxy.position.x,
            vehicle.proxy.position.z,
          ) +
            1,
    );
    if (visible) return visible.proxy.position.clone();
    const main = this.stations.get('main-street-science-world');
    return main
      ? new THREE.Vector3(
          ...main.toWorld(main.trainStop('expo', 'eastbound').position),
        )
      : null;
  }
  private stopPose(route: WorldSkyTrainRoute, index: number): SkyTrainStopPose {
    const station = route.stops[index].stationId,
      data = station && this.metadata.get(station);
    if (data) {
      const stop = trainStopFor(data, route.lineId, route.direction),
        pose = stationWorldPose(
          data,
          (x, z) => this.city.elevation(x, z),
          stop.position,
          stop.quaternion,
        );
      return {
        position: new THREE.Vector3(...pose.position),
        quaternion: new THREE.Quaternion(...pose.quaternion),
        motionSign: stop.motionSign,
      };
    }
    const [x, z] = project(route.stops[index].lonLat),
      vertices =
        route.segments[Math.min(index, route.segments.length - 1)].coordinates;
    const a = project(
        index < route.segments.length ? vertices[0] : vertices.at(-2)!,
      ),
      b = project(
        index < route.segments.length ? vertices[1] : vertices.at(-1)!,
      );
    const sign =
      route.direction === 'westbound' || route.direction === 'northbound'
        ? -1
        : 1;
    return {
      position: new THREE.Vector3(
        x,
        this.city.elevation(x, z) + (route.lineId === 'canada' ? -15 : 8),
        z,
      ),
      quaternion: new THREE.Quaternion().setFromAxisAngle(
        UP,
        Math.atan2((b[0] - a[0]) * sign, (b[1] - a[1]) * sign),
      ),
      motionSign: sign,
    };
  }
  private applyPose(vehicle: ServiceTrain, dt = 0) {
    const state = vehicle.state,
      route = state.route;
    const path =
      state.phase === 'turnback'
        ? this.terminalPaths.get(route.sourceTripId)!
        : this.worldPaths.get(`${route.sourceTripId}:${state.segmentIndex}`)!;
    const u =
      state.phase === 'turnback'
        ? state.phaseElapsed / state.phaseDuration
        : state.phase === 'moving'
          ? state.progress
          : state.stopIndex === route.stops.length - 1
            ? 1
            : 0;
    vehicle.path = path;
    vehicle.progress = u;
    vehicle.exterior.setDirection(
      state.phase === 'turnback' && u > 0.5
        ? path.end.motionSign
        : path.start.motionSign,
    );
    const distance = u * path.length;
    path.sampleDistance(distance, this.poseScratch);
    vehicle.proxy.position.copy(this.poseScratch.position);
    vehicle.proxy.quaternion.copy(this.poseScratch.quaternion);
    vehicle.proxy.updateMatrixWorld(true);
    this.inverseProxyMatrix.copy(vehicle.proxy.matrixWorld).invert();
    for (const car of vehicle.cars) {
      if (path.sampleCarDistance)
        path.sampleCarDistance(
          distance,
          Number(car.userData.offset),
          this.poseScratch,
        );
      else
        path.sampleDistance(
          distance + Number(car.userData.offset) * path.start.motionSign,
          this.poseScratch,
        );
      const matrix = this.carWorldMatrix
        .compose(
          this.poseScratch.position,
          this.poseScratch.quaternion,
          this.unitScale,
        )
        .premultiply(this.inverseProxyMatrix);
      matrix.decompose(car.position, car.quaternion, car.scale);
    }
    if (vehicle.detail?.ready) {
      vehicle.detail.setPathPose(path, u);
      const stopId = route.stops[state.stopIndex].stationId,
        owner = stopId && this.stations.get(stopId);
      const side =
        owner?.trainStop(route.lineId, route.direction).doorSide ?? 'left';
      vehicle.detail.setDoors(
        state.doorsOpen || state.phase === 'opening',
        side,
        dt,
      );
    }
  }
  private async detail(vehicle: ServiceTrain) {
    if (
      vehicle.loading ||
      vehicle.detail ||
      this.disposed ||
      this.worldTime < vehicle.retryAt
    )
      return;
    vehicle.loading = true;
    const train = new SkyTrainRideTrain();
    train.group.visible = false;
    this.city.scene.add(train.group);
    vehicle.detail = train;
    try {
      const loaded = await train.load(
        vehicle.state.route.lineId,
        this.city.settings.quality,
        this.city.compatibleGraphics,
      );
      if (!loaded) throw new Error('Train interior unavailable');
      if (this.disposed || vehicle.detail !== train) return;
      this.captureLights(train.group);
      this.applyPose(vehicle);
      await this.precompile(train.group);
      if (this.disposed || vehicle.detail !== train) return;
      vehicle.prepared = true;
    } catch {
      train.dispose();
      vehicle.detail = null;
      vehicle.prepared = false;
      vehicle.retryAt = this.worldTime + 5;
    } finally {
      vehicle.loading = false;
    }
  }
  private captureLights(root: THREE.Object3D) {
    let lights = this.lightSources.get(root);
    if (!lights) {
      this.city.prepareTravelOccluders?.(root);
      lights = [];
      root.traverse((node) => {
        if (node instanceof THREE.PointLight) {
          node.visible = false;
          lights!.push(node);
        }
      });
      this.lightSources.set(root, lights);
    }
    return lights;
  }
  private updateTransitLights() {
    for (const light of this.lightPool) light.intensity = 0;
    if (this.city.settings.mode !== 'walk') return;
    const origin =
      this.interactionOrigin ?? this.city.navigation?.position.toArray();
    if (!origin) return;
    const foot = new THREE.Vector3(...origin);
    const nearest =
      this.owner ??
      this.stations.owners.reduce<(typeof this.stations.owners)[number] | null>(
        (best, owner) =>
          !best ||
          owner.group.position.distanceToSquared(foot) <
            best.group.position.distanceToSquared(foot)
            ? owner
            : best,
        null,
      );
    const assign = (sources: THREE.PointLight[], offset: number) => {
      sources.sort(
        (a, b) =>
          a.getWorldPosition(new THREE.Vector3()).distanceToSquared(foot) -
          b.getWorldPosition(new THREE.Vector3()).distanceToSquared(foot),
      );
      for (let i = 0; i < Math.min(2, sources.length); i++) {
        const source = sources[i],
          target = this.lightPool[offset + i];
        source.getWorldPosition(target.position);
        target.color.copy(source.color);
        target.distance = source.distance;
        target.decay = source.decay;
        target.intensity =
          target.position.distanceTo(foot) < 90 ? source.intensity : 0;
      }
    };
    if (nearest) assign(this.captureLights(nearest.group), 0);
    if (this.occupied?.detail)
      assign(this.captureLights(this.occupied.detail.group), 2);
  }
  private alignedAtOwner(vehicle: ServiceTrain) {
    if (!this.owner || !vehicle.detail?.stationAligned) return false;
    const route = vehicle.state.route;
    if (route.stops[vehicle.state.stopIndex].stationId !== this.owner.data.id)
      return false;
    const stop = this.owner.trainStop(route.lineId, route.direction),
      expected = stationWorldPose(
        this.owner.data,
        (x, z) => this.city.elevation(x, z),
        stop.position,
        stop.quaternion,
      );
    return (
      vehicle.detail.group.position.distanceToSquared(
        new THREE.Vector3(...expected.position),
      ) < 0.0025 &&
      vehicle.detail.group.quaternion.angleTo(
        new THREE.Quaternion(...expected.quaternion),
      ) < 0.005
    );
  }
  private nearestBoardingTrain(): ServiceTrain | null {
    if (
      !this.owner ||
      !this.foot ||
      this.aboard ||
      this.passengerSeated ||
      !this.inputEnabled ||
      !this.city.settings.trains ||
      this.busy
    )
      return null;
    const platform = this.owner.geometryData.platforms.find(
      (p) =>
        p.surfaceId === this.foot!.surfaceId &&
        p.line === this.line &&
        p.direction === this.direction,
    );
    if (!platform) return null;
    const door = this.boardingDoor();
    if (!door || separation(this.foot.position, door.waiting.position) > 1.8)
      return null;
    return (
      this.fleet.find(
        (v) =>
          v.state.route.lineId === this.line &&
          v.state.route.direction === this.direction &&
          v.state.route.stops[v.state.stopIndex].stationId === this.station &&
          v.state.doorsOpen &&
          v.state.speedMps < 0.05 &&
          v.detail?.ready &&
          v.prepared &&
          this.alignedAtOwner(v) &&
          v.detail.doorsClear,
      ) ?? null
    );
  }
  private boardingDoor(): StationBoardingDoor | null {
    if (
      !this.owner ||
      !this.foot ||
      !this.owner.geometryData.platforms.some(
        (p) =>
          p.line === this.line &&
          p.direction === this.direction &&
          p.surfaceId === this.foot!.surfaceId,
      )
    )
      return null;
    return this.platformDoors(
      this.line,
      this.direction,
    ).reduce<StationBoardingDoor | null>(
      (nearest, door) =>
        !nearest ||
        separation(this.foot!.position, door.waiting.position) <
          separation(this.foot!.position, nearest.waiting.position)
          ? door
          : nearest,
      null,
    );
  }
  private platformDoors(line: LineId, direction: SkyTrainDirection) {
    if (!this.owner) return [];
    let cache = this.doorCache.get(this.owner);
    if (!cache) {
      cache = new Map();
      this.doorCache.set(this.owner, cache);
    }
    const key = `${line}:${direction}`;
    let doors = cache.get(key);
    if (!doors) {
      doors = this.owner.boardingDoors(line, direction);
      cache.set(key, doors);
    }
    return doors;
  }
  private platformDistance(line: LineId, direction: SkyTrainDirection) {
    let distance = Infinity;
    for (const door of this.platformDoors(line, direction))
      distance = Math.min(
        distance,
        separation(this.foot!.position, door.waiting.position),
      );
    return distance;
  }
  private alightingDoor(): StationBoardingDoor | null {
    if (!this.owner || !this.cabinFoot || !this.aboard) return null;
    return this.platformDoors(this.line, this.direction)
      .filter((door) => door.carIndex === this.train.passengerCarIndex)
      .reduce<StationBoardingDoor | null>(
        (nearest, door) =>
          !nearest ||
          separation(this.cabinFoot!, door.carDoor) <
            separation(this.cabinFoot!, nearest.carDoor)
            ? door
            : nearest,
        null,
      );
  }
  protected nearCabinDoor() {
    const door = this.alightingDoor();
    return Boolean(
      door && this.cabinFoot && separation(this.cabinFoot, door.carDoor) < 1.5,
    );
  }
  private canWorldAlight() {
    const v = this.occupied,
      id = v?.state.route.stops[v.state.stopIndex].stationId;
    return Boolean(
      v &&
      id &&
      v.state.doorsOpen &&
      v.state.speedMps < 0.05 &&
      this.owner?.data.id === id &&
      this.train.stationAligned &&
      this.train.doorsClear &&
      !this.passengerSeated &&
      this.inputEnabled &&
      this.nearCabinDoor(),
    );
  }
  interactionCandidates(): readonly InteractionCandidate[] {
    const seats = [
      ...super.interactionCandidates(),
      ...this.constructionCandidates(),
      ...this.elevatorCandidates(),
    ];
    if (!this.active || !this.inputEnabled || this.passengerSeated)
      return seats;
    const vehicle = this.nearestBoardingTrain();
    const door = this.boardingDoor();
    if (vehicle && this.owner && door) {
      const visit = `${vehicle.state.route.sourceTripId}:${vehicle.state.stopIndex}:${Math.floor(vehicle.state.elapsed / vehicle.run.cycleDurationSeconds)}`;
      const current = () =>
        this.nearestBoardingTrain() === vehicle &&
        this.boardingDoor()?.carIndex === door.carIndex &&
        separation(this.boardingDoor()!.carDoor, door.carDoor) < 0.001 &&
        `${vehicle.state.route.sourceTripId}:${vehicle.state.stopIndex}:${Math.floor(vehicle.state.elapsed / vehicle.run.cycleDurationSeconds)}` ===
          visit;
      const point = this.owner.toWorld(door.waiting),
        threshold = this.owner.toWorld(door.threshold);
      return [
        ...seats,
        {
          id: `skytrain:board:${vehicle.id}:${visit}:${door.carIndex}:${door.carDoor[2]}`,
          kind: 'scene',
          action: 'board',
          anchor: [threshold[0], threshold[1] + 1.4, threshold[2]],
          proximityPoint: point,
          range: 1.8,
          priority: 20,
          canInteract: current,
          execute: () => current() && this.board(),
        },
      ];
    }
    if (this.canWorldAlight() && this.owner) {
      const occupied = this.occupied!,
        door = this.alightingDoor()!,
        stopIndex = occupied.state.stopIndex,
        routeId = occupied.state.route.sourceTripId,
        visitElapsed = Math.floor(
          occupied.state.elapsed / occupied.run.cycleDurationSeconds,
        );
      const current = () =>
        this.occupied === occupied &&
        occupied.state.stopIndex === stopIndex &&
        occupied.state.route.sourceTripId === routeId &&
        Math.floor(
          occupied.state.elapsed / occupied.run.cycleDurationSeconds,
        ) === visitElapsed &&
        this.alightingDoor()?.carIndex === door.carIndex &&
        separation(this.alightingDoor()!.carDoor, door.carDoor) < 0.001 &&
        this.canWorldAlight();
      const p = this.train.passengerPointToWorld(door.carDoor);
      return [
        ...seats,
        {
          id: `skytrain:alight:${occupied.id}:${routeId}:${stopIndex}:${visitElapsed}:${door.carIndex}:${door.carDoor[2]}`,
          kind: 'scene',
          action: 'alight',
          anchor: [p[0], p[1] + 1.45, p[2]],
          proximityPoint: p,
          range: 1.5,
          priority: 20,
          canInteract: current,
          execute: () => current() && this.alight(),
        },
      ];
    }
    return seats;
  }
  /** Completed cabins opt in to lift actions. Metadata keeps source X/Z, while
   * the graph and rendered doors have already undergone entrance rebasing. */
  private completedElevatorLanding(
    owner: SkyTrainStationOwner,
    floorId: string,
    position: readonly number[],
  ): { outward: THREE.Vector3; sourcePoint: readonly number[] } | null {
    const landings = owner.geometryData.authoredInterior?.elevatorLandings;
    if (!Array.isArray(landings)) return null;
    const metadata = landings.find(
      (landing) =>
        landing &&
        landing.floorId === floorId &&
        Array.isArray(landing.pointM) &&
        landing.pointM.length === 3 &&
        landing.pointM.every(Number.isFinite) &&
        Math.abs(landing.pointM[1] - position[1]) < 0.1 &&
        typeof landing.clearDoorWidthM === 'number' &&
        Number.isFinite(landing.clearDoorWidthM) &&
        landing.clearDoorWidthM >= 1.4 &&
        Array.isArray(landing.outwardDirectionM) &&
        landing.outwardDirectionM.length === 3 &&
        landing.outwardDirectionM.every(Number.isFinite),
    );
    if (!metadata) return null;
    const leaves = owner.geometryData.parts.filter(
      (part) =>
        part.role === 'lift-door' &&
        part.size[1] >= 2 &&
        Math.abs(part.position[1] - position[1] - 1.1) < 0.2 &&
        Math.hypot(
          part.position[0] - position[0],
          part.position[2] - position[2],
        ) < 1.8,
    );
    if (leaves.length !== 2) return null;
    const outward = new THREE.Vector3(...leaves[0].position)
        .add(new THREE.Vector3(...leaves[1].position))
        .multiplyScalar(0.5)
        .sub(new THREE.Vector3().fromArray(position))
        .setY(0),
      panelGap = Math.hypot(
        leaves[0].position[0] - leaves[1].position[0],
        leaves[0].position[2] - leaves[1].position[2],
      ),
      declared = new THREE.Vector3(...metadata.outwardDirectionM).setY(0);
    if (
      outward.length() < 0.8 ||
      outward.length() > 1.5 ||
      panelGap < 1.6 ||
      panelGap > 2.4 ||
      declared.lengthSq() < 0.5 ||
      outward.normalize().dot(declared.normalize()) < 0.95
    )
      return null;
    return { outward, sourcePoint: metadata.pointM };
  }
  /** A lift serves only its declared, vertically aligned pair of landings.
   * All positions come from the runtime graph, after street/GPS rebasing. */
  private elevatorTrip(
    owner: SkyTrainStationOwner,
    connection: StationConnection,
    reverse: boolean,
  ): { from: StationPoint; to: StationPoint; outward: THREE.Vector3 } | null {
    const foot = this.foot;
    if (
      this.disposed ||
      this.busy ||
      !this.inputEnabled ||
      this.passengerSeated ||
      this.aboard ||
      this.phase !== 'station' ||
      this.owner !== owner ||
      this.station !== owner.data.id ||
      this.city.settings.mode !== 'walk' ||
      this.city.contextLost ||
      this.city.pageSuspended ||
      document.hidden ||
      !owner.group.visible ||
      !owner.geometryData.authoredInterior ||
      !foot ||
      connection.type !== 'elevator' ||
      !owner.geometryData.connections.includes(connection) ||
      connection.from === connection.to ||
      Math.hypot(
        connection.start[0] - connection.end[0],
        connection.start[2] - connection.end[2],
      ) > 0.1 ||
      Math.abs(connection.start[1] - connection.end[1]) < 0.5
    )
      return null;
    const fromPosition = reverse ? connection.end : connection.start,
      toPosition = reverse ? connection.start : connection.end,
      fromLanding = this.completedElevatorLanding(
        owner,
        reverse ? connection.to : connection.from,
        fromPosition,
      ),
      toLanding = this.completedElevatorLanding(
        owner,
        reverse ? connection.from : connection.to,
        toPosition,
      );
    if (
      !fromLanding ||
      !toLanding ||
      Math.hypot(
        fromLanding.sourcePoint[0] -
          toLanding.sourcePoint[0] -
          fromPosition[0] +
          toPosition[0],
        fromLanding.sourcePoint[2] -
          toLanding.sourcePoint[2] -
          fromPosition[2] +
          toPosition[2],
      ) > 0.1
    )
      return null;
    const from = owner.floorAt(
        fromPosition,
        reverse ? connection.to : connection.from,
      ),
      to = owner.floorAt(toPosition, reverse ? connection.from : connection.to),
      current = owner.floorAt(foot.position, foot.surfaceId),
      landing = owner.floorAt(
        foot.position,
        reverse ? connection.to : connection.from,
      );
    if (
      !from ||
      !to ||
      !current ||
      !landing ||
      current.layer !== foot.layer ||
      Math.abs(current.position[1] - foot.position[1]) > 0.02 ||
      Math.abs(landing.position[1] - foot.position[1]) > 0.02 ||
      separation(foot.position, from.position) > 1.55 ||
      !owner.isClearFoot(foot) ||
      !owner.isClearFoot(from) ||
      !owner.isClearFoot(to)
    )
      return null;
    // A nearby lift behind a wall is not an interaction shortcut. The real
    // capsule must be able to reach the cabin centre through its open doorway.
    const approach = owner.walk(
      foot,
      from.position[0] - foot.position[0],
      from.position[2] - foot.position[2],
    );
    return separation(approach.position, from.position) <= 0.18
      ? { from, to, outward: fromLanding.outward }
      : null;
  }
  private elevatorCandidates(): InteractionCandidate[] {
    const owner = this.owner;
    if (!owner?.geometryData.authoredInterior || !this.foot) return [];
    const candidates: InteractionCandidate[] = [];
    for (const connection of owner.geometryData.connections) {
      if (connection.type !== 'elevator') continue;
      for (const reverse of [false, true]) {
        const trip = this.elevatorTrip(owner, connection, reverse);
        if (!trip) continue;
        const up = trip.to.position[1] > trip.from.position[1],
          outward = trip.outward,
          across = new THREE.Vector3(outward.z, 0, -outward.x),
          button = new THREE.Vector3(...trip.from.position).addScaledVector(
            across,
            up ? -0.45 : 0.45,
          ),
          proximity = owner.toWorld(button.toArray()),
          anchor = owner.toWorld(
            button
              .clone()
              .addScaledVector(outward, 0.85)
              .add(new THREE.Vector3(0, 1.15, 0))
              .toArray(),
          );
        candidates.push({
          id: `skytrain:elevator:${owner.data.id}:${connection.id}:${reverse ? 'return' : 'forward'}`,
          kind: 'scene',
          action: up ? 'elevatorUp' : 'elevatorDown',
          anchor,
          proximityPoint: proximity,
          range: 1.55,
          priority: 10,
          canInteract: () =>
            this.elevatorTrip(owner, connection, reverse) !== null,
          execute: () => {
            const current = this.elevatorTrip(owner, connection, reverse);
            if (!current) return false;
            this.clearInput();
            this.foot = {
              ...current.to,
              position: [...current.to.position],
              yaw: this.yaw,
            };
            const platform = this.platformAtFoot();
            this.level = platform ? 'platform' : 'concourse';
            if (platform) {
              this.line = platform.line;
              this.direction = platform.direction;
            }
            this.updateCamera();
            this.city.interactions?.clear();
            this.publish();
            return true;
          },
        });
      }
    }
    return candidates;
  }
  private platformAtFoot() {
    const owner = this.owner,
      foot = this.foot;
    if (!owner || !foot) return undefined;
    const surfaces = new Set([foot.surfaceId]);
    if (owner.geometryData.authoredInterior) {
      // Landing IDs are distinct from platform IDs. Only an actual coplanar
      // walking connection associates a lift lobby with its served platform.
      const pending = [foot.surfaceId];
      for (const surface of pending)
        for (const c of owner.geometryData.connections) {
          if (
            c.type !== 'walk' ||
            ![c.from, c.to].includes(surface) ||
            Math.abs(c.start[1] - foot.position[1]) > 0.25 ||
            Math.abs(c.end[1] - foot.position[1]) > 0.25
          )
            continue;
          const next = c.from === surface ? c.to : c.from;
          if (!surfaces.has(next)) {
            surfaces.add(next);
            pending.push(next);
          }
        }
    }
    return owner.geometryData.platforms
      .filter((p) => surfaces.has(p.surfaceId))
      .sort(
        (a, b) =>
          this.platformDistance(a.line, a.direction) -
          this.platformDistance(b.line, b.direction),
      )[0];
  }
  /** The temporary shortcuts are physical nearby objects, independent of the
   * legacy station planner. Their destinations never modify a service run. */
  private canUseConstructionPortal(
    owner: SkyTrainStationOwner,
    portal: StationConstructionPortal,
  ) {
    const foot = this.foot;
    return Boolean(
      !this.disposed &&
      !this.busy &&
      !this.city.contextLost &&
      !this.city.pageSuspended &&
      !document.hidden &&
      this.phase === 'station' &&
      this.city.settings.mode === 'walk' &&
      this.inputEnabled &&
      !this.passengerSeated &&
      !this.aboard &&
      this.owner === owner &&
      this.station === portal.stationId &&
      this.constructionAccess.get(owner)?.includes(portal) &&
      foot &&
      separation(foot.position, portal.point.position) <= 2.2 &&
      this.onConstructionSurface(owner, portal) &&
      owner.isClearFoot(foot) &&
      owner.isClearFoot(portal.point) &&
      (portal.target.kind === 'platform'
        ? owner.isClearFoot(portal.target.point)
        : this.clearConstructionStreetTarget(portal.target.position)),
    );
  }
  private onConstructionSurface(
    owner: SkyTrainStationOwner,
    portal: StationConstructionPortal,
  ) {
    const foot = this.foot;
    if (!foot) return false;
    if (foot.surfaceId === portal.point.surfaceId) return true;
    if (portal.kind !== 'platform') return false;
    // The public vestibule and street apron overlap as one physical doorway.
    // Walking may adopt either polygon; stacked floors cannot pass this test.
    const apron = owner.floorAt(foot.position, portal.point.surfaceId);
    return Boolean(
      apron &&
      Math.abs(apron.position[1] - foot.position[1]) <= 0.22 &&
      owner.isClearFoot(apron),
    );
  }
  private clearConstructionStreetTarget(position: readonly number[]) {
    const nav = this.city.navigation;
    return Boolean(
      nav &&
      position.every(Number.isFinite) &&
      Number.isFinite(nav.groundHeight(position[0], position[2])) &&
      nav.clearGround(position[0], position[2], 'walk', true),
    );
  }
  private constructionCandidates(): InteractionCandidate[] {
    if (!this.owner || this.aboard || this.phase !== 'station') return [];
    const owner = this.owner;
    return (this.constructionAccess.get(owner) ?? [])
      .filter((portal) => this.canUseConstructionPortal(owner, portal))
      .map<InteractionCandidate>((portal) => {
        const point = owner.toWorld(portal.point);
        return {
          id: `skytrain:portal:${portal.stationId}:${portal.id}`,
          kind: 'scene',
          action: portal.kind === 'platform' ? 'portalPlatform' : 'portalExit',
          anchor: [point[0], point[1] + 1.2, point[2]],
          proximityPoint: point,
          range: 2.2,
          priority: 10,
          canInteract: () => this.canUseConstructionPortal(owner, portal),
          execute: () => this.useConstructionPortal(owner, portal),
        };
      });
  }
  private useConstructionPortal(
    owner: SkyTrainStationOwner,
    portal: StationConstructionPortal,
  ) {
    if (!this.canUseConstructionPortal(owner, portal)) return false;
    const target = portal.target;
    this.clearInput();
    this.resetSeat();
    if (target.kind === 'platform') {
      this.foot = {
        ...target.point,
        position: [...target.point.position],
      };
      this.line = portal.lineId;
      this.direction = portal.directions[0];
      this.level = 'platform';
      this.yaw = target.point.yaw;
      this.lookYaw = 0;
      this.updateCamera();
    } else {
      const nav = this.city.navigation!;
      nav.blur();
      nav.mode = 'walk';
      nav.surface = 'ground';
      nav.surfaceId = undefined;
      nav.surfaceLayer = undefined;
      nav.position.fromArray(target.position);
      nav.position.y = nav.groundHeight(nav.position.x, nav.position.z);
      nav.yaw = target.yaw;
      nav.pitch = -this.pitch;
      if (nav.cameraDistances) nav.cameraDistances.walk = this.distanceView;
      nav.snapCamera = true;
      nav.walker.group.position.copy(nav.position);
      this.phase = 'idle';
      this.station = null;
      this.foot = null;
      this.owner = null;
    }
    this.syncViewCutaway();
    this.city.interactions?.clear();
    this.publish();
    return true;
  }
  async enter(id: StationId) {
    const nav = this.city.navigation,
      owner = this.stations.get(id);
    if (
      !nav ||
      nav.walkSeat ||
      this.active ||
      this.city.settings.mode !== 'walk' ||
      !owner ||
      this.city.busVisit?.aboard
    )
      return false;
    const point = owner.tryEnterFromStreet([
      nav.position.x,
      nav.walkingHeight(),
      nav.position.z,
    ]);
    if (!point) return false;
    this.owner = owner;
    this.station = id;
    this.overviewAnchor = null;
    this.overviewMoved = false;
    const platform =
      owner.geometryData.platforms.find(
        (p) => p.line === this.line && p.direction === this.direction,
      ) ?? owner.geometryData.platforms[0];
    this.line = platform.line;
    this.direction = platform.direction;
    this.phase = 'station';
    this.foot = point;
    this.level = 'concourse';
    this.yaw = nav.yaw - owner.yaw;
    this.pitch = -nav.pitch;
    this.lookYaw = 0;
    const keyMap: Record<string, string> = {
      w: 'KeyW',
      s: 'KeyS',
      a: 'KeyA',
      d: 'KeyD',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
    };
    for (const key of nav.keys) if (keyMap[key]) this.keys.add(keyMap[key]);
    this.axes = { x: nav.touchX, y: nav.touchY };
    this.distanceView = Number.isFinite(nav.cameraDistance)
      ? nav.cameraDistance
      : 0;
    nav.blur();
    nav.mode = 'orbit';
    this.updateCamera();
    this.publish();
    return true;
  }
  stand() {
    const previousYaw = this.yaw;
    // Adopt the requested view before the base method clears free look and
    // publishes the standing pose. A refused stand keeps the seated heading.
    this.yaw += this.lookYaw;
    const stood = super.stand();
    if (!stood) this.yaw = previousYaw;
    return stood;
  }
  chooseDestination(_id: StationId) {
    return false;
  }
  async goPlatform() {
    return false;
  }
  goConcourse() {
    return false;
  }
  board() {
    const v = this.nearestBoardingTrain(),
      door = this.boardingDoor();
    if (!v?.detail || !this.owner || !door || !v.detail.passengerSpace)
      return false;
    let spawn;
    try {
      spawn = v.detail.passengerSpace.doorSpawn(
        door.carDoor[0] > 0 ? 'left' : 'right',
        door.carDoor[2],
      );
    } catch {
      return false;
    }
    if (!v.detail.selectPassengerCar(door.carIndex)) return false;
    const worldYaw = this.owner.yaw + this.yaw,
      forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        v.detail.passengerFrame.getWorldQuaternion(new THREE.Quaternion()),
      );
    this.occupied = v;
    this.train = v.detail;
    this.phase = 'riding';
    this.cabinFoot = spawn;
    this.yaw = worldYaw - Math.atan2(forward.x, forward.z);
    this.clearInput();
    this.updateCamera();
    this.publish();
    return true;
  }
  alight() {
    if (!this.canWorldAlight() || !this.owner) return false;
    const door = this.alightingDoor();
    if (!door) return false;
    const point = door.waiting;
    if (!this.owner.isClearFoot(point)) return false;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
      this.train.passengerFrame.getWorldQuaternion(new THREE.Quaternion()),
    );
    this.yaw += Math.atan2(forward.x, forward.z) - this.owner.yaw;
    this.resetSeat();
    this.occupied = null;
    this.foot = point;
    this.phase = 'station';
    this.level = 'platform';
    this.clearInput();
    this.updateCamera();
    this.publish();
    return true;
  }
  leave() {
    if (this.aboard || !this.owner || !this.foot || this.passengerSeated)
      return false;
    const point = this.owner.streetExit(this.foot);
    if (!point) return false;
    const nav = this.city.navigation!;
    nav.mode = 'walk';
    nav.position.fromArray(point);
    nav.yaw = this.owner.yaw + this.yaw + this.lookYaw;
    nav.pitch = -this.pitch;
    nav.blur();
    for (const key of this.keys)
      nav.keys.add(
        key.startsWith('Key') ? key.slice(3).toLowerCase() : key.toLowerCase(),
      );
    nav.setTouchAxes(this.axes.x, this.axes.y);
    this.phase = 'idle';
    this.station = null;
    this.foot = null;
    this.owner = null;
    this.clearInput();
    this.syncViewCutaway();
    this.publish();
    return true;
  }
  interact() {
    return this.aboard ? this.alight() : this.board();
  }
  snapshot(): SkyTrainTravelSnapshot {
    const v = this.occupied ?? this.nearestBoardingTrain(),
      state = v?.state,
      id = state?.route.stops[state.stopIndex].stationId ?? null;
    return {
      phase: this.phase,
      stationId: this.station,
      lineId: this.station || this.aboard ? this.line : null,
      plannedLineId: this.aboard ? this.line : null,
      destinationId: this.destination,
      nextStationId: state?.route.stops[state.nextStopIndex].stationId ?? null,
      level: this.level,
      doorsOpen: Boolean(v?.detail?.doorsClear && state?.doorsOpen),
      canBoard: !this.aboard && Boolean(v),
      canAlight: this.canWorldAlight(),
      canExit:
        !this.aboard &&
        Boolean(this.owner && this.foot && this.owner.streetExit(this.foot)),
      canChangeLevel: false,
      speedMps: this.speedMps,
      travelProgress: state?.progress ?? 0,
      error: this.error,
      busy: false,
      seated: this.passengerSeated,
      canWalkCabin: this.aboard && !this.passengerSeated,
      availableLines: this.station
        ? SKYTRAIN_STATIONS.find((s) => s.id === this.station)?.lines
        : [],
      hint: this.aboard ? 'wait' : 'approach-door',
      headsign: state?.route.headsign,
      nextStopName: state?.route.stops[state.nextStopIndex].name,
      atStop:
        state?.phase !== 'moving' && state?.phase !== 'turnback' ? id : null,
    };
  }
  serviceSnapshot() {
    return {
      ready: this.ready,
      source: this.worldData?.source,
      vehicles: this.fleet.map((v) => ({
        id: v.id,
        route: v.state.route.lineId,
        direction: v.state.route.direction,
        headsign: v.state.route.headsign,
        phase: v.state.phase,
        stop: v.state.route.stops[v.state.stopIndex].name,
        nextStop: v.state.route.stops[v.state.nextStopIndex].name,
        position: v.proxy.position.toArray(),
        speedMps: v.state.speedMps,
        detail: Boolean(v.detail?.ready && v.prepared),
        occupied: v === this.occupied,
      })),
    };
  }
  update(dt: number) {
    if (
      this.disposed ||
      this.city.contextLost ||
      document.hidden ||
      this.city.pageSuspended ||
      !Number.isFinite(dt) ||
      dt <= 0
    )
      return;
    dt = Math.min(dt, 0.1);
    const previousWalkDistance = this.walkDistance;
    this.worldTime += dt;
    const nav = this.city.navigation,
      observer = this.aboard
        ? this.train.group.position
        : (nav?.position ?? this.city.camera.position);
    this.exteriors.setNight(this.city.uniforms.night?.value ?? 0);
    const nearby: ServiceTrain[] = [];
    for (const v of this.fleet) {
      v.state = v.run.advance(dt);
      this.applyPose(v, dt);
      const d = v.proxy.position.distanceTo(observer),
        withinCity =
          Math.abs(v.proxy.position.x) < 10000 &&
          Math.abs(v.proxy.position.z) < 10000;
      v.proxy.visible =
        withinCity &&
        this.city.settings.trains &&
        !(v.detail?.ready && v.prepared);
      if (v.detail)
        v.detail.group.visible =
          ((withinCity && this.city.settings.trains) || v === this.occupied) &&
          v.prepared;
      if (
        this.city.settings.mode === 'walk' &&
        this.city.settings.trains &&
        d < 180
      ) {
        v.lastNear = this.worldTime;
        nearby.push(v);
      }
      if (
        v.detail &&
        v !== this.occupied &&
        !v.loading &&
        (!this.city.settings.trains ||
          (d > 300 && this.worldTime - v.lastNear > 20))
      ) {
        v.detail.dispose();
        v.detail = null;
        v.prepared = false;
      }
    }
    nearby.sort(
      (a, b) =>
        a.proxy.position.distanceToSquared(observer) -
        b.proxy.position.distanceToSquared(observer),
    );
    let loaded = this.fleet.filter((v) => v.detail).length;
    for (const v of nearby)
      if (!v.detail && this.worldTime >= v.retryAt && loaded < 3) {
        loaded++;
        void this.detail(v);
      }
    if (this.aboard && this.occupied) {
      const state = this.occupied.state;
      this.line = state.route.lineId;
      this.direction = state.route.direction;
      const id = state.route.stops[state.stopIndex].stationId;
      this.station = id;
      this.owner = id ? this.stations.get(id) : null;
      const key = `${state.route.sourceTripId}:${state.segmentIndex}`;
      if (state.phase === 'moving' && this.pathKey !== key) {
        this.pathKey = key;
        const from = state.route.stops[state.segmentIndex].stationId,
          to = state.route.stops[state.segmentIndex + 1].stationId,
          core = from && to ? this.paths.get(pair(this.line, from, to)) : null;
        if (core) this.buildTunnel(core);
        else this.clearTube();
      }
      if (state.phase !== 'moving') this.clearTube();
    }
    if (
      !this.active &&
      this.ready &&
      this.city.settings.buildings &&
      this.city.settings.mode === 'walk' &&
      !this.city.busVisit?.aboard &&
      this.inputEnabled
    ) {
      // A sloped doorway can have only a short city-height handoff window.
      // Check every native movement frame so a timed poll cannot skip it;
      // each owner first rejects positions outside its small doorway bounds.
      for (const owner of this.stations.owners) {
        if (
          owner.tryEnterFromStreet([
            nav!.position.x,
            nav!.walkingHeight(),
            nav!.position.z,
          ])
        ) {
          void this.enter(owner.data.id);
          break;
        }
      }
    }
    if (this.active && this.city.settings.mode === 'orbit' && nav) {
      this.observeOverviewMoved();
      const origin = this.interactionOrigin;
      if (origin) {
        nav.position.fromArray(origin);
        nav.walker.group.position.fromArray(origin);
      }
      nav.walker.group.visible = false;
    }
    if (this.active && this.city.settings.mode === 'walk') {
      if (nav) nav.mode = 'orbit';
      if (!this.passengerSeated && this.inputEnabled) {
        const turn =
          Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) -
          Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
          this.axes.x;
        this.yaw += turn * 1.65 * dt;
        const forward = THREE.MathUtils.clamp(
            Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
              Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) +
              this.axes.y,
            -1,
            1,
          ),
          amount = forward * (this.aboard ? 1.8 : 2.5) * dt;
        // Free look stays independent at rest. Walking adopts that visible
        // heading without moving the camera to the opposite side of the body.
        if (forward !== 0 && this.lookYaw !== 0) {
          this.yaw += this.lookYaw;
          this.lookYaw = 0;
        }
        if (this.aboard && this.cabinFoot) {
          const before = this.cabinFoot;
          this.cabinFoot =
            this.train.passengerSpace?.walk(
              this.cabinFoot,
              Math.sin(this.yaw) * amount,
              Math.cos(this.yaw) * amount,
            ) ?? this.cabinFoot;
          this.walkDistance += separation(before, this.cabinFoot);
        } else if (this.owner && this.foot) {
          const before = this.foot.position;
          this.foot = this.owner.walk(
            this.foot,
            Math.sin(this.yaw) * amount,
            Math.cos(this.yaw) * amount,
          );
          this.walkDistance += separation(before, this.foot.position);
          const platform = this.platformAtFoot();
          this.level = platform ? 'platform' : 'concourse';
          if (platform) {
            this.line = platform.line;
            this.direction = platform.direction;
          }
          this.leave();
        }
      }
      this.updateCamera();
      if (this.active && nav) {
        const walked = this.walkDistance - previousWalkDistance;
        nav.walker.update(
          this.walkDistance,
          !this.passengerSeated && walked > 0.0001,
          dt,
          walked / dt,
        );
      }
    }
    this.updateTransitLights();
    for (const owner of this.stations.owners) {
      owner.group.visible =
        this.city.settings.buildings || (this.active && owner === this.owner);
      if (!this.active || owner !== this.owner || this.aboard)
        owner.setCutaway(null);
      else if (this.city.settings.mode === 'orbit' && this.foot)
        owner.updateCutaway(this.city.camera.position, this.foot.position[1]);
    }
    this.syncViewCutaway();
    const constructionOrigin =
      this.phase === 'station' && this.city.settings.mode === 'walk'
        ? this.interactionOrigin
        : null;
    if (constructionOrigin)
      this.constructionFocus.fromArray(constructionOrigin);
    for (const [owner, visuals] of this.constructionVisuals)
      visuals.update(
        dt,
        // Near-object visibility follows the person inside this station, so a
        // chase camera cannot hide the portal currently offering F/tap.
        constructionOrigin && owner === this.owner
          ? this.constructionFocus
          : this.city.camera.position,
        this.city.settings.quality,
        this.city.locale ?? 'en',
      );
    if (this.worldTime >= this.nextPublish) {
      this.nextPublish = this.worldTime + 0.25;
      this.publish();
    }
  }
  /** Rotation and zoom retain the observer's passenger. A deliberate horizontal
   * pan permanently changes this Overview into a new placement destination. */
  observeOverviewMoved() {
    if (
      this.active &&
      this.city.settings.mode === 'orbit' &&
      this.overviewAnchor &&
      Math.hypot(
        this.city.controls.target.x - this.overviewAnchor.x,
        this.city.controls.target.z - this.overviewAnchor.z,
      ) > 2
    )
      this.overviewMoved = true;
    return this.overviewMoved;
  }
  get canResumeOverview() {
    return Boolean(
      this.active &&
      this.city.settings.mode === 'orbit' &&
      this.overviewAnchor &&
      !this.observeOverviewMoved(),
    );
  }
  /** Explicit placement abandons only passenger ownership. Autonomous trains,
   * retained station architecture and the current Overview camera survive. */
  releaseForPlacement() {
    if (this.disposed) return false;
    if (!this.active) return true;
    if (this.city.settings.mode !== 'orbit' && !this.setOverview(true))
      return false;
    this.clearInput();
    this.resetSeat();
    this.occupied = null;
    this.train = this.previewTrain;
    this.phase = 'idle';
    this.station = null;
    this.owner = null;
    this.foot = null;
    this.journey = null;
    this.arrivalPreparation = null;
    this.pathKey = '';
    this.clearTube();
    this.overviewAnchor = null;
    this.overviewMoved = true;
    this.syncViewCutaway();
    const nav = this.city.navigation;
    if (nav) {
      nav.blur();
      nav.mode = 'orbit';
      nav.walker.group.visible = false;
    }
    this.city.travelReturn?.releaseForPlacement();
    this.city.interactions?.clear();
    this.publish();
    return true;
  }
  setOverview(enabled: boolean) {
    if (!this.active) return false;
    if (enabled && this.city.settings.mode === 'orbit') {
      this.observeOverviewMoved();
      this.syncViewCutaway();
      return true;
    }
    if (!enabled && !this.canResumeOverview) return false;
    this.clearInput();
    if (enabled) {
      const origin = this.interactionOrigin;
      if (!origin) return false;
      const target = new THREE.Vector3(
        origin[0],
        this.city.elevation(origin[0], origin[2]) + 2,
        origin[2],
      );
      this.city.settings = {
        ...this.city.settings,
        mode: 'orbit',
        autoRotate: false,
      };
      this.city.controls.target.copy(target);
      this.overviewAnchor = target.clone();
      this.overviewMoved = false;
      this.city.camera.position
        .copy(target)
        .add(new THREE.Vector3(180, 230, 240));
      this.owner?.updateCutaway(
        this.city.camera.position,
        this.aboard ? null : (this.foot?.position[1] ?? null),
      );
      this.city.camera.near = 2;
      this.city.camera.fov = 48;
      this.city.camera.updateProjectionMatrix();
      this.city.controls.enabled = true;
      this.city.controls.update();
      this.syncViewCutaway();
      this.city.onLocalOrbit();
    } else {
      this.overviewAnchor = null;
      this.overviewMoved = false;
      this.city.settings = {
        ...this.city.settings,
        mode: 'walk',
        autoRotate: false,
      };
      this.city.onTravelResume('walk');
      this.updateCamera();
    }
    this.publish();
    return true;
  }
  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const next = zoomTravel(this.distanceView, factor);
    this.distanceView = next.distance;
    if (next.exit) {
      this.setOverview(true);
      return;
    }
    this.updateCamera();
  }
  private worldWheel = (event: WheelEvent) => {
    if (
      !this.active ||
      this.city.settings.mode !== 'walk' ||
      !this.inputEnabled ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY * 0.003, -0.7, 0.7)));
  };
  protected updateCamera() {
    if (!this.active || this.city.settings.mode !== 'walk') {
      this.syncViewCutaway();
      return;
    }
    const origin = this.interactionOrigin;
    if (!origin) return;
    const third = !firstPerson('walk', this.distanceView),
      viewPitch = third
        ? -Math.atan(0.28) - THREE.MathUtils.clamp(-this.pitch, -0.22, 1.1)
        : this.pitch,
      feet = new THREE.Vector3(...origin),
      bodyQuaternion = new THREE.Quaternion(),
      eye = feet.clone(),
      direction = travelLookDirection(
        this.yaw + this.lookYaw + (this.aboard ? 0 : (this.owner?.yaw ?? 0)),
        viewPitch,
      );
    if (this.aboard) {
      this.train.setPassengerLocal(
        this.cabinSeat?.position ?? this.cabinFoot!,
        this.cabinSeat?.eyeHeight ?? 1.65,
        this.cabinSeat?.eyeOffsetXZ,
      );
      this.train.passengerWorldPose(eye, bodyQuaternion);
      direction.applyQuaternion(bodyQuaternion);
    } else {
      bodyQuaternion.copy(this.owner!.group.quaternion);
      eye.y += this.stationSeat ? 1.15 : 1.65;
    }
    const avatarQuaternion = bodyQuaternion
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.yaw)),
      bodyUp = UP.clone().applyQuaternion(bodyQuaternion),
      bodyForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        avatarQuaternion,
      );
    let camera = eye,
      target = eye.clone().add(direction),
      fov = 65;
    if (third) {
      const seated = this.passengerSeated,
        seatHeight =
          this.cabinSeat?.seatHeight ?? this.stationSeat?.seatHeight ?? 0.46,
        pivot = feet
          .clone()
          .addScaledVector(bodyUp, seated ? seatHeight + 0.43 : 1.13),
        distance = Math.min(14, this.distanceView),
        right = new THREE.Vector3(1, 0, 0).applyQuaternion(avatarQuaternion),
        shoulders = feet
          .clone()
          .addScaledVector(bodyUp, seated ? seatHeight + 0.68 : 1.42),
        anchors = [
          feet
            .clone()
            .addScaledVector(bodyUp, seated ? seatHeight + 1.02 : 1.88),
          feet
            .clone()
            .addScaledVector(bodyUp, 0.04)
            .addScaledVector(bodyForward, seated ? 0.6 : 0),
          shoulders.clone().addScaledVector(right, 0.35),
          shoulders.clone().addScaledVector(right, -0.35),
        ];
      // Requested heading and pitch own the chase ray. Occluders are handled
      // during rendering, so stairs, chairs and roofs cannot orbit the camera.
      camera = pivot.clone().addScaledVector(direction, -distance);
      target = pivot;
      const inverseView = new THREE.Quaternion()
          .setFromRotationMatrix(new THREE.Matrix4().lookAt(camera, target, UP))
          .invert(),
        local = new THREE.Vector3(),
        aspect = Math.max(0.25, this.city.camera.aspect);
      let tangent = Math.tan(THREE.MathUtils.degToRad(55) / 2);
      for (const anchor of anchors) {
        local.copy(anchor).sub(camera).applyQuaternion(inverseView);
        const depth = Math.max(0.08, -local.z);
        tangent = Math.max(
          tangent,
          Math.abs(local.y) / (depth * 0.88),
          Math.abs(local.x) / (depth * aspect * 0.88),
        );
      }
      fov = Math.min(100, THREE.MathUtils.radToDeg(2 * Math.atan(tangent)));
    }
    // The requested chase pose is preserved by whole-object occlusion. Use
    // that exact pose for the authored station's higher roof cutaway too.
    this.owner?.updateCutaway(
      camera,
      !this.aboard && third ? this.owner.toLocal(feet.toArray())[1] : null,
    );
    delete this.city.camera.userData.skyTrainBodyView;
    this.city.camera.near = 0.05;
    this.city.camera.fov = fov;
    this.city.camera.updateProjectionMatrix();
    this.city.camera.position.copy(camera);
    this.city.camera.up.copy(UP);
    this.city.camera.lookAt(target);
    this.city.controls.target.copy(target);
    this.city.controls.enabled = false;
    this.syncViewCutaway();
    const nav = this.city.navigation;
    if (nav) {
      nav.position.copy(feet);
      const walker = nav.walker;
      if (this.avatarSeated !== this.passengerSeated) {
        walker.setSeated?.(
          this.passengerSeated,
          this.cabinSeat?.seatHeight ?? this.stationSeat?.seatHeight ?? 0.46,
        );
        this.avatarSeated = this.passengerSeated;
      }
      walker.group.position.copy(feet);
      walker.group.quaternion.copy(avatarQuaternion);
      walker.group.visible = third;
    }
    this.city.renderer.domElement.setAttribute(
      'data-camera-view',
      third ? 'third-person' : 'first-person',
    );
  }
  /** The render-only city opening follows the actual requested view. Source
   * floor footprints and physical station ceilings remain independently owned. */
  private syncViewCutaway() {
    const revealing =
      this.active &&
      !this.aboard &&
      this.owner &&
      this.foot &&
      (this.city.settings.mode === 'orbit' ||
        (this.city.settings.mode === 'walk' &&
          !firstPerson('walk', this.distanceView)));
    this.openings?.setViewCutaway(
      revealing ? this.owner : null,
      revealing ? this.city.camera.position.y + 0.2 : undefined,
      revealing ? this.city.camera.position : undefined,
    );
  }
  /** Composer creation and station loading may complete in either order.
   * A disposed/replaced composer unregisters even before station data arrives. */
  prepareGroundOpeningMaterial(material: THREE.Material) {
    if (this.disposed) return () => {};
    let registration = this.groundOpeningMaterials.get(material);
    if (!registration) {
      const entry: GroundOpeningMaterial = {
        references: 0,
        restore: this.openings?.prepareGroundMaterial(material),
        disposed: () => {
          if (this.groundOpeningMaterials.get(material) !== entry) return;
          entry.restore?.();
          material.removeEventListener('dispose', entry.disposed);
          this.groundOpeningMaterials.delete(material);
        },
      };
      registration = entry;
      this.groundOpeningMaterials.set(material, entry);
      material.addEventListener('dispose', entry.disposed);
    }
    const entry = registration;
    entry.references++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.groundOpeningMaterials.get(material) !== entry) return;
      if (--entry.references === 0) entry.disposed();
    };
  }
  private bindGroundOpeningMaterials() {
    for (const [material, entry] of this.groundOpeningMaterials)
      entry.restore ??= this.openings?.prepareGroundMaterial(material);
  }
  dispose() {
    this.city.renderer.domElement.removeEventListener(
      'wheel',
      this.worldWheel,
      true,
    );
    this.openings?.setViewCutaway(null);
    for (const entry of this.groundOpeningMaterials.values()) entry.disposed();
    this.openings?.dispose();
    for (const visuals of this.constructionVisuals.values()) visuals.dispose();
    this.constructionVisuals.clear();
    this.constructionAccess.clear();
    this.lightPool.forEach((light) => light.removeFromParent());
    const activeTrain = this.train;
    for (const v of this.fleet) {
      v.exterior.dispose();
      if (v.detail && v.detail !== activeTrain) v.detail.dispose();
    }
    if (this.previewTrain !== activeTrain) this.previewTrain.dispose();
    this.fleet = [];
    this.occupied = null;
    this.exteriors.dispose();
    super.dispose();
  }
}
