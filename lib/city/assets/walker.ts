import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original procedural pedestrian. Metres; +Z forward; ground contact at y=0. */
export function makeWalker(): {
  group: THREE.Group;
  update: (distance: number, moving: boolean) => void;
} {
  const group = new THREE.Group();
  group.name = 'Walker — original Vancouver pedestrian';
  const material = (color: number, roughness = 0.86) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const jacket = material(0x2c6c70),
    seam = material(0x205156),
    pants = material(0x2b3949);
  const skin = material(0xbd8e73),
    hair = material(0x29241f),
    backpack = material(0x9e6748);
  const webbing = material(0x333b39),
    shoeMat = material(0x37414a),
    sole = material(0xc0bcb0);
  const eyes = material(0xdddcd3),
    pupils = material(0x222b2b),
    mouth = material(0x7c5047);
  const zip = material(0xacae9b, 0.48);
  const down = new THREE.Vector3(0, -1, 0),
    tmp = new THREE.Vector3();

  function mesh(
    parent: THREE.Group,
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(
    parent: THREE.Group,
    mat: THREE.Material,
    width: number,
    height: number,
    depth: number,
    x = 0,
    y = 0,
    z = 0,
  ) {
    return mesh(
      parent,
      new THREE.BoxGeometry(width, height, depth),
      mat,
      x,
      y,
      z,
    );
  }
  function ellipsoid(
    parent: THREE.Group,
    mat: THREE.Material,
    rx: number,
    ry: number,
    rz: number,
    x = 0,
    y = 0,
    z = 0,
    segments = 8,
  ) {
    return mesh(
      parent,
      new THREE.SphereGeometry(1, segments, 6).scale(rx, ry, rz),
      mat,
      x,
      y,
      z,
    );
  }
  /** Elliptical loft with tapered profile and smooth side normals. */
  function loft(
    profile: readonly (readonly [number, number, number, number?])[],
    sides = 10,
  ) {
    const positions: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    for (let j = 0; j < profile.length; j++) {
      const [y, width, depth, offset = 0] = profile[j];
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        positions.push(Math.cos(a) * width, y, Math.sin(a) * depth + offset);
        uv.push(i / sides, j / (profile.length - 1));
      }
    }
    for (let j = 0; j < profile.length - 1; j++)
      for (let i = 0; i < sides; i++) {
        const a = j * (sides + 1) + i,
          b = a + sides + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    // End caps have their own normals, keeping the clothing seams crisp.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    const triangles = g.toNonIndexed();
    g.dispose();
    const capPos: number[] = [],
      capUV: number[] = [];
    for (const j of [0, profile.length - 1]) {
      const [y, w, d, z = 0] = profile[j];
      for (let i = 1; i < sides - 1; i++) {
        const ids = j === 0 ? [0, i, i + 1] : [0, i + 1, i];
        for (const k of ids) {
          const a = (k / sides) * Math.PI * 2;
          capPos.push(Math.cos(a) * w, y, Math.sin(a) * d + z);
          capUV.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
        }
      }
    }
    const caps = new THREE.BufferGeometry();
    caps.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
    caps.setAttribute('uv', new THREE.Float32BufferAttribute(capUV, 2));
    caps.computeVertexNormals();
    const out = mergeGeometries([triangles, caps])!;
    triangles.dispose();
    caps.dispose();
    return out;
  }
  function ribbon(
    parent: THREE.Group,
    mat: THREE.Material,
    points: number[][],
    width: number,
    depth = 0.012,
  ) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...(points[i] as [number, number, number]));
      const b = new THREE.Vector3(
        ...(points[i + 1] as [number, number, number]),
      );
      const m = box(parent, mat, width, a.distanceTo(b), depth);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        b.sub(a).normalize(),
      );
    }
  }
  /** Merge only this rigid part; child joints retain their own transforms. */
  function batch(part: THREE.Group) {
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const originals = part.children.filter(
      (o) => o instanceof THREE.Mesh,
    ) as THREE.Mesh[];
    for (const m of originals) {
      if (Array.isArray(m.material)) continue;
      m.updateMatrix();
      const g = m.geometry.index
        ? m.geometry.toNonIndexed()
        : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      const list = byMaterial.get(m.material) || [];
      list.push(g);
      byMaterial.set(m.material, list);
      part.remove(m);
      m.geometry.dispose();
    }
    for (const [mat, geos] of byMaterial) {
      mesh(part, mergeGeometries(geos)!, mat);
      for (const g of geos) g.dispose();
    }
  }

  const body = new THREE.Group();
  body.name = 'Jacket, shoulders and backpack';
  group.add(body);
  mesh(
    body,
    loft([
      [0.008, 0.148, 0.098],
      [0.09, 0.164, 0.108],
      [0.25, 0.181, 0.118],
      [0.415, 0.223, 0.107],
      [0.48, 0.19, 0.085],
    ]),
    jacket,
  );
  mesh(
    body,
    loft(
      [
        [-0.03, 0.144, 0.096],
        [0.065, 0.153, 0.101],
      ],
      10,
    ),
    pants,
  );
  box(body, seam, 0.285, 0.025, 0.018, 0, 0.02, 0.1);
  box(body, zip, 0.009, 0.395, 0.009, 0, 0.23, 0.12);
  box(body, zip, 0.018, 0.03, 0.014, 0.008, 0.3, 0.13);
  for (const s of [-1, 1]) {
    const pocket = box(body, seam, 0.106, 0.081, 0.012, s * 0.098, 0.12, 0.105);
    pocket.rotation.z = s * 0.13;
    box(body, jacket, 0.091, 0.066, 0.014, s * 0.098, 0.123, 0.114);
    const collar = box(body, seam, 0.1, 0.038, 0.065, s * 0.051, 0.475, 0.051);
    collar.rotation.z = -s * 0.18;
  }
  mesh(
    body,
    new THREE.CylinderGeometry(0.047, 0.052, 0.098, 10),
    skin,
    0,
    0.515,
    0.005,
  );
  mesh(
    body,
    loft(
      [
        [0.08, 0.119, 0.049, -0.15],
        [0.13, 0.15, 0.075, -0.15],
        [0.34, 0.146, 0.072, -0.15],
        [0.425, 0.11, 0.05, -0.15],
      ],
      10,
    ),
    backpack,
  );
  box(body, webbing, 0.23, 0.024, 0.018, 0, 0.355, -0.222);
  box(body, backpack, 0.202, 0.092, 0.026, 0, 0.193, -0.23);
  box(body, zip, 0.009, 0.035, 0.009, 0.053, 0.217, -0.25);
  ribbon(
    body,
    webbing,
    [
      [-0.106, 0.395, -0.152],
      [-0.112, 0.484, -0.024],
      [-0.114, 0.412, 0.095],
      [-0.116, 0.2, 0.109],
    ],
    0.031,
  );
  ribbon(
    body,
    webbing,
    [
      [0.106, 0.395, -0.152],
      [0.112, 0.484, -0.024],
      [0.114, 0.412, 0.095],
      [0.116, 0.2, 0.109],
    ],
    0.031,
  );
  box(body, zip, 0.039, 0.043, 0.012, -0.114, 0.245, 0.125);
  box(body, zip, 0.039, 0.043, 0.012, 0.114, 0.245, 0.125);
  ribbon(
    body,
    webbing,
    [
      [-0.038, 0.42, -0.17],
      [-0.036, 0.465, -0.18],
      [0.036, 0.465, -0.18],
      [0.038, 0.42, -0.17],
    ],
    0.018,
  );

  const head = new THREE.Group();
  head.name = 'Face and hair';
  head.position.y = 0.66;
  body.add(head);
  mesh(
    head,
    loft(
      [
        [-0.145, 0.035, 0.045, 0.022],
        [-0.119, 0.074, 0.07, 0.015],
        [-0.052, 0.099, 0.088, 0.012],
        [0.043, 0.101, 0.087, 0.006],
        [0.106, 0.087, 0.071, 0],
        [0.134, 0.041, 0.04, -0.004],
      ],
      12,
    ),
    skin,
  );
  for (const s of [-1, 1]) {
    ellipsoid(head, skin, 0.014, 0.026, 0.02, s * 0.1, -0.007, 0.002);
    ellipsoid(head, eyes, 0.018, 0.01, 0.007, s * 0.042, 0.024, 0.086);
    ellipsoid(head, pupils, 0.0072, 0.0072, 0.005, s * 0.042, 0.024, 0.092);
    const brow = box(head, hair, 0.034, 0.006, 0.01, s * 0.042, 0.046, 0.091);
    brow.rotation.z = -s * 0.07;
  }
  // A small original beveled nose, with its silhouette pointing toward +Z.
  const nose = new THREE.BufferGeometry();
  const np = [
    -0.014, 0.022, 0.087, 0.014, 0.022, 0.087, -0.018, -0.035, 0.099, 0.018,
    -0.035, 0.099, 0, -0.017, 0.138,
  ];
  nose.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  nose.setIndex([0, 4, 1, 0, 2, 4, 1, 4, 3, 2, 3, 4, 0, 1, 2, 1, 3, 2]);
  nose.computeVertexNormals();
  nose.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array(10), 2),
  );
  mesh(head, nose, skin);
  box(head, mouth, 0.036, 0.006, 0.007, 0, -0.069, 0.096);
  ellipsoid(head, skin, 0.029, 0.012, 0.01, 0, -0.095, 0.085);
  // Asymmetric cap: shorter forehead fringe, longer side/back hair.
  const hp: number[] = [],
    hu: number[] = [],
    hi: number[] = [];
  const hs = 14,
    hr = 5;
  for (let j = 0; j <= hr; j++)
    for (let i = 0; i <= hs; i++) {
      const a = (i / hs) * Math.PI * 2,
        front = Math.max(0, Math.sin(a));
      const end = 1.92 - front * 0.64,
        theta = (j / hr) * end;
      const r = 1 + Math.sin(a * 3 + 0.4) * 0.025 * Math.sin(theta);
      hp.push(
        Math.cos(a) * Math.sin(theta) * 0.108 * r,
        0.025 + Math.cos(theta) * 0.155,
        Math.sin(a) * Math.sin(theta) * 0.106 * r - 0.005,
      );
      hu.push(i / hs, j / hr);
    }
  for (let j = 0; j < hr; j++)
    for (let i = 0; i < hs; i++) {
      const a = j * (hs + 1) + i,
        b = a + hs + 1;
      if (j > 0) hi.push(a, a + 1, b);
      hi.push(a + 1, b + 1, b);
    }
  const scalp = new THREE.BufferGeometry();
  scalp.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  scalp.setAttribute('uv', new THREE.Float32BufferAttribute(hu, 2));
  scalp.setIndex(hi);
  scalp.computeVertexNormals();
  mesh(head, scalp, hair);
  const fringe = ellipsoid(
    head,
    hair,
    0.057,
    0.026,
    0.026,
    -0.037,
    0.081,
    0.075,
  );
  fringe.rotation.z = -0.22;

  const arms: { upper: THREE.Group; fore: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group();
    upper.name = side < 0 ? 'Left shoulder' : 'Right shoulder';
    upper.position.set(side * 0.224, 0.414, 0);
    body.add(upper);
    mesh(
      upper,
      loft(
        [
          [-0.28, 0.051, 0.051],
          [-0.205, 0.058, 0.055],
          [-0.037, 0.068, 0.062],
          [0.014, 0.056, 0.052],
        ],
        8,
      ),
      jacket,
    );
    ellipsoid(upper, jacket, 0.071, 0.071, 0.064, 0, -0.016, 0);
    const fore = new THREE.Group();
    fore.position.y = -0.277;
    upper.add(fore);
    ellipsoid(fore, jacket, 0.055, 0.053, 0.052);
    mesh(
      fore,
      loft(
        [
          [-0.253, 0.042, 0.041],
          [-0.18, 0.048, 0.045],
          [0.001, 0.053, 0.052],
        ],
        8,
      ),
      jacket,
    );
    mesh(
      fore,
      loft(
        [
          [-0.267, 0.043, 0.042],
          [-0.24, 0.044, 0.043],
        ],
        8,
      ),
      seam,
    );
    ellipsoid(fore, skin, 0.038, 0.061, 0.025, 0, -0.315, 0.004);
    const thumb = ellipsoid(
      fore,
      skin,
      0.016,
      0.035,
      0.017,
      -side * 0.031,
      -0.303,
      0.018,
    );
    thumb.rotation.z = side * 0.3;
    batch(upper);
    batch(fore);
    arms.push({ upper, fore, side });
  }

  const thighLength = 0.42,
    shinLength = 0.405;
  const legs: {
    upper: THREE.Group;
    lower: THREE.Group;
    foot: THREE.Group;
    side: number;
    footMin: THREE.Vector3[];
  }[] = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group(),
      lower = new THREE.Group(),
      foot = new THREE.Group();
    upper.name = side < 0 ? 'Left thigh' : 'Right thigh';
    lower.name = side < 0 ? 'Left shin' : 'Right shin';
    foot.name = side < 0 ? 'Left shoe' : 'Right shoe';
    group.add(upper, lower, foot);
    mesh(
      upper,
      loft(
        [
          [-thighLength, 0.056, 0.06],
          [-0.23, 0.068, 0.065],
          [0, 0.078, 0.078],
        ],
        9,
      ),
      pants,
    );
    ellipsoid(lower, pants, 0.061, 0.065, 0.063);
    mesh(
      lower,
      loft(
        [
          [-shinLength, 0.043, 0.045],
          [-0.21, 0.057, 0.052],
          [0, 0.059, 0.06],
        ],
        9,
      ),
      pants,
    );
    box(lower, seam, 0.009, 0.225, 0.006, side * 0.038, -0.218, 0.041);
    mesh(
      foot,
      loft(
        [
          [-0.095, 0.069, 0.123, 0.036],
          [-0.073, 0.075, 0.131, 0.036],
          [-0.059, 0.073, 0.13, 0.036],
        ],
        10,
      ),
      sole,
    );
    mesh(
      foot,
      loft(
        [
          [-0.06, 0.07, 0.126, 0.036],
          [-0.016, 0.068, 0.123, 0.035],
          [0.035, 0.046, 0.071, 0.004],
        ],
        10,
      ),
      shoeMat,
    );
    box(foot, sole, 0.086, 0.016, 0.034, 0, -0.044, 0.147);
    for (let i = 0; i < 3; i++)
      box(
        foot,
        sole,
        0.073 - i * 0.004,
        0.006,
        0.008,
        0,
        0.01 - i * 0.012,
        0.048 + i * 0.022,
      );
    box(foot, webbing, 0.027, 0.035, 0.018, 0, 0.028, -0.055);
    batch(upper);
    batch(lower);
    batch(foot);
    const bounds = new THREE.Box3().setFromObject(foot),
      corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          corners.push(new THREE.Vector3(x, y, z));
    legs.push({ upper, lower, foot, side, footMin: corners });
  }
  batch(head);
  batch(body);

  let strength = 0,
    lastTime: number | undefined;
  function update(distance: number, moving: boolean) {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt =
      lastTime === undefined
        ? 1 / 60
        : Math.max(0, Math.min(0.1, (now - lastTime) / 1000));
    lastTime = now;
    strength += (Number(moving) - strength) * (1 - Math.exp(-dt * 13));
    if (!moving && strength < 0.0001) strength = 0;
    const phase =
      (((Number.isFinite(distance) ? distance : 0) % 1.35) / 1.35) *
      Math.PI *
      2;
    const hipY =
      0.91 - strength * 0.03 + Math.cos(phase * 2) * 0.006 * strength;
    body.position.y = hipY;
    body.rotation.set(
      0,
      Math.sin(phase) * 0.045 * strength,
      Math.sin(phase) * 0.014 * strength,
    );
    head.rotation.y = -Math.sin(phase) * 0.025 * strength;
    for (const arm of arms) {
      const s = Math.sin(phase + (arm.side < 0 ? 0 : Math.PI));
      arm.upper.rotation.set(s * 0.46 * strength, 0, -arm.side * 0.075);
      arm.fore.rotation.x = -0.11 - Math.max(0, -s) * 0.25 * strength;
    }
    for (const leg of legs) {
      const p = phase + (leg.side < 0 ? 0 : Math.PI),
        s = Math.sin(p),
        c = Math.cos(p);
      const lift = Math.pow(Math.max(0, c), 1.6) * 0.115 * strength;
      const foot = leg.foot;
      foot.rotation.x = -c * 0.16 * strength;
      foot.rotation.y = leg.side * 0.045;
      foot.updateMatrix();
      let low = Infinity;
      for (const corner of leg.footMin)
        low = Math.min(low, tmp.copy(corner).applyEuler(foot.rotation).y);
      foot.position.set(leg.side * 0.105, -low + lift, s * 0.23 * strength);
      const hip = new THREE.Vector3(leg.side * 0.105, hipY, 0),
        ankle = foot.position;
      const direction = ankle.clone().sub(hip),
        length = Math.min(
          thighLength + shinLength - 0.00001,
          direction.length(),
        );
      direction.normalize();
      const along =
        (thighLength * thighLength -
          shinLength * shinLength +
          length * length) /
        (2 * length);
      const bend = new THREE.Vector3(leg.side * 0.035, 0, 1)
        .addScaledVector(direction, -direction.z)
        .normalize();
      const knee = hip
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(
          bend,
          Math.sqrt(Math.max(0, thighLength * thighLength - along * along)),
        );
      leg.upper.position.copy(hip);
      leg.upper.quaternion.setFromUnitVectors(
        down,
        knee.clone().sub(hip).normalize(),
      );
      leg.lower.position.copy(knee);
      leg.lower.quaternion.setFromUnitVectors(
        down,
        ankle.clone().sub(knee).normalize(),
      );
    }
    group.updateMatrixWorld(true);
  }
  update(0, false);
  let triangles = 0,
    drawCalls = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      triangles +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      drawCalls++;
    }
  });
  group.userData = {
    forward: '+Z',
    groundY: 0,
    heightMetres: 1.75,
    originalProceduralAsset: true,
    triangles,
    drawCalls,
    strideMetres: 1.35,
  };
  return { group, update };
}
