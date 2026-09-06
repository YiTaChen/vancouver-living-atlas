import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original two-seat open roadster. Metres, +Z forward, +X driver's left. */
export function makeRoadster() {
  const group = new THREE.Group();
  group.name = 'open-roadster';
  const palette = {
    paint: new THREE.MeshStandardMaterial({
      color: 0xd7192d,
      roughness: 0.25,
      metalness: 0.38,
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
  const oval = (key: Key, size: P, p: P, r: P = [0, 0, 0]) => {
    const g = new THREE.SphereGeometry(1, 16, 10);
    g.scale(...size);
    add(key, g, p, r);
  };
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
  // Continuous sculpted shell: broad shoulders, a pinched waist and true wheel
  // openings. Cabin is an actual hole, not a dark rectangle on a solid slab.
  const profile = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.77, 0.62, -2.2),
      new THREE.Vector3(0.94, 0.76, -1.85),
      new THREE.Vector3(0.97, 0.79, -1.4),
      new THREE.Vector3(0.87, 0.77, -0.85),
      new THREE.Vector3(0.83, 0.73, 0),
      new THREE.Vector3(0.87, 0.73, 0.65),
      new THREE.Vector3(0.96, 0.7, 1.38),
      new THREE.Vector3(0.91, 0.62, 1.85),
      new THREE.Vector3(0.74, 0.49, 2.25),
    ],
    false,
    'catmullrom',
    0.3,
  );
  // Sample by z, so wheel openings and the open cabin have exact boundaries.
  const samples = profile.getPoints(240);
  const section = (z: number) => {
    const found = samples.findIndex((p) => p.z >= z);
    const i = found < 0 ? samples.length - 1 : Math.max(1, found);
    const a = samples[i - 1],
      b = samples[i];
    return a
      .clone()
      .lerp(b, THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1));
  };
  const shoulder = (z: number) =>
    0.16 * Math.exp(-(((z - 1.38) / 0.55) ** 2)) +
    0.1 * Math.exp(-(((z + 1.4) / 0.55) ** 2));
  const top = (z: number, u: number): P => {
    const p = section(z),
      x = Math.abs(u);
    return [p.x * u, p.y + shoulder(z) * x * x - 0.025 * x ** 8, z];
  };
  function surface(
    key: Key,
    nz: number,
    nx: number,
    point: (v: number, u: number) => P,
    reverse = false,
  ) {
    const positions: number[] = [],
      indices: number[] = [];
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) positions.push(...point(j / nz, i / nx));
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i,
          b = a + 1,
          c = a + nx + 1,
          d = c + 1;
        indices.push(...(reverse ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    add(key, g);
  }
  // Hood and rear deck, then narrow door shoulders alongside the cockpit.
  surface('paint', 32, 24, (v, u) => top(0.67 + v * 1.58, u * 2 - 1));
  surface('paint', 28, 24, (v, u) => top(-2.2 + v * 1.3, u * 2 - 1));
  for (const sign of [-1, 1]) {
    surface(
      'paint',
      24,
      4,
      (v, u) => top(-0.9 + v * 1.57, sign * (0.82 + u * 0.18)),
      sign < 0,
    );
    surface(
      'paint',
      100,
      6,
      (v, u) => {
        const z = -2.2 + v * 4.45,
          p = section(z);
        const arch = Math.min(Math.abs(z + 1.4), Math.abs(z - 1.38));
        const bottom =
          arch < 0.425 ? 0.36 + Math.sqrt(0.425 ** 2 - arch ** 2) : 0.29;
        const upper = top(z, sign)[1];
        return [
          sign * (p.x - 0.065 * Math.sin(u * Math.PI)),
          THREE.MathUtils.lerp(upper, Math.min(bottom, upper - 0.015), u),
          z,
        ];
      },
      sign < 0,
    );
    // Lower rocker, flush door handle and swept mirror housing.
    box('dark', [0.11, 0.075, 1.75], [sign * 0.83, 0.29, -0.03]);
    box('metal', [0.015, 0.021, 0.16], [sign * 0.852, 0.72, -0.35]);
    beam('dark', [sign * 0.82, 0.79, 0.57], [sign * 1.01, 0.87, 0.64], 0.022);
    const mirror = new THREE.SphereGeometry(1, 16, 10);
    mirror.scale(0.135, 0.065, 0.17);
    add('paint', mirror, [sign * 1.025, 0.89, 0.61]);
    box('dark', [0.19, 0.065, 0.017], [sign * 1.025, 0.89, 0.47]);
    // Side air blade just ahead of the rear wheel, inset into the shoulder.
    surface(
      'dark',
      8,
      3,
      (v, u) => {
        const z = -0.96 + v * 0.36,
          p = section(z);
        return [sign * (p.x + 0.005), 0.44 + u * (0.22 - 0.07 * v), z];
      },
      sign > 0,
    );
  }
  for (const z of [-2.2, 2.25])
    surface(
      'paint',
      1,
      24,
      (v, u) => {
        const p = top(z, u * 2 - 1);
        return [p[0], THREE.MathUtils.lerp(0.29, p[1], v), z];
      },
      z > 0,
    );
  box('dark', [1.48, 0.1, 3.95], [0, 0.26, 0]);
  box('dark', [1.4, 0.09, 1.55], [0, 0.43, -0.14]);
  // Twin tapered rear fairings behind the rollover hoops.
  for (const x of [-0.44, 0.44]) {
    surface(
      'paint',
      18,
      12,
      (v, u) => {
        const z = -1.8 + v * 0.93,
          a = u * Math.PI;
        const rise = 0.21 * Math.sin(v * Math.PI * 0.75);
        return [
          x + Math.cos(a) * 0.22 * Math.sin((v * Math.PI) / 2),
          section(z).y + Math.sin(a) * rise,
          z,
        ];
      },
      true,
    );
  }
  // Recessed wheel-well liners keep daylight from shining through the body.
  for (const x of [-0.79, 0.79])
    for (const z of [-1.4, 1.38])
      add(
        'dark',
        new THREE.CylinderGeometry(0.418, 0.418, 0.04, 28),
        [x, 0.36, z],
        [0, 0, Math.PI / 2],
      );
  for (const x of [-0.44, 0.44]) {
    oval('dark', [0.275, 0.085, 0.32], [x, 0.53, -0.21]);
    oval('dark', [0.275, 0.33, 0.09], [x, 0.86, -0.57], [-0.14, 0, 0]);
    oval('dark', [0.15, 0.11, 0.085], [x, 1.17, -0.62]);
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
  beam('dark', [-0.79, 0.85, 0.86], [-0.72, 1.28, 0.5], 0.028);
  beam('dark', [0.79, 0.85, 0.86], [0.72, 1.28, 0.5], 0.028);
  beam('dark', [-0.72, 1.28, 0.5], [0.72, 1.28, 0.5], 0.026);
  beam('dark', [-0.79, 0.85, 0.86], [0.79, 0.85, 0.86], 0.027);
  add(
    'dark',
    new THREE.TorusGeometry(0.16, 0.019, 8, 20),
    [0.44, 0.88, 0.4],
    [0.25, 0, 0],
  );
  beam('metal', [0.3, 0.88, 0.4], [0.58, 0.88, 0.4], 0.013);
  beam('metal', [0.44, 0.88, 0.4], [0.44, 0.73, 0.44], 0.013);
  // Wide lower intakes, swept LED blades and a slim rear light bar.
  box('dark', [1.1, 0.14, 0.045], [0, 0.365, 2.27]);
  box('dark', [1.58, 0.035, 0.22], [0, 0.275, 2.17]);
  for (const sign of [-1, 1]) {
    box('dark', [0.29, 0.11, 0.06], [sign * 0.66, 0.36, 2.23]);
    const lamp = new THREE.SphereGeometry(1, 16, 8);
    lamp.scale(0.19, 0.025, 0.115);
    add('dark', lamp, [sign * 0.65, 0.615, 2.01], [0, sign * 0.32, 0]);
    box(
      'lamp',
      [0.3, 0.017, 0.034],
      [sign * 0.65, 0.63, 2.06],
      [0, sign * 0.32, 0],
    );
    box('tail', [0.42, 0.028, 0.032], [sign * 0.52, 0.585, -2.225]);
    add(
      'metal',
      new THREE.CylinderGeometry(0.064, 0.064, 0.17, 12),
      [sign * 0.37, 0.33, -2.2],
      [Math.PI / 2, 0, 0],
    );
    add(
      'dark',
      new THREE.CircleGeometry(0.05, 12),
      [sign * 0.37, 0.33, -2.29],
      [0, Math.PI, 0],
    );
  }
  box('tail', [0.63, 0.013, 0.022], [0, 0.585, -2.226]);
  box('dark', [1.4, 0.13, 0.09], [0, 0.345, -2.225]);
  for (const x of [-0.6, -0.2, 0.2, 0.6])
    box('dark', [0.025, 0.115, 0.28], [x, 0.28, -2.12]);
  // Subtle integrated ducktail follows the rear deck instead of a box wing.
  surface(
    'paint',
    5,
    24,
    (v, u) => {
      const x = (u * 2 - 1) * 0.77;
      return [
        x,
        0.635 + v * 0.055 + 0.04 * (1 - (x / 0.77) ** 2),
        -2.08 - v * 0.12,
      ];
    },
    true,
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
        new THREE.TorusGeometry(0.265, 0.022, 8, 24),
        palette.metal,
      );
      rim.rotation.y = Math.PI / 2;
      rim.position.x = Math.sign(x) * 0.132;
      spin.add(rim);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.27, 12),
        palette.dark,
      );
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(0.027, 0.029, 0.5),
          palette.metal,
        );
        spoke.rotation.x = a;
        spoke.position.x = Math.sign(x) * 0.134;
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
