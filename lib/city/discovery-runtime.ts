import type { CityEngine } from './engine';
import { discoveryLegStart, type DiscoveryRoute } from './discovery-routes';
import type { DiscoverySample } from './discovery';

/** Preflight every remaining virtual trail segment against the live collision
 * model before changing travel state. Source path identity alone is not enough. */
export function canStartDiscovery(
  city: CityEngine,
  route: DiscoveryRoute,
  next: number,
) {
  const nav = city.navigation;
  if (!nav || next < 0 || next >= route.stops.length) return false;
  for (let index = next; index < route.stops.length; index++) {
    const a = discoveryLegStart(route, index),
      b = route.stops[index].position;
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    const count = Math.ceil(length / 3);
    for (let step = 0; step <= count; step++) {
      const t = step / count;
      for (const offset of [-0.45, 0, 0.45]) {
        const x = a[0] + dx * t - (dz / length) * offset;
        const z = a[1] + dz * t + (dx / length) * offset;
        if (
          !nav.clearGround(x, z, 'walk') ||
          city.data.travelSurfaces?.lookup(x, z).length
        )
          return false;
      }
    }
  }
  return true;
}
export function placeDiscoveryStart(
  city: CityEngine,
  route: DiscoveryRoute,
  next: number,
) {
  if (!canStartDiscovery(city, route, next)) return false;
  const nav = city.navigation!,
    point = discoveryLegStart(route, next),
    stop = route.stops[next];
  city.flight?.clear();
  city.placement?.cancel();
  city.applySettings({
    ...city.settings,
    mode: 'walk',
    autoRotate: false,
    buildings: true,
  });
  return nav.startAt('walk', {
    x: point[0],
    z: point[1],
    y: nav.roadHeight(point[0], point[1]),
    yaw: Math.atan2(stop.position[0] - point[0], stop.position[1] - point[1]),
    surface: 'ground',
    name: route.title.en,
    snappedDistance: 0,
  });
}
export function discoverySample(
  city: CityEngine,
  now = performance.now(),
): DiscoverySample {
  const nav = city.navigation;
  return {
    x: nav?.position.x ?? NaN,
    z: nav?.position.z ?? NaN,
    mode: nav?.mode ?? 'orbit',
    now,
    visible: !document.hidden,
    grounded:
      !!nav &&
      nav.surface === 'ground' &&
      Math.abs(
        nav.position.y - nav.roadHeight(nav.position.x, nav.position.z),
      ) < 3,
  };
}
