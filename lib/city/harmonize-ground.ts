import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project } from './geo';
import {
  applyShoreLowering,
  shoreGroundMeshes,
  type ShoreMesh,
} from './shore-lowering';
import {
  applyGroundVisibility,
  applyRoadLowering,
  type GroundMesh,
} from './ground-visibility-mesh';
import { groundHarmonizationScopes } from './ground-harmonization-scopes';
import type { Bounds, GroundCover } from './ground-visibility';

/** One preparation pass before navigation, placement and road paint indexing.
 * Lower only intersecting City pavement; retain source path and bridge floors. */
export function harmonizeGround(e: CityEngine) {
  const started = performance.now();
  const scopes = groundHarmonizationScopes(project);
  const ground: GroundMesh[] = [],
    asphalt: THREE.Mesh[] = [];
  e.roads.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.walkSurface) return;
    ground.push({
      mesh: object,
      id: object.name,
      kind: object.userData.asphaltSurface
        ? 'asphalt'
        : object.userData.groundPath
          ? 'path'
          : 'sidewalk',
    });
    if (object.userData.asphaltSurface && !object.userData.protectedSurface)
      asphalt.push(object);
  });
  const sources = e.data.groundPathSources as GroundCover[];
  const road = scopes.map((scope) => {
    const paths = sources.filter((source) =>
      scope.pathSourceIds.includes(source.id),
    );
    for (const id of scope.pathSourceIds)
      if (!paths.some((path) => path.id === id))
        throw new Error(`Missing ground path source: ${id}`);
    return { scope: scope.id, ...applyRoadLowering(asphalt, paths, scope) };
  });
  const shoreMeshes: ShoreMesh[] = [];
  e.terrain.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.groundShoreSource === 'measured-shoreline-strip'
    )
      shoreMeshes.push({
        kind: 'shore',
        shoreKind: object.userData.groundShoreKind,
        mesh: object,
      });
  });
  const shore = scopes
    .filter((scope) => scope.id !== 'causeway-lower')
    .map((scope) => applyShoreLowering(shoreMeshes, sources, scope));
  ground.push(...shoreGroundMeshes(shoreMeshes));
  const terrain = e.terrain.children[0] as THREE.Mesh;
  const triangles = terrain.geometry.getAttribute('position').count / 3;
  const profileTriangles = e.data.beachCoast.profilePositions.length / 9;
  const regions = scopes.map((scope) => scope.bounds);
  const bounds: Bounds = [
    Math.min(...regions.map((b) => b[0])),
    Math.min(...regions.map((b) => b[1])),
    Math.max(...regions.map((b) => b[2])),
    Math.max(...regions.map((b) => b[3])),
  ];
  const visibility = applyGroundVisibility(
    terrain,
    ground,
    { bounds, regions },
    [[triangles - profileTriangles, triangles]],
  );
  e.data.groundHarmonization = {
    road,
    visibility,
    shore,
    elapsedMs: performance.now() - started,
  };
}
