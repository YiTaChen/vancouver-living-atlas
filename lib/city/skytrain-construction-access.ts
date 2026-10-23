/** Temporary, explicitly signposted construction access. This additive adapter
 * preserves station source packets and derives every destination from an actual
 * entrance-to-platform route; it never creates a boarding or train shortcut. */
import * as THREE from 'three';
import {
  SKYTRAIN_LINES,
  type LineId,
  type SkyTrainDirection,
  type StationId,
} from './skytrain-network';
import type {
  SkyTrainStationOwner,
  StationPoint,
  StationVector,
} from './skytrain-stations';

export interface StationConstructionPortal {
  id: string;
  pairId: string;
  kind: 'platform' | 'exit';
  stationId: StationId;
  entranceId: string;
  entranceLabel: string;
  lineId: LineId;
  directions: SkyTrainDirection[];
  platformSurfaceId: string;
  /** Human-readable destination, shared by the physical sign and interaction. */
  label: string;
  /** Supported station-local feet; yaw faces the approaching pedestrian. */
  point: StationPoint;
  signSide: -1 | 1;
  /** Explicit supported A-frame centre, avoiding the normal pedestrian lane. */
  signPosition?: StationVector;
  target:
    | { kind: 'platform'; point: StationPoint }
    | { kind: 'street'; position: StationVector; yaw: number };
}

const pointCopy = (point: StationPoint): StationPoint => ({
  ...point,
  position: [...point.position],
});
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const heading = (dx: number, dz: number) => Math.atan2(dx, dz);
function supported(
  owner: SkyTrainStationOwner,
  position: StationVector,
  surfaceId?: string,
): StationPoint | null {
  const point = owner.floorAt(position, surfaceId);
  return point && owner.isClearFoot(point) && !owner.streetExit(point)
    ? point
    : null;
}
function clearDisc(
  owner: SkyTrainStationOwner,
  point: StationPoint,
  radius: number,
) {
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    if (
      !supported(
        owner,
        [
          point.position[0] + Math.cos(angle) * radius,
          point.position[1],
          point.position[2] + Math.sin(angle) * radius,
        ],
        point.surfaceId,
      )
    )
      return false;
  }
  return true;
}
function signFits(
  owner: SkyTrainStationOwner,
  position: StationVector,
  yaw: number,
) {
  // Includes clearance around the visual's 0.66 x 0.52 m A-frame footprint.
  for (const x of [-0.4, 0, 0.4])
    for (const z of [-0.34, 0, 0.34])
      if (
        !supported(owner, [
          position[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
          position[1],
          position[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
        ])
      )
        return false;
  return true;
}

/** One outward and return portal per existing entrance/distinct-platform route.
 * Pass the city's rendered groundHeight callback for exact outside support.
 * Legacy owners without the street overlay expose no construction portals. */
export function stationConstructionPortals(
  owner: SkyTrainStationOwner,
  streetHeightAt?: (x: number, z: number) => number,
): readonly StationConstructionPortal[] {
  if (owner.stats().disposed) return [];
  const routes = owner.streetRoutes(),
    entrances = owner.streetEntrances(),
    portals: StationConstructionPortal[] = [],
    reserved = new Map<string, StationVector[]>();
  for (const route of routes) {
    const entrance = entrances.find((e) => e.id === route.entranceId),
      platforms = owner.geometryData.platforms.filter(
        (p) => p.surfaceId === route.platformSurfaceId,
      ),
      floor = owner.geometryData.floors.find(
        (f) => f.id === route.platformSurfaceId,
      );
    if (!entrance || !platforms.length || !floor)
      throw new Error('Construction access requires an existing street route');
    const siblings = routes.filter((r) => r.entranceId === entrance.id),
      slot = siblings.indexOf(route),
      lateral = (slot - (siblings.length - 1) / 2) * 2.3,
      threshold = owner.toLocal(entrance.threshold),
      inward = new THREE.Vector3(...entrance.localDirection),
      side = new THREE.Vector3(inward.z, 0, -inward.x),
      sourceRaw = new THREE.Vector3(...threshold)
        .addScaledVector(inward, 0.6)
        .addScaledVector(side, lateral),
      // The rendered street apron can slope or step across this fanout. Its
      // threshold height is not the floor height at a lateral portal position.
      // Resolve the existing flat vestibule at that datum instead of forcing a
      // named apron lookup whose height tolerance may reject a valid landing.
      source = supported(owner, sourceRaw.toArray()),
      sourceYaw = heading(-inward.x, -inward.z);
    if (!source)
      throw new Error(`Unsupported construction vestibule: ${entrance.id}`);
    source.yaw = sourceYaw;
    const sourceSign = new THREE.Vector3(...threshold)
      .addScaledVector(inward, 1.5)
      .addScaledVector(side, siblings.length > 1 ? lateral : 1.1)
      .toArray();
    if (!signFits(owner, sourceSign, sourceYaw))
      throw new Error(`Unsupported construction sign: ${entrance.id}`);

    const endpoint = route.points.at(-1)!,
      target = supported(owner, endpoint, route.platformSurfaceId);
    if (!target) throw new Error('Construction platform target is unsupported');
    const prior = [...route.points]
      .reverse()
      .find((p) => distance(p, endpoint) > 0.05)!;
    target.yaw = heading(endpoint[0] - prior[0], endpoint[2] - prior[2]);
    const bounds = new THREE.Box3().setFromPoints(
        floor.vertices.map((p) => new THREE.Vector3(...p)),
      ),
      center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3()),
      alongZ = size.z > size.x,
      toward = alongZ
        ? Math.sign(center.z - endpoint[2]) || 1
        : Math.sign(center.x - endpoint[0]) || 1,
      boardingPoints = platforms.flatMap((platform) =>
        owner
          .boardingDoors(platform.line, platform.direction)
          .map((door) => door.waiting.position),
      ),
      used = reserved.get(floor.id) ?? [];
    let returnPoint: StationPoint | null = null,
      returnSign: StationVector | null = null,
      signSide: -1 | 1 = 1;
    search: for (let along = 4; along < Math.max(size.x, size.z) - 4; along++)
      for (const cross of [0, 0.6, -0.6, 1.2, -1.2]) {
        const raw: StationVector = alongZ
            ? [center.x + cross, endpoint[1], endpoint[2] + toward * along]
            : [endpoint[0] + toward * along, endpoint[1], center.z + cross],
          point = supported(owner, raw, floor.id);
        if (
          !point ||
          distance(point.position, target.position) < 2.8 ||
          boardingPoints.some((p) => distance(p, point.position) < 2.2) ||
          used.some((p) => distance(p, point.position) < 2.5) ||
          !clearDisc(owner, point, 0.82)
        )
          continue;
        point.yaw = heading(
          target.position[0] - point.position[0],
          target.position[2] - point.position[2],
        );
        for (const sign of [1, -1] as const) {
          const signAt: StationVector = [
            raw[0] + Math.cos(point.yaw) * sign * 1.35,
            raw[1],
            raw[2] - Math.sin(point.yaw) * sign * 1.35,
          ];
          if (
            !signFits(owner, signAt, point.yaw) ||
            used.some((p) => distance(p, signAt) < 1.4)
          )
            continue;
          returnPoint = point;
          returnSign = signAt;
          signSide = sign;
          break search;
        }
      }
    if (!returnPoint || !returnSign)
      throw new Error(`No clear construction portal on ${floor.id}`);
    used.push([...returnPoint.position]);
    reserved.set(floor.id, used);
    const lineId = platforms[0].line,
      directions = [...new Set(platforms.map((p) => p.direction))],
      directionLabel = directions
        .map((direction) => direction[0].toUpperCase() + direction.slice(1))
        .join(' / '),
      pairId = `${owner.data.id}:${entrance.id}:${floor.id}`,
      common = {
        pairId,
        stationId: owner.data.id,
        entranceId: entrance.id,
        entranceLabel: entrance.label,
        lineId,
        directions,
        platformSurfaceId: floor.id,
      };
    portals.push({
      ...common,
      id: `${pairId}:platform`,
      kind: 'platform',
      label: `${SKYTRAIN_LINES[lineId].name} · ${directionLabel} platform`,
      point: source,
      signSide: lateral < 0 ? -1 : 1,
      signPosition: sourceSign,
      target: { kind: 'platform', point: pointCopy(target) },
    });
    const outside = new THREE.Vector3(...entrance.threshold)
      .addScaledVector(
        new THREE.Vector3(...entrance.localDirection).applyQuaternion(
          owner.group.quaternion,
        ),
        -3.7,
      )
      .toArray();
    outside[1] = streetHeightAt
      ? streetHeightAt(outside[0], outside[2])
      : entrance.outward[1];
    portals.push({
      ...common,
      id: `${pairId}:exit`,
      kind: 'exit',
      label: `Street · ${entrance.label}`,
      point: returnPoint,
      signSide,
      signPosition: returnSign,
      target: {
        kind: 'street',
        position: outside,
        yaw: heading(-inward.x, -inward.z) + owner.yaw,
      },
    });
  }
  return portals;
}
