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
import { riderWorldTransform } from './city-life/continuous-path';
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
  /** Viewing another seat does not move or reserve the passenger's anchor. */
  viewAnchor: string | null;
  previewAnchor: string | null;
  passengerAnchor: string | null;
  routeIndex: number | null;
  profile: BusVisitProfile | null;
  requestedProfile: BusVisitProfile | null;
  fallback: boolean;
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
    !nav.clearGround(x, z, mode) ||
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
  front: Point = [-1.7, 0.36, 4.275],
  rear: Point = [-1.7, 0.36, -0.625],
): BusVisitPlacement | null {
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
      for (const longitudinal of [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6.3]) {
        if (!clear) break;
        for (const lateral of [-1.55, 0, 1.55]) {
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
      if (frontFloor && rearFloor)
        return {
          routeIndex: index,
          position,
          rotation,
          yaw,
          frontFloor,
          rearFloor,
        };
    }
  }
  return null;
}

/** A parked cabin visit in the city. It has no route, fare or moving service;
 * passenger occupancy and the optional viewing anchor remain separate. */
export class BusCabinVisit {
  onChange: (snapshot: BusVisitSnapshot) => void = () => {};
  private phase: Phase = 'idle';
  private error = '';
  private owner: Owner | null = null;
  private contract: VehiclePassengerContract | null = null;
  private placement: BusVisitPlacement | null = null;
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
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
  }
  get aboard() {
    return this.transfers.state(VISITOR)?.mode === 'riding';
  }
  get routeIndex() {
    return this.placement?.routeIndex ?? null;
  }
  private hidden() {
    return document.hidden || this.city.pageSuspended || this.city.contextLost;
  }
  prepare(policy?: BusVisitPolicy): Promise<boolean> {
    if (this.disposed || this.hidden()) return Promise.resolve(false);
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
        const placement = findBusVisitPlacement(
          this.city,
          this.routes,
          doors.find((d) => d.group === 'front')!.point,
          doors.find((d) => d.group === 'rear')!.point,
        );
        if (!placement) throw new Error('No safe flat bus parking and exit');
        const transfers = new PassengerTransfers(1);
        if (!transfers.register(VISITOR, placement.frontFloor))
          throw new Error('Invalid entrance floor');
        owner.group.position.copy(placement.position);
        owner.group.quaternion.copy(placement.rotation);
        owner.group.name = 'Parked city bus cabin visit';
        const cabinLight = new THREE.PointLight(0xffecd1, 4, 12, 2);
        cabinLight.position.set(0, 2.45, 0);
        cabinLight.castShadow = false;
        cabinLight.name = 'Single parked cabin light';
        owner.group.add(cabinLight);
        owner.group.updateWorldMatrix(true, true);
        this.owner = owner;
        this.contract = contract;
        this.doors = doors;
        this.placement = placement;
        this.transfers = transfers;
        this.elapsed = 0;
        this.doorProgress = 0;
        this.stoppedSeconds = 0;
        this.city.scene.add(owner.group);
        this.busAssets.setExcludedRoutes(new Set([placement.routeIndex]));
        this.phase = 'ready';
        this.error = '';
        if (!this.placeWalker(placement.frontFloor))
          throw new Error('Cannot place visitor at entrance');
        this.applyDoors();
        this.notify();
        return true;
      } catch (error) {
        owner?.dispose();
        if (generation === this.generation && !this.disposed) {
          this.owner = null;
          this.contract = null;
          this.placement = null;
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
  update(dt: number) {
    if (this.disposed || !this.owner || this.hidden()) return;
    if (this.resumeAnchor) {
      this.resumeAnchor = false;
      return;
    }
    const h = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
    this.elapsed += h;
    this.stoppedSeconds += h;
    this.doorProgress = Math.min(1, this.doorProgress + h);
    this.applyDoors();
    this.transfers.expire(this.elapsed);
    if (this.aboard) this.updateCamera();
    else {
      const floor = this.walkingFloor();
      if (floor) this.synchronizeWalkingFloor(floor);
    }
  }
  board(anchorId: string) {
    if (
      this.disposed ||
      this.hidden() ||
      this.aboard ||
      !this.owner ||
      !this.contract
    )
      return false;
    const anchor = this.contract.anchors.find(
      (a) => a.anchor.anchorId === anchorId,
    );
    const floor = this.walkingFloor();
    if (!anchor || !floor)
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
    this.viewAnchor = anchorId;
    this.previewAnchor = null;
    this.yaw = this.pitch = 0;
    this.phase = 'aboard';
    this.error = '';
    this.updateCamera();
    this.notify();
    return true;
  }
  preview(anchorId: string) {
    if (
      !this.aboard ||
      this.disposed ||
      this.hidden() ||
      !this.contract?.anchors.some((a) => a.anchor.anchorId === anchorId)
    )
      return false;
    const passenger = this.transfers.state(VISITOR);
    this.viewAnchor = anchorId;
    this.previewAnchor =
      passenger?.mode === 'riding' && passenger.anchor.anchorId === anchorId
        ? null
        : anchorId;
    this.yaw = this.pitch = 0;
    this.updateCamera();
    this.notify();
    return true;
  }
  alight() {
    if (!this.aboard || this.disposed || this.hidden() || !this.city.navigation)
      return false;
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
    this.drag = null;
    this.viewAnchor = this.previewAnchor = null;
    this.phase = 'ready';
    this.error = '';
    this.notify();
    return true;
  }
  /** Release the visit only after a rider reached freshly validated ground. */
  exit() {
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
        !this.aboard &&
        !!walking &&
        boardingProofValid(this.proof('front', walking)),
      canAlight:
        !this.hidden() &&
        this.aboard &&
        !!exit &&
        boardingProofValid(this.proof('rear', exit)),
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
    };
  }
  /** Static body collision for the host navigation; the doors are approached outside it. */
  blocksGround(x: number, z: number) {
    if (!this.owner) return false;
    const local = this.owner.group.worldToLocal(
      new THREE.Vector3(x, this.owner.group.position.y, z),
    );
    return Math.abs(local.x) < 1.5 && local.z > -5.85 && local.z < 6.25;
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
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  private release() {
    this.owner?.dispose();
    this.owner = null;
    this.contract = null;
    this.placement = null;
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
      speedMps: 0,
      stoppedSeconds: this.stoppedSeconds,
      distanceM: doorPoint
        ? doorPoint.distanceTo(new THREE.Vector3(floor.x, floor.y, floor.z))
        : Infinity,
      doorOpen: this.actualDoorsOpen(),
      correctDoorSide: !!door,
      alignmentValid:
        !!owner &&
        !!this.placement &&
        owner.group.position.distanceTo(this.placement.position) < 1e-5 &&
        Math.abs(owner.group.quaternion.dot(this.placement.rotation)) >
          1 - 1e-8,
      zoneClear: floorValid && lineOfSight,
      lineOfSight,
      floorValid,
      passengerCapable: !!this.contract?.capabilities.passengerCapable,
    };
  }
  private updateCamera() {
    const a = this.contract?.anchors.find(
      (anchor) => anchor.anchor.anchorId === this.viewAnchor,
    );
    if (!a || !this.owner || !this.aboard) return;
    const localEye =
      a.cameraEyePointM ??
      ([
        a.anchor.translationM[0],
        a.anchor.translationM[1] + 1.62,
        a.anchor.translationM[2],
      ] as Point);
    const pose = riderWorldTransform(
      this.owner.group.position,
      this.owner.group.quaternion,
      localEye,
      a.anchor.rotationQuaternionXYZW,
    );
    const camera = this.city.camera;
    camera.position.copy(pose.position);
    camera.quaternion
      .copy(pose.rotation)
      .multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-this.pitch, this.yaw, 0, 'YXZ'),
        ),
      )
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.PI,
        ),
      );
    camera.up.set(0, 1, 0);
    if (camera.near !== 0.05 || camera.fov !== 65) {
      camera.near = 0.05;
      camera.fov = 65;
      camera.updateProjectionMatrix();
    }
    this.city.controls.enabled = false;
    this.city.controls.target
      .copy(camera.position)
      .add(camera.getWorldDirection(new THREE.Vector3()));
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
      !this.drag ||
      this.drag.id !== event.pointerId
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.yaw -= (event.clientX - this.drag.x) * 0.004;
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
    if (key === 'arrowleft') this.yaw += 0.08;
    if (key === 'arrowright') this.yaw -= 0.08;
    if (key === 'arrowup') this.pitch = Math.min(1.2, this.pitch + 0.08);
    if (key === 'arrowdown') this.pitch = Math.max(-1.2, this.pitch - 0.08);
    this.updateCamera();
  };
  private blur = () => {
    this.drag = null;
  };
  private visibility = () => {
    this.drag = null;
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
