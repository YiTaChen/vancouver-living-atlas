import * as THREE from 'three';
import type { CityEngine } from './engine';
import type {
  InteractionCandidate,
  InteractionPoint,
} from './proximity-interactions';

/** Explicit authored seats; never infer a chair from an arbitrary mesh's bounds. */
export interface WorldSeat {
  id: string;
  floor: InteractionPoint;
  yaw: number;
  height: number;
  visible(): boolean;
}

/** Static 16 m buckets keep the per-frame interaction query local. The same
 * floor/collision checks authorize both approaching a seat and standing up. */
export class WorldSeats {
  private readonly cells = new Map<string, WorldSeat[]>();
  private indexed = 0;
  private furnitureIndexed = false;
  constructor(private readonly e: CityEngine) {}

  private add(seat: WorldSeat) {
    if (
      !seat.id ||
      ![...seat.floor, seat.yaw, seat.height].every(Number.isFinite)
    )
      return;
    const key = `${Math.floor(seat.floor[0] / 16)},${Math.floor(seat.floor[2] / 16)}`;
    const bucket = this.cells.get(key) ?? [];
    bucket.push(seat);
    this.cells.set(key, bucket);
  }

  private index() {
    const furniture = this.e.streetFurniture;
    if (furniture && !this.furnitureIndexed) {
      this.furnitureIndexed = true;
      for (const p of furniture.placements) {
        if (p.kind !== 'cedar-bench') continue;
        this.add({
          id: `street-seat:${p.id}`,
          floor: [p.x, p.y, p.z],
          yaw: p.yaw,
          // Audited source GLB seat top in BOTH LODs; not the backrest bounds.
          height: 0.509,
          visible: () => furniture.renderer.hasVisiblePlacement(p.id),
        });
      }
    }
    const authored = this.e.data.walkSeats as WorldSeat[] | undefined;
    while (authored && this.indexed < authored.length)
      this.add(authored[this.indexed++]);
  }

  private floor(x: number, z: number, anchor: number): number | undefined {
    const nav = this.e.navigation;
    if (
      !nav ||
      !nav.clearGround(x, z, 'walk', true) ||
      this.e.busVisit?.blocksGround(x, z)
    )
      return undefined;
    const interior = this.e.interiors?.height(x, z);
    if (interior !== undefined)
      return Math.abs(interior - anchor) < 0.4 ? interior : undefined;
    // groundHeight initializes the shared explicit rendered-floor index, but
    // its DEM fallback cannot itself authorize an interaction or a safe exit.
    nav.groundHeight(x, z);
    const y = nav.groundSurface?.sample(x, z, anchor);
    return y !== undefined && Math.abs(y - anchor) < 0.4 ? y : undefined;
  }

  private exit(seat: WorldSeat): THREE.Vector3 | null {
    const [x, y, z] = seat.floor;
    const sin = Math.sin(seat.yaw),
      cos = Math.cos(seat.yaw);
    for (const side of [0, -0.4, 0.4]) {
      const xx = x + sin * 0.95 + cos * side;
      const zz = z + cos * 0.95 - sin * side;
      const yy = this.floor(xx, zz, y);
      if (yy !== undefined) return new THREE.Vector3(xx, yy + 0.02, zz);
    }
    return null;
  }

  private accessible(seat: WorldSeat) {
    const nav = this.e.navigation;
    if (!nav || !seat.visible() || nav.surface === 'bridge') return false;
    const p = nav.position,
      [x, y, z] = seat.floor;
    if (Math.abs(nav.walkingHeight() - y) > 0.4) return false;
    // Only the clear front of the bench accepts an approach; no reaching
    // through its back, a building wall, water or an intervening obstacle.
    const front =
      (p.x - x) * Math.sin(seat.yaw) + (p.z - z) * Math.cos(seat.yaw);
    if (front < 0.32) return false;
    const exit = this.exit(seat);
    if (!exit) return false;
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(p.x - exit.x, p.z - exit.z) / 0.2),
    );
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      if (
        this.floor(p.x + (exit.x - p.x) * t, p.z + (exit.z - p.z) * t, y) ===
        undefined
      )
        return false;
    }
    return true;
  }

  update() {
    const id = this.e.navigation?.walkSeat?.id;
    this.e.streetFurniture?.renderer.setOccupied(
      id?.startsWith('street-seat:') ? id.slice('street-seat:'.length) : null,
    );
  }

  interactionCandidates(): readonly InteractionCandidate[] {
    const nav = this.e.navigation;
    if (
      !nav ||
      nav.mode !== 'walk' ||
      this.e.settings.mode !== 'walk' ||
      this.e.skyTrainTravel?.active ||
      this.e.busVisit?.aboard
    )
      return [];
    this.index();
    const seated = nav.walkSeat;
    if (seated)
      return [
        {
          id: seated.id,
          kind: 'seat',
          action: 'stand',
          priority: 100,
          anchor: [
            seated.floor[0],
            seated.floor[1] + seated.height + 0.65,
            seated.floor[2],
          ],
          proximityPoint: seated.floor,
          range: 2,
          canInteract: () => nav.walkSeat?.id === seated.id,
          execute: () => nav.leaveWalkSeat(),
        },
      ];
    const result: InteractionCandidate[] = [];
    const gx = Math.floor(nav.position.x / 16),
      gz = Math.floor(nav.position.z / 16);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const seat of this.cells.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (
            Math.hypot(
              nav.position.x - seat.floor[0],
              nav.position.z - seat.floor[2],
            ) > 1.85
          )
            continue;
          result.push({
            id: seat.id,
            kind: 'seat',
            action: 'sit',
            anchor: [
              seat.floor[0],
              seat.floor[1] + seat.height + 0.65,
              seat.floor[2],
            ],
            proximityPoint: seat.floor,
            range: 1.85,
            canInteract: () => !nav.walkSeat && this.accessible(seat),
            execute: () =>
              this.accessible(seat) &&
              nav.sitOnSeat({
                id: seat.id,
                floor: seat.floor,
                yaw: seat.yaw,
                height: seat.height,
                stand: () => this.exit(seat),
              }),
          });
        }
      }
    return result;
  }

  dispose() {
    this.e.streetFurniture?.renderer.setOccupied(null);
    this.cells.clear();
  }
}
