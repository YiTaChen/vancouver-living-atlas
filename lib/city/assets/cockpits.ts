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
  group.position.set(0, -0.345, -0.9);
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

// Driver-eye view of an original left-hand-drive interior. The steering wheel
// stays on the eye axis; the CABIN is asymmetric around that axis, not the wheel.
function drive(
  group: THREE.Group,
  p: Parts,
  palette: Palette,
  roadster = false,
) {
  // Approximate vehicle centreline is camera-local +X=0.45m. Thus the nearby
  // driver door is at -0.5m and the far passenger edge is around +1.3m.
  p.panel(
    'dash',
    [
      [-0.5, -0.7],
      [1.34, -0.7],
      [1.34, -0.365],
      [1.12, -0.34],
      [0.73, -0.352],
      [0.28, -0.402],
      [-0.24, -0.402],
      [-0.48, -0.364],
    ],
    0.28,
    -1.045,
    0.018,
  );
  p.tube(
    'trim',
    [
      [-0.49, -0.39, -1.019],
      [-0.25, -0.42, -1.019],
      [0.2, -0.418, -1.019],
      [0.54, -0.394, -1.019],
      [0.93, -0.379, -1.019],
      [1.28, -0.383, -1.019],
    ],
    0.0045,
    30,
  );
  // The cluster is centred behind the wheel, with its full dials above the
  // bottom 10% HUD band at FOV58 and root transform identity.
  p.panel(
    'dark',
    [
      [-0.223, -0.377],
      [0.223, -0.377],
      [0.208, -0.276],
      [0.145, -0.239],
      [-0.145, -0.239],
      [-0.208, -0.276],
    ],
    0.082,
    -1.033,
    0.012,
  );
  const speed = gauge(
    p,
    palette,
    group,
    [-0.09, -0.31, -1.008],
    0.065,
    120,
    true,
  );
  gauge(p, palette, group, [0.082, -0.31, -1.008], 0.053, 8, false);
  p.box('dark', [0.044, 0.026, 0.003], [0.005, -0.302, -1.0]);
  for (let i = 0; i < 5; i++)
    p.box(
      'ink',
      [0.004, 0.008 + i * 0.002, 0.001],
      [-0.009 + i * 0.006, -0.302, -0.997],
    );

  // One driver vent to the LEFT of the binnacle; centre and passenger vents are
  // farther to the RIGHT. Their unequal placement is a strong LHD depth cue.
  for (const [x, width, y] of [
    [-0.365, 0.107, -0.407],
    [0.477, 0.242, -0.419],
    [1.103, 0.124, -0.399],
  ]) {
    p.box('dark', [width, 0.039, 0.018], [x, y, -1.018]);
    for (let i = 0; i < 4; i++)
      p.box(
        'trim',
        [width - 0.016, 0.0022, 0.009],
        [x, y - 0.012 + i * 0.008, -1.007],
      );
  }
  // Low right-hand centre screen/controls: neutral display, no invented live map.
  p.panel(
    'dark',
    [
      [0.337, -0.383],
      [0.625, -0.383],
      [0.622, -0.229],
      [0.345, -0.229],
    ],
    0.026,
    -0.997,
    0.008,
  );
  p.panel(
    'mirror',
    [
      [0.351, -0.365],
      [0.609, -0.365],
      [0.607, -0.242],
      [0.354, -0.242],
    ],
    0.001,
    -0.986,
    0.002,
  );
  // Small controls under the screen and a tapered tunnel console run toward
  // the passenger side of the camera; there is no matching fake console left.
  p.panel(
    'dark',
    [
      [0.335, -0.608],
      [0.657, -0.608],
      [0.62, -0.449],
      [0.358, -0.449],
    ],
    0.09,
    -0.901,
    0.01,
  );
  for (const x of [0.395, 0.57]) {
    p.ring('silver', 0.018, 0.003, [x, -0.482, -0.882]);
    p.disk('dark', 0.014, [x, -0.482, -0.878]);
  }
  p.box('red', [0.014, 0.01, 0.003], [0.482, -0.484, -0.877]);
  p.beam('trim', [0.647, -0.605, -0.85], [0.674, -0.714, -0.59], 0.01, 6);
  p.beam('dark', [0.486, -0.631, -0.832], [0.483, -0.568, -0.812], 0.013, 6);
  p.box('trim', [0.055, 0.024, 0.028], [0.483, -0.567, -0.812]);
  // Passenger glovebox: the long, quiet surface extends beyond the right edge
  // of a driver-eye FOV, instead of ending symmetrically beside the steering.
  p.box('dark', [0.552, 0.005, 0.002], [0.986, -0.479, -1.023]);
  p.box('trim', [0.061, 0.008, 0.01], [0.92, -0.487, -1.014]);

  // Nearby left door sill/window surround. A-pillar has a flat trim surface,
  // not a roll-cage tube, and its dark rubber edge is slightly farther out.
  p.beam('dash', [-0.531, -0.43, -0.624], [-0.493, 0.515, -0.955], 0.027, 4);
  p.beam('dark', [-0.555, -0.429, -0.628], [-0.517, 0.514, -0.962], 0.008, 4);
  p.tube(
    'dash',
    [
      [-0.553, -0.289, -0.458],
      [-0.543, -0.319, -0.719],
      [-0.512, -0.35, -0.96],
    ],
    0.024,
    20,
  );
  p.tube(
    'trim',
    [
      [-0.532, -0.313, -0.473],
      [-0.522, -0.339, -0.713],
      [-0.493, -0.369, -0.948],
    ],
    0.005,
    20,
  );
  if (!roadster)
    p.beam('dash', [-0.576, 0.386, -0.56], [-0.493, 0.515, -0.955], 0.024, 4);
  // A small neutral LEFT door mirror sits beyond the pillar. No copied or
  // fabricated rear-facing camera image is applied to either mirror.
  p.panel(
    'dark',
    [
      [-0.765, -0.234],
      [-0.595, -0.247],
      [-0.584, -0.154],
      [-0.746, -0.15],
    ],
    0.025,
    -0.789,
    0.008,
  );
  p.panel(
    'mirror',
    [
      [-0.75, -0.226],
      [-0.608, -0.236],
      [-0.6, -0.165],
      [-0.739, -0.16],
    ],
    0.001,
    -0.777,
    0.002,
  );
  p.beam('dark', [-0.589, -0.236, -0.827], [-0.534, -0.295, -0.84], 0.016, 5);

  // Far passenger pillar is genuinely farther right, and the header/mirror
  // follow the vehicle centreline (+0.45m), not the driver's eye centreline.
  p.beam('dash', [1.287, -0.386, -1.049], [1.133, 0.527, -1.145], 0.024, 4);
  p.beam('dark', [1.311, -0.386, -1.055], [1.155, 0.527, -1.15], 0.006, 4);
  p.tube(
    'dash',
    [
      [-0.493, 0.535, -0.955],
      [0.18, 0.553, -1.046],
      [0.62, 0.552, -1.095],
      [1.133, 0.548, -1.145],
    ],
    0.027,
    30,
  );
  p.beam('dark', [0.448, 0.543, -1.076], [0.448, 0.363, -0.996], 0.008, 6);
  p.panel(
    'dark',
    [
      [0.31, 0.304],
      [0.585, 0.307],
      [0.59, 0.374],
      [0.307, 0.373],
    ],
    0.027,
    -0.967,
    0.006,
  );
  p.panel(
    'mirror',
    [
      [0.321, 0.313],
      [0.574, 0.316],
      [0.578, 0.365],
      [0.319, 0.364],
    ],
    0.001,
    -0.957,
    0.002,
  );

  if (roadster) {
    // Open cabin and passenger seat remain visible when looking sideways/back.
    p.box('wood', [0.53, 0.15, 0.64], [0.9, -0.66, 0.15]);
    p.box('wood', [0.53, 0.58, 0.15], [0.9, -0.32, 0.54], [-0.14, 0, 0]);
    p.box('wood', [0.3, 0.2, 0.16], [0.9, 0.04, 0.58]);
    p.beam('silver', [0.69, -0.28, 0.77], [0.69, 0.08, 0.77], 0.025);
    p.beam('silver', [1.11, -0.28, 0.77], [1.11, 0.08, 0.77], 0.025);
    p.beam('silver', [0.69, 0.08, 0.77], [1.11, 0.08, 0.77], 0.025);
    p.box('navy', [0.1, 0.28, 1.8], [1.29, -0.5, 0.2]);
  }
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

export function makeCockpit(
  kind: 'drive' | 'boat',
  variant: 'classic' | 'roadster' = 'classic',
): THREE.Group {
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
    wood: material('wood', variant === 'roadster' ? 0xba794e : 0x8c6240),
    navy: material('navy', variant === 'roadster' ? 0x167b83 : 0x263d47),
  };
  const p = new Parts(group, palette);
  const controls =
    kind === 'drive'
      ? drive(group, p, palette, variant === 'roadster')
      : boat(group, p, palette);
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
    variant,
    ...(kind === 'drive'
      ? {
          layout: 'left-hand-drive',
          recommendedRootPosition: [0, 0, 0],
          recommendedVerticalFov: 58,
          referenceEyeVehicleLocalX: 0.45,
          vehicleForward: '+Z',
          cabinCentreCameraLocalX: 0.45,
        }
      : {}),
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
