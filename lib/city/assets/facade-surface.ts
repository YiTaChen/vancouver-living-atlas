/** Original indexed facade primitives. Metre UVs, no external assets. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). */
import * as THREE from 'three';
export type Point3 = readonly [number, number, number];
export type Point2 = readonly [number, number];
export class FacadeSurface {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  triangle(a: Point3, b: Point3, c: Point3, color: number, desired?: Point3) {
    const ab = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),
      ac = new THREE.Vector3(...c).sub(new THREE.Vector3(...a)),
      normal = ab.clone().cross(ac);
    if (normal.lengthSq() < 1e-14) return;
    if (desired && normal.dot(new THREE.Vector3(...desired)) < 0) {
      [b, c] = [c, b];
      normal.negate();
    }
    normal.normalize();
    const base = this.positions.length / 3,
      co = new THREE.Color(color),
      u = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),
      len = u.length();
    u.normalize();
    for (const p of [a, b, c]) {
      const d = new THREE.Vector3(...p).sub(new THREE.Vector3(...a));
      this.positions.push(...p);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(co.r, co.g, co.b);
      this.uvs.push(d.dot(u), d.clone().cross(u).length());
    }
    this.indices.push(base, base + 1, base + 2);
  }
  quad(
    a: Point3,
    b: Point3,
    c: Point3,
    d: Point3,
    color: number,
    desired?: Point3,
  ) {
    this.triangle(a, b, c, color, desired);
    this.triangle(a, c, d, color, desired);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
export function finishFacade(
  name: string,
  detail: boolean,
  parts: {
    surface: FacadeSurface;
    role: string;
    roughness: number;
    metalness: number;
    emissive?: number;
    night?: number;
  }[],
  metadata: object = {},
) {
  const group = new THREE.Group();
  group.name = name;
  const nightMaterials: {
    material: THREE.MeshStandardMaterial;
    intensity: number;
  }[] = [];
  let triangles = 0,
    geometryBytes = 0;
  for (const p of parts) {
    if (!p.surface.indices.length) continue;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: p.roughness,
      metalness: p.metalness,
      emissive: p.emissive ?? 0,
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(p.surface.geometry(), material);
    mesh.name = name + '/' + p.role;
    mesh.userData.role = p.role;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (p.night) {
      material.userData.nightIntensity = p.night;
      nightMaterials.push({ material, intensity: p.night });
    }
    triangles += mesh.geometry.index!.count / 3;
    for (const a of Object.values(
      mesh.geometry.attributes,
    ) as THREE.BufferAttribute[])
      geometryBytes += a.array.byteLength;
    geometryBytes += mesh.geometry.index!.array.byteLength;
  }
  const bounds = new THREE.Box3().setFromObject(group);
  Object.assign(group.userData, {
    detail,
    triangles,
    drawCalls: group.children.length,
    geometryBytes,
    nightMaterials,
    solidFootprints: [],
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    originalProceduralAsset: true,
    ...metadata,
  });
  return group;
}
