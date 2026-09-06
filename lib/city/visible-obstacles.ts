import type * as THREE from 'three';

/** Only for visible building/landmark obstruction picking. Ground/bridge proxy
 * picking and physical footprint collision intentionally have other contracts. */
export function visibleThroughParents(object: THREE.Object3D): boolean {
  for (
    let current: THREE.Object3D | null = object;
    current;
    current = current.parent
  )
    if (!current.visible) return false;
  return true;
}

/** Raycaster ignores ancestor visibility. Search past hidden nearer hits rather
 * than letting them either block placement or conceal a visible farther roof.
 * This does not mutate visibility, camera layers, geometry or raycaster state.
 * Keep any existing inactive body-representation raycast guard for efficiency. */
export function firstVisibleObstacleHit(
  raycaster: THREE.Raycaster,
  roots: THREE.Object3D[],
): THREE.Intersection | undefined {
  return raycaster
    .intersectObjects(roots, true)
    .find((hit) => visibleThroughParents(hit.object));
}
