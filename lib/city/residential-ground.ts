import * as THREE from 'three';
import {
  createPerennialQAEvidence,
  appendBlenderPerennialQA,
} from './residential-perennial-qa';
import type { CityEngine } from './engine';
import { GroundSurfaceIndex } from './ground-surface';
import { project, rings } from './geo';
import { structureKey, hashId, fitBays, type Profile } from './facade-profile';
import { replacedBuilding } from './replaced-buildings';
import { roofFrame } from './building-roof';
import {
  visibilityGeometry as g,
  type Point,
  type Triangle,
  type Bounds,
} from './ground-visibility';
import {
  RESIDENTIAL_GROUND_LIMITS as limits,
  ResidentialSpatialIndex,
  residentialBeds,
  residentialOverlap,
  drapeResidentialBed,
} from './residential-ground-plan';

type Footprint = {
  key: string;
  polygon: Point[];
  bounds: Bounds;
  min: number;
  height: number;
};
/** Read final visible triangle positions, respecting transformations/drawRange. */
export function residentialSurfaceTriangles(mesh: THREE.Mesh): Triangle[] {
  const out: Triangle[] = [],
    geometry = mesh.geometry,
    position = geometry.getAttribute('position'),
    index = geometry.index;
  if (!position) return out;
  mesh.updateWorldMatrix(true, false);
  const start = Math.max(0, geometry.drawRange.start),
    end = Math.min(
      index?.count ?? position.count,
      start + geometry.drawRange.count,
    );
  const p = new THREE.Vector3();
  for (let i = start; i + 2 < end; i += 3) {
    const flat: number[] = [];
    for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(
        position,
        index ? index.getX(i + k) : i + k,
      ).applyMatrix4(mesh.matrixWorld);
      flat.push(p.x, p.y, p.z);
    }
    const triangle = g.triangle(flat, 0);
    if (triangle) out.push(triangle);
  }
  return out;
}

/** Original illustrative foundation gardens, not parcel/use/landscaping survey.
 * No footprint edits, walk surfaces, collision, textures, shadow casters or animation. */
export function createResidentialGround(e: CityEngine) {
  const perennialQA =
    process.env.VANCOUVER_VISUAL_QA === '1' && typeof window !== 'undefined'
      ? createPerennialQAEvidence(window.location?.search ?? '')
      : null;
  // A fresh build owns its diagnostic evidence; no shared cross-engine state.
  if (process.env.VANCOUVER_VISUAL_QA === '1') {
    delete e.data.residentialPerennialQA;
    if (perennialQA) e.data.residentialPerennialQA = perennialQA;
  }
  const footprints: Footprint[] = [];
  for (const f of e.data.buildings.features) {
    if (replacedBuilding(f.properties)) continue;
    for (const raw of rings(f)) {
      const polygon = raw[0].slice(0, -1).map(project);
      if (polygon.length < 3) continue;
      const key = structureKey(
        f.properties,
        polygon
          .map((p) => p.map((n) => n.toFixed(3)).join(','))
          .sort()
          .join(';'),
      );
      if (g.signedArea(polygon) < 0) polygon.reverse();
      footprints.push({
        key,
        polygon,
        bounds: g.boundsOf(polygon),
        min: Number(f.properties.minHeight) || 0,
        height: Number(f.properties.height ?? f.properties.hgt_agl ?? 8),
      });
    }
  }
  const buildings = new ResidentialSpatialIndex(footprints);
  const roadTriangles: Triangle[] = [];
  e.roads.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.walkSurface)
      roadTriangles.push(...residentialSurfaceTriangles(o));
  });
  const roads = new ResidentialSpatialIndex(roadTriangles);
  const terrainMesh = e.terrain.children[0] as THREE.Mesh;
  const ground = new GroundSurfaceIndex([terrainMesh]);
  const terrain = new ResidentialSpatialIndex(
    residentialSurfaceTriangles(terrainMesh),
  );
  const profiles = e.data.buildingProfiles as Map<string, Profile>;
  const parts = new Map<string, number>();
  for (const f of footprints) parts.set(f.key, (parts.get(f.key) ?? 0) + 1);
  const candidates = footprints
    .filter(
      (f) =>
        profiles.get(f.key)?.kind === 'domestic-cladding' &&
        f.min === 0 &&
        f.height >= 3.5 &&
        f.height <= 12 &&
        parts.get(f.key) === 1,
    )
    .sort(
      (a, b) => hashId(a.key) - hashId(b.key) || a.key.localeCompare(b.key),
    );
  const batches = new Map<string, { positions: number[]; colors: number[] }>();
  const report = {
    candidates: candidates.length,
    plots: 0,
    beds: 0,
    plants: 0,
    triangles: 0,
    batches: 0,
    sourceIds: [] as string[],
    examples: [] as { key: string; center: number[] }[],
  };
  const accepted: { bounds: Bounds; polygon: Point[] }[] = [];
  const add = (
    batch: { positions: number[]; colors: number[] },
    positions: number[],
    color: number,
  ) => {
    const tint = new THREE.Color(color);
    batch.positions.push(...positions);
    for (let i = 0; i < positions.length; i += 3)
      batch.colors.push(tint.r, tint.g, tint.b);
  };
  for (const source of candidates) {
    if (report.plots >= limits.plots) break;
    const frame = roofFrame(source.polygon),
      edges = source.polygon.map((a, i) => ({
        a,
        b: source.polygon[(i + 1) % source.polygon.length],
        i,
      }));
    // The representative domestic entry uses this same longest edge. Prefer
    // it, but use one other clear edge where source pavement reaches the wall.
    edges.sort((a, b) =>
      a.i === frame.edge ? -1 : b.i === frame.edge ? 1 : 0,
    );
    let built = false;
    for (const edge of edges) {
      if (built) break;
      const plans: {
        polygon: Point[];
        positions: number[];
        center: Point;
        y: number;
      }[] = [];
      const grid = fitBays(
        profiles.get(source.key)!,
        Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]),
      );
      const entry =
        edge.i === frame.edge && grid.count > 0
          ? grid.originM + (Math.floor(grid.count / 2) + 0.5) * grid.pitchM
          : undefined;
      for (const polygon of residentialBeds(edge.a, edge.b, entry)) {
        const bounds = g.boundsOf(polygon);
        if (
          buildings
            .query(bounds)
            .some((b) => residentialOverlap(polygon, b.polygon)) ||
          roads
            .query(bounds)
            .some((r) => residentialOverlap(polygon, r.points)) ||
          accepted.some(
            (p) =>
              g.overlaps(bounds, p.bounds) &&
              residentialOverlap(polygon, p.polygon),
          )
        )
          continue;
        const center: Point = [
          polygon.reduce((n, p) => n + p[0], 0) / polygon.length,
          polygon.reduce((n, p) => n + p[1], 0) / polygon.length,
        ];
        const y = ground.sample(center[0], center[1], e.elevation(...center));
        if (y === undefined) continue;
        const positions = drapeResidentialBed(polygon, terrain, y);
        if (positions) plans.push({ polygon, positions, center, y });
      }
      if (!plans.length) continue;
      const seed = hashId(source.key);
      for (const plan of plans) {
        const { center, polygon } = plan,
          key = `${Math.floor(center[0] / limits.cellM)},${Math.floor(center[1] / limits.cellM)}`;
        const batch = batches.get(key) ?? { positions: [], colors: [] };
        batches.set(key, batch);
        add(batch, plan.positions, [0x786c55, 0x82745d, 0x716c55][seed % 3]);
        accepted.push({ bounds: g.boundsOf(polygon), polygon });
        report.beds++;
        if (process.env.VANCOUVER_VISUAL_QA === '1')
          perennialQA?.beds.push({
            sourceId: source.key,
            cell: key,
            positions: [...plan.positions],
          });
        // Two low clustered perennials per bed, fully contained by its inset.
        const dx = edge.b[0] - edge.a[0],
          dz = edge.b[1] - edge.a[1],
          length = Math.hypot(dx, dz);
        for (const side of [-1, 1]) {
          const x = center[0] + (dx / length) * 0.38 * side,
            z = center[1] + (dz / length) * 0.38 * side;
          const base = ground.sample(x, z, plan.y);
          if (base === undefined) continue;
          if (process.env.VANCOUVER_VISUAL_QA === '1')
            perennialQA?.plants.push({
              sourceId: source.key,
              cell: key,
              center: [x, base, z],
              seed,
              firstVertex: batch.positions.length / 3,
            });
          if (
            process.env.VANCOUVER_VISUAL_QA === '1' &&
            perennialQA?.variant === 'blender'
          ) {
            appendBlenderPerennialQA(
              batch,
              x,
              z,
              base,
              seed,
              (px, pz, fallback) => ground.sample(px, pz, fallback),
              new THREE.Color(
                [0x687355, 0x737a5c, 0x606d51][(seed + (side > 0 ? 1 : 0)) % 3],
              ),
            );
          } else {
            const plant: number[] = [];
            for (let k = 0; k < 7; k++) {
              const a = (k * Math.PI * 2) / 7 + (seed % 7),
                b = ((k + 1) * Math.PI * 2) / 7 + (seed % 7);
              const radius = 0.23 + (k % 3) * 0.028,
                height = 0.19 + (seed % 4) * 0.022;
              plant.push(
                x,
                base + height,
                z,
                x + Math.cos(b) * radius,
                (ground.sample(
                  x + Math.cos(b) * radius,
                  z + Math.sin(b) * radius,
                  base,
                ) ?? base) + 0.025,
                z + Math.sin(b) * radius,
                x + Math.cos(a) * radius,
                (ground.sample(
                  x + Math.cos(a) * radius,
                  z + Math.sin(a) * radius,
                  base,
                ) ?? base) + 0.025,
                z + Math.sin(a) * radius,
              );
            }
            add(
              batch,
              plant,
              [0x687355, 0x737a5c, 0x606d51][(seed + (side > 0 ? 1 : 0)) % 3],
            );
          }
          report.plants++;
        }
      }
      report.sourceIds.push(source.key);
      report.examples.push({
        key: source.key,
        center: [...plans[0].center, plans[0].y],
      });
      report.plots++;
      built = true;
    }
  }
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
  });
  for (const [key, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(batch.positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(batch.colors, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const center = geometry.boundingSphere!.center.clone();
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = `Residential foundation gardens ${key}`;
    const lod = new THREE.LOD();
    lod.position.copy(center);
    lod.addLevel(mesh, 0);
    lod.addLevel(new THREE.Group(), limits.showDistanceM, 0.12);
    e.buildings.add(lod);
    report.triangles += batch.positions.length / 9;
    report.batches++;
  }
  if (!batches.size) material.dispose();
  e.data.residentialGround = report;
}
