import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './city-modules.mjs';
import { cityElevation } from './city-elevation.mjs';

const { cityRoadGraph } = await import(cityModule('street-layout'));
const { buildPavement } = await import(cityModule('pavement'));
const { gridHeightField, drapeTriangles } = await import(
  cityModule('surface-meshing')
);
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));

/** Real road sources and the production pavement/drape/Float32 path, kept
 * small enough for a repeatable CPU regression and microbenchmark. */
export function groundSurfaceRoadFixture() {
  const source = JSON.parse(readFileSync('public/data/roads.geojson', 'utf8'));
  const names = [
    'ROBSON ST',
    'BURRARD ST',
    'GRANVILLE ST',
    'WATER ST',
    'DENMAN ST',
  ];
  const features = names.flatMap((name) =>
    source.features
      .filter(
        (f) => f.properties.name === name && f.properties.class === 'Arterial',
      )
      .slice(0, 4),
  );
  const graph = cityRoadGraph({ features });
  const pavement = buildPavement(graph);
  const relief = gridHeightField(cityElevation);
  const meshes = [pavement.asphalt, pavement.sidewalks].map((surface, i) => {
    const { positions } = drapeTriangles(
      surface.vertices,
      surface.indices,
      (x, z) => relief(x, z) + (i ? 1.18 : 1.05),
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return new THREE.Mesh(geometry);
  });
  const index = new GroundSurfaceIndex(meshes, [], {
    cacheEdgeTolerances: true,
  });
  const defaultIndex = new GroundSurfaceIndex(meshes);
  let seed = 0x4a17c0de;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const queries = [];
  for (let i = 0; i < 2000; i++) {
    const edge = graph.edges[Math.floor(random() * graph.edges.length)];
    const a = graph.nodes[edge.a].point,
      b = graph.nodes[edge.b].point;
    const t = random(),
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    const offset = (random() - 0.5) * (edge.corridorWidth + 8);
    const x = a[0] + dx * t - (dz / length) * offset;
    const z = a[1] + dz * t + (dx / length) * offset;
    queries.push([x, z, relief(x, z) + 1.05 + (i % 7 === 0 ? 5 : 0)]);
  }
  return {
    index,
    defaultIndex,
    queries,
    names: [...new Set(features.map((f) => f.properties.name))],
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
