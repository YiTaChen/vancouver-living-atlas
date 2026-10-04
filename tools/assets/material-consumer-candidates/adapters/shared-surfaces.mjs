import * as THREE from 'three';

export const SURFACES = Object.freeze({
  'landmark-brushed-aluminum': 1, 'landmark-pale-panel': 1,
  'vehicle-red-paint': 0.5, 'vehicle-tire-rubber': 0.5, 'vehicle-seat-leather': 0.5,
  'interior-terrazzo': 1, 'interior-oak-veneer': 1, 'interior-matte-plaster': 1,
});
export const ROLE_SURFACE = Object.freeze({
  'body-paint': 'vehicle-red-paint', 'tire-rubber': 'vehicle-tire-rubber',
  'seat-upholstery': 'vehicle-seat-leather', 'floor-terrazzo': 'interior-terrazzo',
  'wood': 'interior-oak-veneer', 'plaster': 'interior-matte-plaster',
});

/** CPU-safe binding API. Caller provides one shared set of Three Textures per
 * surface, after authorized lazy loading; this module never starts downloads.
 * Shared maps contain authored colour: tint/vertex colours must not multiply it
 * a second time. Original fallback is untouched until bind is explicitly used.
 * Existing onBeforeCompile/cutaway/ambient hooks must be preserved by the caller.
 */
export function configureSharedMaps(surfaceId, maps, { gltf = false } = {}) {
  if (!(surfaceId in SURFACES)) throw new Error(`Unknown surface ${surfaceId}`);
  const { basecolor, normal, orm } = maps;
  if (![basecolor,normal,orm].every(t => t?.isTexture)) throw new Error('Three shared textures required');
  for (const t of [basecolor, normal, orm]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.setScalar(1 / SURFACES[surfaceId]);
    t.flipY = !gltf; // Native Three UVs; glTF-imported geometry requires flipY=false.
  }
  basecolor.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = orm.colorSpace = THREE.NoColorSpace;
  // ORM uses UV0 too. R is authored constant one, so AO assignment is optional.
  return { map: basecolor, normalMap: normal, roughnessMap: orm, metalnessMap: orm,
    aoMap: orm, aoMapIntensity: 1, normalScale: new THREE.Vector2(1,1) };
}
export function bindSurface(material, surfaceId, sharedMaps) {
  if (!material.isMeshStandardMaterial || material.transparent || material.opacity < 1) throw new Error('Opaque standard material only');
  const previousHook = material.onBeforeCompile;
  Object.assign(material, configureSharedMaps(surfaceId, sharedMaps));
  material.color.set(0xffffff); material.vertexColors = false;
  material.roughness = 1; material.metalness = 1;
  material.userData.sharedSurfaceId = surfaceId;
  material.onBeforeCompile = previousHook; material.needsUpdate = true;
  return material;
}
