import * as THREE from 'three';
import { addStreetMeshes } from './street-meshes';
import type { CityEngine } from './engine';
import { GroundSurfaceIndex } from './ground-surface';
import { inPolygon } from './geo';
import { sampleStations, type RoadGraph } from './road-graph';
import { streetPaint } from './street-layout';
import { drapeTriangles } from './surface-meshing';
import type { Point } from './road-graph';

/** One static preparation pass. No per-frame topology, lights or mesh creation. */
export function roadDecorations(e: CityEngine, graph: RoadGraph) {
  const asphalt: THREE.Mesh[] = [];
  e.roads.traverse((m) => {
    if (
      m instanceof THREE.Mesh &&
      m.userData.asphaltSurface &&
      !m.userData.protectedSurface
    )
      asphalt.push(m);
  });
  const surfaces = new GroundSurfaceIndex(asphalt);
  e.data.roadSurface = surfaces;
  const surfaceY = (x: number, z: number) =>
    surfaces.sample(x, z, e.elevation(x, z) + 1.05);
  const layout = streetPaint(graph),
    positions: number[] = [];
  for (const rect of layout.paint) {
    const [dx, dz] = rect.tangent,
      px = dz,
      pz = -dx,
      [x, z] = rect.center;
    const corners = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ].map(
      ([f, s]): Point => [
        x + ((dx * rect.length) / 2) * f + ((px * rect.width) / 2) * s,
        z + ((dz * rect.length) / 2) * f + ((pz * rect.width) / 2) * s,
      ],
    );
    const heights = corners.map(([xx, zz]) => surfaceY(xx, zz));
    if (heights.some((h) => h === undefined)) continue;
    const draped = drapeTriangles(
      corners,
      [0, 1, 2, 0, 2, 3],
      (xx, zz) => e.data.roadRelief(xx, zz) + 1.075,
    );
    positions.push(...draped.positions);
  }
  addStreetMeshes(
    e,
    positions,
    new THREE.MeshStandardMaterial({
      color: 0xd9d8c9,
      roughness: 0.93,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    'Road paint',
  );
  const lamps: number[][] = [],
    nearby = new Map<string, number[][]>();
  for (const path of graph.paths)
    for (const s of sampleStations(path, 45, 16, 10, path.length - 10)) {
      const edge = graph.edges[path.edgeIds[s.segment]];
      if (edge.classes.every((c) => /lane|private|non.city|bikeway/i.test(c)))
        continue;
      const [dx, dz] = s.tangent,
        x = s.point[0] + dz * (edge.width / 2 + 1),
        z = s.point[1] - dx * (edge.width / 2 + 1);
      if (
        !e.onLand(x, z) ||
        surfaceY(x, z) !== undefined ||
        e.waterWorld.solidAt(x, z) ||
        e.data.waterPolys.some((p: number[][][]) => inPolygon([x, z], p))
      )
        continue;
      const gx = Math.floor(x / 15),
        gz = Math.floor(z / 15);
      let crowded = false;
      for (let xx = gx - 1; xx <= gx + 1; xx++)
        for (let zz = gz - 1; zz <= gz + 1; zz++)
          if (
            (nearby.get(`${xx},${zz}`) || []).some(
              (p) => Math.hypot(p[0] - x, p[1] - z) < 12,
            )
          )
            crowded = true;
      if (crowded) continue;
      const key = `${gx},${gz}`,
        cell = nearby.get(key) || [];
      cell.push([x, z]);
      nearby.set(key, cell);
      lamps.push([x, z, Math.atan2(dx, dz)]);
    }
  e.data.streetGeometry = {
    graphEdges: graph.edges.length,
    junctions: graph.junctions.length,
    crossings: layout.crossings.length,
    paintTriangles: positions.length / 9,
    lamps: lamps.length,
  };
  return lamps;
}
