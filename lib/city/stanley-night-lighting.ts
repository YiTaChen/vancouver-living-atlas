import source from './stanley-lighting-source.json';
import { inPolygon, project } from './geo';
import type { RoadGraph } from './road-graph';

export const STANLEY_LIGHTING_SOURCE = source;
/** Sub-metre duplicate inventory observations share one fixture/pool/collider.
 * Every original block:node ID remains attached to that stable physical group. */
export const STANLEY_POLE_DEDUP_METRES = 1;
export interface StanleySourcePole {
  sourceIds: string[];
  coordinates: number[];
  point: [number, number];
}
export interface StanleyLampMapping extends StanleySourcePole {
  /** Index in the final streetLampPoints / visible instances / impact world. */
  lampIndex: number;
}
export interface StanleyRejectedPole extends StanleySourcePole {
  /** No render/impact slot is allocated for an unsupported source position. */
  lampIndex: null;
  reason: 'outside-current-runtime-land';
}

export function stanleySourcePoles(): StanleySourcePole[] {
  const poles: StanleySourcePole[] = [];
  for (const record of source.records) {
    const point = project(record.coordinates),
      duplicate = poles.find(
        (pole) =>
          Math.hypot(pole.point[0] - point[0], pole.point[1] - point[1]) <
          STANLEY_POLE_DEDUP_METRES,
      );
    if (duplicate) duplicate.sourceIds.push(record.id);
    else
      poles.push({
        sourceIds: [record.id],
        coordinates: [...record.coordinates],
        point,
      });
  }
  return poles;
}

/** The municipal inventory has pole positions, not fixture orientation. Aim the
 * existing inexpensive fixture toward the closest ground road segment without
 * moving its surveyed base or claiming this representative model is surveyed. */
function roadFacingYaw(point: readonly number[], graph: RoadGraph) {
  let distanceSquared = Infinity,
    yaw = 0;
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a],
      b = graph.nodes[edge.b];
    if (a.level !== 'ground' || b.level !== 'ground') continue;
    const dx = b.point[0] - a.point[0],
      dz = b.point[1] - a.point[1],
      lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) continue;
    const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a.point[0]) * dx + (point[1] - a.point[1]) * dz) /
            lengthSquared,
        ),
      ),
      ox = a.point[0] + dx * t - point[0],
      oz = a.point[1] + dz * t - point[1],
      nextDistanceSquared = ox * ox + oz * oz;
    if (nextDistanceSquared >= distanceSquared) continue;
    distanceSquared = nextDistanceSquared;
    yaw = Math.atan2(oz, -ox);
  }
  return yaw;
}

/** Remove the procedural in-park lamps before publishing the common render /
 * physics array. Outside park order/poses are unchanged; source poles follow in
 * stable source-ID order. A municipal observation cannot override the current
 * physical coastline: keep unsupported observations in metadata, without a
 * floating visible fixture, baked pool or stale invisible collider. */
export function reconcileStanleyStreetLamps(
  procedural: readonly number[][],
  parkPolygons: readonly number[][][][],
  graph: RoadGraph,
  supportedBase: (x: number, z: number) => boolean,
) {
  const lampPoints = procedural.filter(
    (point) =>
      !parkPolygons.some((polygon) => inPolygon([point[0], point[1]], polygon)),
  );
  const inventoryPoles = stanleySourcePoles(),
    sourcePoles: StanleyLampMapping[] = [],
    rejectedPoles: StanleyRejectedPole[] = [];
  for (const pole of inventoryPoles) {
    if (!supportedBase(...pole.point)) {
      rejectedPoles.push({
        ...pole,
        lampIndex: null,
        reason: 'outside-current-runtime-land',
      });
      continue;
    }
    const lampIndex = lampPoints.length;
    lampPoints.push([...pole.point, roadFacingYaw(pole.point, graph)]);
    sourcePoles.push({ ...pole, lampIndex });
  }
  return {
    lampPoints,
    sourcePoles,
    inventoryPoles,
    rejectedPoles,
    removedProcedural:
      procedural.length - (lampPoints.length - sourcePoles.length),
    inventoryRecords: source.records.length,
    inventoryFixtures: inventoryPoles.length,
    admittedFixtures: sourcePoles.length,
    rejectedCoastMismatch: rejectedPoles.length,
  };
}

/** Only source-local fields use this receiver permission. It is deliberately
 * independent of the downtown policy, and never grants global forest fill. */
export function createStanleyNightPolicy(
  parkPolygons: readonly number[][][][],
  waterPolygons: readonly number[][][][],
  onLand: (x: number, z: number) => boolean,
) {
  return (x: number, z: number) =>
    onLand(x, z) &&
    parkPolygons.some((polygon) => inPolygon([x, z], polygon)) &&
    !waterPolygons.some((polygon) => inPolygon([x, z], polygon));
}

/** Tight source extent gives the fixed 512² park field useful metre-scale
 * sampling. The caller may include a 1.55m head offset inside this 40m margin. */
export function stanleyNightBounds() {
  const points = stanleySourcePoles().map((pole) => pole.point);
  return {
    minX: Math.min(...points.map((p) => p[0])) - 40,
    maxX: Math.max(...points.map((p) => p[0])) + 40,
    minZ: Math.min(...points.map((p) => p[1])) - 40,
    maxZ: Math.max(...points.map((p) => p[1])) + 40,
  };
}
