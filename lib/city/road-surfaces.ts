import * as THREE from 'three';
import { addStreetMeshes } from './street-meshes';
import type { CityEngine } from './engine';
import { cityRoadGraph } from './street-layout';
import extension from './street-curb-extensions.json';
import type { Point } from './road-graph';
import { buildPavement } from './pavement';
import {
  drapeTriangles,
  gridHeightField,
  splitGridLine,
} from './surface-meshing';

export function createRoadSurfaces(e: CityEngine) {
  const graph = cityRoadGraph(e.data.roads, e.data.trees.trees),
    pavement = buildPavement(graph, {
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
  const relief = gridHeightField((x, z) => e.elevation(x, z));
  e.data.roadRelief = relief;
  const loader = new THREE.TextureLoader();
  const material = (kind: 'asphalt-fine' | 'sidewalk-concrete') => {
    if (!e.roadMaterials.has(kind)) {
      const map = loader.load(`/textures/${kind}-albedo.png`);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      const normalMap =
        kind === 'asphalt-fine'
          ? loader.load('/textures/asphalt-fine-normal.png')
          : null;
      if (normalMap) {
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        normalMap.colorSpace = THREE.NoColorSpace;
        normalMap.anisotropy = 8;
      }
      e.roadMaterials.set(
        kind,
        new THREE.MeshStandardMaterial({
          map,
          normalMap,
          normalScale: new THREE.Vector2(0.32, 0.32),
          color: 0xe1e2df,
          roughness: 0.94,
          side: THREE.DoubleSide,
        }),
      );
    }
    return e.roadMaterials.get(kind)!;
  };
  for (const [source, kind, offset] of [
    [pavement.asphalt, 'asphalt-fine', 1.05],
    [pavement.sidewalks, 'sidewalk-concrete', 1.18],
  ] as const) {
    const { positions, uv } = drapeTriangles(
      source.vertices,
      source.indices,
      (x, z) => relief(x, z) + offset,
    );
    addStreetMeshes(
      e,
      positions,
      material(kind),
      kind === 'asphalt-fine' ? 'Connected road pavement' : 'Clipped sidewalks',
      uv,
      true,
      kind === 'asphalt-fine',
    );
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
        uv.push(u, v);
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
  };
  e.stats.roads = graph.edges.length;
}
