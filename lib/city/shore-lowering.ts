import * as THREE from 'three';
import { project } from './geo';
import { groundHarmonizationScopes } from './ground-harmonization-scopes';
import { applyRoadLowering, type GroundMesh } from './ground-visibility-mesh';
import type { GroundCover } from './ground-visibility';

export interface ShoreMesh {
  kind: 'shore';
  shoreKind: 'seawall' | 'rock';
  mesh: THREE.Mesh;
}
type Scope = ReturnType<typeof groundHarmonizationScopes>[number];

function verifyShoreMesh(source: ShoreMesh) {
  const m = source.mesh;
  if (
    source.kind !== 'shore' ||
    !['seawall', 'rock'].includes(source.shoreKind) ||
    !(m instanceof THREE.Mesh) ||
    (m as THREE.InstancedMesh).isInstancedMesh ||
    m.userData.groundShoreSource !== 'measured-shoreline-strip' ||
    m.userData.groundShoreKind !== source.shoreKind ||
    !m.userData.walkSurface ||
    m.userData.protectedSurface ||
    m.userData.asphaltSurface ||
    m.userData.waterId ||
    m.userData.beachProfile ||
    m.userData.groundVisibilityApplied
  )
    throw new Error(
      'Only explicitly marked original measured shoreline strips can be lowered',
    );
}

/** Caller explicitly opts in only the two original createNature strip meshes.
 * Mark them at their construction site:
 * userData.groundShoreSource = 'measured-shoreline-strip';
 * userData.groundShoreKind = 'seawall' | 'rock'.
 * Water, terrain, sand overlays, City asphalt and bridges cannot enter this API.
 */
export function shoreGroundMeshes(sources: readonly ShoreMesh[]): GroundMesh[] {
  return sources.map((source) => {
    verifyShoreMesh(source);
    return {
      mesh: source.mesh,
      kind: 'shore',
      id: `shore:${source.shoreKind}`,
    };
  });
}

/** The same downward-only geometric operation, explicitly restricted to the
 * two reviewed coastal regions and their exact actual source path IDs. The
 * strip's material, footprint and sea-facing source XY remain unchanged.
 * The first terrain/physical beach profile is never accepted by this API.
 * Run after City lowering and before the one final coarse-terrain clip/index.
 */
export function applyShoreLowering(
  sources: readonly ShoreMesh[],
  actualPaths: readonly GroundCover[],
  scope: Scope,
) {
  if (!['north-coast', 'northwest-coast'].includes(scope.id))
    throw new Error(
      'Shore correction is limited to the two reviewed coastal regions',
    );
  const expected = groundHarmonizationScopes(project).find(
    (s) => s.id === scope.id,
  )!;
  if (
    scope.bounds.some((v, i) => Math.abs(v - expected.bounds[i]) > 1e-6) ||
    scope.focusBounds.some(
      (v, i) => Math.abs(v - expected.focusBounds[i]) > 1e-6,
    )
  )
    throw new Error(
      'Shore correction bounds differ from the reviewed geographic region',
    );
  const paths = actualPaths.filter((p) =>
    expected.pathSourceIds.includes(p.id),
  );
  if (expected.pathSourceIds.some((id) => !paths.some((p) => p.id === id)))
    throw new Error(
      'Missing actual source path geometry for shoreline correction',
    );
  if (
    paths.some(
      (p) => p.kind !== 'path' || p.level !== 'ground' || p.protectedSurface,
    )
  )
    throw new Error(
      'A shoreline reference must be an actual unprotected source path',
    );
  const selected = shoreGroundMeshes(sources);
  // The lower-level adapter is reusable geometry mathematics; source guards
  // above are deliberately separate from City-asphalt selection and metadata.
  return {
    kind: 'shore' as const,
    scope: scope.id,
    ...applyRoadLowering(
      selected.map((s) => s.mesh),
      paths,
      expected,
    ),
  };
}
