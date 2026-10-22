import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { CityBusAssets } from './bus-assets';
import type { BusRoute } from './city-buses';
import type { PlacementPoint } from './placement-geometry';
import {
  resolveSurfaceStep,
  type SurfaceState,
  type SurfaceHit,
} from './surface-reachability';
import {
  PassengerTransfers,
  boardingProofValid,
  type BoardingProof,
} from './city-life/passenger-transfers';
import {
  passengerContractFromManifest,
  type VehiclePassengerContract,
} from './city-life/vehicle-profile-adapter';
import {
  BusPassengerSpace,
  type BusPassengerSeat,
} from './bus-passenger-space';
import type { InteractionCandidate } from './proximity-interactions';
import {
  BusAccessibility,
  rampContainsPoint,
  type BusAccessibilitySnapshot,
} from './bus-accessibility';
import {
  busVisitProfile,
  type BusVisitPolicy,
  type BusVisitProfile,
} from './bus-visit-policy';

const VISITOR = 'city-bus-visitor';
const VEHICLE = 'parked-city-bus';
const CAR = 'parked-city-bus-car';
const SERVICE = 'parked-interior-visit';
type Point = [number, number, number];
interface BusBounds {
  min: Point;
  max: Point;
}
type Owner = Awaited<ReturnType<CityBusAssets['loadBoardable']>>;
type Phase = 'idle' | 'loading' | 'ready' | 'aboard' | 'error';
interface Door {
  id: string;
  group: 'front' | 'rear';
  node: THREE.Object3D;
  point: Point;
  end: Point;
  duration: number;
  start: number;
  action: THREE.AnimationAction;
}
export interface BusVisitSnapshot {
  phase: Phase;
  status: Phase;
  loading: boolean;
  error: string | null;
  canBoard: boolean;
  canAlight: boolean;
  aboard: boolean;
  doorsOpen: boolean;
  anchors: {
    id: string;
    kind: 'seat' | 'standing';
    datum: 'pelvis' | 'feet';
  }[];
  /** Physical passenger anchor; seat changes require a nearby interaction. */
  viewAnchor: string | null;
  previewAnchor: string | null;
  passengerAnchor: string | null;
  routeIndex: number | null;
  profile: BusVisitProfile | null;
  requestedProfile: BusVisitProfile | null;
  fallback: boolean;
  accessibility?: BusAccessibilitySnapshot | null;
  seated: boolean;
  canWalkCabin: boolean;
  canRide: boolean;
  ridePhase: 'parked' | 'closing' | 'moving' | 'opening' | 'complete';
  speedMps: number;
  rideProgress: number;
}
export interface BusVisitPlacement {
  routeIndex: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  yaw: number;
  frontFloor: SurfaceState;
  rearFloor: SurfaceState;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid bus metadata');
  return value as Record<string, unknown>;
};
const point = (value: unknown): Point => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new Error('Invalid bus point');
  return [...value] as Point;
};
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value)
    throw new Error('Missing bus identity');
  return value;
};
const bounds = (value: unknown): BusBounds => {
  const data = record(value),
    min = point(data.min),
    max = point(data.max);
  if (min.some((v, i) => v >= max[i])) throw new Error('Invalid bus bounds');
  return { min, max };
};
/** Exact ground identity only: protected bridge/deck/interior floors are never
 * inferred from a nearby height or accepted as a parking/exit surface. */
function groundFloor(
  city: CityEngine,
  x: number,
  z: number,
  mode: 'walk' | 'drive',
) {
  const nav = city.navigation;
  if (
    !nav ||
    ![x, z].every(Number.isFinite) ||
    !nav.clearGround(x, z, mode, true) ||
    city.interiors?.height(x, z) !== undefined ||
    city.data.travelSurfaces
      ?.lookup(x, z)
      .some((hit: SurfaceHit) => hit.surfaceId !== 'ground')
  )
    return null;
  const y = nav.groundHeight(x, z);
  return Number.isFinite(y) ? { x, y, z, surfaceId: 'ground', layer: 0 } : null;
}
function walkClearance(city: CityEngine, floor: SurfaceState) {
  for (const [dx, dz] of [
    [0, 0],
    [-0.32, 0],
    [0.32, 0],
    [0, -0.32],
    [0, 0.32],
  ]) {
    const hit = groundFloor(city, floor.x + dx, floor.z + dz, 'walk');
    if (!hit || Math.abs(hit.y - floor.y) > 0.12) return false;
  }
  return true;
}
const worldPoint = (
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  p: Point,
) => new THREE.Vector3(...p).applyQuaternion(rotation).add(position);

/** Select a flat stretch of an existing displayed source road, checking the
 * complete bus footprint and both door-side walking exits before allocating it. */
export function findBusVisitPlacement(
  city: CityEngine,
  routes: readonly BusRoute[],
  front: Point = [-1.7, 0.36, 4.6],
  rear: Point = [-1.7, 0.36, -1.85],
  fullBounds: BusBounds = {
    min: [-1.52, 0, -6.3],
    max: [1.52, 3.2, 6.1],
  },
  prefer?: (placement: BusVisitPlacement) => boolean,
): BusVisitPlacement | null {
  let fallback: BusVisitPlacement | null = null;
  const rearEdge = fullBounds.min[2] - 0.03,
    frontEdge = fullBounds.max[2] + 0.03,
    intervals = Math.ceil((frontEdge - rearEdge) / 1.5);
  const origin =
    city.navigation?.mode === 'walk'
      ? city.navigation.position
      : city.controls.target;
  const indices = routes
    .slice(0, 64)
    .map((r, index) => ({ r, index }))
    .filter(
      ({ r }) =>
        r.length >= 40 && [...r.a, ...r.b, r.length].every(Number.isFinite),
    )
    .sort((a, b) => {
      const distance = ({ r }: typeof a) =>
        Math.hypot(
          (r.a[0] + r.b[0]) / 2 - origin.x,
          (r.a[1] + r.b[1]) / 2 - origin.z,
        );
      return distance(a) - distance(b);
    });
  for (const { r, index } of indices) {
    const yaw = Math.atan2(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw,
    );
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const x = THREE.MathUtils.lerp(r.a[0], r.b[0], t);
      const z = THREE.MathUtils.lerp(r.a[1], r.b[1], t);
      const contact = groundFloor(city, x, z, 'drive');
      if (!contact) continue;
      const position = new THREE.Vector3(x, contact.y, z);
      let clear = true;
      for (let i = 0; i <= intervals; i++) {
        if (!clear) break;
        const longitudinal = THREE.MathUtils.lerp(
          rearEdge,
          frontEdge,
          i / intervals,
        );
        for (const lateral of [
          fullBounds.min[0] - 0.03,
          (fullBounds.min[0] + fullBounds.max[0]) / 2,
          fullBounds.max[0] + 0.03,
        ]) {
          const sample = worldPoint(position, rotation, [
            lateral,
            0,
            longitudinal,
          ]);
          const hit = groundFloor(city, sample.x, sample.z, 'drive');
          if (!hit || Math.abs(hit.y - contact.y) > 0.12) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;
      const outside = (local: Point) => {
        const p = worldPoint(position, rotation, local);
        const floor = groundFloor(city, p.x, p.z, 'walk');
        return floor &&
          Math.abs(floor.y - contact.y) <= 0.12 &&
          walkClearance(city, floor)
          ? floor
          : null;
      };
      const frontFloor = outside(front),
        rearFloor = outside(rear);
      if (frontFloor && rearFloor) {
        const placement = {
          routeIndex: index,
          position,
          rotation,
          yaw,
          frontFloor,
          rearFloor,
        };
        fallback ??= placement;
        if (!prefer || prefer(placement)) return placement;
      }
    }
  }
  return fallback;
}

/** A boardable cabin with physical seating and a short, verified street ride.
 * This uses a displayed road segment, not a scheduled TransLink route. */
export class BusCabinVisit {
  onChange: (snapshot: BusVisitSnapshot) => void = () => {};
  private phase: Phase = 'idle';
  private error = '';
  private owner: Owner | null = null;
  private contract: VehiclePassengerContract | null = null;
  private placement: BusVisitPlacement | null = null;
  private bodyBounds: BusBounds | null = null;
  private accessibility: BusAccessibility | null = null;
  private transfers = new PassengerTransfers(1);
  private doors: Door[] = [];
  private elapsed = 0;
  private doorProgress = 0;
  private stoppedSeconds = 0;
  private viewAnchor: string | null = null;
  private previewAnchor: string | null = null;
  private generation = 0;
  private pending: Promise<boolean> | null = null;
  private abort: AbortController | null = null;
  private disposed = false;
  private resumeAnchor = false;
  private yaw = 0;
  private pitch = 0;
  private drag: { id: number; x: number; y: number } | null = null;
  private space: BusPassengerSpace | null = null;
  private cabinFoot: Point | null = null;
  private cabinSeat: BusPassengerSeat | null = null;
  private cabinStand: Point | null = null;
  private standingAnchor: string | null = null;
  private lookYaw = 0;
  private inputEnabled = true;
  private keys = new Set<string>();
  private axes = { x: 0, y: 0 };
  private walkDistance = 0;
  private avatarSeated = false;
  private ridePlan: {
    points: THREE.Vector3[];
    length: number;
    duration: number;
  } | null = null;
  private ridePhase: BusVisitSnapshot['ridePhase'] = 'parked';
  private rideTime = 0;
  private rideSpeed = 0;
  private rideProgress = 0;
  constructor(
    private city: CityEngine,
    private busAssets: CityBusAssets,
    private routes: readonly BusRoute[],
  ) {
    window.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('pointermove', this.pointerMove, true);
    window.addEventListener('pointerup', this.pointerUp, true);
    window.addEventListener('pointercancel', this.pointerUp, true);
    window.addEventListener('wheel', this.wheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener('keydown', this.keyDown, true);
    window.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
  }
  get aboard() {
    return this.transfers.state(VISITOR)?.mode === 'riding';
  }
  get passengerSeated() {
    return Boolean(this.cabinSeat);
  }
  get speedMps() {
    return this.rideSpeed;
  }
  get interactionOrigin(): Point | null {
    if (!this.aboard || !this.owner || !this.cabinFoot || this.hidden())
      return null;
    return this.owner.interiorRoot
      .localToWorld(
        new THREE.Vector3(...(this.cabinSeat?.position ?? this.cabinFoot)),
      )
      .toArray() as Point;
  }
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.clearInput();
  }
  setTouchAxes(x: number, y: number) {
    const axis = (v: number) =>
      Number.isFinite(v) ? THREE.MathUtils.clamp(v, -1, 1) : 0;
    this.axes =
      this.aboard && this.inputEnabled && !this.passengerSeated
        ? { x: axis(x), y: axis(y) }
        : { x: 0, y: 0 };
  }
  clearInput = () => {
    this.keys.clear();
    this.axes = { x: 0, y: 0 };
    this.drag = null;
  };
  interactionCandidates(): readonly InteractionCandidate[] {
    const origin = this.interactionOrigin;
    if (
      !origin ||
      !this.inputEnabled ||
      this.disposed ||
      !this.space ||
      !this.cabinFoot ||
      !this.owner
    )
      return [];
    if (this.cabinSeat)
      return [
        {
          id: 'bus:stand',
          kind: 'seat',
          action: 'stand',
          anchor: [origin[0], origin[1] + 1, origin[2]],
          proximityPoint: origin,
          range: 1.5,
          priority: 100,
          canInteract: () =>
            this.aboard &&
            this.inputEnabled &&
            !this.hidden() &&
            this.passengerSeated,
          execute: () => this.stand(),
        },
      ];
    const owner = this.owner,
      space = this.space;
    return space.seats
      .filter((seat) => space.canSit(seat, this.cabinFoot!))
      .map((seat) => ({
        id: `bus:seat:${seat.id}`,
        kind: 'seat' as const,
        action: 'sit',
        anchor: owner.interiorRoot
          .localToWorld(
            new THREE.Vector3(
              seat.position[0],
              seat.position[1] + seat.seatHeight + 1.05,
              seat.position[2],
            ),
          )
          .toArray() as Point,
        proximityPoint: owner.interiorRoot
          .localToWorld(new THREE.Vector3(...seat.position))
          .toArray() as Point,
        range: 1.5,
        canInteract: () =>
          this.owner === owner &&
          this.space === space &&
          this.aboard &&
          this.inputEnabled &&
          !this.hidden() &&
          !this.cabinSeat &&
          Boolean(this.cabinFoot && space.canSit(seat, this.cabinFoot)),
        execute: () => this.sit(seat),
      }));
  }
  private sit(seat: BusPassengerSeat) {
    if (
      !this.aboard ||
      !this.owner ||
      !this.space ||
      !this.cabinFoot ||
      this.cabinSeat ||
      !this.inputEnabled ||
      this.hidden() ||
      !this.space.seats.includes(seat) ||
      !this.space.canSit(seat, this.cabinFoot)
    )
      return false;
    const anchor = this.contract?.anchors.find(
      (row) => row.anchor.anchorId === seat.id,
    );
    const stand = this.space.safeStand(this.cabinFoot);
    if (
      !anchor ||
      !stand ||
      !this.transfers.changeRideAnchor(VISITOR, anchor.anchor)
    )
      return false;
    this.cabinStand = stand;
    this.cabinSeat = seat;
    this.viewAnchor = seat.id;
    this.previewAnchor = null;
    this.yaw = seat.yaw;
    this.lookYaw = 0;
    this.clearInput();
    this.updateCamera();
    this.notify();
    return true;
  }
  stand() {
    if (
      !this.aboard ||
      !this.cabinSeat ||
      !this.cabinStand ||
      !this.space ||
      !this.inputEnabled ||
      this.hidden() ||
      !this.space.clear(this.cabinStand)
    )
      return false;
    const anchor = this.contract?.anchors.find(
      (row) => row.anchor.anchorId === this.standingAnchor,
    );
    if (!anchor || !this.transfers.changeRideAnchor(VISITOR, anchor.anchor))
      return false;
    this.cabinFoot = [...this.cabinStand];
    this.cabinSeat = null;
    this.cabinStand = null;
    this.viewAnchor = this.standingAnchor;
    this.previewAnchor = null;
    this.lookYaw = 0;
    this.clearInput();
    this.updateCamera();
    this.notify();
    return true;
  }
  get routeIndex() {
    return this.placement?.routeIndex ?? null;
  }
  private hidden() {
    return document.hidden || this.city.pageSuspended || this.city.contextLost;
  }
  prepare(policy?: BusVisitPolicy): Promise<boolean> {
    if (this.disposed || this.hidden()) return Promise.resolve(false);
    if (this.accessibility && !this.accessibility.stowed)
      return Promise.resolve(
        this.reject('Stow the access ramp before changing the bus'),
      );
    if (this.aboard) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const profile = policy ? busVisitProfile(policy) : 'budget';
    if (this.owner && this.placement) {
      if ((this.owner.requestedProfile ?? 'budget') === profile) {
        const floor = this.freshOutside('front');
        if (!floor) return Promise.resolve(this.reject('No safe bus entrance'));
        return Promise.resolve(this.placeWalker(floor));
      }
      // A different preboarding choice starts a fresh visit. Riders keep their
      // existing owner, camera and reservations via the early aboard return.
      this.release();
    }
    const generation = ++this.generation;
    this.abort = new AbortController();
    this.phase = 'loading';
    this.error = '';
    this.notify();
    const run = async () => {
      let owner: Owner | null = null;
      try {
        owner = await this.busAssets.loadBoardable({
          signal: this.abort!.signal,
          profile,
        });
        if (this.disposed || generation !== this.generation || this.hidden()) {
          owner.dispose();
          if (!this.disposed && generation === this.generation) {
            this.phase = 'idle';
            this.notify();
          }
          return false;
        }
        const contract = passengerContractFromManifest(
          owner.manifest,
          'city-bus-12m',
          'low-floor-bus-12m',
          VEHICLE,
          CAR,
          0,
        );
        const vehicle = record(owner.vehicle);
        if (owner.cabinSurfaces) {
          const aisleCamera = Array.isArray(vehicle.cameraAnchors)
            ? vehicle.cameraAnchors
                .map(record)
                .find((camera) => camera.cameraId === 'camera-aisle')
            : undefined;
          if (!aisleCamera || aisleCamera.frameId !== 'vehicle')
            throw new Error('Missing bus standing camera anchor');
          const eye = point(aisleCamera.eyePointM),
            cameraNode = owner.interiorRoot.getObjectByName(
              text(aisleCamera.nodeId),
            );
          if (
            !cameraNode ||
            cameraNode
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(new THREE.Vector3(...eye)) > 1e-4
          )
            throw new Error('Bus standing camera differs from actual GLB');
          for (const anchor of contract.anchors) {
            if (anchor.datum !== 'feet') continue;
            const [x, y, z] = anchor.anchor.translationM,
              floor = owner.cabinSurfaces.floorAt(x, z);
            if (
              !floor ||
              Math.abs(floor.heightM - y) > 0.003 ||
              !owner.cabinSurfaces.canStand(x, z)
            )
              throw new Error(
                'Bus standing anchor lacks actual floor or clearance',
              );
            // Preserve the authored aisle camera's explicit eye datum; the
            // generic adapter's feet-to-eye fallback is only for legacy visits.
            anchor.cameraEyePointM = [...eye];
          }
        }
        if (!Array.isArray(vehicle.doors)) throw new Error('Missing bus doors');
        const doors: Door[] = vehicle.doors.map((value) => {
          const d = record(value),
            motion = record(d.motion);
          const node = owner!.group.getObjectByName(text(d.nodeId));
          const clip = THREE.AnimationClip.findByName(
            [...owner!.animations],
            text(d.animationClip),
          );
          if (
            !node ||
            !clip ||
            !clip.tracks.length ||
            d.frameId !== 'vehicle' ||
            d.side !== 'right' ||
            !['front', 'rear'].includes(String(d.doorGroupId)) ||
            !Array.isArray(motion.keyframes)
          )
            throw new Error('Missing actual bus door animation');
          const start = Math.min(...clip.tracks.map((track) => track.times[0]));
          const end = Math.max(
            ...clip.tracks.map((track) => track.times[track.times.length - 1]),
          );
          const duration = Number(motion.durationS);
          if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            Math.abs(end - start - duration) > 1e-4
          )
            throw new Error('Bus door interval mismatch');
          const action = owner!.mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          action.paused = true;
          return {
            id: text(d.doorId),
            group: d.doorGroupId as 'front' | 'rear',
            node,
            point: point(d.boardingPointM),
            duration,
            start,
            action,
            end: point(
              record(record(motion.keyframes.at(-1)).transform).translationM,
            ),
          };
        });
        if (
          doors.length !== 4 ||
          new Set(doors.map((door) => door.id)).size !== 4 ||
          !doors.some((d) => d.group === 'front') ||
          !doors.some((d) => d.group === 'rear')
        )
          throw new Error('Incomplete bus door contract');
        const space = new BusPassengerSpace(
          owner.interiorRoot,
          vehicle,
          contract.anchors,
          owner.cabinSurfaces,
        );
        if (!space.spawn()) throw new Error('Bus has no safe aisle spawn');
        const placement = findBusVisitPlacement(
          this.city,
          this.routes,
          doors.find((d) => d.group === 'front')!.point,
          doors.find((d) => d.group === 'rear')!.point,
          bounds(vehicle.fullBoundsM),
          owner.manifest.accessibility
            ? (candidate) => {
                owner!.group.position.copy(candidate.position);
                owner!.group.quaternion.copy(candidate.rotation);
                const probe = BusAccessibility.create(
                  owner!.group,
                  owner!.manifest.accessibility,
                  (x, z) => this.rampGround(x, z),
                );
                if (!probe) return true;
                try {
                  return probe.landingFits();
                } finally {
                  probe.dispose();
                }
              }
            : undefined,
        );
        if (!placement) throw new Error('No safe flat bus parking and exit');
        const bodyBounds = bounds(vehicle.bodyBoundsM);
        const transfers = new PassengerTransfers(1);
        if (!transfers.register(VISITOR, placement.frontFloor))
          throw new Error('Invalid entrance floor');
        owner.group.position.copy(placement.position);
        owner.group.quaternion.copy(placement.rotation);
        owner.group.name = 'Boardable city bus cabin';
        const cabinLight = new THREE.PointLight(0xffecd1, 4, 12, 2);
        cabinLight.position.set(0, 2.45, 0);
        cabinLight.castShadow = false;
        cabinLight.name = 'Single parked cabin light';
        owner.group.add(cabinLight);
        owner.group.updateWorldMatrix(true, true);
        this.owner = owner;
        this.contract = contract;
        this.space = space;
        this.doors = doors;
        this.placement = placement;
        this.bodyBounds = bodyBounds;
        this.transfers = transfers;
        this.elapsed = 0;
        this.doorProgress = 0;
        this.stoppedSeconds = 0;
        this.ridePhase = 'parked';
        this.rideSpeed = this.rideTime = this.rideProgress = 0;
        this.ridePlan = this.planRide();
        this.city.scene.add(owner.group);
        this.accessibility = BusAccessibility.create(
          owner.group,
          owner.manifest.accessibility,
          (x, z) => this.rampGround(x, z),
          (surface) => {
            const walker = this.city.navigation;
            return (
              this.aboard ||
              !walker ||
              walker.mode !== 'walk' ||
              !rampContainsPoint(surface, walker.position.x, walker.position.z)
            );
          },
          (area) =>
            this.city.navigation?.groundSurface?.trianglesInBounds?.(area) ??
            null,
        );
        this.busAssets.setExcludedRoutes(new Set([placement.routeIndex]));
        this.phase = 'ready';
        this.error = '';
        if (!this.placeWalker(placement.frontFloor))
          throw new Error('Cannot place visitor at entrance');
        this.applyDoors();
        this.notify();
        return true;
      } catch (error) {
        this.accessibility?.dispose();
        this.accessibility = null;
        owner?.dispose();
        if (generation === this.generation && !this.disposed) {
          this.owner = null;
          this.contract = null;
          this.space = null;
          this.ridePlan = null;
          this.placement = null;
          this.bodyBounds = null;
          this.doors = [];
          this.busAssets.setExcludedRoutes(new Set());
          this.phase = 'error';
          this.error =
            error instanceof Error ? error.message : 'Bus load failed';
          this.notify();
        }
        return false;
      } finally {
        if (generation === this.generation) {
          this.pending = null;
          this.abort = null;
        }
      }
    };
    this.pending = run();
    return this.pending;
  }
  private roadStop(position: THREE.Vector3) {
    if (!this.owner || !this.placement) return null;
    const vehicle = record(this.owner.vehicle),
      full = bounds(vehicle.fullBoundsM);
    const center = groundFloor(this.city, position.x, position.z, 'drive');
    if (!center) return null;
    const origin = new THREE.Vector3(center.x, center.y, center.z),
      rotation = this.placement.rotation;
    const count = Math.ceil((full.max[2] - full.min[2] + 0.06) / 1.5);
    for (let i = 0; i <= count; i++)
      for (const lateral of [
        full.min[0] - 0.03,
        (full.min[0] + full.max[0]) / 2,
        full.max[0] + 0.03,
      ]) {
        const sample = worldPoint(origin, rotation, [
          lateral,
          0,
          THREE.MathUtils.lerp(
            full.min[2] - 0.03,
            full.max[2] + 0.03,
            i / count,
          ),
        ]);
        const floor = groundFloor(this.city, sample.x, sample.z, 'drive');
        if (!floor || Math.abs(floor.y - origin.y) > 0.12) return null;
      }
    const outside = (group: 'front' | 'rear') => {
      const door = this.doors.find((d) => d.group === group);
      if (!door) return null;
      const sample = worldPoint(origin, rotation, door.point),
        floor = groundFloor(this.city, sample.x, sample.z, 'walk');
      return floor &&
        Math.abs(floor.y - origin.y) <= 0.12 &&
        walkClearance(this.city, floor)
        ? floor
        : null;
    };
    const frontFloor = outside('front'),
      rearFloor = outside('rear');
    return frontFloor && rearFloor
      ? { position: origin, frontFloor, rearFloor }
      : null;
  }
  /** Validate the complete footprint and both eventual exits along one existing
   * displayed road edge. No wrapping, invented stop, jump or U-turn is used. */
  private planRide() {
    if (
      !this.owner ||
      !this.placement ||
      !this.roadStop(this.owner.group.position) ||
      this.owner.group.position.distanceTo(this.placement.position) > 1e-5 ||
      Math.abs(this.owner.group.quaternion.dot(this.placement.rotation)) <
        1 - 1e-8
    )
      return null;
    const route = this.routes[this.placement.routeIndex];
    if (!route) return null;
    const dx = route.b[0] - route.a[0],
      dz = route.b[1] - route.a[1],
      length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length <= 0) return null;
    const full = bounds(record(this.owner.vehicle).fullBoundsM);
    const along =
      ((this.placement.position.x - route.a[0]) * dx +
        (this.placement.position.z - route.a[1]) * dz) /
      length;
    const available = Math.min(60, length - along - full.max[2] - 1);
    if (along < full.max[2] || available < 6) return null;
    const points = [this.placement.position.clone()];
    let distance = 0;
    for (let d = 1.5; d <= available + 1.5; d += 1.5) {
      const nextDistance = Math.min(d, available);
      const target = this.placement.position
        .clone()
        .add(
          new THREE.Vector3(dx / length, 0, dz / length).multiplyScalar(
            nextDistance,
          ),
        );
      const stop = this.roadStop(target);
      if (!stop) break;
      points.push(stop.position);
      distance = nextDistance;
      if (nextDistance === available) break;
    }
    return distance >= 6
      ? { points, length: distance, duration: Math.max(4, distance / 4) }
      : null;
  }
  startRide() {
    if (
      this.disposed ||
      this.hidden() ||
      !this.inputEnabled ||
      !this.aboard ||
      !this.owner ||
      !this.placement ||
      this.ridePhase !== 'parked' ||
      !this.actualDoorsOpen() ||
      (this.accessibility && !this.accessibility.stowed)
    )
      return false;
    // The preflight cache is for UI availability only. Recheck the world before
    // departure, retaining the parked owner and passenger on any failure.
    const plan = this.planRide();
    if (!plan) {
      this.ridePlan = null;
      this.notify();
      return false;
    }
    this.ridePlan = plan;
    this.ridePhase = 'closing';
    this.rideTime = this.rideSpeed = this.rideProgress = 0;
    this.stoppedSeconds = 0;
    this.error = '';
    this.clearInput();
    this.notify();
    return true;
  }
  private updateRide(h: number) {
    if (!this.owner || !this.placement) return;
    if (this.ridePhase === 'closing') {
      this.doorProgress = Math.max(0, this.doorProgress - h);
      this.stoppedSeconds = 0;
      if (this.doorProgress === 0) {
        this.ridePhase = 'moving';
        this.notify();
      }
      return;
    }
    if (this.ridePhase === 'moving' && this.ridePlan) {
      const plan = this.ridePlan;
      this.rideTime = Math.min(plan.duration, this.rideTime + h);
      const t = this.rideTime / plan.duration;
      this.rideProgress = t * t * (3 - 2 * t);
      this.rideSpeed = (6 * t * (1 - t) * plan.length) / plan.duration;
      const along = this.rideProgress * plan.length;
      const index = Math.min(plan.points.length - 2, Math.floor(along / 1.5));
      const a = plan.points[index],
        b = plan.points[index + 1];
      const startDistance = index * 1.5,
        segment = Math.hypot(b.x - a.x, b.z - a.z);
      this.owner.group.position
        .copy(a)
        .lerp(
          b,
          segment > 0
            ? THREE.MathUtils.clamp((along - startDistance) / segment, 0, 1)
            : 1,
        );
      this.owner.group.updateWorldMatrix(true, true);
      this.stoppedSeconds = 0;
      if (t === 1) {
        this.rideSpeed = 0;
        const endpoint = this.roadStop(this.owner.group.position);
        if (
          endpoint &&
          (!this.accessibility || this.accessibility.reanchorStowed())
        ) {
          this.placement.position.copy(endpoint.position);
          this.placement.frontFloor = endpoint.frontFloor;
          this.placement.rearFloor = endpoint.rearFloor;
        }
        // Even if an exit changed during motion, door proofs will reject it;
        // never relocate a passenger to an unverified ground floor.
        this.ridePhase = 'opening';
        this.notify();
      }
      return;
    }
    // Retry a changed arrival surface only in place, without moving the owner or
    // rider. A temporarily blocked endpoint can become usable when it clears.
    if (
      (this.ridePhase === 'opening' || this.ridePhase === 'complete') &&
      this.owner.group.position.distanceTo(this.placement.position) > 1e-5
    ) {
      const endpoint = this.roadStop(this.owner.group.position);
      if (
        endpoint &&
        (!this.accessibility || this.accessibility.reanchorStowed())
      ) {
        this.placement.position.copy(endpoint.position);
        this.placement.frontFloor = endpoint.frontFloor;
        this.placement.rearFloor = endpoint.rearFloor;
      }
    }
    this.stoppedSeconds += h;
    this.doorProgress = Math.min(1, this.doorProgress + h);
    if (this.ridePhase === 'opening' && this.doorProgress === 1) {
      this.ridePhase = 'complete';
      this.notify();
    }
  }
  update(dt: number) {
    if (this.disposed || !this.owner || this.hidden()) return;
    if (this.resumeAnchor) {
      this.resumeAnchor = false;
      return;
    }
    const h = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
    this.elapsed += h;
    this.updateRide(h);
    this.applyDoors();
    const accessibilityChanged = this.accessibility?.update(
      h,
      this.frontDoorsOpen(),
    );
    this.transfers.expire(this.elapsed);
    if (this.aboard) {
      if (
        !this.cabinSeat &&
        this.cabinFoot &&
        this.space &&
        this.inputEnabled
      ) {
        const left = Number(this.keys.has('a') || this.keys.has('arrowleft')),
          right = Number(this.keys.has('d') || this.keys.has('arrowright'));
        this.yaw += (left - right - this.axes.x) * 1.65 * h;
        const forward = THREE.MathUtils.clamp(
          Number(this.keys.has('w') || this.keys.has('arrowup')) -
            Number(this.keys.has('s') || this.keys.has('arrowdown')) +
            this.axes.y,
          -1,
          1,
        );
        const previous = this.cabinFoot;
        this.cabinFoot = this.space.walk(
          previous,
          Math.sin(this.yaw) * forward * 1.6 * h,
          Math.cos(this.yaw) * forward * 1.6 * h,
        );
        this.walkDistance += Math.hypot(
          ...this.cabinFoot.map((v, i) => v - previous[i]),
        );
      }
      this.updateCamera();
    } else {
      const floor = this.walkingFloor();
      if (floor) this.synchronizeWalkingFloor(floor);
    }
    if (accessibilityChanged) this.notify();
  }
  deployRamp() {
    if (
      this.disposed ||
      this.hidden() ||
      !this.owner ||
      !this.accessibility ||
      !this.inputEnabled ||
      (this.ridePhase !== 'parked' && this.ridePhase !== 'complete') ||
      this.stoppedSeconds < 0.5
    )
      return false;
    const accepted = this.accessibility.deploy(this.frontDoorsOpen());
    this.notify();
    return accepted;
  }
  stowRamp() {
    if (
      this.disposed ||
      this.hidden() ||
      !this.inputEnabled ||
      !this.owner ||
      !this.accessibility
    )
      return false;
    const accepted = this.accessibility.stow(this.frontDoorsOpen());
    this.notify();
    return accepted;
  }
  /** The optional legacy selection is validated, but boarding always enters the
   * physical aisle. Choosing a distant seat must not teleport a passenger. */
  board(anchorId?: string) {
    if (
      this.disposed ||
      this.hidden() ||
      this.accessibility?.moving ||
      this.aboard ||
      !this.owner ||
      !this.contract ||
      !this.space ||
      !this.inputEnabled
    )
      return false;
    if (
      anchorId &&
      !this.contract.anchors.some((a) => a.anchor.anchorId === anchorId)
    )
      return false;
    const spawn = this.space.spawn();
    const anchor =
      spawn &&
      this.contract.anchors
        .filter((a) => a.datum === 'feet')
        .sort(
          (a, b) =>
            Math.hypot(...a.anchor.translationM.map((v, i) => v - spawn[i])) -
            Math.hypot(...b.anchor.translationM.map((v, i) => v - spawn[i])),
        )[0];
    const floor = this.walkingFloor();
    if (!anchor || !spawn || !floor)
      return this.reject('Walk to the front door to board');
    if (!this.synchronizeWalkingFloor(floor))
      return this.reject('Walking floor changed during transfer');
    const token = this.transfers.beginBoard(
      VISITOR,
      anchor.anchor,
      this.proof('front', floor),
      this.elapsed,
    );
    if (!token) return this.reject('Bus entrance is not ready or clear');
    this.transfers.markPreloaded(token, this.elapsed);
    if (!this.transfers.commit(token, this.proof('front', floor), this.elapsed))
      return this.reject('Entrance changed; visitor remains on the ground');
    this.city.navigation!.blur();
    this.city.navigation!.walker.group.visible = false;
    this.city.navigation!.car.visible = false;
    this.city.controls.enabled = false;
    this.city.transition = null;
    this.cabinFoot = [...spawn];
    this.cabinSeat = null;
    this.cabinStand = null;
    this.standingAnchor = anchor.anchor.anchorId;
    this.viewAnchor = anchor.anchor.anchorId;
    this.previewAnchor = null;
    this.yaw = Math.PI;
    this.lookYaw = this.pitch = 0;
    this.clearInput();
    this.phase = 'aboard';
    this.error = '';
    this.updateCamera();
    this.notify();
    return true;
  }
  /** Legacy caller compatibility now uses the same physical proximity guard. */
  preview(anchorId: string) {
    if (!this.aboard || this.disposed || this.hidden() || !this.inputEnabled)
      return false;
    if (this.cabinSeat) return anchorId === this.cabinSeat.id;
    const seat = this.space?.seats.find((s) => s.id === anchorId);
    return seat ? this.sit(seat) : anchorId === this.standingAnchor;
  }
  alight() {
    if (!this.canAlight()) return false;
    const floor = this.freshOutside('rear');
    if (!floor) return this.reject('No safe bus exit; visitor stays aboard');
    const token = this.transfers.beginAlight(
      VISITOR,
      floor,
      this.proof('rear', floor),
      this.elapsed,
    );
    if (!token) return this.reject('Bus exit is not ready or clear');
    this.transfers.markPreloaded(token, this.elapsed);
    // The navigation adapter is fallible. Keep the seat reserved while it moves
    // to the validated exit; restore its source if placement/commit fails.
    const restoreNavigation = this.navigationRollback();
    let placed = false;
    try {
      placed = this.placeWalker(floor);
    } catch {
      /* Retain the rider below. */
    }
    if (!placed) {
      this.transfers.cancel(token);
      restoreNavigation();
      return this.reject('Cannot resume walking; visitor stays aboard');
    }
    if (
      !this.transfers.commit(token, this.proof('rear', floor), this.elapsed)
    ) {
      restoreNavigation();
      return this.reject('Exit changed; visitor stays aboard');
    }
    this.clearInput();
    this.resetPassenger();
    this.viewAnchor = this.previewAnchor = null;
    this.phase = 'ready';
    this.error = '';
    this.notify();
    return true;
  }
  /** Release the visit only after a rider reached freshly validated ground. */
  exit() {
    if (this.accessibility && !this.accessibility.stowed)
      return this.reject('Stow the access ramp before leaving the bus');
    if (this.aboard && !this.alight()) return false;
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.release();
    this.phase = 'idle';
    this.error = '';
    this.notify();
    return true;
  }
  close() {
    return this.exit();
  }
  snapshot(): BusVisitSnapshot {
    const passenger = this.transfers.state(VISITOR);
    const walking = this.walkingFloor();
    const exit = this.freshOutside('rear');
    return {
      phase: this.phase,
      status: this.phase,
      loading: this.phase === 'loading',
      error: this.error || null,
      aboard: this.aboard,
      doorsOpen: this.actualDoorsOpen(),
      canBoard:
        !this.hidden() &&
        !this.accessibility?.moving &&
        !this.aboard &&
        this.inputEnabled &&
        !!walking &&
        boardingProofValid(this.proof('front', walking)),
      canAlight: this.canAlight(exit),
      anchors:
        this.contract?.anchors.map((a) => ({
          id: a.anchor.anchorId,
          kind: a.anchor.kind,
          datum: a.datum,
        })) ?? [],
      viewAnchor: this.viewAnchor,
      previewAnchor: this.previewAnchor,
      passengerAnchor:
        passenger?.mode === 'riding' ? passenger.anchor.anchorId : null,
      routeIndex: this.routeIndex,
      profile: this.owner?.profile ?? null,
      requestedProfile: this.owner?.requestedProfile ?? null,
      fallback: this.owner?.fallback ?? false,
      accessibility: this.accessibility?.snapshot() ?? null,
      seated: this.passengerSeated,
      canWalkCabin:
        this.aboard &&
        !this.passengerSeated &&
        this.inputEnabled &&
        !this.hidden(),
      canRide:
        this.aboard &&
        this.inputEnabled &&
        !this.hidden() &&
        this.ridePhase === 'parked' &&
        this.actualDoorsOpen() &&
        (!this.accessibility || this.accessibility.stowed) &&
        Boolean(this.ridePlan),
      ridePhase: this.ridePhase,
      speedMps: this.rideSpeed,
      rideProgress: this.rideProgress,
    };
  }
  /** Static body collision for the host navigation; the doors are approached outside it. */
  blocksGround(x: number, z: number) {
    if (this.accessibility?.blocksGround(x, z)) return true;
    if (!this.owner || !this.bodyBounds) return false;
    const local = this.owner.group.worldToLocal(
      new THREE.Vector3(x, this.owner.group.position.y, z),
    );
    const { min, max } = this.bodyBounds;
    return (
      local.x > min[0] - 0.25 &&
      local.x < max[0] + 0.25 &&
      local.z > min[2] - 0.05 &&
      local.z < max[2] + 0.05
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.pending = null;
    this.release();
    window.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('pointermove', this.pointerMove, true);
    window.removeEventListener('pointerup', this.pointerUp, true);
    window.removeEventListener('pointercancel', this.pointerUp, true);
    window.removeEventListener('wheel', this.wheel, true);
    window.removeEventListener('keydown', this.keyDown, true);
    window.removeEventListener('keyup', this.keyUp, true);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  private rampGround(x: number, z: number) {
    const floor = groundFloor(this.city, x, z, 'walk');
    // Navigation's terrain fallback does not prove a rendered support surface.
    const measured =
      floor && this.city.navigation?.groundSurface?.sample(x, z, floor.y);
    return floor &&
      measured !== undefined &&
      measured !== null &&
      Math.abs(measured - floor.y) <= 0.003
      ? { y: measured, surfaceId: floor.surfaceId, layer: floor.layer }
      : null;
  }
  private release() {
    this.accessibility?.dispose();
    this.accessibility = null;
    this.resetPassenger();
    this.clearInput();
    this.space = null;
    this.ridePlan = null;
    this.ridePhase = 'parked';
    this.rideSpeed = this.rideTime = this.rideProgress = 0;
    this.owner?.dispose();
    this.owner = null;
    this.contract = null;
    this.placement = null;
    this.bodyBounds = null;
    this.doors = [];
    this.drag = null;
    this.viewAnchor = this.previewAnchor = null;
    this.transfers = new PassengerTransfers(1);
    this.busAssets.setExcludedRoutes(new Set());
  }
  private walkingFloor() {
    const n = this.city.navigation;
    if (
      !n ||
      n.walkSeat ||
      n.mode !== 'walk' ||
      n.surface !== 'ground' ||
      (n.surfaceId && n.surfaceId !== 'ground') ||
      (n.surfaceLayer ?? 0) !== 0
    )
      return null;
    if (this.blocksGround(n.position.x, n.position.z)) return null;
    const floor = groundFloor(this.city, n.position.x, n.position.z, 'walk');
    return floor && walkClearance(this.city, floor) ? floor : null;
  }
  private synchronizeWalkingFloor(floor: SurfaceState) {
    const passenger = this.transfers.state(VISITOR);
    if (passenger?.mode !== 'walking') return false;
    const source = passenger.floor;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(floor.x - source.x, floor.z - source.z) / 1.5),
    );
    if (steps > 64) return false;
    let current = source;
    for (let i = 1; i <= steps; i++) {
      const x = THREE.MathUtils.lerp(source.x, floor.x, i / steps);
      const z = THREE.MathUtils.lerp(source.z, floor.z, i / steps);
      const destination = groundFloor(this.city, x, z, 'walk');
      if (!destination) return false;
      const step = resolveSurfaceStep({
        current,
        to: [x, z],
        mode: 'walk',
        connections: [],
        maxHeightDelta: 0.35,
        lookup: (xx, zz) => {
          const hit = groundFloor(this.city, xx, zz, 'walk');
          return hit ? [{ ...hit, allowedModes: ['walk'] }] : [];
        },
      });
      if (!this.transfers.updateWalkingFloor(VISITOR, destination, step))
        return false;
      current = destination;
    }
    return true;
  }
  private freshOutside(group: 'front' | 'rear') {
    const owner = this.owner,
      door = this.doors.find((d) => d.group === group);
    if (!owner || !door) return null;
    const p = worldPoint(
      owner.group.position,
      owner.group.quaternion,
      door.point,
    );
    const floor = groundFloor(this.city, p.x, p.z, 'walk');
    return floor &&
      Math.abs(floor.y - owner.group.position.y) <= 0.12 &&
      walkClearance(this.city, floor)
      ? floor
      : null;
  }
  private placeWalker(floor: SurfaceState) {
    if (!this.city.navigation || !this.placement) return false;
    const p: PlacementPoint = {
      ...floor,
      surface: 'ground',
      yaw: this.placement.yaw + Math.PI / 2,
      name: 'Parked bus',
      snappedDistance: 0,
    };
    return this.city.navigation.startAt('walk', p);
  }
  private applyDoors() {
    if (!this.owner) return;
    for (const door of this.doors)
      door.action.time = door.start + this.doorProgress * door.duration;
    this.owner.mixer.update(0);
    this.owner.group.updateWorldMatrix(true, true);
  }
  private actualDoorsOpen() {
    return (
      this.doorProgress === 1 &&
      this.doors.length === 4 &&
      this.doors.every(
        (door) =>
          door.node.position.distanceTo(new THREE.Vector3(...door.end)) < 1e-4,
      )
    );
  }
  private frontDoorsOpen() {
    const doors = this.doors.filter((door) => door.group === 'front');
    return (
      this.doorProgress === 1 &&
      doors.length === 2 &&
      doors.every(
        (door) =>
          door.node.position.distanceTo(new THREE.Vector3(...door.end)) < 1e-4,
      )
    );
  }
  private apertureClear(group: 'front' | 'rear') {
    const owner = this.owner,
      door = this.doors.find((d) => d.group === group);
    if (!owner || !door) return false;
    owner.group.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster();
    for (const dz of [-0.18, 0.18])
      for (const height of [0.45, 1.65]) {
        const from = worldPoint(owner.group.position, owner.group.quaternion, [
          door.point[0],
          door.point[1] + height,
          door.point[2] + dz,
        ]);
        const to = worldPoint(owner.group.position, owner.group.quaternion, [
          -0.65,
          door.point[1] + height,
          door.point[2] + dz,
        ]);
        const direction = to.clone().sub(from);
        ray.set(from, direction.clone().normalize());
        ray.near = 0.01;
        ray.far = direction.length();
        if (ray.intersectObject(owner.group, true).length) return false;
      }
    return true;
  }
  private proof(group: 'front' | 'rear', floor: SurfaceState): BoardingProof {
    const owner = this.owner,
      door = this.doors.find((d) => d.group === group);
    const doorPoint =
      owner && door
        ? worldPoint(owner.group.position, owner.group.quaternion, door.point)
        : null;
    const exact = groundFloor(this.city, floor.x, floor.z, 'walk');
    const floorValid =
      !!exact &&
      floor.surfaceId === exact.surfaceId &&
      floor.layer === exact.layer &&
      Math.abs(exact.y - floor.y) < 1e-5 &&
      walkClearance(this.city, floor);
    let clearApproach = !!doorPoint;
    if (doorPoint)
      for (let i = 0; i <= 8; i++) {
        const p = new THREE.Vector3(floor.x, floor.y, floor.z).lerp(
          doorPoint,
          i / 8,
        );
        if (!groundFloor(this.city, p.x, p.z, 'walk')) {
          clearApproach = false;
          break;
        }
      }
    const lineOfSight = clearApproach && this.apertureClear(group);
    return {
      vehicleId: VEHICLE,
      serviceId: SERVICE,
      carId: CAR,
      stopId: 'parked-bus-door',
      platformId: 'parked-bus-ground',
      doorId: door?.id ?? '',
      doorSide: 'right',
      surfaceId: floor.surfaceId,
      layer: floor.layer,
      floorPointM: [floor.x, floor.y, floor.z],
      speedMps: this.rideSpeed,
      stoppedSeconds: this.stoppedSeconds,
      distanceM: doorPoint
        ? doorPoint.distanceTo(new THREE.Vector3(floor.x, floor.y, floor.z))
        : Infinity,
      doorOpen: this.actualDoorsOpen(),
      correctDoorSide: !!door,
      alignmentValid:
        !!owner &&
        !!this.placement &&
        (this.accessibility
          ? this.accessibility.aligned
          : owner.group.position.distanceTo(this.placement.position) < 1e-5) &&
        Math.abs(owner.group.quaternion.dot(this.placement.rotation)) >
          1 - 1e-8,
      zoneClear: floorValid && lineOfSight && !this.accessibility?.moving,
      lineOfSight,
      floorValid,
      passengerCapable: !!this.contract?.capabilities.passengerCapable,
    };
  }
  private updateCamera() {
    if (!this.owner || !this.aboard || !this.cabinFoot || !this.space) return;
    const local = this.cabinSeat?.position ?? this.cabinFoot;
    const localEye = new THREE.Vector3(...local);
    if (this.cabinSeat) {
      localEye.y += this.cabinSeat.eyeHeight;
      localEye.x += this.cabinSeat.eyeOffsetXZ[0];
      localEye.z += this.cabinSeat.eyeOffsetXZ[1];
    } else localEye.y += this.space.standingEyeHeight(local);
    this.owner.interiorRoot.updateWorldMatrix(true, false);
    const frameRotation = this.owner.interiorRoot.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const camera = this.city.camera;
    camera.position.copy(this.owner.interiorRoot.localToWorld(localEye));
    const direction = new THREE.Vector3(
      Math.sin(this.yaw + this.lookYaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw + this.lookYaw) * Math.cos(this.pitch),
    ).applyQuaternion(frameRotation);
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.clone().add(direction));
    if (camera.near !== 0.05 || camera.fov !== 65) {
      camera.near = 0.05;
      camera.fov = 65;
      camera.updateProjectionMatrix();
    }
    this.city.controls.enabled = false;
    this.city.controls.target.copy(camera.position).add(direction);
    const nav = this.city.navigation;
    if (nav) {
      const foot = this.owner.interiorRoot.localToWorld(
        new THREE.Vector3(...local),
      );
      nav.position.copy(foot);
      nav.walker.group.position.copy(foot);
      nav.walker.group.quaternion
        .copy(frameRotation)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            this.yaw,
          ),
        );
      if (this.avatarSeated !== this.passengerSeated) {
        nav.walker.setSeated?.(
          this.passengerSeated,
          this.cabinSeat?.seatHeight ?? 0.46,
        );
        this.avatarSeated = this.passengerSeated;
      }
      nav.walker.group.visible = false; // Ordinary first-person self hiding.
      nav.walker.update?.(
        this.walkDistance,
        !this.passengerSeated &&
          (this.keys.has('w') || this.keys.has('s') || this.axes.y !== 0),
      );
    }
  }
  private resetPassenger() {
    if (this.avatarSeated) this.city.navigation?.walker.setSeated?.(false);
    this.avatarSeated = false;
    this.cabinFoot = this.cabinStand = null;
    this.cabinSeat = null;
    this.standingAnchor = null;
  }
  private nearRearDoor() {
    const door = this.doors.find((d) => d.group === 'rear');
    return Boolean(
      this.cabinFoot &&
      door &&
      Math.hypot(this.cabinFoot[0] + 0.7, this.cabinFoot[2] - door.point[2]) <
        1.35,
    );
  }
  private canAlight(exit = this.freshOutside('rear')) {
    return (
      !this.disposed &&
      !this.hidden() &&
      this.inputEnabled &&
      Boolean(this.city.navigation) &&
      this.aboard &&
      !this.passengerSeated &&
      (!this.accessibility || this.accessibility.stowed) &&
      this.nearRearDoor() &&
      (this.ridePhase === 'parked' || this.ridePhase === 'complete') &&
      Boolean(exit && boardingProofValid(this.proof('rear', exit)))
    );
  }
  private navigationRollback() {
    const n = this.city.navigation!;
    const position = n.position.clone();
    const fields = {
      mode: n.mode,
      yaw: n.yaw,
      pitch: n.pitch,
      surface: n.surface,
      surfaceId: n.surfaceId,
      surfaceLayer: n.surfaceLayer,
      snapCamera: n.snapCamera,
      speed: n.speed,
      driveLookYaw: n.driveLookYaw,
      returnBlend: n.returnBlend,
      steering: n.steering,
      steeringPulse: n.steeringPulse,
    };
    const walkerPosition = n.walker.group.position.clone(),
      walkerQuaternion = n.walker.group.quaternion.clone();
    const walkerVisible = n.walker.group.visible,
      carVisible = n.car.visible;
    const camera = this.city.camera;
    const eye = camera.position.clone(),
      rotation = camera.quaternion.clone(),
      up = camera.up.clone();
    const near = camera.near,
      fov = camera.fov;
    const target = this.city.controls.target.clone(),
      enabled = this.city.controls.enabled;
    return () => {
      Object.assign(n, fields);
      n.position.copy(position);
      n.walker.group.visible = walkerVisible;
      n.walker.group.position.copy(walkerPosition);
      n.walker.group.quaternion.copy(walkerQuaternion);
      n.car.visible = carVisible;
      camera.position.copy(eye);
      camera.quaternion.copy(rotation);
      camera.up.copy(up);
      camera.near = near;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      this.city.controls.target.copy(target);
      this.city.controls.enabled = enabled;
    };
  }
  private pointerDown = (event: PointerEvent) => {
    if (
      !this.aboard ||
      this.hidden() ||
      !this.inputEnabled ||
      event.target !== this.city.renderer.domElement ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.drag) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.city.renderer.domElement.setPointerCapture?.(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (
      !this.aboard ||
      this.hidden() ||
      !this.inputEnabled ||
      !this.drag ||
      this.drag.id !== event.pointerId
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.lookYaw -= (event.clientX - this.drag.x) * 0.004;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - (event.clientY - this.drag.y) * 0.004,
      -1.2,
      1.2,
    );
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.updateCamera();
  };
  private pointerUp = (event: PointerEvent) => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.drag = null;
    const canvas = this.city.renderer.domElement;
    if (canvas.hasPointerCapture?.(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  };
  private wheel = (event: WheelEvent) => {
    if (!this.aboard || event.target !== this.city.renderer.domElement) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  private keyDown = (event: KeyboardEvent) => {
    if (
      !this.aboard ||
      this.hidden() ||
      !this.inputEnabled ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        ))
    )
      return;
    const key = event.key.toLowerCase();
    if (
      key === ' ' &&
      event.target instanceof Element &&
      event.target.closest('button, a, [role="radio"], [role="slider"]')
    )
      return;
    if (
      ![
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        ' ',
        'shift',
      ].includes(key)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat || this.keys.has(key)) this.keys.add(key);
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };
  private blur = () => {
    this.clearInput();
  };
  private visibility = () => {
    this.clearInput();
    this.resumeAnchor = true;
  };
  private reject(message: string) {
    this.error = message;
    this.notify();
    return false;
  }
  private notify() {
    this.onChange(this.snapshot());
  }
}
