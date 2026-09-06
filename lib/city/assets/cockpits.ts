import * as THREE from 'three';

/** Original, renderer-independent first-person interiors. Metres; camera looks -Z.
 * No texture, glass surface, light, font, renderer or engine dependency.
 * Parent the returned group to the camera, with its transform left at identity.
 */
type P = [number, number, number];
type Batch = { positions: number[]; normals: number[]; uvs: number[] };
type Palette = Record<string, THREE.MeshBasicMaterial>;
const TAU = Math.PI * 2;
const V = (p: P) => new THREE.Vector3(...p);
const material = (name: string, color: number) => {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  m.name = `cockpit/${name}`;
  return m;
};

class Parts {
  private batches = new Map<string, Batch>();
  constructor(
    private group: THREE.Group,
    private palette: Palette,
  ) {}
  add(
    key: string,
    geometry: THREE.BufferGeometry,
    position: P = [0, 0, 0],
    rotation: P = [0, 0, 0],
    scale: P = [1, 1, 1],
  ) {
    const matrix = new THREE.Matrix4().compose(
      V(position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      V(scale),
    );
    geometry.applyMatrix4(matrix);
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      uv = geometry.getAttribute('uv'),
      index = geometry.index;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { positions: [], normals: [], uvs: [] };
      this.batches.set(key, batch);
    }
    const count = index ? index.count : p.count;
    for (let j = 0; j < count; j++) {
      const i = index ? index.getX(j) : j;
      batch.positions.push(p.getX(i), p.getY(i), p.getZ(i));
      batch.normals.push(n.getX(i), n.getY(i), n.getZ(i));
      batch.uvs.push(uv ? uv.getX(i) : p.getX(i), uv ? uv.getY(i) : p.getY(i));
    }
    geometry.dispose();
  }
  box(key: string, size: P, position: P, rotation: P = [0, 0, 0]) {
    this.add(key, new THREE.BoxGeometry(...size), position, rotation);
  }
  beam(key: string, a: P, b: P, radius: number, segments = 6) {
    const av = V(a),
      bv = V(b),
      direction = bv.clone().sub(av);
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      direction.length(),
      segments,
      1,
      true,
    );
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    );
    this.add(key, geometry, av.lerp(bv, 0.5).toArray() as P);
  }
  ring(
    key: string,
    radius: number,
    tube: number,
    position: P,
    scale: P = [1, 1, 1],
    arc = TAU,
  ) {
    this.add(
      key,
      new THREE.TorusGeometry(radius, tube, 5, 40, arc),
      position,
      [0, 0, 0],
      scale,
    );
  }
  disk(key: string, radius: number, position: P, scale: P = [1, 1, 1]) {
    this.add(
      key,
      new THREE.CircleGeometry(radius, 32),
      position,
      [0, 0, 0],
      scale,
    );
  }
  tube(
    key: string,
    points: P[],
    radius: number,
    segments = 36,
    closed = false,
  ) {
    const path = new THREE.CatmullRomCurve3(
      points.map(V),
      closed,
      'centripetal',
    );
    this.add(key, new THREE.TubeGeometry(path, segments, radius, 5, closed));
  }
  // Bevelled solid panel in camera XY; front is at the specified Z coordinate.
  panel(
    key: string,
    outline: [number, number][],
    depth: number,
    z: number,
    bevel = 0.012,
  ) {
    const shape = new THREE.Shape(
      outline.map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
      curveSegments: 1,
      steps: 1,
    });
    this.add(key, geometry, [0, 0, z - depth]);
  }
  finish() {
    for (const [key, batch] of this.batches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(batch.positions, 3),
      );
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(batch.normals, 3),
      );
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(batch.uvs, 2),
      );
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.palette[key]);
      mesh.name = `${this.group.name}/${key}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData = {
        cockpit: true,
        excludeFromSSAO: true,
        excludeFromPicking: true,
      };
      this.group.add(mesh);
    }
  }
}

// Seven-segment numerals are authored as tiny bars, not a canvas/font texture.
const DIGITS = [
  'abcdef',
  'bc',
  'abged',
  'abgcd',
  'fgbc',
  'afgcd',
  'afgecd',
  'abc',
  'abcdefg',
  'abfgcd',
];
function number(
  parts: Parts,
  value: number,
  x: number,
  y: number,
  z: number,
  height: number,
  key = 'ink',
) {
  const digits = String(value),
    width = height * 0.5,
    spacing = width * 1.3,
    thick = height * 0.09;
  const segments: Record<string, [number, number, number, number]> = {
    a: [0, 0.5, 0.4, 0],
    g: [0, 0, 0.4, 0],
    d: [0, -0.5, 0.4, 0],
    f: [-0.25, 0.25, 0, 0.34],
    b: [0.25, 0.25, 0, 0.34],
    e: [-0.25, -0.25, 0, 0.34],
    c: [0.25, -0.25, 0, 0.34],
  };
  for (let i = 0; i < digits.length; i++)
    for (const s of DIGITS[Number(digits[i])]) {
      const [sx, sy, w, h] = segments[s];
      parts.box(
        key,
        [w ? w * height : thick, h ? h * height : thick, 0.0007],
        [
          x + (i - (digits.length - 1) / 2) * spacing + sx * height,
          y + sy * height,
          z,
        ],
      );
    }
}

function gauge(
  parts: Parts,
  palette: Palette,
  parent: THREE.Group,
  center: P,
  radius: number,
  maximum: number,
  moving: boolean,
  dialKey = 'dark',
) {
  parts.ring('silver', radius + 0.002, 0.0045, center);
  parts.disk(dialKey, radius, [center[0], center[1], center[2] + 0.001]);
  const startAngle = 2.25,
    endAngle = -2.25;
  const ticks = 24;
  for (let i = 0; i <= ticks; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / ticks;
    const major = i % 4 === 0,
      r0 = radius * (major ? 0.72 : 0.8),
      r1 = radius * 0.9;
    const point = (r: number): P => [
      center[0] - Math.sin(angle) * r,
      center[1] + Math.cos(angle) * r,
      center[2] + 0.003,
    ];
    parts.beam(
      i >= 22 ? 'red' : 'ink',
      point(r0),
      point(r1),
      major ? 0.0011 : 0.0006,
      4,
    );
    if (i % 8 === 0) {
      const p = point(radius * 0.52);
      number(
        parts,
        Math.round((maximum * i) / ticks),
        p[0],
        p[1],
        center[2] + 0.004,
        radius * 0.14,
      );
    }
  }
  const needle = new THREE.Group();
  needle.name = moving ? 'speed-needle' : 'secondary-needle';
  needle.position.set(...center);
  needle.position.z += 0.008;
  needle.rotation.z = moving ? startAngle : -0.45;
  const n = new Parts(needle, palette);
  n.panel(
    'red',
    [
      [-0.0018, -radius * 0.14],
      [0.0018, -radius * 0.14],
      [0.001, radius * 0.69],
      [-0.001, radius * 0.69],
    ],
    0.0015,
    0,
    0,
  );
  n.disk('silver', radius * 0.074, [0, 0, 0.002]);
  n.finish();
  parent.add(needle);
  return { needle, startAngle, endAngle, maxSpeed: maximum };
}

function carWheel(palette: Palette) {
  const group = new THREE.Group();
  group.name = 'drive-steering-wheel';
  group.position.set(0, -0.405, -0.66);
  group.rotation.x = -0.2;
  const p = new Parts(group, palette),
    radius = 0.166;
  const points = Array.from({ length: 40 }, (_, i): P => {
    const angle = (i / 40) * TAU;
    return [
      Math.cos(angle) * radius,
      Math.max(-0.135, Math.sin(angle) * radius),
      0,
    ];
  });
  p.tube('dark', points, 0.017, 48, true);
  p.tube(
    'stitch',
    points.map(([x, y, z]): P => [x * 0.974, y * 0.974, z + 0.012]),
    0.0012,
    48,
    true,
  );
  p.panel(
    'dark',
    [
      [-0.068, -0.04],
      [0.055, -0.04],
      [0.074, 0.01],
      [0.046, 0.048],
      [-0.046, 0.048],
      [-0.074, 0.01],
    ],
    0.04,
    0.029,
  );
  p.panel(
    'trim',
    [
      [-0.147, 0.027],
      [-0.041, 0.019],
      [-0.039, -0.013],
      [-0.136, -0.022],
    ],
    0.018,
    0.012,
    0.002,
  );
  p.panel(
    'trim',
    [
      [0.147, 0.027],
      [0.041, 0.019],
      [0.039, -0.013],
      [0.136, -0.022],
    ],
    0.018,
    0.012,
    0.002,
  );
  p.panel(
    'trim',
    [
      [-0.02, -0.035],
      [0.02, -0.035],
      [0.032, -0.135],
      [-0.032, -0.135],
    ],
    0.018,
    0.012,
    0.003,
  );
  p.box('silver', [0.02, 0.006, 0.003], [0, 0.006, 0.044]);
  for (const side of [-1, 1])
    for (let i = 0; i < 2; i++)
      p.box(
        'dark',
        [0.02, 0.01, 0.003],
        [side * (0.09 + i * 0.025), 0.006, 0.025],
      );
  p.finish();
  return group;
}

function boatWheel(palette: Palette) {
  const group = new THREE.Group();
  group.name = 'boat-steering-wheel';
  group.position.set(0.065, -0.414, -0.735);
  group.rotation.x = -0.28;
  const p = new Parts(group, palette);
  p.ring('wood', 0.166, 0.013, [0, 0, 0]);
  p.ring('silver', 0.154, 0.003, [0, 0, 0.004]);
  for (let i = 0; i < 5; i++) {
    const angle = (i * TAU) / 5 + Math.PI / 2;
    p.beam(
      'silver',
      [0, 0, 0.018],
      [Math.cos(angle) * 0.158, Math.sin(angle) * 0.158, 0],
      0.006,
      6,
    );
    p.disk('silver', 0.004, [
      Math.cos(angle) * 0.162,
      Math.sin(angle) * 0.162,
      0.012,
    ]);
  }
  p.disk('silver', 0.033, [0, 0, 0.026]);
  p.disk('dark', 0.025, [0, 0, 0.029]);
  p.ring('silver', 0.015, 0.0015, [0, 0, 0.03]);
  p.finish();
  return group;
}

function drive(group: THREE.Group, p: Parts, palette: Palette) {
  // The hood and binnacle rise only into the bottom quarter of a 45-degree view.
  p.panel(
    'dash',
    [
      [-0.88, -0.62],
      [0.9, -0.62],
      [0.9, -0.355],
      [0.43, -0.356],
      [0.23, -0.368],
      [-0.23, -0.368],
      [-0.46, -0.356],
      [-0.88, -0.355],
    ],
    0.34,
    -0.78,
    0.02,
  );
  p.tube(
    'trim',
    [
      [-0.83, -0.37, -0.752],
      [-0.44, -0.371, -0.752],
      [0, -0.382, -0.752],
      [0.45, -0.372, -0.752],
      [0.86, -0.37, -0.752],
    ],
    0.004,
    24,
  );
  p.panel(
    'dark',
    [
      [-0.225, -0.347],
      [0.225, -0.347],
      [0.207, -0.233],
      [0.145, -0.202],
      [-0.145, -0.202],
      [-0.207, -0.233],
    ],
    0.085,
    -0.828,
    0.014,
  );
  const speed = gauge(
    p,
    palette,
    group,
    [-0.092, -0.28, -0.805],
    0.066,
    120,
    true,
  );
  gauge(p, palette, group, [0.079, -0.28, -0.805], 0.054, 8, false);
  // Small central fuel/status elements have no fabricated navigation display.
  p.box('dark', [0.045, 0.026, 0.004], [0.002, -0.273, -0.799]);
  for (let i = 0; i < 5; i++)
    p.box(
      'ink',
      [0.004, 0.008 + i * 0.002, 0.001],
      [-0.012 + i * 0.006, -0.27, -0.795],
    );
  // Vents and passenger fascia remain low and off the central sight line.
  for (const x of [-0.55, 0.36, 0.6]) {
    p.box('dark', [0.132, 0.042, 0.02], [x, -0.385, -0.744]);
    for (let i = 0; i < 4; i++)
      p.box('trim', [0.112, 0.0023, 0.016], [x, -0.397 + i * 0.008, -0.731]);
  }
  p.box('dark', [0.17, 0.13, 0.025], [0.35, -0.494, -0.739]);
  for (const x of [0.3, 0.4]) {
    p.ring('silver', 0.018, 0.003, [x, -0.473, -0.719]);
    p.disk('dark', 0.015, [x, -0.473, -0.715]);
  }
  p.box('red', [0.014, 0.01, 0.003], [0.35, -0.514, -0.721]);
  // Side pillars and a high header frame an empty windshield aperture.
  for (const side of [-1, 1]) {
    p.beam(
      'dash',
      [side * 0.69, -0.39, -0.81],
      [side * 0.78, 0.54, -1.06],
      0.022,
      6,
    );
    p.beam(
      'trim',
      [side * 0.718, -0.39, -0.827],
      [side * 0.8, 0.535, -1.066],
      0.006,
      4,
    );
  }
  p.beam('dash', [-0.78, 0.55, -1.055], [0.78, 0.55, -1.055], 0.03, 6);
  // Rear-view mirror has a neutral dark reflective face, not a fake live scene.
  p.beam('dark', [0.25, 0.5, -1.0], [0.25, 0.325, -0.94], 0.007, 6);
  p.panel(
    'dark',
    [
      [0.125, 0.293],
      [0.373, 0.293],
      [0.383, 0.357],
      [0.118, 0.357],
    ],
    0.026,
    -0.882,
    0.006,
  );
  p.panel(
    'mirror',
    [
      [0.131, 0.301],
      [0.366, 0.301],
      [0.372, 0.349],
      [0.129, 0.349],
    ],
    0.001,
    -0.873,
    0.002,
  );
  const wheel = carWheel(palette);
  group.add(wheel);
  return {
    wheel,
    speed,
    unit: 'km/h',
    speedMultiplier: 3.6,
    steeringMaxRadians: 1.2,
  };
}

function boat(group: THREE.Group, p: Parts, palette: Palette) {
  p.panel(
    'hull',
    [
      [-0.74, -0.65],
      [0.8, -0.65],
      [0.77, -0.403],
      [0.35, -0.306],
      [-0.27, -0.313],
      [-0.7, -0.405],
    ],
    0.3,
    -0.875,
    0.022,
  );
  p.panel(
    'dash',
    [
      [-0.264, -0.425],
      [0.36, -0.425],
      [0.302, -0.277],
      [-0.214, -0.284],
    ],
    0.035,
    -0.833,
    0.01,
  );
  p.tube(
    'wood',
    [
      [-0.67, -0.419, -0.835],
      [-0.26, -0.333, -0.821],
      [0.28, -0.329, -0.821],
      [0.74, -0.437, -0.835],
    ],
    0.0075,
    28,
  );
  const speed = gauge(
    p,
    palette,
    group,
    [-0.069, -0.335, -0.802],
    0.052,
    30,
    true,
    'navy',
  );
  gauge(p, palette, group, [0.105, -0.336, -0.802], 0.041, 6, false, 'navy');
  // Compass rose and switches, all at the bottom of the windshield.
  p.disk('dark', 0.035, [0.257, -0.362, -0.8]);
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    p.beam(
      i === 0 ? 'red' : 'ink',
      [0.257 + Math.sin(a) * 0.009, -0.362 + Math.cos(a) * 0.009, -0.795],
      [0.257 + Math.sin(a) * 0.028, -0.362 + Math.cos(a) * 0.028, -0.795],
      0.0011,
      4,
    );
  }
  for (let i = 0; i < 5; i++) {
    p.box('dark', [0.018, 0.027, 0.013], [-0.198 + i * 0.04, -0.418, -0.792]);
    p.box(
      i === 0 ? 'red' : 'ink',
      [0.009, 0.003, 0.002],
      [-0.198 + i * 0.04, -0.409, -0.784],
    );
  }
  // Side throttle and recess; comfortable, understated powerboat proportions.
  p.box('dash', [0.08, 0.065, 0.105], [0.49, -0.486, -0.739]);
  p.beam('silver', [0.49, -0.462, -0.72], [0.49, -0.353, -0.776], 0.008, 8);
  p.box('dark', [0.055, 0.024, 0.028], [0.49, -0.35, -0.776]);
  // Stainless side stanchions only: no transparent plane or centre crossing bar.
  for (const side of [-1, 1]) {
    p.beam(
      'silver',
      [side * 0.66, -0.399, -0.95],
      [side * 0.73, 0.238, -1.17],
      0.01,
      8,
    );
    p.beam(
      'silver',
      [side * 0.73, 0.238, -1.17],
      [side * 0.48, 0.238, -1.17],
      0.009,
      6,
    );
    p.beam(
      'silver',
      [side * 0.68, -0.415, -1.19],
      [side * 0.57, -0.553, -1.83],
      0.01,
      6,
    );
  }
  // A curved gunwale cues the bow without a solid deck across the viewing area.
  p.tube(
    'hull',
    [
      [-0.68, -0.46, -1.11],
      [-0.57, -0.54, -1.7],
      [0, -0.65, -2.08],
      [0.57, -0.54, -1.7],
      [0.68, -0.46, -1.11],
    ],
    0.016,
    40,
  );
  p.tube(
    'silver',
    [
      [-0.66, -0.435, -1.13],
      [-0.54, -0.515, -1.71],
      [0, -0.625, -2.08],
      [0.54, -0.515, -1.71],
      [0.66, -0.435, -1.13],
    ],
    0.004,
    40,
  );
  const wheel = boatWheel(palette);
  group.add(wheel);
  return {
    wheel,
    speed,
    unit: 'kn',
    speedMultiplier: 1.943844492,
    steeringMaxRadians: 1.35,
  };
}

export function makeCockpit(kind: 'drive' | 'boat'): THREE.Group {
  const group = new THREE.Group();
  group.name = `${kind}-cockpit`;
  const palette: Palette = {
    dash: material('dash', 0x303b3e),
    dark: material('dark', 0x11191d),
    trim: material('trim', 0x657174),
    silver: material('silver', 0xaab8b9),
    ink: material('ink', 0xc4d9cc),
    red: material('red', 0xd47459),
    stitch: material('stitch', 0x817e70),
    mirror: material('mirror', 0x65747a),
    hull: material('hull', 0xc4c4b2),
    wood: material('wood', 0x8c6240),
    navy: material('navy', 0x263d47),
  };
  const p = new Parts(group, palette);
  const controls =
    kind === 'drive' ? drive(group, p, palette) : boat(group, p, palette);
  p.finish();
  group.updateMatrixWorld(true);
  const used = new Set<THREE.Material>();
  let triangles = 0,
    meshes = 0;
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    used.add(o.material as THREE.Material);
    meshes++;
    triangles += o.geometry.getAttribute('position').count / 3;
  });
  for (const m of Object.values(palette)) if (!used.has(m)) m.dispose();
  const box = new THREE.Box3().setFromObject(group);
  group.userData = {
    cockpit: true,
    excludeFromSSAO: true,
    excludeFromPicking: true,
    kind,
    units: 'metres',
    axes: 'Camera local: +X right, +Y up, -Z forward',
    steeringWheel: controls.wheel,
    speedNeedle: controls.speed.needle,
    speedGauge: {
      startAngle: controls.speed.startAngle,
      endAngle: controls.speed.endAngle,
      maxSpeed: controls.speed.maxSpeed,
      unit: controls.unit,
      metresPerSecondMultiplier: controls.speedMultiplier,
    },
    steeringMaxRadians: controls.steeringMaxRadians,
    triangleCount: triangles,
    meshCount: meshes,
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    originalProceduralGeometry: true,
    // Some meshes share palette materials within this group; dispose each once.
    disposeMaterialsOnce: true,
  };
  return group;
}
