import * as THREE from 'three';
import { addStreetMeshes } from './street-meshes';
import type { CityEngine } from './engine';
import { cityRoadGraph } from './street-layout';
import extension from './street-curb-extensions.json';
import type { Point } from './road-graph';
import { buildPavement } from './pavement';
import { heritageFrames, partitionHeritagePaving } from './heritage-paving';
import { heritagePavingMaterial } from './heritage-paving-material';
import { getCityMaterialLibrary } from './material-library';
import { cityGroundMaterial } from './city-surface-material';
import {
  drapeTriangles,
  gridHeightField,
  splitGridLine,
} from './surface-meshing';

export function createRoadSurfaces(e: CityEngine) {
  const graph = cityRoadGraph(
      e.data.roads,
      e.data.trees.trees,
      e.data.causeway?.cuts,
    ),
    pavement = buildPavement(graph, {
      exclusions: e.data.causeway?.masks,
      sidewalkExtensions: graph.edges.some(
        (e) =>
          e.sourceIds.includes(extension.sourceRoadId) &&
          Math.abs(e.width - extension.asphaltWidth) < 0.05,
      )
        ? [
            {
              points: extension.points.map((p): Point => [p[0], p[1]]),
              level: 'ground',
            },
          ]
        : [],
      sidewalkWidth: (edge) =>
        edge.classes.every((c) => /lane|private|non.city|bikeway/i.test(c))
          ? 0
          : Math.max(2, (edge.corridorWidth - edge.width) / 2),
    });
  e.data.roadGraph = graph;
  const widths = new Map();
  for (const edge of graph.edges)
    for (const id of edge.sourceIds) {
      const feature = e.data.roads.features[Number(id.split(':')[0])];
      widths.set(
        feature,
        Math.min(widths.get(feature) ?? Infinity, edge.width),
      );
    }
  e.data.roadWidths = widths;
  const relief =
    e.data.roadRelief || gridHeightField((x, z) => e.elevation(x, z));
  e.data.roadRelief = relief;
  const library = getCityMaterialLibrary(e);
  const material = (kind: 'asphalt-fine' | 'sidewalk-concrete') => {
    if (!e.roadMaterials.has(kind))
      e.roadMaterials.set(
        kind,
        cityGroundMaterial(library, kind === 'asphalt-fine' ? 7 : 2),
      );
    return e.roadMaterials.get(kind)!;
  };
  const waterFrames = heritageFrames(graph);
  let heritageTriangles = 0;
  for (const [source, kind, offset] of [
    [pavement.asphalt, 'asphalt-fine', 1.05],
    [pavement.sidewalks, 'sidewalk-concrete', 1.18],
  ] as const) {
    const { positions, uv } = drapeTriangles(
      source.vertices,
      source.indices,
      (x, z) => relief(x, z) + offset,
    );
    const sidewalk = kind === 'sidewalk-concrete';
    const { plain, heritage } = partitionHeritagePaving(
      positions,
      uv,
      waterFrames,
      sidewalk,
    );
    addStreetMeshes(
      e,
      plain.positions,
      material(kind),
      sidewalk ? 'Clipped sidewalks' : 'Connected road pavement',
      plain.uv,
      true,
      !sidewalk,
    );
    if (heritage.positions.length) {
      const detailed = heritagePavingMaterial(
        material(kind),
        sidewalk,
        library,
      );
      addStreetMeshes(
        e,
        heritage.positions,
        detailed,
        sidewalk ? 'Water Street brick footways' : 'Water Street brick road',
        heritage.uv,
        true,
        !sidewalk,
        false,
        false,
        { aHeritagePaving: { array: heritage.paving, itemSize: 4 } },
      );
      heritageTriangles += heritage.positions.length / 9;
    }
  }
  const positions: number[] = [],
    uv: number[] = [];
  for (const curb of pavement.curbs) {
    const points = splitGridLine(curb.a, curb.b);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const ay = relief(a[0], a[1]) + 1.05,
        by = relief(b[0], b[1]) + 1.05;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const [x, y, z, u, v] of [
        [a[0], ay, a[1], 0, 0],
        [b[0], by, b[1], length, 0],
        [b[0], by + 0.13, b[1], length, 0.13],
        [a[0], ay, a[1], 0, 0],
        [b[0], by + 0.13, b[1], length, 0.13],
        [a[0], ay + 0.13, a[1], 0, 0.13],
      ]) {
        positions.push(x, y, z);
        // Shared ground materials interpret every incoming UV as metres / 3,
        // including these vertical curb strips (whose local u follows length).
        uv.push(u / 3, v / 3);
      }
    }
  }
  addStreetMeshes(
    e,
    positions,
    material('sidewalk-concrete'),
    'Road-facing curb edges',
    uv,
  );
  e.data.pavementStats = {
    ...pavement.stats,
    curbSegments: pavement.curbs.length,
    heritageFrames: waterFrames.length,
    heritageTriangles,
  };
  e.stats.roads = graph.edges.length;
}
