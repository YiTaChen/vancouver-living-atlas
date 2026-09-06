import * as THREE from 'three';
import {
  planConventionEntries,
  conventionGlassPieces,
  conventionMullionPieces,
  drawConventionInterfaces,
  type ConventionSurfaceOptions,
  type ConventionEntry,
  type ConventionEdge,
} from './convention-entry';

/**
 * Original, metre-scale Vancouver Convention Centre West reconstruction. No downloaded model, texture,
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

type Roof = {
  name: string;
  polygon: XZ[];
  y: (x: number, z: number) => number;
  planted: boolean;
};
// COV 2009 north roof extrema and OSM building:part fold boundaries, projected
// into the shared placement frame. Metre values are rounded, not BIM precision.
const OUTLINE: XZ[] = [
  [65.5, 70.29],
  [69.75, 36.51],
  [86.4, -19.4],
  [93.4, -40.8],
  [102.5, -94.5],
  [74.4, -87.6],
  [35.8, -82.9],
  [34.51, -67.3],
  [11.95, -67.09],
  [13.5, -80.2],
  [-54.1, -72],
  [-104.78, 47.5],
  [-61.06, 64.02],
  [-44.21, 70.38],
];
/** Exact existing lower podium top, for main-thread ground planning only.
 * Same ExtrudeGeometry/rotate/translate sequence as Model.slab; excludes every
 * upper floor, support and habitat shelf. No complete landmark build needed. */
export function conventionPodiumTopTriangles(): number[] {
  const podium = OUTLINE.map(([x, z]): XZ => [x * 1.044, z * 1.044]);
  const shape = new THREE.Shape(
    podium.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.35,
    steps: 1,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.55, 0);
  const p = geometry.getAttribute('position'),
    out: number[] = [];
  for (let i = 0; i + 2 < p.count; i += 3)
    if ([0, 1, 2].every((j) => Math.abs(p.getY(i + j) - 0.8) < 1e-5))
      for (let j = i; j < i + 3; j++) out.push(p.getX(j), p.getY(j), p.getZ(j));
  geometry.dispose();
  return out;
}
const ROOFS: Roof[] = [
  {
    name: 'east-fold',
    planted: true,
    polygon: [
      [69.75, 36.51],
      [36.66, 31.59],
      [34.51, -67.3],
      [35.8, -82.9],
      [74.4, -87.6],
      [102.5, -94.5],
      [93.4, -40.8],
      [86.4, -19.4],
    ],
    y: (x, z) => 19.35 + 0.09 * (0.29 * x - 0.956 * z),
  },
  {
    name: 'middle-fold',
    planted: true,
    polygon: [
      [14.62, 30.05],
      [-60.22, 37.21],
      [-54.1, -72],
      [13.5, -80.2],
      [11.95, -67.09],
    ],
    y: (x, z) => 24.9 - 0.072 * (0.29 * x - 0.956 * z),
  },
  {
    name: 'south-fold',
    planted: true,
    polygon: [
      [69.75, 36.51],
      [65.5, 70.29],
      [22.22, 70.32],
      [16.91, 70.32],
      [-44.21, 70.38],
      [-61.06, 64.02],
      [-60.22, 37.21],
      [14.62, 30.05],
      [36.66, 31.59],
    ],
    y: (x, z) => 21.7 + 0.108 * (0.29 * x - 0.956 * z),
  },
  {
    name: 'west-fold',
    planted: true,
    polygon: [
      [-54.1, -72],
      [-104.78, 47.5],
      [-61.06, 64.02],
      [-60.22, 37.21],
    ],
    y: (x, z) => 20.65 + 0.205 * (x + 54.1) - 0.014 * (z + 72),
  },
  {
    name: 'central-service-court',
    planted: false,
    polygon: [
      [14.62, 30.05],
      [36.66, 31.59],
      [34.51, -67.3],
      [11.95, -67.09],
    ],
    y: () => 18.25,
  },
];

function quad(m: Model, key: string, a: P, b: P, c: P, d: P) {
  m.triangle(key, a, b, c);
  m.triangle(key, a, c, d);
}

function plane(
  m: Model,
  key: string,
  polygon: XZ[],
  y: (x: number, z: number) => number,
  down = false,
) {
  const points = polygon.map(([x, z]) => new THREE.Vector2(x, z));
  for (const indices of THREE.ShapeUtils.triangulateShape(points, [])) {
    const ps = indices.map(
      (i): P => [polygon[i][0], y(...polygon[i]), polygon[i][1]],
    );
    const normalY = v(ps[1])
      .sub(v(ps[0]))
      .cross(v(ps[2]).sub(v(ps[0]))).y;
    if (normalY < 0 !== down) [ps[1], ps[2]] = [ps[2], ps[1]];
    m.triangle(key, ps[0], ps[1], ps[2]);
  }
}

function inside(p: XZ, ring: XZ[]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

function clipAxis(
  poly: XZ[],
  axis: 0 | 1,
  value: number,
  positive: boolean,
): XZ[] {
  const output: XZ[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const ai = positive ? a[axis] >= value : a[axis] <= value;
    const bi = positive ? b[axis] >= value : b[axis] <= value;
    if (ai) output.push(a);
    if (ai !== bi) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      output.push([mix(a[0], b[0], t), mix(a[1], b[1], t)]);
    }
  }
  return output;
}

function meadow(m: Model, roof: Roof, index: number) {
  const poly = roof.polygon,
    step = m.detail ? 4 : 7;
  const minX = Math.floor(Math.min(...poly.map((p) => p[0])) / step) * step;
  const maxX = Math.max(...poly.map((p) => p[0]));
  const minZ = Math.floor(Math.min(...poly.map((p) => p[1])) / step) * step;
  const maxZ = Math.max(...poly.map((p) => p[1]));
  const colors = ['meadow', 'meadow-shadow', 'meadow-straw'];
  let tufts = 0;
  for (let x = minX; x < maxX; x += step)
    for (let z = minZ; z < maxZ; z += step) {
      let clipped = clipAxis(poly, 0, x, true);
      clipped = clipAxis(clipped, 0, x + step, false);
      clipped = clipAxis(clipped, 1, z, true);
      clipped = clipAxis(clipped, 1, z + step, false);
      if (clipped.length < 3) continue;
      const n = index * 20000 + x * 11.7 + z * 52.8;
      const key = colors[hash(n) < 0.22 ? 2 : hash(n + 2) < 0.24 ? 1 : 0];
      plane(m, key, clipped, roof.y);
      const clumps = m.detail ? 2 : 1;
      for (let k = 0; k < clumps; k++) {
        const px = x + 0.7 + hash(n + k * 24 + 11) * (step - 1.4);
        const pz = z + 0.7 + hash(n + k * 24 + 12) * (step - 1.4);
        if (!inside([px, pz], poly)) continue;
        if (
          (index === 0 &&
            Math.abs(px - 58) < 1.75 &&
            Math.abs(pz + 51) < 11.35) ||
          (index === 3 && Math.abs(px + 82) < 1.75 && Math.abs(pz - 38) < 8.35)
        )
          continue;
        // Small closed triangular blades, no alpha cards or invisible depth quads.
        const yy = roof.y(px, pz),
          height = 0.28 + hash(n + k * 37) * 0.42;
        const angle = hash(n + k * 31 + 23) * TAU;
        for (let blade = 0; blade < 3; blade++) {
          const a = angle + (blade * TAU) / 3,
            dx = Math.cos(a) * 0.25,
            dz = Math.sin(a) * 0.25;
          const p: P = [px + dx, roof.y(px + dx, pz + dz), pz + dz];
          const q: P = [
            px - dz * 0.24,
            roof.y(px - dz * 0.24, pz + dx * 0.24),
            pz + dx * 0.24,
          ];
          const r: P = [px + dx * 0.32, yy + height, pz + dz * 0.32];
          m.triangle(key, p, q, r);
          m.triangle(key, q, p, r);
        }
        tufts++;
      }
    }
  // Thin aggregate fire/drainage strips visible in the architect's aerial photo.
  for (let z = Math.ceil(minZ / 17) * 17; z < maxZ; z += 17) {
    const cuts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z))
        cuts.push(mix(a[0], b[0], (z - a[1]) / (b[1] - a[1])));
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const a = cuts[i] + 0.6,
        b = cuts[i + 1] - 0.6;
      if (b > a)
        m.beam(
          'gravel',
          [a, roof.y(a, z) + 0.035, z],
          [b, roof.y(b, z) + 0.035, z],
          0.08,
          4,
        );
    }
  }
  return tufts;
}

/** The same lightweight external interfaces used by facade(), without geometry. */
export function conventionEntryEdges(): ConventionEdge[] {
  const result: ConventionEdge[] = [];
  for (const [roofIndex, roof] of ROOFS.entries()) {
    const poly = roof.polygon;
    const area = poly.reduce((s, a, i) => {
      const b = poly[(i + 1) % poly.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0);
    for (let edgeIndex = 0; edgeIndex < poly.length; edgeIndex++) {
      const a = poly[edgeIndex],
        b = poly[(edgeIndex + 1) % poly.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.02) continue;
      const same = (p: XZ, q: XZ) =>
        Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.025;
      if (
        ROOFS.some(
          (other) =>
            other !== roof &&
            other.polygon.some((p, i) => {
              const q = other.polygon[(i + 1) % other.polygon.length];
              return (same(a, p) && same(b, q)) || (same(a, q) && same(b, p));
            }),
        )
      )
        continue;
      const outwardX = (area < 0 ? -dz : dz) / length,
        outwardZ = (area < 0 ? dx : -dx) / length,
        y0 = roof.y(...a),
        y1 = roof.y(...b);
      const at = (t: number, y: number): P => {
        const top = mix(y0, y1, t) - 0.95,
          inset = 4.2 - Math.max(0, Math.min(1, (y - 0.9) / (top - 0.9))) * 1.7;
        return [
          mix(a[0], b[0], t) - outwardX * inset,
          y,
          mix(a[1], b[1], t) - outwardZ * inset,
        ];
      };
      result.push({
        roofIndex,
        edgeIndex,
        length,
        outwardX,
        outwardZ,
        at,
        roofY: (t) => mix(y0, y1, t),
      });
    }
  }
  return result;
}

function facade(
  m: Model,
  roof: Roof,
  roofIndex: number,
  options: ConventionSurfaceOptions,
  entries: ConventionEntry[],
) {
  const poly = roof.polygon;
  let area = 0;
  for (let i = 0; i < poly.length; i++)
    area +=
      poly[i][0] * poly[(i + 1) % poly.length][1] -
      poly[(i + 1) % poly.length][0] * poly[i][1];
  const drawQuad = (key: string, a: P, b: P, c: P, d: P) => {
    if (area > 0) quad(m, key, a, b, c, d);
    else quad(m, key, d, c, b, a);
  };
  for (let edge = 0; edge < poly.length; edge++) {
    const a = poly[edge],
      b = poly[(edge + 1) % poly.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const same = (p: XZ, q: XZ) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.025;
    const neighbour = ROOFS.find(
      (other) =>
        other !== roof &&
        other.polygon.some((p, i) => {
          const q = other.polygon[(i + 1) % other.polygon.length];
          return (same(a, p) && same(b, q)) || (same(a, q) && same(b, p));
        }),
    );
    const bottomAt = (t: number) =>
      neighbour
        ? neighbour.y(mix(a[0], b[0], t), mix(a[1], b[1], t)) + 0.02
        : 0.9;
    const y0 = roof.y(...a),
      y1 = roof.y(...b);
    // Dark rolled edge above a real wood-coloured underside; less than 1m thick.
    drawQuad(
      'metal',
      [a[0], y0, a[1]],
      [b[0], y1, b[1]],
      [b[0], y1 - 0.58, b[1]],
      [a[0], y0 - 0.58, a[1]],
    );
    m.beam('metal', [a[0], y0 + 0.12, a[1]], [b[0], y1 + 0.12, b[1]], 0.12, 4);
    const outwardX = (area < 0 ? -dz : dz) / len,
      outwardZ = (area < 0 ? dx : -dx) / len;
    // Glass wall leans outward at the top, as visible from the harbour.
    const at = (t: number, y: number): P => {
      const x = mix(a[0], b[0], t),
        z = mix(a[1], b[1], t);
      const top = mix(y0, y1, t) - 0.95;
      const inset =
        4.2 - Math.max(0, Math.min(1, (y - 0.9) / (top - 0.9))) * 1.7;
      return [x - outwardX * inset, y, z - outwardZ * inset];
    };
    const interfaceEdge: ConventionEdge = {
      roofIndex,
      edgeIndex: edge,
      length: len,
      outwardX,
      outwardZ,
      at,
      roofY: (t) => mix(y0, y1, t),
    };
    const plan = neighbour
      ? { entries: [] }
      : options.resolvedEntries
        ? {
            entries: options.resolvedEntries.filter(
              (e) => e.roofIndex === roofIndex && e.edgeIndex === edge,
            ),
          }
        : planConventionEntries(interfaceEdge, options);
    if (!neighbour) drawConventionInterfaces(m, interfaceEdge, plan.entries);
    entries.push(...plan.entries);
    const bays = Math.max(1, Math.ceil(len / (m.detail ? 1.85 : 5.2)));
    for (let bay = 0; bay < bays; bay++) {
      const t0 = bay / bays,
        t1 = (bay + 1) / bays;
      const top0 = mix(y0, y1, t0) - 0.96,
        top1 = mix(y0, y1, t1) - 0.96;
      const levels = [0.9, 5.5, 10.3, 15.1, 19.9, 24.7, 29.5];
      for (let level = 0; level < levels.length; level++) {
        const low = levels[level];
        if (Math.max(top0, top1) <= low + 0.001) continue;
        let left = t0,
          right = t1;
        if (top0 < low) left = mix(t0, t1, (low - top0) / (top1 - top0));
        if (top1 < low) right = mix(t0, t1, (low - top0) / (top1 - top0));
        const high0 = Math.min(
          levels[level + 1] ?? 40,
          mix(y0, y1, left) - 0.96,
        );
        const high1 = Math.min(
          levels[level + 1] ?? 40,
          mix(y0, y1, right) - 0.96,
        );
        const floor0 = Math.max(low, bottomAt(left)),
          floor1 = Math.max(low, bottomAt(right));
        if (floor0 >= high0 && floor1 >= high1) continue;
        // Shared folds need only their exposed clerestory, not hidden full walls.
        // Narrow crossing bays are bounded to the higher roof and the neighbour.
        const low0 = Math.min(floor0, high0),
          low1 = Math.min(floor1, high1);
        const seed = roofIndex * 3000 + edge * 150 + bay * 5 + level;
        const key =
          hash(seed) < 0.17
            ? 'glass-warm'
            : hash(seed + 7) < 0.4
              ? 'glass-grey'
              : 'glass';
        if (!neighbour && level === 0 && plan.entries.length) {
          // Ground strip remains below the same 5.5m datum; cut each physical
          // doorway across any old LOD bay boundaries before inserting its recess.
          for (const p of conventionGlassPieces(
            left,
            right,
            low0,
            high0,
            plan.entries,
          ))
            drawQuad(
              key,
              at(p.left, p.low),
              at(p.left, p.high),
              at(p.right, p.high),
              at(p.right, p.low),
            );
        } else {
          drawQuad(
            key,
            at(left, low0),
            at(left, high0),
            at(right, high1),
            at(right, low1),
          );
        }
        if (level && low > Math.max(bottomAt(left), bottomAt(right)))
          m.beam(
            'metal',
            at(left, low + 0.015),
            at(right, low + 0.015),
            0.055,
            4,
          );
      }
      if (top0 > bottomAt(t0))
        for (const [lo, hi] of conventionMullionPieces(
          t0,
          bottomAt(t0),
          top0,
          plan.entries,
        ))
          m.beam('metal', at(t0, lo), at(t0, hi), m.detail ? 0.066 : 0.083, 4);
    }
    if (y1 - 0.95 > bottomAt(1))
      m.beam(
        'metal',
        at(1, bottomAt(1)),
        at(1, y1 - 0.95),
        m.detail ? 0.066 : 0.083,
        4,
      );
    if (neighbour) continue;
    // Exposed glulam soffit ribs and concrete supports follow the sloping edge.
    const ribs = Math.max(1, Math.floor(len / (m.detail ? 0.9 : 4)));
    for (let i = 0; i <= ribs; i++) {
      const t = i / ribs,
        x = mix(a[0], b[0], t),
        z = mix(a[1], b[1], t),
        y = mix(y0, y1, t) - 0.77;
      const end: P = [x - outwardX * 4.65, y, z - outwardZ * 4.65];
      m.beam('wood', [x, y, z], end, m.detail ? 0.074 : 0.11, 4);
    }
    const columns = Math.floor(len / 10.5);
    for (let i = 1; i <= columns; i++) {
      const t = i / (columns + 1),
        x = mix(a[0], b[0], t),
        z = mix(a[1], b[1], t),
        top = mix(y0, y1, t) - 1;
      m.beam(
        'concrete',
        [x - outwardX * 5.2, 0.5, z - outwardZ * 5.2],
        [x - outwardX * 2.3, top, z - outwardZ * 2.3],
        0.3,
        m.detail ? 8 : 6,
      );
    }
    // Wood soffit is solid geometry and remains visible through underside views.
    const ai: P = [a[0] - outwardX * 4.8, y0 - 0.68, a[1] - outwardZ * 4.8];
    const bi: P = [b[0] - outwardX * 4.8, y1 - 0.68, b[1] - outwardZ * 4.8];
    quad(m, 'wood-shadow', [a[0], y0 - 0.68, a[1]], ai, bi, [
      b[0],
      y1 - 0.68,
      b[1],
    ]);
  }
}

/** Original exterior reconstruction, not a surveyed BIM or an interior model. */
export function createConventionCentre(
  detail: boolean,
  options: ConventionSurfaceOptions = {},
): THREE.Group {
  const m = new Model('Vancouver Convention Centre West', detail);
  m.material('concrete', 0xa2a399, 0.91, 0.02);
  m.material('metal', 0x5e6867, 0.34, 0.69);
  // Opaque PBR glass avoids transparency sorting/SSAO artifacts at city scale.
  m.material('glass', 0x6b8991, 0.23, 0.36, [0xffc58b, 0.29]);
  m.material('glass-grey', 0x859295, 0.29, 0.3, [0xffc18b, 0.24]);
  m.material('glass-warm', 0x90918a, 0.31, 0.25, [0xffb978, 0.42]);
  m.material('wood', 0xa17747, 0.8, 0.01);
  m.material(
    'wood-shadow',
    0x705337,
    0.9,
    0.01,
    [0xc89553, 0.12],
    THREE.DoubleSide,
  );
  m.material('meadow', 0x626e39, 1, 0);
  m.material('meadow-shadow', 0x606d39, 1, 0);
  m.material('meadow-straw', 0x67713c, 1, 0);
  m.material('gravel', 0x888979, 1, 0);
  m.material('led', 0xe8c68c, 0.5, 0, [0xffb95e, 1.3]);

  const podium = OUTLINE.map(([x, z]): XZ => [x * 1.044, z * 1.044]);
  m.slab('concrete', podium, -0.55, 1.35);
  m.slab('concrete', OUTLINE, 5.3, 0.48);
  let clumpCount = 0;
  const facadeEntries: ConventionEntry[] = [];
  ROOFS.forEach((roof, index) => {
    if (roof.planted) clumpCount += meadow(m, roof, index);
    else plane(m, 'gravel', roof.polygon, roof.y);
    plane(m, 'wood-shadow', roof.polygon, (x, z) => roof.y(x, z) - 0.63, true);
    facade(m, roof, index, options, facadeEntries);
  });

  // Central roof service strip: low parapets, plant bed, rooflights, screened HVAC.
  for (let i = 0; i < 6; i++) {
    const z = -58 + i * 12.5;
    m.box('metal', [5.5, 1.1, 4.8], [23.5, 18.8, z]);
    m.box(
      i < 2 ? 'meadow-straw' : 'glass-grey',
      [4.8, 0.1, 4.1],
      [23.5, 19.39, z],
    );
    if (detail)
      for (let l = 0; l < 6; l++)
        m.box('metal', [5.6, 0.045, 0.07], [23.5, 18.4 + l * 0.17, z - 2.46]);
  }
  // Two slit rooflights, aligned to their respective sloping panels.
  for (const [roofIndex, x, z, length] of [
    [0, 58, -51, 22],
    [3, -82, 38, 16],
  ]) {
    const roof = ROOFS[roofIndex];
    const p: XZ[] = [
      [x - 1.4, z - length / 2],
      [x + 1.4, z - length / 2],
      [x + 1.4, z + length / 2],
      [x - 1.4, z + length / 2],
    ];
    plane(m, 'glass', p, (px, pz) => roof.y(px, pz) + 0.5);
    for (let i = 0; i < 4; i++) {
      const a = p[i],
        b = p[(i + 1) % 4];
      m.beam(
        'metal',
        [a[0], roof.y(...a) + 0.52, a[1]],
        [b[0], roof.y(...b) + 0.52, b[1]],
        0.12,
        4,
      );
    }
  }

  // North waterfront promenade, railings, a lower marine skirt and pipe piles.
  for (let i = 0; i < podium.length; i++) {
    const a = podium[i],
      b = podium[(i + 1) % podium.length];
    if (Math.min(a[1], b[1]) > 32) continue; // keep the city-side approaches open
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    m.beam('metal', [a[0], 1.86, a[1]], [b[0], 1.86, b[1]], 0.045, 4);
    m.beam('metal', [a[0], 1.31, a[1]], [b[0], 1.31, b[1]], 0.03, 4);
    const count = Math.max(1, Math.floor(len / 3));
    for (let j = 0; j <= count; j++) {
      const x = mix(a[0], b[0], j / count),
        z = mix(a[1], b[1], j / count);
      m.beam('metal', [x, 0.8, z], [x, 1.9, z], 0.038, 4);
      if (j % 4 === 0) {
        m.cylinder(
          'concrete',
          0.47,
          5.2,
          [x * 0.994, -2.0, z * 0.994],
          detail ? 10 : 6,
        );
        m.box('led', [0.22, 0.12, 0.22], [x, 0.99, z]);
      }
    }
    // Five stepped habitat shelves follow the marine edge, not a full ground box.
    for (let shelf = 0; shelf < 5; shelf++) {
      const scale = 1 + shelf * 0.004,
        yy = -0.58 - shelf * 0.78;
      m.beam(
        'concrete',
        [a[0] * scale, yy, a[1] * scale],
        [b[0] * scale, yy, b[1] * scale],
        0.26,
        4,
      );
    }
  }
  // Human-scale benches on the southern approach. No public access onto roof.
  for (let i = 0; i < 9; i++) {
    const x = -39 + i * 11;
    m.box('wood', [3.7, 0.17, 0.62], [x, 1.27, 72.15]);
    for (const dx of [-1.35, 1.35])
      m.box('metal', [0.12, 0.5, 0.58], [x + dx, 0.96, 72.15]);
  }
  const solid = [...podium, podium[0]];
  return m.finish(
    { lon: -123.1159678, lat: 49.2890752, yaw: -0.403, baseY: 4 },
    {
      solidFootprints: [solid],
      greenRoofFolds: 4,
      facadeEntries,
      facadeInterfaceStatus:
        options.resolvedEntries || options.actualSurface
          ? 'Selected rendered surface; uncertain entries omitted'
          : 'Existing model podium 0.8m top; external terrain contact not yet audited',
      roofGrassClumps: clumpCount,
      replacementBuildingKeys: ['152366'],
      replacementFeatureIds: [160690, 162308, 162309],
      geographySources: [
        'City of Vancouver buildingId 152366',
        'OSM way 85240507',
        'OSM ways 1526189023–1526189027',
      ],
      reconstruction:
        'Mapped roof outline and folds; approximate heights, pitches, glazing bays and fittings from architect photographs.',
      glassIsOpaqueApproximation: true,
      noInteriorAccess: true,
    },
  );
}
