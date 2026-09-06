import { lines, project } from './geo';
import { constrainCarriageway } from './tree-road-clearance';
import { groupNumberedBlocks } from './numbered-blocks';
import type { FeatureCollection } from './types';
import {
  buildRoadGraph,
  createCrossings,
  sampleAt,
  sampleStations,
  type Point,
  type RoadInput,
  type RoadGraph,
} from './road-graph';

/** The source has estimated widths but no lane/crossing survey. Keep paint
 * conservative and exclude known bridge/causeway topology from the ground graph. */
export function cityRoadGraph(
  data: FeatureCollection,
  treeCoordinates: number[][] = [],
): RoadGraph {
  const trees = treeCoordinates.map((point, id) => ({
    point: project(point),
    id,
  }));
  const inputs: RoadInput[] = [];
  data.features.forEach((f, index) => {
    const name = String(f.properties.name || ''),
      roadClass = String(f.properties.class || f.properties.type || '');
    if (/bridge|causeway/i.test(name) || /bikeway/i.test(roadClass)) return;
    const width =
      Number(f.properties.width) ||
      (/lane/i.test(roadClass) ? 4 : /arterial/i.test(roadClass) ? 18 : 9);
    lines(f).forEach((line, part) => {
      const points = line.map(project);
      const constraint =
        /^(WATER|ROBSON) ST$/i.test(name) && width >= 12
          ? constrainCarriageway(points, trees, width)
          : undefined;
      inputs.push({
        id: `${index}:${part}`,
        name,
        roadClass,
        width: constraint?.asphaltWidth ?? width,
        corridorWidth: width + 4,
        points,
        level: 'ground',
        crossingEligible:
          width >= 12 && !/lane|private|non.city/i.test(roadClass),
      });
    });
  });
  for (const block of groupNumberedBlocks(inputs).blocks) {
    const width = constrainCarriageway(
      block.points,
      trees,
      block.width,
    ).asphaltWidth;
    if (width !== undefined)
      for (const input of inputs)
        if (block.sourceIds.includes(input.id)) input.width = width;
  }
  return buildRoadGraph(inputs, { nodeIntersections: false, snapMeters: 0.75 });
}

export interface PaintRectangle {
  center: Point;
  tangent: Point;
  width: number;
  length: number;
}
export function streetPaint(graph: RoadGraph) {
  // Alley/access mouths are not inferred to have zebra crossings.
  const publicJunctions = graph.junctions.filter(
    (j) =>
      j.approaches.filter((a) =>
        a.edgeIds.some((id) =>
          graph.edges[id].classes.some(
            (c) => !/lane|private|non.city|bikeway/i.test(c),
          ),
        ),
      ).length >= 3,
  );
  const result = createCrossings({ ...graph, junctions: publicJunctions }),
    paint: PaintRectangle[] = [];
  const junctions = new Map(graph.junctions.map((j) => [j.nodeId, j]));
  const crossingsByEdge = new Map<number, typeof result.crossings>();
  for (const c of result.crossings) {
    for (const edge of c.edgeIds) {
      const list = crossingsByEdge.get(edge) || [];
      list.push(c);
      crossingsByEdge.set(edge, list);
    }
    const normal: Point = [c.tangent[1], -c.tangent[0]];
    const count = Math.max(1, Math.floor((c.width - 2) / 1.7));
    for (let i = 0; i < count; i++) {
      const side = (i - (count - 1) / 2) * 1.7;
      paint.push({
        center: [
          c.center[0] + normal[0] * side,
          c.center[1] + normal[1] * side,
        ],
        tangent: c.tangent,
        width: 0.8,
        length: c.depth,
      });
    }
  }
  for (const path of graph.paths) {
    const endBuffer = (id: number) => {
      const j = junctions.get(id);
      return j ? Math.max(...j.approaches.map((a) => a.width)) / 2 + 5 : 4;
    };
    for (const sample of sampleStations(
      path,
      15,
      8,
      endBuffer(path.nodeIds[0]),
      path.length - endBuffer(path.nodeIds.at(-1)!),
    )) {
      const edge = graph.edges[path.edgeIds[sample.segment]];
      if (!edge.crossingEligible) continue;
      // All four corners clear a crossing, including its immediate lead-in.
      if (
        (crossingsByEdge.get(edge.id) || []).some(
          (c) =>
            Math.hypot(
              sample.point[0] - c.center[0],
              sample.point[1] - c.center[1],
            ) <
            c.depth / 2 + 5,
        )
      )
        continue;
      const a = sampleAt(path, sample.distance - 2.2),
        b = sampleAt(path, sample.distance + 2.2);
      if (
        !a ||
        !b ||
        a.tangent[0] * b.tangent[0] + a.tangent[1] * b.tangent[1] < 0.985
      )
        continue;
      paint.push({
        center: sample.point,
        tangent: sample.tangent,
        width: 0.16,
        length: 4.4,
      });
    }
  }
  return { paint, crossings: result.crossings, rejected: result.rejected };
}
