import * as THREE from 'three';

/**
 * Original, metre-scale parametric architecture. No downloaded model, texture,
 * DOM, renderer, environment map, or engine dependency. See SOURCES.md.
 * +Y up. Placement is metadata only: the returned Group remains at (0,0,0).
 * detail=false is the medium model; true adds close-view structural detail.
 */
type P = [number, number, number];
type XZ = [number, number];
type Batch = {
  material: THREE.MeshStandardMaterial;
  positions: number[];
  normals: number[];
  uvs: number[];
  castShadow: boolean;
};
const TAU = Math.PI * 2;
const v = (p: P) => new THREE.Vector3(...p);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (n: number) => {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

class Model {
  batches = new Map<string, Batch>();
  nightMaterials: {
    material: THREE.MeshStandardMaterial;
    intensity: number;
  }[] = [];
  constructor(
    public name: string,
    public detail: boolean,
  ) {}
  material(
    key: string,
    color: number,
    roughness = 0.65,
    metalness = 0.05,
    night?: [number, number],
    side: THREE.Side = THREE.FrontSide,
  ) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      side,
    });
    material.name = `${this.name}/${key}`;
    if (night) {
      material.emissive.setHex(night[0]);
      material.emissiveIntensity = 0;
      material.userData.nightIntensity = night[1];
      this.nightMaterials.push({ material, intensity: night[1] });
    }
    this.batches.set(key, {
      material,
      positions: [],
      normals: [],
      uvs: [],
      castShadow: key !== 'led',
    });
  }
  add(
    key: string,
    geometry: THREE.BufferGeometry,
    position: P = [0, 0, 0],
    yaw = 0,
  ) {
    if (yaw) geometry.rotateY(yaw);
    geometry.translate(...position);
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    const batch = this.batches.get(key)!;
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv'),
      index = geometry.index;
    const count = index ? index.count : p.count;
    for (let j = 0; j < count; j++) {
      const i = index ? index.getX(j) : j;
      batch.positions.push(p.getX(i), p.getY(i), p.getZ(i));
      batch.normals.push(n.getX(i), n.getY(i), n.getZ(i));
      // Authored custom surfaces have UVs; the fallback is a metre-scaled chart.
      batch.uvs.push(
        uv ? uv.getX(i) : p.getX(i) / 4,
        uv ? uv.getY(i) : p.getY(i) / 4,
      );
    }
    geometry.dispose();
  }
  box(key: string, size: P, position: P, yaw = 0) {
    this.add(key, new THREE.BoxGeometry(...size), position, yaw);
  }
  cylinder(
    key: string,
    radius: number,
    height: number,
    position: P,
    segments = 32,
    topRadius = radius,
  ) {
    this.add(
      key,
      new THREE.CylinderGeometry(topRadius, radius, height, segments),
      position,
    );
  }
  beam(
    key: string,
    a: P,
    b: P,
    radius: number,
    segments = this.detail ? 6 : 4,
  ) {
    const av = v(a),
      bv = v(b),
      direction = bv.clone().sub(av),
      length = direction.length();
    if (length < 1e-6) return;
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      length,
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
  path(key: string, points: P[], radius: number, segments?: number) {
    for (let i = 1; i < points.length; i++)
      this.beam(key, points[i - 1], points[i], radius, segments);
  }
  triangle(key: string, a: P, b: P, c: P) {
    const av = v(a),
      bv = v(b),
      cv = v(c);
    const ab = bv.clone().sub(av),
      length = ab.length();
    if (length < 1e-8) return;
    const ac = cv.clone().sub(av),
      normal = ab.clone().cross(ac);
    if (normal.lengthSq() < 1e-12) return;
    const axis = ab.clone().normalize(),
      u = ac.dot(axis),
      h = ac.clone().cross(axis).length();
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...a, ...b, ...c], 3),
    );
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, length / 4, 0, u / 4, h / 4], 2),
    );
    g.computeVertexNormals();
    this.add(key, g);
  }
  slab(key: string, points: XZ[], bottom: number, height: number) {
    const shape = new THREE.Shape(
      points.map(([x, z]) => new THREE.Vector2(x, -z)),
    );
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      steps: 1,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    this.add(key, g, [0, bottom, 0]);
  }
  arc(
    key: string,
    radius: number,
    y: number,
    a0 = 0,
    a1 = TAU,
    tube = 0.05,
    cx = 0,
    cz = 0,
    steps = this.detail ? 96 : 48,
  ) {
    this.path(
      key,
      Array.from({ length: steps + 1 }, (_, i): P => {
        const a = mix(a0, a1, i / steps);
        return [cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius];
      }),
      tube,
    );
  }
  wall(
    key: string,
    radius: number,
    bottom: number,
    height: number,
    a0: number,
    a1: number,
    cx = 0,
    cz = 0,
    steps = this.detail ? 12 : 6,
  ) {
    // Outward-facing curved wall, cylindrical UVs in metres / 4.
    for (let i = 0; i < steps; i++) {
      const a = mix(a0, a1, i / steps),
        b = mix(a0, a1, (i + 1) / steps);
      const p: P = [
        cx + Math.cos(a) * radius,
        bottom,
        cz + Math.sin(a) * radius,
      ];
      const q: P = [
        cx + Math.cos(b) * radius,
        bottom,
        cz + Math.sin(b) * radius,
      ];
      const r: P = [q[0], bottom + height, q[2]],
        s: P = [p[0], bottom + height, p[2]];
      this.triangle(key, p, s, r);
      this.triangle(key, p, r, q);
    }
  }
  finish(placement: object, extra: object = {}) {
    const group = new THREE.Group();
    group.name = `${this.name}/${this.detail ? 'detail' : 'medium'}`;
    let triangles = 0;
    for (const [key, batch] of this.batches) {
      if (!batch.positions.length) {
        batch.material.dispose();
        continue;
      }
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
      const mesh = new THREE.Mesh(geometry, batch.material);
      mesh.name = `${this.name}/${key}`;
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = key !== 'led';
      group.add(mesh);
      triangles += batch.positions.length / 9;
    }
    const box = new THREE.Box3().setFromObject(group);
    group.userData = {
      units: 'metres',
      axes: '+Y up; placement yaw rotates local +Z',
      placement,
      detail: this.detail,
      triangleCount: triangles,
      meshCount: group.children.length,
      bounds: { min: box.min.toArray(), max: box.max.toArray() },
      nightMaterials: this.nightMaterials.filter(({ material }) =>
        group.children.some((o) => (o as THREE.Mesh).material === material),
      ),
      originalProceduralGeometry: true,
      ...extra,
    };
    return group;
  }
}

function roundRect(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  radius: number,
  steps = 5,
): XZ[] {
  const points: XZ[] = [];
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2;
    const x =
      cx + Math.cos(angle + Math.PI / 4) * Math.SQRT2 * (width / 2 - radius);
    const z =
      cz + Math.sin(angle + Math.PI / 4) * Math.SQRT2 * (depth / 2 - radius);
    for (let i = 0; i <= steps; i++) {
      const a = angle + ((i / steps) * Math.PI) / 2;
      points.push([x + Math.cos(a) * radius, z + Math.sin(a) * radius]);
    }
  }
  return points;
}

function clipAbove(poly: P[], y: number): P[] {
  const result: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ai = a[1] >= y,
      bi = b[1] >= y;
    if (ai) result.push(a);
    if (ai !== bi) {
      const t = (y - a[1]) / (b[1] - a[1]);
      result.push([mix(a[0], b[0], t), y, mix(a[2], b[2], t)]);
    }
  }
  return result;
}

function scienceDome(m: Model) {
  // Frequency-7 geodesic skeleton, shared by both LODs: detail changes fittings,
  // not the panel pattern. Outer cage diameter is exactly 40 m.
  const center: P = [0, 28.2, 0],
    cut = 13.5;
  const source = new THREE.IcosahedronGeometry(20, 6);
  const p = source.getAttribute('position'),
    edges = new Map<string, [P, P]>(),
    nodes = new Map<string, P>();
  const gaskets = new Map<string, [P, P]>();
  let visiblePanels = 0;
  const key = (a: P) => a.map((x) => x.toFixed(4)).join(',');
  const materialNames = ['silver', 'silver-cool', 'silver-dark', 'silver-warm'];
  const skinRadius = 19.55;
  for (let i = 0; i < p.count; i += 3) {
    const outer = Array.from(
      { length: 3 },
      (_, j): P => [p.getX(i + j), p.getY(i + j) + center[1], p.getZ(i + j)],
    );
    const poly = clipAbove(outer, cut);
    if (poly.length < 3) continue;
    visiblePanels++;
    const inner = poly.map(
      (a): P => [
        (a[0] * skinRadius) / 20,
        ((a[1] - center[1]) * skinRadius) / 20 + center[1],
        (a[2] * skinRadius) / 20,
      ],
    );
    const color =
      materialNames[Math.floor(hash(i + 19) * materialNames.length)];
    for (let j = 1; j + 1 < inner.length; j++)
      m.triangle(color, inner[0], inner[j], inner[j + 1]);
    if (m.detail) {
      const c = inner
        .reduce((sum, a) => sum.add(v(a)), new THREE.Vector3())
        .divideScalar(inner.length);
      const inset = inner.map((a) => v(a).lerp(c, 0.017).toArray() as P);
      for (let j = 0; j < inner.length; j++) {
        const a = inner[j],
          b = inner[(j + 1) % inner.length];
        const ka = key(a),
          kb = key(b);
        gaskets.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b]);
        // A tiny rolled edge catches sunlight around the otherwise flat panels.
        m.beam('panel-trim', inset[j], inset[(j + 1) % inset.length], 0.018, 4);
      }
    }
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j],
        b = poly[(j + 1) % poly.length],
        ka = key(a),
        kb = key(b);
      edges.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b]);
      nodes.set(ka, a);
    }
  }
  source.dispose();
  for (const [a, b] of gaskets.values()) m.beam('gasket', a, b, 0.028, 4);
  for (const [a, b] of edges.values())
    m.beam('frame', a, b, m.detail ? 0.07 : 0.082);
  const vertices = [...nodes.values()];
  if (m.detail)
    for (const a of vertices) {
      m.add('frame', new THREE.OctahedronGeometry(0.14, 0), a);
      const inner: P = [
        a[0] * 0.9775,
        (a[1] - center[1]) * 0.9775 + center[1],
        a[2] * 0.9775,
      ];
      m.beam('panel-trim', a, inner, 0.035, 4);
    }
  // The real 2023 system has 651 LEDs. Positions here are a deterministic visual
  // reconstruction, not a surveyed lighting layout. Medium uses every other LED.
  const candidates = [
    ...vertices,
    ...[...edges.values()].map(([a, b]) => v(a).lerp(v(b), 0.5).toArray() as P),
  ];
  const ordered = candidates.sort(
    (a, b) =>
      hash(a[0] * 3 + a[1] * 7 + a[2]) - hash(b[0] * 3 + b[1] * 7 + b[2]),
  );
  const lamps = ordered.slice(0, 651).filter((_, i) => m.detail || i % 2 === 0);
  for (const point of lamps) {
    const outward = v(point).sub(v(center)).normalize().multiplyScalar(0.14);
    m.add(
      'led',
      new THREE.OctahedronGeometry(m.detail ? 0.16 : 0.19, 0),
      v(point).add(outward).toArray() as P,
    );
  }
  return {
    geodesicSourceFaces: p.count / 3,
    visiblePanelCount: visiblePanels,
    panelLayoutIsApproximate: true,
    domeLedCount: lamps.length,
    nightPoints: lamps.map((point) =>
      v(point)
        .add(v(point).sub(v(center)).normalize().multiplyScalar(0.2))
        .toArray(),
    ),
  };
}

function scienceStair(m: Model, angle: number) {
  const transform = (x: number, y: number, z: number): P => [
    Math.cos(angle) * x - Math.sin(angle) * z,
    y,
    Math.sin(angle) * x + Math.cos(angle) * z,
  ];
  for (let floor = 0; floor < 3; floor++) {
    const direction = floor % 2 ? -1 : 1,
      base = 1.7 + floor * 3.35;
    for (let step = 0; step < (m.detail ? 18 : 9); step++) {
      const count = m.detail ? 18 : 9,
        t = step / count;
      m.box(
        'frame',
        [1.15, 0.12, 4.4 / count + 0.04],
        transform(34, base + t * 3.35, direction * mix(-2.2, 2.2, t)),
        -angle,
      );
    }
    m.box(
      'frame',
      [2.0, 0.14, 1.4],
      transform(33.7, base + 3.35, direction * 2.55),
      -angle,
    );
    for (const r of [33.35, 34.65]) {
      m.beam(
        'frame',
        transform(r, base + 0.85, -direction * 2.2),
        transform(r, base + 4.2, direction * 2.2),
        0.04,
      );
      for (let j = 0; j <= 4; j++) {
        const t = j / 4,
          z = direction * mix(-2.2, 2.2, t),
          y = base + t * 3.35;
        m.beam('frame', transform(r, y, z), transform(r, y + 0.9, z), 0.027, 4);
      }
    }
  }
}

/** Main pavilion deck datum: place at (-123.1039114,49.2733499), Y=3.4, yaw=0. */
export function createScienceWorld(detail: boolean): THREE.Group {
  const m = new Model('Science World', detail);
  m.material('concrete', 0xb4b2a5, 0.93);
  m.material('red', 0xb52d2b, 0.57);
  m.material('cladding', 0xb9bdbd, 0.48, 0.28);
  m.material('frame', 0xe2e3dc, 0.4, 0.42);
  m.material('panel-trim', 0xa7b3b8, 0.3, 0.72);
  m.material('gasket', 0x2e3a41, 0.68, 0.1);
  m.material('glass', 0x3c646c, 0.23, 0.34, [0x86bdc0, 0.22]);
  m.material('roof', 0x737e7d, 0.91);
  m.material('yellow', 0xd4d38b, 0.63);
  m.material('blue', 0x458aac, 0.48);
  m.material('silver', 0xc5cdd0, 0.22, 0.72);
  m.material('silver-cool', 0x99b0bb, 0.24, 0.74);
  m.material('silver-dark', 0x788f9b, 0.2, 0.75);
  m.material('silver-warm', 0xbfc0b5, 0.27, 0.68);
  m.material('led', 0xdaecf4, 0.3, 0, [0xa7dcff, 4.5]);
  const n = detail ? 96 : 48;
  m.cylinder('concrete', 37.4, 1.5, [0, 0.1, 0], n);
  m.cylinder('red', 31.8, 11.6, [0, 6.7, 0], n);
  m.cylinder('roof', 32.1, 0.45, [0, 12.65, 0], n);
  m.cylinder('red', 15.8, 4.6, [0, 14.7, 0], n);
  m.cylinder('frame', 16.05, 0.18, [0, 17.05, 0], n);
  m.wall('glass', 31.95, 1.45, 3.2, 0, TAU, 0, 0, n);
  m.arc('frame', 32.08, 4.68, 0, TAU, 0.08);
  m.arc('frame', 32.1, 1.5, 0, TAU, 0.09);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU,
      x = Math.cos(a),
      z = Math.sin(a);
    m.beam('frame', [x * 32, 1.4, z * 32], [x * 32, 4.8, z * 32], 0.055, 4);
    if (i % 8 < 6) {
      m.wall(
        'cladding',
        32.04,
        5.0,
        6.8,
        a + 0.012,
        a + TAU / 48 - 0.012,
        0,
        0,
        detail ? 3 : 1,
      );
      if (detail) {
        m.wall('gasket', 32.08, 8.3, 0.036, a, a + TAU / 48, 0, 0, 3);
        if (i % 6 === 0)
          m.wall('yellow', 32.11, 6.1, 2.2, a + 0.014, a + 0.075, 0, 0, 2);
        if (i % 7 === 0)
          m.wall('blue', 32.11, 5.2, 0.6, a + 0.018, a + 0.11, 0, 0, 2);
      }
    } else {
      m.beam(
        'frame',
        [Math.cos(a) * 32.2, 5.0, Math.sin(a) * 32.2],
        [Math.cos(a + TAU / 48) * 32.2, 11.6, Math.sin(a + TAU / 48) * 32.2],
        0.08,
      );
    }
    if (i % 3 === 0)
      m.cylinder('gasket', 0.34, 4.8, [x * 34, -2.9, z * 34], detail ? 8 : 6);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8,
      b = a + TAU / 8;
    const p: P = [Math.cos(a) * 30.5, 22.1, Math.sin(a) * 30.5];
    m.beam('frame', [p[0], 11.8, p[2]], p, 0.16);
    m.beam(
      'frame',
      p,
      [Math.cos(a + 0.16) * 17, 16.7, Math.sin(a + 0.16) * 17],
      0.18,
    );
    m.beam('frame', p, [Math.cos(b) * 30.5, 13, Math.sin(b) * 30.5], 0.14);
    m.beam(
      'frame',
      [Math.cos(a) * 30.5, 13, Math.sin(a) * 30.5],
      [Math.cos(b) * 30.5, 22.1, Math.sin(b) * 30.5],
      0.12,
    );
    if (detail && i > 1 && i < 7) scienceStair(m, a);
  }
  // Public promenade: three light rails, thin stanchions and marine piles.
  for (const y of [1.05, 1.55, 2.05])
    m.arc(
      'frame',
      36.65,
      y,
      Math.PI / 2,
      Math.PI * 1.83,
      detail ? 0.035 : 0.05,
    );
  for (let i = 0; i < (detail ? 84 : 42); i++) {
    const a = Math.PI / 2 + (i / (detail ? 83 : 41)) * Math.PI * 1.33;
    m.beam(
      'frame',
      [Math.cos(a) * 36.65, 0.75, Math.sin(a) * 36.65],
      [Math.cos(a) * 36.65, 2.08, Math.sin(a) * 36.65],
      0.042,
      4,
    );
  }
  // East-side crescent addition, derived from the mapped outline, not a second
  // circular drum. Its roof steps back toward the main sphere.
  const annex: XZ[] = [
    [25, -29],
    [36, -48],
    [46, -44],
    [56, -29],
    [63, -11],
    [65, 8],
    [60, 23],
    [31, 14],
  ];
  m.slab(
    'concrete',
    [
      [23, -32],
      [36, -51],
      [49, -47],
      [59, -31],
      [68, -12],
      [69, 10],
      [63, 26],
      [29, 17],
    ],
    -0.2,
    1.2,
  );
  m.slab('red', annex, 1.0, 10.3);
  m.slab('cladding', annex, 11.3, 0.35);
  for (let i = 0; i < annex.length; i++) {
    const a = annex[i],
      b = annex[(i + 1) % annex.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    m.box(
      'glass',
      [0.16, 3.3, length],
      [(a[0] + b[0]) / 2, 3.2, (a[1] + b[1]) / 2],
      yaw,
    );
    for (let j = 0; j <= Math.ceil(length / (detail ? 2.5 : 5)); j++) {
      const t = j / Math.ceil(length / (detail ? 2.5 : 5));
      m.beam(
        'frame',
        [mix(a[0], b[0], t), 1.5, mix(a[1], b[1], t)],
        [mix(a[0], b[0], t), 4.8, mix(a[1], b[1], t)],
        0.045,
        4,
      );
    }
  }
  m.box('glass', [10, 10.8, 11], [39, 6.45, -43], -0.35);
  m.box('frame', [12.8, 0.28, 15], [40, 2.9, -52], -0.35);
  for (let j = 0; j < (detail ? 7 : 4); j++) {
    const z = -31 + j * (detail ? 6.3 : 12.6);
    m.box('frame', [23, 0.22, 0.32], [47, 11.85, z], -0.08);
  }
  if (detail)
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.7 + i * 0.29;
      for (let row = 0; row < 8; row++) {
        const x = Math.cos(a) * 32.2,
          z = Math.sin(a) * 32.2;
        m.box('glass', [0.32, 0.5, 2.4], [x, 5.4 + row * 0.72, z], -a);
      }
    }
  const dome = scienceDome(m);
  return m.finish(
    { lon: -123.1039114, lat: 49.2733499, yaw: 0, baseY: 3.4 },
    {
      domeDiameterM: 40,
      ...dome,
      solidFootprints: [
        Array.from(
          { length: 49 },
          (_, i): XZ => [
            Math.cos((i / 48) * TAU) * 37.4,
            Math.sin((i / 48) * TAU) * 37.4,
          ],
        ),
        [...annex, annex[0]],
      ],
      sourceGeometry: 'OSM 37084312; independent architectural reconstruction',
    },
  );
}

function sailPoint(bay: number, u: number, t: number): P {
  // Geographic roof bands are diagonal in plan: the west and east mast rows
  // are staggered by roughly 49 m, rather than five perpendicular tents.
  const x = mix(-25.6, 27.4, u);
  const leftStart = -31.8 + bay * 24.55,
    rightStart = -80.4 + bay * 24.55;
  const start = mix(leftStart, rightStart, u);
  const end = bay === 4 ? mix(71.3, 72.7, u) : start + 24.55;
  const cross = Math.pow(Math.abs(u * 2 - 1), 1.65);
  const crest = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.76);
  // Opposing curvatures: concave transverse catenary and convex longitudinal
  // crest. Adjacent bays share the low boundary, so no intersecting sheets.
  const y =
    26.0 + crest * (5.0 + 13.4 * cross) + (1 - crest) * (1 - cross) * 3.0;
  return [x, y, mix(start, end, t)];
}

function sailGeometry(bay: number, nx: number, nz: number) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      positions.push(...sailPoint(bay, i / nx, j / nz));
      uvs.push(i / nx, j / nz);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i,
        b = a + 1,
        d = a + nx + 1,
        c = d + 1;
      indices.push(a, d, b, b, d, c); // +Y face winding
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Pier deck datum: place at (-123.111352,49.2886214), Y=3.5, yaw=-1.073. */
export function createCanadaPlace(detail: boolean): THREE.Group {
  const m = new Model('Canada Place', detail);
  m.material('concrete', 0xb8b7aa, 0.91);
  m.material('white', 0xe5e6dc, 0.61, 0.1);
  m.material('frame', 0xe0e3df, 0.37, 0.45);
  m.material('cable', 0x6e7c82, 0.34, 0.65);
  m.material('glass', 0x527b86, 0.22, 0.43, [0x9bbcc0, 0.25]);
  m.material('glass-dark', 0x354e59, 0.25, 0.34, [0x879da7, 0.12]);
  m.material('fabric', 0xf0f0e8, 0.76, 0.01, [0xa7c3dc, 0.3], THREE.DoubleSide);
  m.material('roof', 0x919c99, 0.88);
  m.material('wood', 0x947e61, 0.92);
  m.material('green', 0x5d7050, 0.95);
  m.material('led', 0xf3e9cb, 0.45, 0, [0xffdf9e, 2.2]);
  const deck: XZ[] = [
    [-46, -96],
    [-46, 230],
    [-12, 212],
    [41, 173],
    [61, 157],
    [39, 124],
    [39, -273],
    [34, -282],
    [24, -282],
    [18, -275],
  ];
  m.slab('concrete', deck, -2.5, 3.8);
  // The northern pier is a tapering ship's bow; keep the later extension free
  // of enormous roof blocks. It carries a smaller terminal pavilion.
  m.slab(
    'white',
    [
      [-16, -130],
      [7, -196],
      [17, -212],
      [24, -211],
      [28, -206],
      [28, -115],
    ],
    1.3,
    12.0,
  );
  m.slab(
    'roof',
    [
      [-16, -130],
      [7, -196],
      [17, -212],
      [24, -211],
      [28, -206],
      [28, -115],
    ],
    13.3,
    0.45,
  );
  m.box('white', [65, 24.4, 181], [0.5, 13.5, -0.5]);
  for (const side of [-1, 1]) {
    const x = side < 0 ? -33.2 : 34.2;
    // Dark recessed window fields sit behind articulated concrete floors.
    for (const y of [5.1, 11.3, 20.5])
      m.box('glass', [0.24, y === 20.5 ? 6.3 : 3.9, 180], [x, y, -0.5]);
    for (const y of [2.7, 8.0, 14.8, 17.0, 24.0])
      m.box('white', [2.3, 0.55, 184], [x, y, -0.5]);
    m.box('white', [9.8, 0.8, 190], [side * 37.9 + 0.5, 17.1, -0.5]);
    for (let z = -88; z <= 89; z += detail ? 3 : 6) {
      m.box(
        'frame',
        [0.26, 22, detail ? 0.14 : 0.2],
        [x + side * 0.12, 13.1, z],
      );
      if (detail)
        for (const y of [4.4, 5.8, 10.7, 12.1, 19.2, 21.2])
          m.box('frame', [0.31, 0.08, 3], [x + side * 0.14, y, z + 1.5]);
    }
    for (let z = -88; z <= 90; z += 12) {
      m.box('white', [0.75, 17.4, 0.9], [side * 40.5 + 0.5, 8.1, z]);
      if (detail) {
        m.box('concrete', [3.4, 0.65, 3.2], [side * 38.5 + 0.5, 18.0, z]);
        m.box('green', [2.8, 0.65, 2.6], [side * 38.5 + 0.5, 18.65, z]);
      }
    }
    for (const y of [18.05, 18.55])
      m.beam(
        'frame',
        [side * 42.3 + 0.5, y, -94],
        [side * 42.3 + 0.5, y, 94],
        0.045,
      );
    for (let z = -93; z < 94; z += detail ? 2.4 : 4.8)
      m.beam(
        'frame',
        [side * 42.3 + 0.5, 17.45, z],
        [side * 42.3 + 0.5, 18.55, z],
        0.038,
        4,
      );
  }
  // The roof is five adjoining anticlastic patches, using the measured plan
  // staggering. The last bay closes against the hotel, as in the mapped plan.
  const tips: P[][] = [[], []];
  for (let bay = 0; bay < 5; bay++) {
    m.add('fabric', sailGeometry(bay, detail ? 32 : 16, detail ? 24 : 12));
    for (const u of [0, 1]) {
      const crest = sailPoint(bay, u, 0.5),
        sign = u ? 1 : -1;
      const tip: P = [crest[0] + sign * 0.9, 44.5, crest[2]];
      const foot: P = [crest[0] + sign * 9.2, 17.5, crest[2] + 2.8];
      tips[u].push(tip);
      m.beam('frame', foot, tip, 0.29, detail ? 10 : 6);
      m.beam('frame', tip, crest, 0.11);
      for (const dz of [-8.4, 8.4]) {
        const anchor: P = [crest[0] + sign * 12.3, 17.65, crest[2] + dz];
        m.beam('cable', tip, anchor, 0.046, 4);
        if (detail) {
          m.box('cable', [0.55, 0.18, 0.72], anchor);
          m.beam(
            'frame',
            anchor,
            v(anchor).lerp(v(tip), 0.06).toArray() as P,
            0.09,
            6,
          );
        }
      }
      m.path(
        'cable',
        Array.from({ length: detail ? 25 : 13 }, (_, i) =>
          sailPoint(bay, u, i / (detail ? 24 : 12)),
        ),
        0.062,
        4,
      );
      if (detail) m.add('frame', new THREE.OctahedronGeometry(0.24, 0), tip);
    }
    for (const t of [0, 0.5, 1])
      m.path(
        'frame',
        Array.from({ length: detail ? 33 : 17 }, (_, i) => {
          const p = sailPoint(bay, i / (detail ? 32 : 16), t);
          p[1] += 0.035;
          return p;
        }),
        t === 0.5 ? 0.045 : 0.025,
        4,
      );
    if (detail)
      for (let seam = 1; seam < 7; seam++) {
        m.path(
          'white',
          Array.from({ length: 25 }, (_, i) => {
            const p = sailPoint(bay, seam / 7, i / 24);
            p[1] += 0.025;
            return p;
          }),
          0.012,
          4,
        );
      }
  }
  for (const row of tips) {
    m.path('cable', row, 0.065, 4);
    for (const tip of row)
      m.beam('cable', tip, [tip[0], 25.8, tip[2] - 5.4], 0.04, 4);
  }
  // Recessed end atrium and public entry stairs, beneath the saddle roof.
  m.box('glass-dark', [54, 17, 0.3], [0.7, 14, -91.1]);
  for (let x = -25; x <= 27; x += detail ? 2.8 : 5.6)
    m.box('frame', [0.14, 16.8, 0.4], [x, 14, -91.4]);
  for (let step = 0; step < (detail ? 28 : 14); step++) {
    const t = step / (detail ? 28 : 14);
    m.box(
      'white',
      [10, 0.15, detail ? 0.34 : 0.68],
      [-30, 1.3 + t * 5.1, 106 + t * 9.5],
    );
  }
  // Pan Pacific podium and a stepped, rounded glass hotel. The roof cupola
  // aligns with mapped part 1216968929 (approximately x10.7,z159.9).
  m.slab(
    'white',
    [
      [-44, 91],
      [38, 91],
      [38, 172],
      [-12, 209],
      [-44, 224],
    ],
    1.3,
    16.5,
  );
  m.slab(
    'glass-dark',
    [
      [-42, 96],
      [35, 96],
      [35, 172],
      [-13, 206],
      [-42, 220],
    ],
    17.8,
    4.5,
  );
  const floorHeight = 2.9;
  for (let floor = 0; floor < 20; floor++) {
    const taper = Math.max(0, floor - 13),
      y = 21.8 + floor * floorHeight;
    const width = 61 - taper * 2.6,
      depth = 64 - taper * 2.7;
    const plan = roundRect(
      -2 - taper * 0.7,
      143 + taper * 0.75,
      width,
      depth,
      10,
      detail ? 7 : 4,
    );
    m.slab(
      floor % 4 === 1 ? 'glass-dark' : 'glass',
      plan,
      y,
      floorHeight - 0.22,
    );
    m.slab(
      'frame',
      roundRect(
        -2 - taper * 0.7,
        143 + taper * 0.75,
        width + 0.3,
        depth + 0.3,
        10.15,
        detail ? 7 : 4,
      ),
      y + floorHeight - 0.22,
      0.22,
    );
    if (detail && floor < 17)
      for (let x = -27; x < 27; x += 4.3) {
        if (Math.abs(x + 2) > width / 2 - 10) continue;
        m.box(
          'frame',
          [0.1, floorHeight, 0.22],
          [
            x - taper * 0.7,
            y + floorHeight / 2,
            143 + taper * 0.75 - depth / 2 - 0.1,
          ],
        );
        m.box(
          'frame',
          [0.1, floorHeight, 0.22],
          [
            x - taper * 0.7,
            y + floorHeight / 2,
            143 + taper * 0.75 + depth / 2 + 0.1,
          ],
        );
      }
  }
  const dome = new THREE.SphereGeometry(
    9.4,
    detail ? 32 : 20,
    detail ? 12 : 8,
    0,
    TAU,
    0,
    Math.PI / 2,
  );
  dome.scale(1, 0.43, 1);
  m.add('glass', dome, [10.7, 77.4, 159.9]);
  m.cylinder('frame', 9.7, 0.38, [10.7, 77.25, 159.9], detail ? 48 : 24);
  for (const z of [104, 117, 130]) {
    m.box('white', [75, 0.7, 12], [-3, 19.2, z]);
    if (detail)
      for (const x of [-33, -17, 1, 20])
        m.box('green', [5, 0.5, 5], [x, 19.9, z]);
  }
  // Waterfront railings, pilings, fenders and small luminaires.
  for (let j = 0; j < deck.length; j++) {
    const a = deck[j],
      b = deck[(j + 1) % deck.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      count = Math.ceil(length / (detail ? 3 : 6));
    for (const y of [1.8, 2.4])
      m.beam('frame', [a[0], y, a[1]], [b[0], y, b[1]], 0.055, 4);
    for (let i = 0; i < count; i++) {
      const t = i / count,
        x = mix(a[0], b[0], t),
        z = mix(a[1], b[1], t);
      m.beam('frame', [x, 1.2, z], [x, 2.45, z], 0.043, 4);
      if (i % 4 === 0) {
        m.cylinder('wood', 0.42, 4.8, [x, -2.7, z], detail ? 8 : 6);
        if (detail) {
          m.beam('frame', [x, 1.3, z], [x, 4.0, z], 0.055, 4);
          m.add('led', new THREE.OctahedronGeometry(0.15, 0), [x, 4.05, z]);
        }
      }
    }
  }
  return m.finish(
    { lon: -123.111352, lat: 49.2886214, yaw: -1.073, baseY: 3.5 },
    {
      sailCount: 5,
      sailPlanWidthM: 53,
      sailPlanStaggerM: 48.6,
      sailMastTopLocalM: 44.5,
      solidFootprints: [[...deck, deck[0]]],
      sourceGeometry:
        'OSM 223635729, 1216968939–1216968944; original anticlastic membrane surfaces',
    },
  );
}
