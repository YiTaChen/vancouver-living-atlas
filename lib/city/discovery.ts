import {
  DISCOVERY_ROUTES,
  discoveryRoute,
  discoveryLegStart,
  type DiscoveryRoute,
} from './discovery-routes';
export const DISCOVERY_STORAGE_KEY = 'vancouver-atlas-discovery-v1';
export const DISCOVERY_RADIUS = 12;
export interface DiscoveryProgress {
  next: number;
  best: number;
  stamped: boolean;
}
export interface DiscoverySave {
  version: 1;
  selected: string;
  routes: Record<string, DiscoveryProgress>;
}
export function emptyDiscoverySave(): DiscoverySave {
  return {
    version: 1,
    selected: DISCOVERY_ROUTES[0].id,
    routes: Object.fromEntries(
      DISCOVERY_ROUTES.map((route) => [
        route.id,
        { next: 0, best: 0, stamped: false },
      ]),
    ),
  };
}
/** Storage is untrusted input; discard unknown routes and future schema versions. */
export function readDiscoverySave(raw: string | null): DiscoverySave {
  const clean = emptyDiscoverySave();
  if (!raw) return clean;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || value.version !== 1)
      return clean;
    if (discoveryRoute(value.selected)) clean.selected = value.selected;
    for (const route of DISCOVERY_ROUTES) {
      const saved = value.routes?.[route.id];
      if (!saved || typeof saved !== 'object') continue;
      const count = (n: unknown) =>
        Number.isInteger(n) && Number(n) >= 0
          ? Math.min(route.stops.length, Number(n))
          : 0;
      const next = count(saved.next),
        best = Math.max(next, count(saved.best));
      clean.routes[route.id] = {
        next,
        best,
        stamped: saved.stamped === true && best === route.stops.length,
      };
      if (next === route.stops.length) clean.routes[route.id].stamped = true;
    }
  } catch {
    /* Corrupt or unavailable browser storage starts a fresh passport. */
  }
  return clean;
}
export interface DiscoverySample {
  x: number;
  z: number;
  mode: string;
  now: number;
  visible: boolean;
  grounded: boolean;
}
export interface DiscoveryStatus {
  distance: number;
  bearing: number;
  walked: number;
  required: number;
  eligible: boolean;
  walking: boolean;
  discontinuity: boolean;
}
/** Tracks accepted live navigation displacement, not camera targets or elapsed time.
 * Large moves, hidden tabs and mode changes cannot manufacture walking credit. */
export class DiscoveryLeg {
  private previous: DiscoverySample | null = null;
  private suspendedPosition: readonly [number, number] | null = null;
  walked = 0;
  discontinuity = false;
  readonly required: number;
  constructor(
    readonly route: DiscoveryRoute,
    readonly next: number,
  ) {
    const start = discoveryLegStart(route, next),
      stop = route.stops[next];
    this.required = stop
      ? Math.max(
          0,
          Math.hypot(stop.position[0] - start[0], stop.position[1] - start[1]) -
            DISCOVERY_RADIUS * 1.5,
        )
      : Infinity;
  }
  sample(value: DiscoverySample): DiscoveryStatus {
    const stop = this.route.stops[this.next];
    const finite = [value.x, value.z, value.now].every(Number.isFinite);
    const walking =
      finite && value.visible && value.mode === 'walk' && value.grounded;
    if (!walking) {
      if (this.previous && !this.suspendedPosition)
        this.suspendedPosition = [this.previous.x, this.previous.z];
      if (value.mode !== 'walk' || !value.grounded) {
        this.walked = 0;
        this.discontinuity = true;
      }
      this.previous = null;
    } else if (this.suspendedPosition) {
      if (
        Math.hypot(
          value.x - this.suspendedPosition[0],
          value.z - this.suspendedPosition[1],
        ) > 2
      ) {
        this.walked = 0;
        this.discontinuity = true;
      }
      this.suspendedPosition = null;
    } else if (this.previous) {
      const elapsed = (value.now - this.previous.now) / 1000;
      const moved = Math.hypot(
        value.x - this.previous.x,
        value.z - this.previous.z,
      );
      // Navigation supports 12 m/s with Shift. The 2 m tolerance covers timer
      // jitter, while >1.5 s gaps intentionally do not infer unseen movement.
      if (elapsed <= 0 || elapsed > 1.5 || moved > elapsed * 14 + 2) {
        if (moved > 2) {
          this.walked = 0;
          this.discontinuity = true;
        }
      } else {
        this.walked += moved;
        if (this.walked >= this.required) this.discontinuity = false;
      }
    }
    this.previous = walking ? { ...value } : null;
    const dx = stop && finite ? stop.position[0] - value.x : Infinity;
    const dz = stop && finite ? stop.position[1] - value.z : Infinity;
    const distance = Math.hypot(dx, dz);
    return {
      distance,
      bearing: Math.atan2(dx, -dz),
      walked: this.walked,
      required: this.required,
      eligible:
        walking &&
        distance <= DISCOVERY_RADIUS &&
        this.walked + 0.01 >= this.required,
      walking,
      discontinuity: this.discontinuity,
    };
  }
}
export function startDiscovery(
  save: DiscoverySave,
  route: DiscoveryRoute,
): DiscoverySave {
  const progress = save.routes[route.id];
  return {
    ...save,
    selected: route.id,
    routes: {
      ...save.routes,
      [route.id]: {
        ...progress,
        next: progress.next >= route.stops.length ? 0 : progress.next,
      },
    },
  };
}
export function collectDiscovery(
  save: DiscoverySave,
  leg: DiscoveryLeg,
  sample: DiscoverySample,
): DiscoverySave {
  const progress = save.routes[leg.route.id];
  if (
    !progress ||
    save.selected !== leg.route.id ||
    progress.next !== leg.next ||
    !leg.sample(sample).eligible
  )
    return save;
  const next = progress.next + 1;
  return {
    ...save,
    routes: {
      ...save.routes,
      [leg.route.id]: {
        next,
        best: Math.max(progress.best, next),
        stamped: progress.stamped || next === leg.route.stops.length,
      },
    },
  };
}
