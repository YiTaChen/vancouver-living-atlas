export type StreetMode = 'walk' | 'drive';
export type TravelMode = StreetMode | 'boat';
/** Land travel modes share the existing scene position; water needs a new drop. */
export function canSwitchStreetMode(from: string, to: string) {
  return (
    (from === 'walk' || from === 'drive') && (to === 'walk' || to === 'drive')
  );
}

export interface RoadSegment {
  a: number[];
  b: number[];
  name: string;
  h0?: number;
  h1?: number;
  width?: number;
}
export interface PlacementPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  surface: 'ground' | 'bridge' | 'water';
  waterId?: string;
  name: string;
  snappedDistance: number;
}
export type PlacementResult =
  | { valid: true; point: PlacementPoint }
  | {
      valid: false;
      reason:
        | 'placementInvalid'
        | 'placementRoadRequired'
        | 'placementOutside'
        | 'placementWaterRequired';
    };

/** Nearest position on the whole segment, including short segments and endpoints. */
export function closestOnSegment(x: number, z: number, s: RoadSegment) {
  const dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1];
  const length2 = dx * dx + dz * dz;
  if (length2 < 0.01) return null;
  const t = Math.max(
    0,
    Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / length2),
  );
  const px = s.a[0] + t * dx,
    pz = s.a[1] + t * dz;
  return {
    x: px,
    z: pz,
    t,
    distance: Math.hypot(x - px, z - pz),
    yaw: Math.atan2(dx, dz),
  };
}

export interface PlacementWorld {
  roads: RoadSegment[];
  bridges: RoadSegment[];
  elevation: (x: number, z: number) => number;
  contains: (x: number, z: number) => boolean;
  clear: (x: number, z: number) => boolean;
}

export function resolvePlacement(
  mode: StreetMode,
  hit: { x: number; y: number; z: number; surface: 'ground' | 'bridge' },
  world: PlacementWorld,
  radius: number,
  heading: number,
): PlacementResult {
  const bridge = hit.surface === 'bridge';
  if (!bridge && !world.contains(hit.x, hit.z))
    return { valid: false, reason: 'placementOutside' };
  if (!bridge && !world.clear(hit.x, hit.z))
    return { valid: false, reason: 'placementInvalid' };
  if (mode === 'walk') {
    if (
      !bridge &&
      ![
        [0.4, 0],
        [-0.4, 0],
        [0, 0.4],
        [0, -0.4],
      ].every(([dx, dz]) => world.clear(hit.x + dx, hit.z + dz))
    )
      return { valid: false, reason: 'placementInvalid' };
    return {
      valid: true,
      point: {
        ...hit,
        y: bridge ? hit.y : world.elevation(hit.x, hit.z) + 1.25,
        yaw: heading,
        name: '',
        snappedDistance: 0,
      },
    };
  }
  let chosen: PlacementPoint | null = null;
  let best = Math.max(4, Math.min(30, radius));
  for (const road of bridge ? world.bridges : world.roads) {
    const p = closestOnSegment(hit.x, hit.z, road);
    if (!p || p.distance > best) continue;
    const y = bridge
      ? road.h0! + (road.h1! - road.h0!) * p.t
      : world.elevation(p.x, p.z) + 1.25;
    // A road under an overpass must not capture a drop on its deck.
    if (bridge && Math.abs(y - hit.y) > 4) continue;
    if (
      !bridge &&
      ![-2.4, 0, 2.4].every((forward) =>
        [-1.1, 0, 1.1].every((side) => {
          const x = p.x + Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side;
          const z = p.z + Math.cos(p.yaw) * forward - Math.sin(p.yaw) * side;
          return world.contains(x, z) && world.clear(x, z);
        }),
      )
    )
      continue;
    let yaw = p.yaw;
    // Face along the road in the direction closest to the overview camera.
    if (Math.cos(yaw - heading) < 0) yaw += Math.PI;
    best = p.distance;
    chosen = {
      x: p.x,
      y,
      z: p.z,
      yaw,
      surface: hit.surface,
      name: road.name,
      snappedDistance: p.distance,
    };
  }
  return chosen
    ? { valid: true, point: chosen }
    : { valid: false, reason: 'placementRoadRequired' };
}
