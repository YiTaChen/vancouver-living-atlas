import * as THREE from 'three';

export type CitizenCharacter = 'male' | 'female';

type Surface = {
  mesh: THREE.Mesh;
  positions: THREE.BufferAttribute;
  normals: THREE.BufferAttribute | undefined;
  colors: THREE.BufferAttribute | undefined;
  vertexColors: boolean[];
  jacket: Set<number>;
  femaleColors: THREE.Float32BufferAttribute | undefined;
};
type Appearance = { surfaces: Surface[]; hair: THREE.Group | undefined };
const appearances = new WeakMap<THREE.Group, Appearance>();

/** Virtual connectivity includes UV seams without welding the actual mesh. */
function jacketVertices(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position');
  const count = p.count;
  const parents = Array.from({ length: count }, (_, i) => i);
  const find = (start: number): number => {
    let i = start;
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    parents[find(b)] = find(a);
  };
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)]
      .map((n) => Math.round(n * 1e6))
      .join(',');
    const previous = seen.get(key);
    if (previous !== undefined) join(i, previous);
    else seen.set(key, i);
  }
  const indices = geometry.index;
  const at = (i: number) => (indices ? indices.getX(i) : i);
  for (let i = 0; i < (indices?.count ?? count); i += 3) {
    join(at(i), at(i + 1));
    join(at(i), at(i + 2));
  }
  const components = new Map<
    number,
    { vertices: number[]; minY: number; maxY: number }
  >();
  for (let i = 0; i < count; i++) {
    const id = find(i);
    let component = components.get(id);
    if (!component) {
      component = { vertices: [], minY: Infinity, maxY: -Infinity };
      components.set(id, component);
    }
    component.vertices.push(i);
    component.minY = Math.min(component.minY, p.getY(i));
    component.maxY = Math.max(component.maxY, p.getY(i));
  }
  // Only the original continuous rain shell spans these shoulder/hem datums.
  // Skin, collar, daypack, hands and shoes keep their original baked colors.
  const jacket = [...components.values()]
    .filter(
      (c) =>
        c.minY > 0.75 &&
        c.minY < 0.95 &&
        c.maxY > 1.43 &&
        c.vertices.length > 1000,
    )
    .sort((a, b) => b.vertices.length - a.vertices.length)[0];
  return new Set(jacket?.vertices ?? []);
}

function makePonytail(model: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'Female citizen — tied hair';
  const hair = new THREE.MeshStandardMaterial({
    color: 0x251b17,
    roughness: 0.87,
  });
  const tie = new THREE.MeshStandardMaterial({
    color: 0x987485,
    roughness: 0.82,
  });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.738, -0.077),
    new THREE.Vector3(0.009, 1.71, -0.127),
    new THREE.Vector3(0.022, 1.62, -0.161),
    new THREE.Vector3(0.036, 1.51, -0.174),
    new THREE.Vector3(0.045, 1.45, -0.146),
  ]);
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 22, 0.033, 10, false),
    hair,
  );
  // Keep a softly tapered silhouette.
  const p = tail.geometry.getAttribute('position');
  for (let row = 0; row <= 22; row++) {
    const t = row / 22;
    const center = curve.getPointAt(t);
    const taper = 1 - 0.65 * t ** 2;
    for (let side = 0; side <= 10; side++) {
      const i = row * 11 + side;
      p.setXYZ(
        i,
        center.x + (p.getX(i) - center.x) * taper,
        center.y + (p.getY(i) - center.y) * taper,
        center.z + (p.getZ(i) - center.z) * taper,
      );
    }
  }
  tail.geometry.computeVertexNormals();
  group.add(tail);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), hair);
  knot.scale.set(0.044, 0.045, 0.042);
  knot.position.copy(curve.getPointAt(0));
  group.add(knot);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.033, 0.004, 6, 16),
    tie,
  );
  band.position.copy(curve.getPointAt(0.16));
  const tangent = curve.getTangentAt(0.16).normalize();
  band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  group.add(band);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), hair);
  tip.position.copy(curve.getPointAt(1));
  group.add(tip);
  for (const mesh of [tail, knot, band, tip]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }
  // Use the inverse bind rather than the current head pose: first selecting the
  // character while seated or mid-stride must not pin hair at standing height.
  const skins: THREE.SkinnedMesh[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skins.push(object);
  });
  const skin = skins[0];
  const head =
    skin?.skeleton.bones.findIndex((bone) => bone.name === 'head') ?? -1;
  if (skin && head >= 0) {
    skin.skeleton.bones[head].add(group);
    group.applyMatrix4(
      skin.skeleton.boneInverses[head].clone().multiply(skin.bindMatrix),
    );
  } else model.add(group);
  return group;
}

/** Original alternate appearance; rest joints, UVs, skin weights and clips stay intact. */
export function setCitizenAppearance(
  model: THREE.Group,
  character: CitizenCharacter,
) {
  let appearance = appearances.get(model);
  if (!appearance && character === 'male') {
    model.userData.character = character;
    return;
  }
  if (!appearance) {
    const surfaces: Surface[] = [];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      surfaces.push({
        mesh: object,
        positions: geometry
          .getAttribute('position')
          .clone() as THREE.BufferAttribute,
        normals: geometry.getAttribute('normal')?.clone() as
          | THREE.BufferAttribute
          | undefined,
        colors: geometry.getAttribute('color')?.clone() as
          | THREE.BufferAttribute
          | undefined,
        vertexColors: materials.map(
          (m) => 'vertexColors' in m && Boolean(m.vertexColors),
        ),
        jacket: jacketVertices(geometry),
        femaleColors: undefined,
      });
    });
    appearance = { surfaces, hair: undefined };
    appearances.set(model, appearance);
  }
  for (const surface of appearance.surfaces) {
    const { mesh, positions, normals, colors, jacket } = surface;
    const geometry = mesh.geometry;
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      p.setXYZ(i, positions.getX(i), positions.getY(i), positions.getZ(i));
    const currentNormals = geometry.getAttribute('normal');
    if (normals && currentNormals)
      for (let i = 0; i < normals.count; i++)
        currentNormals.setXYZ(
          i,
          normals.getX(i),
          normals.getY(i),
          normals.getZ(i),
        );
    if (colors) geometry.setAttribute('color', colors.clone());
    else geometry.deleteAttribute('color');
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((material, i) => {
      if ('vertexColors' in material) {
        material.vertexColors =
          character === 'female' || surface.vertexColors[i];
        material.needsUpdate = true;
      }
    });
    if (character === 'female') {
      const colors =
        surface.femaleColors ??
        new THREE.Float32BufferAttribute(
          new Float32Array(p.count * 3).fill(1),
          3,
        );
      const transformedNormal = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const x = positions.getX(i),
          y = positions.getY(i),
          z = positions.getZ(i);
        const waist = Math.exp(-(((y - 1.11) / 0.18) ** 2));
        const shoulder = Math.exp(-(((y - 1.4) / 0.11) ** 2));
        const jaw = Math.exp(-(((y - 1.595) / 0.047) ** 2));
        const width = 1 - 0.085 * waist - 0.045 * shoulder - 0.095 * jaw;
        p.setXYZ(i, x * width, y, z);
        if (normals && currentNormals) {
          // Inverse-transpose of x'=x*width(y), preserving authored smoothing
          // across the atlas's duplicated UV vertices instead of resplitting it.
          const slope =
            2 *
            ((0.085 * waist * (y - 1.11)) / 0.18 ** 2 +
              (0.045 * shoulder * (y - 1.4)) / 0.11 ** 2 +
              (0.095 * jaw * (y - 1.595)) / 0.047 ** 2);
          transformedNormal
            .set(
              normals.getX(i) / width,
              normals.getY(i) - (x * slope * normals.getX(i)) / width,
              normals.getZ(i),
            )
            .normalize();
          currentNormals.setXYZ(
            i,
            transformedNormal.x,
            transformedNormal.y,
            transformedNormal.z,
          );
        }
        if (jacket.has(i)) {
          // A plum shell, while preserving the atlas weave, seams and PBR maps.
          colors.setXYZ(i, 3.4, 0.56, 1.45);
        }
      }
      surface.femaleColors = colors;
      geometry.setAttribute('color', colors);
    }
    p.needsUpdate = true;
    const normal = geometry.getAttribute('normal');
    if (normal) normal.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  if (character === 'female' && !appearance.hair)
    appearance.hair = makePonytail(model);
  if (appearance.hair) appearance.hair.visible = character === 'female';
  model.userData.character = character;
}

/** Keep the reusable alternate color buffer owned until final GPU disposal. */
export function prepareCitizenAppearanceDisposal(root: THREE.Object3D) {
  root.traverse((object) => {
    const appearance = appearances.get(object as THREE.Group);
    if (!appearance) return;
    for (const surface of appearance.surfaces)
      if (surface.femaleColors)
        surface.mesh.geometry.setAttribute('color', surface.femaleColors);
  });
}
