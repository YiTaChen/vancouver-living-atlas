import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original low-floor model, inspired by TransLink's blue/yellow fleet photos.
 * +Z is forward; doors are on the vehicle's right (-X). No downloaded model.
 */
export function busGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  function add(g: THREE.BufferGeometry, color: number) {
    const c = new THREE.Color(color),
      n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    c: number,
  ) => add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
  const blue = 0x173e65,
    glass = 0x243b47,
    yellow = 0xe8b82f,
    silver = 0xc5cbd0;
  box(2.5, 2.55, 12, 0, 1.9, 0, blue);
  box(2.48, 0.17, 11.8, 0, 3.24, 0, silver);
  box(1.85, 0.32, 5.8, 0, 3.47, -1.7, silver);
  box(2.54, 0.13, 11.85, 0, 1.28, 0, yellow);
  box(2.54, 0.2, 11.7, 0, 0.72, 0, silver);
  for (const side of [-1, 1]) {
    for (let j = 0; j < 8; j++) {
      const z = -4.75 + j * 1.3;
      box(0.035, 1.15, 1.17, side * 1.265, 2.36, z, glass);
    }
    for (const z of [-3.65, 3.6]) {
      add(
        new THREE.CylinderGeometry(0.51, 0.51, 0.26, 12)
          .rotateZ(Math.PI / 2)
          .translate(side * 1.22, 0.52, z),
        0x182125,
      );
      add(
        new THREE.CylinderGeometry(0.27, 0.27, 0.275, 10)
          .rotateZ(Math.PI / 2)
          .translate(side * 1.225, 0.52, z),
        silver,
      );
    }
    box(0.16, 0.36, 0.26, side * 1.44, 2.7, 5.56, blue);
    box(0.24, 0.08, 0.08, side * 1.32, 2.86, 5.5, silver);
    box(0.24, 0.16, 0.025, side * 0.87, 0.97, 6.015, 0xffedc6);
    box(0.23, 0.33, 0.025, side * 0.92, 1.05, -6.015, 0xb92c23);
  }
  // Full-height front and rear passenger doors; yellow safety edges.
  for (const z of [4.5, -0.8]) {
    box(0.045, 2.05, 1.28, -1.286, 1.76, z, glass);
    box(0.05, 2.09, 0.065, -1.313, 1.76, z, silver);
    box(0.05, 0.07, 1.35, -1.313, 0.73, z, yellow);
  }
  box(2.17, 1.34, 0.035, 0, 2.25, 6.02, glass);
  box(0.055, 1.34, 0.05, 0, 2.25, 6.045, blue);
  box(1.92, 0.32, 0.045, 0, 3.01, 6.035, 0x111c23);
  // Amber destination-board pixels, deliberately generic (not live route data).
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 22; col++)
      if ((row + col) % 4 !== 0)
        box(
          0.043,
          0.034,
          0.015,
          -0.8 + col * 0.075,
          2.94 + row * 0.065,
          6.065,
          0xffba36,
        );
  box(1.86, 0.82, 0.025, 0, 2.42, -6.02, glass);
  for (let j = 0; j < 6; j++)
    box(1.5, 0.035, 0.025, 0, 1.05 + j * 0.095, -6.025, 0x172c40);
  const result = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  result.computeBoundingBox();
  return result;
}

export interface BusRoute {
  a: number[];
  b: number[];
  length: number;
  speed: number;
  phase: number;
}
export function createBuses(count: number) {
  const mesh = new THREE.InstancedMesh(
    busGeometry(),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.15,
    }),
    count,
  );
  mesh.name = 'Vancouver low-floor buses';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}
const transform = new THREE.Object3D();
/** One shared geometry/material and one draw; no per-bus objects in the frame loop. */
export function updateBuses(
  mesh: THREE.InstancedMesh,
  routes: BusRoute[],
  time: number,
  ground: (x: number, z: number) => number,
  camera: THREE.Vector3,
) {
  let visible = 0;
  for (const r of routes) {
    const t = (r.phase + (time * r.speed) / r.length) % 1;
    const x = r.a[0] + (r.b[0] - r.a[0]) * t,
      z = r.a[1] + (r.b[1] - r.a[1]) * t;
    const y = ground(x, z) + 1.08;
    if (
      (x - camera.x) ** 2 + (z - camera.z) ** 2 + (y - camera.y) ** 2 >
      1000 ** 2
    )
      continue;
    const dx = (r.b[0] - r.a[0]) / r.length,
      dz = (r.b[1] - r.a[1]) / r.length;
    const slope = Math.atan2(
      ground(x + dx * 3.6, z + dz * 3.6) - ground(x - dx * 3.65, z - dz * 3.65),
      7.25,
    );
    transform.position.set(x, y, z);
    transform.rotation.set(-slope, Math.atan2(dx, dz), 0, 'YXZ');
    transform.updateMatrix();
    mesh.setMatrixAt(visible++, transform.matrix);
  }
  mesh.count = visible;
  mesh.visible = visible > 0;
  mesh.instanceMatrix.needsUpdate = visible > 0;
}
