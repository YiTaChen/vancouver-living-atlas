import * as THREE from 'three';
import { GroundSurfaceIndex } from './ground-surface';
import { project } from './geo';
import { conventionPodiumTopTriangles } from './assets/convention-centre';
/** Main only; select the current original lower podium, never the elevated
 * 5.3 m slab or the marine supports/shelves. Returns world Y or undefined. */
export function createConventionPlatformSampler() {
  const p = { lon: -123.1159678, lat: 49.2890752, yaw: -0.403, baseY: 4 },
    origin = project([p.lon, p.lat]);
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(conventionPodiumTopTriangles(), 3),
  );
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(origin[0], p.baseY, origin[1]);
  mesh.rotation.y = p.yaw;
  const index = new GroundSurfaceIndex([mesh]),
    triangles = geometry.getAttribute('position').count / 3;
  geometry.dispose();
  material.dispose();
  return {
    triangles,
    sample: (x: number, z: number) => index.sample(x, z, 4.8),
  };
}
