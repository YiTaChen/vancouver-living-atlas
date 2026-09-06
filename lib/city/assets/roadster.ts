import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original two-seat open roadster. Metres, +Z forward, +X driver's left. */
export function makeRoadster() {
  const group = new THREE.Group();
  group.name = 'open-roadster';
  const palette = {
    paint: new THREE.MeshStandardMaterial({
      color: 0x167b83,
      roughness: 0.28,
      metalness: 0.5,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x142127, roughness: 0.65 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x15191b, roughness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({
      color: 0xba794e,
      roughness: 0.85,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0xa8b7bb,
      metalness: 0.65,
      roughness: 0.3,
    }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xe4f8ff }),
    tail: new THREE.MeshBasicMaterial({ color: 0xfc493c }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x98c8d5,
      transparent: true,
      opacity: 0.26,
      roughness: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  type Key = keyof typeof palette;
  type P = [number, number, number];
  const batches = new Map<Key, THREE.BufferGeometry[]>();
  function add(
    key: Key,
    geometry: THREE.BufferGeometry,
    p: P = [0, 0, 0],
    r: P = [0, 0, 0],
  ) {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...p),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    // Lofts and primitives share just position/normal for one batch per material.
    flat.deleteAttribute('uv');
    if (!flat.hasAttribute('normal')) flat.computeVertexNormals();
    const list = batches.get(key) ?? [];
    list.push(flat);
    batches.set(key, list);
    if (flat !== geometry) geometry.dispose();
  }
  const box = (key: Key, size: P, p: P, r: P = [0, 0, 0]) =>
    add(key, new THREE.BoxGeometry(...size), p, r);
  const beam = (key: Key, a: P, b: P, r = 0.025) => {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      delta = bv.clone().sub(av);
    const g = new THREE.CylinderGeometry(r, r, delta.length(), 8);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    add(key, g, av.lerp(bv, 0.5).toArray() as P);
  };
  // Elliptical cross sections produce a continuous tapered nose and rear deck.
  function loft(sections: [number, number, number, number][]) {
    const positions: number[] = [];
    const indices: number[] = [];
    const sides = 20;
    for (const [z, width, centre, height] of sections)
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        positions.push(Math.cos(a) * width, centre + Math.sin(a) * height, z);
      }
    for (let j = 0; j < sections.length - 1; j++)
      for (let i = 0; i < sides; i++) {
        const a = j * sides + i,
          b = j * sides + ((i + 1) % sides),
          c = a + sides,
          d = b + sides;
        indices.push(a, b, c, b, d, c);
      }
    for (const end of [0, sections.length - 1]) {
      const centre = positions.length / 3;
      positions.push(0, sections[end][2], sections[end][0]);
      for (let i = 0; i < sides; i++) {
        const a = end * sides + i,
          b = end * sides + ((i + 1) % sides);
        indices.push(...(end === 0 ? [centre, b, a] : [centre, a, b]));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    add('paint', g);
  }
  loft([
    [0.65, 0.85, 0.61, 0.2],
    [1.1, 0.92, 0.6, 0.22],
    [1.6, 0.91, 0.54, 0.2],
    [2.12, 0.78, 0.48, 0.16],
    [2.25, 0.67, 0.46, 0.12],
  ]);
  loft([
    [-2.18, 0.73, 0.5, 0.2],
    [-1.83, 0.94, 0.6, 0.23],
    [-1.25, 0.94, 0.65, 0.22],
    [-0.92, 0.87, 0.65, 0.2],
  ]);
  box('dark', [1.53, 0.13, 4.05], [0, 0.28, 0]);
  box('dark', [1.43, 0.1, 1.62], [0, 0.43, -0.14]);
  // Side sills remain below the open cabin; no solid box across the seats.
  for (const x of [-0.86, 0.86]) {
    box('paint', [0.16, 0.32, 1.93], [x, 0.6, -0.12]);
    box('dark', [0.045, 0.09, 1.72], [x * 0.96, 0.8, -0.12]);
    box('paint', [0.21, 0.11, 2.12], [x, 0.36, -0.08]);
    box('metal', [0.14, 0.025, 0.027], [x * 1.105, 0.72, -0.4]);
    beam('paint', [x, 0.8, 0.54], [x * 1.17, 0.86, 0.68], 0.035);
    add('paint', new THREE.SphereGeometry(0.12, 12, 8), [x * 1.22, 0.88, 0.7]);
    box('dark', [0.14, 0.07, 0.015], [x * 1.22, 0.88, 0.6]);
  }
  // Raised fender arcs, distinct from the wheel itself.
  for (const x of [-0.91, 0.91])
    for (const z of [-1.4, 1.38]) {
      add(
        'paint',
        new THREE.TorusGeometry(0.415, 0.075, 8, 24, Math.PI),
        [x, 0.37, z],
        [0, Math.PI / 2, 0],
      );
    }
  for (const x of [-0.44, 0.44]) {
    box('leather', [0.55, 0.17, 0.64], [x, 0.53, -0.21]);
    box('leather', [0.55, 0.59, 0.16], [x, 0.86, -0.57], [-0.14, 0, 0]);
    box('leather', [0.3, 0.22, 0.16], [x, 1.17, -0.62]);
    for (const side of [-1, 1])
      box(
        'dark',
        [0.055, 0.4, 0.18],
        [x + side * 0.255, 0.86, -0.45],
        [-0.14, 0, 0],
      );
    for (const z of [-0.36, -0.19, -0.02])
      box('dark', [0.41, 0.005, 0.008], [x, 0.618, z]);
    // Polished rollover hoop behind each headrest.
    add('metal', new THREE.TorusGeometry(0.2, 0.027, 8, 16, Math.PI), [
      x,
      1.01,
      -0.8,
    ]);
    beam('metal', [x - 0.2, 0.85, -0.8], [x - 0.2, 1.01, -0.8]);
    beam('metal', [x + 0.2, 0.85, -0.8], [x + 0.2, 1.01, -0.8]);
  }
  box('dark', [0.2, 0.32, 1.1], [0, 0.62, -0.02]);
  beam('metal', [0, 0.75, 0.04], [0, 0.91, 0.09], 0.019);
  add('dark', new THREE.SphereGeometry(0.045, 8, 6), [0, 0.91, 0.09]);
  box('dark', [1.57, 0.18, 0.33], [0, 0.8, 0.61]);
  // Windshield rakes back over the open cabin; no roof, side glass or rear canopy.
  const windshield = new THREE.BufferGeometry();
  windshield.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.79, 0.85, 0.86, 0.79, 0.85, 0.86, 0.72, 1.28, 0.5, -0.72, 1.28, 0.5],
      3,
    ),
  );
  windshield.setIndex([0, 1, 2, 0, 2, 3]);
  windshield.computeVertexNormals();
  add('glass', windshield);
  beam('metal', [-0.79, 0.85, 0.86], [-0.72, 1.28, 0.5], 0.028);
  beam('metal', [0.79, 0.85, 0.86], [0.72, 1.28, 0.5], 0.028);
  beam('metal', [-0.72, 1.28, 0.5], [0.72, 1.28, 0.5], 0.026);
  beam('dark', [-0.79, 0.85, 0.86], [0.79, 0.85, 0.86], 0.027);
  add(
    'dark',
    new THREE.TorusGeometry(0.16, 0.019, 8, 20),
    [0.44, 0.88, 0.4],
    [0.25, 0, 0],
  );
  beam('metal', [0.3, 0.88, 0.4], [0.58, 0.88, 0.4], 0.013);
  beam('metal', [0.44, 0.88, 0.4], [0.44, 0.73, 0.44], 0.013);
  box('dark', [1.14, 0.16, 0.035], [0, 0.43, 2.23]);
  for (const x of [-0.46, -0.23, 0, 0.23, 0.46])
    box('metal', [0.013, 0.12, 0.012], [x, 0.43, 2.254]);
  box('dark', [1.65, 0.055, 0.24], [0, 0.29, 2.12]);
  for (const x of [-0.64, 0.64]) {
    box('dark', [0.35, 0.1, 0.06], [x, 0.61, 2.08], [0.1, 0, 0]);
    box('lamp', [0.3, 0.035, 0.068], [x, 0.63, 2.1]);
    box('tail', [0.39, 0.045, 0.055], [x, 0.64, -2.15]);
    add(
      'metal',
      new THREE.CylinderGeometry(0.062, 0.062, 0.17, 12),
      [x * 0.8, 0.32, -2.18],
      [Math.PI / 2, 0, 0],
    );
    add(
      'dark',
      new THREE.CircleGeometry(0.047, 12),
      [x * 0.8, 0.32, -2.271],
      [0, Math.PI, 0],
    );
  }
  box('dark', [1.39, 0.16, 0.06], [0, 0.36, -2.16]);
  for (let i = 0; i < 7; i++)
    box(
      'dark',
      [1.02, 0.017, 0.035],
      [0, 0.864 - i * 0.007, -1.17 - i * 0.082],
    );
  // Seated driver silhouette gives the open cockpit scale, without a downloaded asset.
  box('dark', [0.34, 0.44, 0.2], [0.44, 0.93, -0.39], [-0.1, 0, 0]);
  add('leather', new THREE.SphereGeometry(0.115, 12, 10), [0.44, 1.27, -0.34]);
  for (const x of [0.25, 0.63])
    beam('dark', [x, 1.06, -0.29], [x, 0.88, 0.29], 0.047);
  for (const [key, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false)!;
    geometries.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, palette[key]);
    mesh.name = `roadster/${key}`;
    group.add(mesh);
  }
  const wheels: THREE.Group[] = [];
  for (const x of [-0.94, 0.94])
    for (const z of [-1.4, 1.38]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      pivot.userData.front = z > 0;
      const spin = new THREE.Group();
      pivot.add(spin);
      wheels.push(pivot);
      group.add(pivot);
      const tyre = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.24, 24),
        palette.rubber,
      );
      tyre.rotation.z = Math.PI / 2;
      spin.add(tyre);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.25, 16),
        palette.metal,
      );
      rim.rotation.z = Math.PI / 2;
      spin.add(rim);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.258, 12),
        palette.dark,
      );
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(0.266, 0.042, 0.4),
          palette.metal,
        );
        spoke.rotation.x = a;
        spin.add(spoke);
      }
      // Rim and spokes share one draw per wheel.
      const metalParts = spin.children.filter(
        (o) => (o as THREE.Mesh).material === palette.metal,
      ) as THREE.Mesh[];
      const parts = metalParts.map((mesh) => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const combined = mergeGeometries(parts, false)!;
      parts.forEach((g) => g.dispose());
      metalParts.forEach((mesh) => {
        spin.remove(mesh);
        mesh.geometry.dispose();
      });
      spin.add(new THREE.Mesh(combined, palette.metal));
    }
  group.userData.originalProceduralGeometry = true;
  group.userData.openTop = true;
  return {
    group,
    update(distance: number, steering: number) {
      for (const pivot of wheels) {
        pivot.rotation.y = pivot.userData.front ? steering * 0.42 : 0;
        pivot.children[0].rotation.x = distance / 0.35;
      }
    },
  };
}
