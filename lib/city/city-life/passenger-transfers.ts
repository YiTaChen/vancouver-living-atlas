import { sameSurface, type SurfaceState } from '../surface-reachability';
import { TRANSIT_PARAMETERS, type DoorSide } from './transit-service';

export type LocalTransform = {
  frameId: string;
  translationM: [number, number, number];
  rotationQuaternionXYZW: [number, number, number, number];
};
export interface RideAnchor extends LocalTransform {
  vehicleId: string;
  carId: string;
  anchorId: string;
  kind: 'seat' | 'standing';
}
export type PassengerState =
  | { mode: 'walking'; floor: SurfaceState }
  | { mode: 'riding'; anchor: RideAnchor; serviceId: string; stopId: string };
export interface BoardingProof {
  vehicleId: string;
  serviceId: string;
  carId: string;
  stopId: string;
  platformId: string;
  doorId: string;
  doorSide: DoorSide;
  surfaceId: string;
  layer: number;
  floorPointM: [number, number, number];
  speedMps: number;
  stoppedSeconds: number;
  distanceM: number;
  doorOpen: boolean;
  correctDoorSide: boolean;
  alignmentValid: boolean;
  zoneClear: boolean;
  lineOfSight: boolean;
  passengerCapable: boolean;
  floorValid: boolean;
}
export interface TransferToken {
  passengerId: string;
  generation: number;
}
interface Pending {
  token: TransferToken;
  kind: 'board' | 'alight';
  phase: 'reserved' | 'preloaded';
  deadline: number;
  createdAt: number;
  original: PassengerState;
  anchor: RideAnchor;
  targetFloor?: SurfaceState;
  proof: BoardingProof;
}
const finiteFloor = (floor: SurfaceState) =>
  !!floor.surfaceId &&
  [floor.x, floor.y, floor.z, floor.layer].every(Number.isFinite);
function validAnchor(anchor: RideAnchor) {
  const q = anchor.rotationQuaternionXYZW;
  return (
    anchor.vehicleId &&
    anchor.carId &&
    anchor.anchorId &&
    anchor.frameId &&
    ['seat', 'standing'].includes(anchor.kind) &&
    anchor.translationM.length === 3 &&
    anchor.translationM.every(Number.isFinite) &&
    q.length === 4 &&
    q.every(Number.isFinite) &&
    Math.abs(Math.hypot(...q) - 1) < 1e-5
  );
}
const key = (anchor: RideAnchor) =>
  JSON.stringify([anchor.vehicleId, anchor.carId, anchor.anchorId]);
export function boardingProofValid(p: BoardingProof) {
  return (
    !!(
      p.vehicleId &&
      p.serviceId &&
      p.carId &&
      p.stopId &&
      p.platformId &&
      p.doorId &&
      p.surfaceId
    ) &&
    ['left', 'right'].includes(p.doorSide) &&
    p.floorPointM.length === 3 &&
    p.floorPointM.every(Number.isFinite) &&
    Number.isFinite(p.layer) &&
    Number.isFinite(p.speedMps) &&
    Math.abs(p.speedMps) <= TRANSIT_PARAMETERS.stoppedSpeedMps &&
    Number.isFinite(p.stoppedSeconds) &&
    p.stoppedSeconds >= TRANSIT_PARAMETERS.stoppedSeconds &&
    Number.isFinite(p.distanceM) &&
    p.distanceM >= 0 &&
    p.distanceM <= TRANSIT_PARAMETERS.interactionDistanceM &&
    p.doorOpen &&
    p.correctDoorSide &&
    p.alignmentValid &&
    p.zoneClear &&
    p.lineOfSight &&
    p.passengerCapable &&
    p.floorValid
  );
}
const sameProofTarget = (a: BoardingProof, b: BoardingProof) =>
  a.floorPointM.every((v, i) => v === b.floorPointM[i]) &&
  [
    'vehicleId',
    'serviceId',
    'carId',
    'stopId',
    'platformId',
    'doorId',
    'doorSide',
    'surfaceId',
    'layer',
  ].every((k) => a[k as keyof BoardingProof] === b[k as keyof BoardingProof]);
/** Reserve -> preload -> validate -> commit. Owns passenger/anchor occupancy only.
 * Scene/controller/collider replacement must use the separate representation transaction.
 * Render camera is deliberately absent. All reads are copies, stale tokens never mutate. */
export class PassengerTransfers {
  private passengers = new Map<string, PassengerState>();
  private generation = 0;
  private pending = new Map<string, Pending>();
  private occupants = new Map<string, string>();
  private reservations = new Map<string, string>();
  private exits = new Map<string, string>();
  constructor(readonly capacity = 32) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Invalid transfer capacity');
  }
  register(passengerId: string, floor: SurfaceState) {
    if (
      !passengerId ||
      !finiteFloor(floor) ||
      this.passengers.has(passengerId) ||
      this.passengers.size >= this.capacity
    )
      return false;
    this.passengers.set(passengerId, {
      mode: 'walking',
      floor: structuredClone(floor),
    });
    return true;
  }
  state(passengerId: string) {
    const state = this.passengers.get(passengerId);
    return state ? structuredClone(state) : undefined;
  }
  beginBoard(
    passengerId: string,
    anchor: RideAnchor,
    proof: BoardingProof,
    now: number,
  ): TransferToken | null {
    const state = this.passengers.get(passengerId);
    if (
      !state ||
      state.mode !== 'walking' ||
      this.pending.has(passengerId) ||
      !Number.isFinite(now) ||
      !validAnchor(anchor) ||
      !boardingProofValid(proof) ||
      anchor.vehicleId !== proof.vehicleId ||
      anchor.carId !== proof.carId ||
      !sameSurface(state.floor, proof) ||
      !this.floorMatches(state.floor, proof) ||
      this.occupants.has(key(anchor)) ||
      this.reservations.has(key(anchor))
    )
      return null;
    const token = this.nextToken(passengerId);
    this.reservations.set(key(anchor), passengerId);
    this.pending.set(passengerId, {
      token,
      kind: 'board',
      phase: 'reserved',
      deadline: now + TRANSIT_PARAMETERS.transferTimeoutSeconds,
      createdAt: now,
      original: structuredClone(state),
      anchor: structuredClone(anchor),
      proof: structuredClone(proof),
    });
    return { ...token };
  }
  beginAlight(
    passengerId: string,
    targetFloor: SurfaceState,
    proof: BoardingProof,
    now: number,
  ): TransferToken | null {
    const state = this.passengers.get(passengerId);
    if (
      !state ||
      state.mode !== 'riding' ||
      this.pending.has(passengerId) ||
      !Number.isFinite(now) ||
      !finiteFloor(targetFloor) ||
      !boardingProofValid(proof) ||
      state.anchor.vehicleId !== proof.vehicleId ||
      state.anchor.carId !== proof.carId ||
      state.serviceId !== proof.serviceId ||
      !sameSurface(targetFloor, proof) ||
      !this.floorMatches(targetFloor, proof)
    )
      return null;
    const exitKey = this.exitKey(targetFloor);
    if (
      this.exits.has(exitKey) ||
      [...this.pending.values()].some(
        (p) =>
          p.targetFloor &&
          sameSurface(p.targetFloor, targetFloor) &&
          Math.hypot(
            p.targetFloor.x - targetFloor.x,
            p.targetFloor.z - targetFloor.z,
          ) < 0.6,
      )
    )
      return null;
    const token = this.nextToken(passengerId);
    this.exits.set(exitKey, passengerId);
    this.pending.set(passengerId, {
      token,
      kind: 'alight',
      phase: 'reserved',
      deadline: now + TRANSIT_PARAMETERS.transferTimeoutSeconds,
      createdAt: now,
      original: structuredClone(state),
      anchor: structuredClone(state.anchor),
      targetFloor: structuredClone(targetFloor),
      proof: structuredClone(proof),
    });
    return { ...token };
  }
  markPreloaded(token: TransferToken, now: number) {
    const p = this.current(token, now);
    if (!p) return false;
    p.phase = 'preloaded';
    return true;
  }
  /** Caller MUST freshly re-evaluate collision, actual doors and exact floor at commit. */
  commit(token: TransferToken, proof: BoardingProof, now: number) {
    const p = this.current(token, now);
    if (!p) return false;
    if (
      p.phase !== 'preloaded' ||
      !boardingProofValid(proof) ||
      !sameProofTarget(p.proof, proof)
    ) {
      this.cancel(token);
      return false;
    }
    if (p.kind === 'board') {
      if (
        this.reservations.get(key(p.anchor)) !== token.passengerId ||
        this.occupants.has(key(p.anchor))
      ) {
        this.cancel(token);
        return false;
      }
      this.occupants.set(key(p.anchor), token.passengerId);
      this.passengers.set(token.passengerId, {
        mode: 'riding',
        anchor: structuredClone(p.anchor),
        serviceId: proof.serviceId,
        stopId: proof.stopId,
      });
    } else {
      if (
        !p.targetFloor ||
        this.occupants.get(key(p.anchor)) !== token.passengerId
      ) {
        this.cancel(token);
        return false;
      }
      // Preserve seat until target floor validation succeeded.
      this.passengers.set(token.passengerId, {
        mode: 'walking',
        floor: structuredClone(p.targetFloor),
      });
      this.occupants.delete(key(p.anchor));
    }
    this.release(p);
    return true;
  }
  cancel(token: TransferToken) {
    const p = this.pending.get(token.passengerId);
    if (!p || p.token.generation !== token.generation) return false;
    // The source never changed during preload: cancellation cannot strand a rider.
    this.release(p);
    return true;
  }
  expire(now: number) {
    if (!Number.isFinite(now)) return;
    for (const p of this.pending.values())
      if (now >= p.deadline) this.cancel(p.token);
  }
  /** Mode changes may remove only a walking passenger. Riding must safely alight first. */
  unregister(passengerId: string) {
    if (
      this.passengers.get(passengerId)?.mode !== 'walking' ||
      this.pending.has(passengerId)
    )
      return false;
    return this.passengers.delete(passengerId);
  }
  pendingFor(vehicleId: string) {
    return [...this.pending.values()].filter(
      (p) => p.anchor.vehicleId === vehicleId,
    ).length;
  }
  occupantsFor(vehicleId: string) {
    return [...this.passengers.values()].filter(
      (p) => p.mode === 'riding' && p.anchor.vehicleId === vehicleId,
    ).length;
  }
  /** Same vehicle may change 5/6 service only while parked and with no in-flight transfers. */
  rebindService(
    vehicleId: string,
    oldServiceId: string,
    newServiceId: string,
    stopId: string,
    parked: boolean,
  ) {
    if (!parked || !newServiceId || !stopId || this.pendingFor(vehicleId))
      return false;
    for (const state of this.passengers.values())
      if (
        state.mode === 'riding' &&
        state.anchor.vehicleId === vehicleId &&
        state.serviceId !== oldServiceId
      )
        return false;
    for (const state of this.passengers.values())
      if (state.mode === 'riding' && state.anchor.vehicleId === vehicleId) {
        state.serviceId = newServiceId;
        state.stopId = stopId;
      }
    return true;
  }
  private nextToken(passengerId: string) {
    return { passengerId, generation: ++this.generation };
  }
  private floorMatches(f: SurfaceState, p: BoardingProof) {
    return (
      f.x === p.floorPointM[0] &&
      f.y === p.floorPointM[1] &&
      f.z === p.floorPointM[2]
    );
  }
  private current(token: TransferToken, now: number) {
    const p = this.pending.get(token.passengerId);
    if (
      !p ||
      p.token.generation !== token.generation ||
      !Number.isFinite(now) ||
      now < p.createdAt
    )
      return null;
    if (now >= p.deadline) {
      this.cancel(token);
      return null;
    }
    return p;
  }
  private exitKey(f: SurfaceState) {
    return JSON.stringify([f.surfaceId, f.layer, f.x, f.y, f.z]);
  }
  private release(p: Pending) {
    this.pending.delete(p.token.passengerId);
    this.reservations.delete(key(p.anchor));
    if (p.targetFloor) this.exits.delete(this.exitKey(p.targetFloor));
  }
}
