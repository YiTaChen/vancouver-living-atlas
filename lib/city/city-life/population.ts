import type { SurfaceIdentity } from '../surface-reachability';
import { sameSurface } from '../surface-reachability';

export type Point3 = readonly [number, number, number];
export interface PopulationProfile {
  total: number;
  interactive: number;
  skeletons: number;
  upgrade: number;
  downgrade: number;
  selection: number;
  visible: number;
}
/** Capability wins over UI quality. Ultra deliberately has no larger budget. */
export function populationProfile(
  capability: 'compatible' | 'desktop',
  quality: string,
): PopulationProfile {
  if (capability === 'compatible')
    return {
      total: 12,
      interactive: 2,
      skeletons: 2,
      upgrade: 10,
      downgrade: 14,
      selection: 60,
      visible: 80,
    };
  if (quality.toLowerCase() === 'balanced' || quality.toLowerCase() === 'low')
    return {
      total: 24,
      interactive: 3,
      skeletons: 3,
      upgrade: 12,
      downgrade: 16,
      selection: 90,
      visible: 110,
    };
  return {
    total: 32,
    interactive: 4,
    skeletons: 4,
    upgrade: 12,
    downgrade: 16,
    selection: 100,
    visible: 120,
  };
}
export interface PopulationCenter extends SurfaceIdentity {
  position: Point3;
  /** High-altitude city views set false; Orbit itself is NOT a reason to disable. */
  streetVisible: boolean;
  kind: 'camera' | 'player' | 'service';
}
export interface ActorCandidate extends SurfaceIdentity {
  actorId: string;
  position: Point3;
  interactive: boolean;
  /** Only validated safety/interaction work may outrank camera background. */
  necessary: boolean;
  /** Consumer supplies visibility/occlusion result; no front-of-camera births. */
  spawnSafe: boolean;
  skeletonEligible: boolean;
}
export interface ActorSelection {
  actorId: string;
  skeleton: boolean;
  visible: boolean;
  collision: boolean;
  movementHz: number;
  decisionHz: number;
}
interface Active {
  outsideSince: number | null;
  skeleton: boolean;
}
const distance = (a: Point3, b: Point3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const valid = (a: ActorCandidate) =>
  a.actorId &&
  a.surfaceId &&
  Number.isFinite(a.layer) &&
  a.position.every(Number.isFinite);
/** One instance for the ENTIRE runtime, not one per neighborhood/activation center.
 * Stable IDs live in the caller's bounded route state; slots never become identities. */
export class PopulationSelector {
  private active = new Map<string, Active>();
  private lastTime = -Infinity;
  constructor(readonly profile: PopulationProfile) {
    if (
      ![profile.total, profile.interactive, profile.skeletons].every(
        (v) => Number.isInteger(v) && v >= 0,
      ) ||
      profile.total > 32 ||
      profile.interactive > 4 ||
      profile.skeletons > 4 ||
      profile.interactive > profile.total ||
      profile.skeletons > profile.total ||
      ![
        profile.upgrade,
        profile.downgrade,
        profile.selection,
        profile.visible,
      ].every((v) => Number.isFinite(v) && v > 0) ||
      profile.upgrade > profile.downgrade ||
      profile.selection > profile.visible
    )
      throw new Error('Invalid population budget');
    this.profile = Object.freeze({ ...profile });
  }
  select(
    candidates: readonly ActorCandidate[],
    centers: readonly PopulationCenter[],
    now: number,
  ): ActorSelection[] {
    if (!Number.isFinite(now) || now < this.lastTime)
      throw new Error('Population requires monotonic simulation time');
    this.lastTime = now;
    const ids = new Set<string>();
    const ranked = candidates
      .map((actor) => {
        if (!valid(actor) || ids.has(actor.actorId))
          throw new Error('Invalid or duplicate actor identity');
        ids.add(actor.actorId);
        const compatible = centers.filter(
          (c) =>
            c.streetVisible &&
            sameSurface(c, actor) &&
            c.position.every(Number.isFinite),
        );
        const near = Math.min(
          Infinity,
          ...compatible.map((c) => distance(c.position, actor.position)),
        );
        const player = Math.min(
          Infinity,
          ...compatible
            .filter((c) => c.kind === 'player')
            .map((c) => distance(c.position, actor.position)),
        );
        const previous = this.active.get(actor.actorId);
        let outsideSince: number | null = null;
        if (near > this.profile.selection + 20)
          outsideSince = previous?.outsideSince ?? now;
        const retained =
          !!previous && (outsideSince === null || now - outsideSince < 3);
        const eligible =
          retained || (near <= this.profile.selection && actor.spawnSafe);
        return { actor, near, player, previous, outsideSince, eligible };
      })
      .filter((a) => a.eligible)
      .sort(
        (a, b) =>
          Number(b.actor.necessary && b.player <= 35) -
            Number(a.actor.necessary && a.player <= 35) ||
          Number(b.actor.interactive && b.player <= 35) -
            Number(a.actor.interactive && a.player <= 35) ||
          Number(!!b.previous) - Number(!!a.previous) ||
          a.near - b.near ||
          a.actor.actorId.localeCompare(b.actor.actorId),
      );
    const next = new Map<string, Active>();
    const selected: ActorSelection[] = [];
    let interactive = 0,
      skeletons = 0;
    for (const item of ranked) {
      if (selected.length >= this.profile.total) break;
      const { actor, near, player, previous, outsideSince } = item;
      if (actor.interactive && interactive >= this.profile.interactive)
        continue;
      if (actor.interactive) interactive++;
      const skeleton =
        actor.skeletonEligible &&
        near <=
          (previous?.skeleton
            ? this.profile.downgrade
            : this.profile.upgrade) &&
        skeletons < this.profile.skeletons;
      if (skeleton) skeletons++;
      next.set(actor.actorId, { outsideSince, skeleton });
      selected.push({
        actorId: actor.actorId,
        skeleton,
        visible: near <= this.profile.visible,
        collision: false,
        movementHz: player <= 35 ? 20 : 2,
        decisionHz: player <= 35 ? 5 : 1,
      });
    }
    // Collision prioritizes actual player distance, independently of rendering order.
    const collision = ranked
      .filter((a) => next.has(a.actor.actorId) && a.player <= 35)
      .sort(
        (a, b) =>
          a.player - b.player || a.actor.actorId.localeCompare(b.actor.actorId),
      )
      .slice(0, 12);
    const collisionIds = new Set(collision.map((a) => a.actor.actorId));
    for (const actor of selected)
      actor.collision = collisionIds.has(actor.actorId);
    this.active = next;
    return selected;
  }
  clear() {
    this.active.clear();
  }
  get size() {
    return this.active.size;
  }
}

export interface LocalEvent extends SurfaceIdentity {
  eventId: string;
  position: Point3;
  radius: number;
  now: number;
}
/** Surface-keyed bins: an underground horn cannot wake a street-level actor. */
export class ActorEventGrid {
  private bins = new Map<string, ActorCandidate[]>();
  private cooldown = new Map<string, number>();
  constructor(
    readonly cellSize = 16,
    readonly maxEvents = 128,
  ) {
    if (
      !Number.isFinite(cellSize) ||
      cellSize <= 0 ||
      !Number.isInteger(maxEvents) ||
      maxEvents < 1
    )
      throw new Error('Invalid event grid');
  }
  rebuild(actors: readonly ActorCandidate[]) {
    this.bins.clear();
    for (const actor of actors) {
      if (!valid(actor)) throw new Error('Invalid event actor');
      const key = JSON.stringify([
        actor.surfaceId,
        actor.layer,
        Math.floor(actor.position[0] / this.cellSize),
        Math.floor(actor.position[2] / this.cellSize),
      ]);
      const list = this.bins.get(key) ?? [];
      list.push(actor);
      this.bins.set(key, list);
    }
  }
  query(event: LocalEvent, cooldownSeconds = 1): string[] {
    if (
      !event.eventId ||
      !Number.isFinite(event.now) ||
      !Number.isFinite(event.radius) ||
      event.radius < 0 ||
      event.radius > 120 ||
      !event.position.every(Number.isFinite) ||
      !Number.isFinite(cooldownSeconds) ||
      cooldownSeconds < 0
    )
      return [];
    for (const [id, until] of this.cooldown)
      if (until <= event.now) this.cooldown.delete(id);
    if (this.cooldown.has(event.eventId)) return [];
    // Fail closed when bounded dedup storage is saturated, do not evict live events.
    if (this.cooldown.size >= this.maxEvents) return [];
    this.cooldown.set(event.eventId, event.now + cooldownSeconds);
    const result = new Set<string>();
    const [x, , z] = event.position,
      r = event.radius;
    for (
      let bx = Math.floor((x - r) / this.cellSize);
      bx <= Math.floor((x + r) / this.cellSize);
      bx++
    )
      for (
        let bz = Math.floor((z - r) / this.cellSize);
        bz <= Math.floor((z + r) / this.cellSize);
        bz++
      )
        for (const actor of this.bins.get(
          JSON.stringify([event.surfaceId, event.layer, bx, bz]),
        ) ?? [])
          if (distance(actor.position, event.position) <= r)
            result.add(actor.actorId);
    return [...result].sort();
  }
}
