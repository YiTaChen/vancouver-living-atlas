import type { SurfaceIdentity } from '../surface-reachability';
import { sameSurface } from '../surface-reachability';
export interface LaneOccupant extends SurfaceIdentity {
  vehicleId: string;
  pathId: string;
  /** Vehicle center station and full longitudinal length, same metre frame as lane. */
  stationM: number;
  lengthM: number;
}
/** Common occupancy for cars and dwelling buses; no elapsed-time modulo reset.
 * Call from the single authoritative traffic tick, not independently per renderer. */
export class TrafficOccupancy {
  private vehicles = new Map<string, LaneOccupant>();
  private blocks = new Map<string, string>();
  constructor(readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Invalid traffic capacity');
  }
  update(occupant: LaneOccupant) {
    if (
      !occupant.vehicleId ||
      !occupant.pathId ||
      !occupant.surfaceId ||
      ![occupant.stationM, occupant.lengthM, occupant.layer].every(
        Number.isFinite,
      ) ||
      occupant.stationM < 0 ||
      occupant.lengthM <= 0
    )
      throw new Error('Invalid lane occupancy');
    if (
      !this.vehicles.has(occupant.vehicleId) &&
      this.vehicles.size >= this.capacity
    )
      return false;
    this.vehicles.set(occupant.vehicleId, { ...occupant });
    return true;
  }
  clearDistance(vehicleId: string, gapM = 2) {
    const own = this.vehicles.get(vehicleId);
    if (!own || !Number.isFinite(gapM) || gapM < 0)
      throw new Error('Invalid traffic query');
    let distance = Infinity;
    for (const other of this.vehicles.values()) {
      if (
        other.vehicleId === vehicleId ||
        other.pathId !== own.pathId ||
        !sameSurface(other, own)
      )
        continue;
      const rear = other.stationM - other.lengthM / 2,
        front = own.stationM + own.lengthM / 2;
      // An overlapping vehicle also blocks; never treat its rear as already passed.
      if (other.stationM + other.lengthM / 2 >= own.stationM - own.lengthM / 2)
        distance = Math.min(distance, Math.max(0, rear - front - gapM));
    }
    return distance;
  }
  /** Source topology supplies explicit conflict IDs, including layer in its key.
   * Validate all requested blocks before changing any owner (atomic reservation). */
  reserveJunction(vehicleId: string, conflictIds: readonly string[]) {
    if (
      !this.vehicles.has(vehicleId) ||
      !conflictIds.length ||
      conflictIds.some((id) => !id) ||
      new Set(conflictIds).size !== conflictIds.length
    )
      return false;
    if (
      conflictIds.some(
        (id) => this.blocks.has(id) && this.blocks.get(id) !== vehicleId,
      )
    )
      return false;
    if (
      this.blocks.size +
        conflictIds.filter((id) => !this.blocks.has(id)).length >
      this.capacity * 4
    )
      return false;
    for (const id of conflictIds) this.blocks.set(id, vehicleId);
    return true;
  }
  releaseJunction(
    vehicleId: string,
    conflictIds: readonly string[],
    verifiedClear: boolean,
  ) {
    if (!verifiedClear) return false;
    for (const id of conflictIds)
      if (this.blocks.get(id) === vehicleId) this.blocks.delete(id);
    return true;
  }
  /** Representation downgrade is not removal. Occupied/conflicting vehicles stay tracked. */
  remove(
    vehicleId: string,
    empty: boolean,
    notVisible: boolean,
    pendingTransfers: number,
  ) {
    if (
      !empty ||
      !notVisible ||
      pendingTransfers !== 0 ||
      [...this.blocks.values()].includes(vehicleId)
    )
      return false;
    return this.vehicles.delete(vehicleId);
  }
  snapshot() {
    return {
      vehicles: [...this.vehicles.values()].map((v) => ({ ...v })),
      blocks: [...this.blocks].map(([blockId, vehicleId]) => ({
        blockId,
        vehicleId,
      })),
    };
  }
}
