/**
 * Original Marine Building ground-floor entrance study. MIT, 2026.
 * Replaces BOTH original ground prisms and the bottom of MARINE_PARTS[1].
 * The aperture is absent from the wall geometry; this is not a portal pasted
 * in front of a solid extrusion. Existing upper masses/placement stay intact.
 * References and explicit interpretation limits: prototype-marine-notes.md.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type XZ = readonly [number, number];
type XYZ = readonly [number, number, number];
type Colour = THREE.ColorRepresentation;
export const MARINE_RAW_GROUND: readonly XZ[] = [
  [32.9118, -1.5642],
  [36.1335, 4.4905],
  [41.6661, 14.8483],
  [36.4917, 14.8857],
  [14.3355, 15.0481],
  [-12.5488, 15.2466],
  [-14.6768, 15.261],
  [-24.6089, -12.0469],
  [-13.7349, -16.5436],
  [-7.7538, -18.9776],
  [17.9156, -29.6578],
];
export const MARINE_GROUND = MARINE_RAW_GROUND.map(
  ([x, z]): XZ => [x * 0.975, z * 0.975],
);
const A = MARINE_GROUND[4],
  B = MARINE_GROUND[5];
const edgeLength = Math.hypot(B[0] - A[0], B[1] - A[1]);
const U: XZ = [(A[0] - B[0]) / edgeLength, (A[1] - B[1]) / edgeLength];
const N: XZ = [-U[1], U[0]];
const C: XZ = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
const INNER_RX = 2.55,
  INNER_RY = 2.82,
  SPRING_Y = 3.7,
  THRESHOLD_Y = 0.16;
const HALF_SURROUND = 4.18,
  WALL_TOP = 8,
  LOBBY_BACK = -2.8;
const DEFAULT_THRESHOLD_Y = 3.30377427848736; // present DEM + sidewalk1.18 - preserved base14.22
export const MARINE_UPPER_ENTRY_RAW: readonly XZ[] = [
  [14.3355, 15.0481],
  [-12.5488, 15.2466],
  [-13.712, -14.9087],
  [4.8024, -15.2686],
  [4.8529, -13.2659],
  [4.9849, -8.1449],
  [5.0495, -5.8959],
  [5.1727, -1.0161],
  [7.5002, -1.0696],
  [12.6303, -1.1656],
  [13.8551, -1.1874],
  [32.9118, -1.5642],
  [36.1335, 4.4905],
  [36.4917, 14.8857],
];
const UPPER_ENTRY_RING = MARINE_UPPER_ENTRY_RAW.map(
  ([x, z]): XZ => [x * 0.975, z * 0.975],
);

export const MARINE_ENTRY_CONTRACT = {
  replacePrisms: [
    { bottom: 0, top: 1.35 },
    { bottom: 1.35, top: 8 },
  ],
  facadeEdge: [4, 5],
  facadeCenterLocal: C,
  tangentLocal: U,
  outwardNormalLocal: N,
  entranceCoordinateEstimate: [-123.11699580073898, 49.28735920267722],
  entranceCoordinateStatus:
    'Centre of mapped Burrard-facing tower facade; actual doorway offset is interpreted, not surveyed.',
  aperture: {
    halfWidth: INNER_RX,
    springY: SPRING_Y,
    rise: INNER_RY,
    bottomY: THRESHOLD_Y,
    topY: SPRING_Y + INNER_RY,
  },
  surroundHalfWidth: HALF_SURROUND,
  maximumProjectionBeyondInsetFacadeM: 0.24,
  groundTopY: WALL_TOP,
  upperEntryPartIndex: 1,
  defaultThresholdY: DEFAULT_THRESHOLD_Y,
  thresholdStatus:
    'Current DEM +1.18m sidewalk offset at mapped entry, relative to unchanged baseY14.22. Root should pass actual rendered sidewalk Y-baseY after final street rebuild.',
  placementMustRemain: {
    lon: -123.117146,
    lat: 49.287449,
    yaw: 0.77,
    baseY: 14.22,
  },
  collisionPolicy:
    'Keep original closed solidFootprints; entrance is an exterior viewing recess, not a new navigable interior.',
  sourcePrecision:
    'Original parametric interpretation of architectural character, not a measured restoration model.',
} as const;

export function marineEntryPoint(
  u: number,
  y: number,
  d: number,
  centerShiftM = 0,
): XYZ {
  return [
    C[0] + U[0] * (u + centerShiftM) + N[0] * d,
    y,
    C[1] + U[1] * (u + centerShiftM) + N[1] * d,
  ];
}
export function marineEntryCoordinates(x: number, z: number, centerShiftM = 0) {
  return {
    u: (x - C[0]) * U[0] + (z - C[1]) * U[1] - centerShiftM,
    d: (x - C[0]) * N[0] + (z - C[1]) * N[1],
  };
}

/** Locates bays intersecting the doorway surround on the shared front edge.
 * Omit level=0 bays; on upper part index1 only trim ribs and skip low windows
 * below group.userData.upperCutY. Other facade directions remain unchanged. */
export function marineGroundBayOverlapsEntry(
  x: number,
  z: number,
  halfBayWidth: number,
  centerShiftM = 0,
): boolean {
  const p = marineEntryCoordinates(x, z, centerShiftM);
  return Math.abs(p.d) < 0.35 && Math.abs(p.u) < HALF_SURROUND + halfBayWidth;
}

/** Distances along an existing a->b edge where its ground-level cornices remain.
 * Use this only for level=0 horizontal trims. Cuts the two original horizontal
 * bars around the entrance rather than letting one run across the arch relief. */
export function marineGroundTrimRanges(
  a: XZ,
  b: XZ,
  centerShiftM = 0,
): [number, number][] {
  const aa = marineEntryCoordinates(...a, centerShiftM),
    bb = marineEntryCoordinates(...b, centerShiftM);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (
    Math.abs(aa.d) > 0.01 ||
    Math.abs(bb.d) > 0.01 ||
    Math.abs(bb.u - aa.u) < 1e-9
  )
    return [[0, length]];
  const ts = [
    (-HALF_SURROUND - aa.u) / (bb.u - aa.u),
    (HALF_SURROUND - aa.u) / (bb.u - aa.u),
  ].sort((x, y) => x - y);
  const from = Math.max(0, ts[0]),
    to = Math.min(1, ts[1]);
  if (to <= from) return [[0, length]];
  return [
    [0, from * length],
    [to * length, length],
  ].filter(([a, b]) => b - a > 0.01) as [number, number][];
}

class Batch {
  parts: THREE.BufferGeometry[] = [];
  constructor(
    readonly name: string,
    readonly material: THREE.MeshStandardMaterial,
    readonly role: string,
    readonly nightIntensity = 0,
  ) {}
  add(source: THREE.BufferGeometry, colour: Colour) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    for (const name of Object.keys(g.attributes))
      if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const c = new THREE.Color(colour),
      colours = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    this.parts.push(g);
  }
  quad(a: XYZ, b: XYZ, c: XYZ, d: XYZ, colour: Colour, normal?: XYZ) {
    let points = [...a, ...b, ...c, ...a, ...c, ...d];
    if (normal) {
      const cross = new THREE.Vector3(...b)
        .sub(new THREE.Vector3(...a))
        .cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a)));
      if (cross.dot(new THREE.Vector3(...normal)) < 0)
        points = [...a, ...c, ...b, ...a, ...d, ...c];
    }
    // The first/last arch infill cells have one triangular half, not a second
    // zero-area face where the curved arch meets its spring line.
    const filtered: number[] = [];
    for (let i = 0; i < points.length; i += 9) {
      const aa = new THREE.Vector3(
        ...(points.slice(i, i + 3) as [number, number, number]),
      );
      const bb = new THREE.Vector3(
        ...(points.slice(i + 3, i + 6) as [number, number, number]),
      );
      const cc = new THREE.Vector3(
        ...(points.slice(i + 6, i + 9) as [number, number, number]),
      );
      if (bb.sub(aa).cross(cc.sub(aa)).lengthSq() > 1e-16)
        filtered.push(...points.slice(i, i + 9));
    }
    if (!filtered.length) return;
    const g = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(filtered, 3),
    );
    g.computeVertexNormals();
    this.add(g, colour);
  }
  finish(group: THREE.Group) {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!g) throw new Error(`Cannot merge ${this.name}`);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = this.name;
    mesh.castShadow = this.role !== 'glass' && this.role !== 'night';
    mesh.receiveShadow = true;
    mesh.userData.role = this.role;
    group.add(mesh);
    if (this.nightIntensity) {
      this.material.emissiveIntensity = 0;
      this.material.userData.nightIntensity = this.nightIntensity;
      group.userData.nightMaterials.push({
        material: this.material,
        intensity: this.nightIntensity,
      });
    }
  }
}

function material(roughness: number, metalness = 0, emissive?: Colour) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness,
    metalness,
    emissive: emissive ?? 0x000000,
    emissiveIntensity: 0,
  });
}

export function createMarineGroundEntrance(
  detail: boolean,
  options: { centerShiftM?: number; thresholdY?: number } = {},
): THREE.Group {
  const shift = options.centerShiftM ?? 0;
  if (
    !Number.isFinite(shift) ||
    Math.abs(shift) + HALF_SURROUND > edgeLength / 2 - 0.3
  )
    throw new Error('Entrance must stay inside reserved facade edge');
  const thresholdY = options.thresholdY ?? DEFAULT_THRESHOLD_Y;
  if (
    !Number.isFinite(thresholdY) ||
    thresholdY < THRESHOLD_Y ||
    thresholdY > 6
  )
    throw new Error('Invalid site-relative threshold height');
  const lift = thresholdY - THRESHOLD_Y;
  const upperCutY = Math.max(
    8,
    Math.ceil((SPRING_Y + 3.64 + lift + 0.6) * 2) / 2,
  );
  const group = new THREE.Group();
  group.name = 'Marine Building / true ground entrance replacement';
  group.userData.nightMaterials = [];
  const granite = new Batch(
    'Marine entry / ground granite',
    material(0.84, 0.02),
    'ground-wall',
  );
  const brick = new Batch(
    'Marine entry / lower brick shell',
    material(0.9),
    'ground-wall',
  );
  const terra = new Batch(
    'Marine entry / glazed terracotta archivolts',
    material(0.49, 0.03),
    'terracotta',
  );
  const bronze = new Batch(
    'Marine entry / bronze frames and grille',
    material(0.36, 0.76),
    'metal',
  );
  const interior = new Batch(
    'Marine entry / recessed lobby and reveals',
    material(0.87, 0.02),
    'lobby',
  );
  const glass = new Batch(
    'Marine entry / inset dark green glazing',
    material(0.22, 0.34),
    'glass',
  );
  const night = new Batch(
    'Marine entry / restrained lobby light',
    material(0.7, 0, 0xffd4a0),
    'night',
    0.5,
  );
  const point = (x: number, y: number, z: number) =>
    marineEntryPoint(x, y + lift, z, shift);
  const basePoint = (x: number, y: number, z: number) =>
    marineEntryPoint(x, y, z, shift);
  const frame = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(U[0], 0, U[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(N[0], 0, N[1]),
  );
  frame.setPosition(...point(0, 0, 0));
  const addLocal = (batch: Batch, g: THREE.BufferGeometry, colour: Colour) =>
    batch.add(g.applyMatrix4(frame), colour);
  const box = (batch: Batch, size: XYZ, position: XYZ, colour: Colour) =>
    addLocal(
      batch,
      new THREE.BoxGeometry(...size).translate(...position),
      colour,
    );
  const rect = (
    batch: Batch,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z: number,
    colour: Colour,
  ) =>
    batch.quad(
      point(x0, y0, z),
      point(x1, y0, z),
      point(x1, y1, z),
      point(x0, y1, z),
      colour,
      [N[0], 0, N[1]],
    );
  const cylinder = (
    batch: Batch,
    r: number,
    height: number,
    p: XYZ,
    colour: Colour,
    sides = 8,
  ) =>
    addLocal(
      batch,
      new THREE.CylinderGeometry(r, r, height, sides).translate(...p),
      colour,
    );
  const beam = (
    batch: Batch,
    a: XYZ,
    b: XYZ,
    r: number,
    colour: Colour,
    sides = 6,
  ) => {
    const va = new THREE.Vector3(...a),
      vb = new THREE.Vector3(...b),
      direction = vb.clone().sub(va),
      length = direction.length();
    if (length < 1e-8) return;
    const g = new THREE.CylinderGeometry(r, r, length, sides)
      .applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        ),
      )
      .translate(...va.lerp(vb, 0.5).toArray());
    addLocal(batch, g, colour);
  };

  // All unmodified ground facade edges, split at the old granite/brick datum.
  MARINE_GROUND.forEach((a, i) => {
    if (i === 4) return;
    const b = MARINE_GROUND[(i + 1) % MARINE_GROUND.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    const n: XYZ = [dz, 0, -dx];
    for (const [bottom, top, batch, colour] of [
      [0, 1.35, granite, 0x747b75],
      [1.35, 8, brick, 0x997454],
    ] as const)
      batch.quad(
        [a[0], bottom, a[1]],
        [b[0], bottom, b[1]],
        [b[0], top, b[1]],
        [a[0], top, a[1]],
        colour,
        n,
      );
  });
  const left = -edgeLength / 2 - shift,
    right = edgeLength / 2 - shift;
  const archSegments = detail ? 48 : 28;
  const arch = (rx: number, ry: number, i: number): [number, number] => {
    const a = Math.PI - (i / archSegments) * Math.PI;
    return [Math.cos(a) * rx, SPRING_Y + Math.sin(a) * ry];
  };
  const frontRect = (
    batch: Batch,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    colour: Colour,
  ) => {
    if (y1 - y0 < 1e-8) return;
    batch.quad(
      basePoint(x0, y0, 0),
      basePoint(x1, y0, 0),
      basePoint(x1, y1, 0),
      basePoint(x0, y1, 0),
      colour,
      [N[0], 0, N[1]],
    );
  };
  const frontBand = (
    batch: Batch,
    bottom: number,
    top: number,
    colour: Colour,
  ) => {
    frontRect(batch, left, -INNER_RX, bottom, top, colour);
    frontRect(batch, INNER_RX, right, bottom, top, colour);
    frontRect(
      batch,
      -INNER_RX,
      INNER_RX,
      bottom,
      Math.min(top, thresholdY),
      colour,
    );
    for (let i = 0; i < archSegments; i++) {
      const aa = arch(INNER_RX, INNER_RY, i),
        bb = arch(INNER_RX, INNER_RY, i + 1);
      const a = [aa[0], aa[1] + lift],
        b = [bb[0], bb[1] + lift],
        cuts = [0, 1];
      for (const y of [bottom, top])
        if (Math.abs(b[1] - a[1]) > 1e-9) {
          const t = (y - a[1]) / (b[1] - a[1]);
          if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t);
        }
      cuts.sort((x, y) => x - y);
      for (let k = 1; k < cuts.length; k++) {
        const ta = cuts[k - 1],
          tb = cuts[k],
          x0 = a[0] + (b[0] - a[0]) * ta,
          x1 = a[0] + (b[0] - a[0]) * tb;
        const y0 = Math.max(bottom, a[1] + (b[1] - a[1]) * ta),
          y1 = Math.max(bottom, a[1] + (b[1] - a[1]) * tb);
        if (Math.min(y0, y1) >= top - 1e-9) continue;
        batch.quad(
          basePoint(x0, Math.min(top, y0), 0),
          basePoint(x1, Math.min(top, y1), 0),
          basePoint(x1, top, 0),
          basePoint(x0, top, 0),
          colour,
          [N[0], 0, N[1]],
        );
      }
    }
  };
  frontBand(granite, 0, 1.35, 0x747b75);
  frontBand(brick, 1.35, 8, 0x997454);
  // A notch in the 8m internal cap keeps it from cutting horizontally through
  // the raised, street-aligned doorway/transom. Other base roof area remains.
  const capRing: XZ[] = [];
  MARINE_GROUND.forEach((p, i) => {
    capRing.push(p);
    if (i === 4 && lift + SPRING_Y + INNER_RY > 8)
      for (const [x, z] of [
        [INNER_RX + 0.03, 0],
        [INNER_RX + 0.03, LOBBY_BACK - 0.1],
        [-INNER_RX - 0.03, LOBBY_BACK - 0.1],
        [-INNER_RX - 0.03, 0],
      ]) {
        const p = basePoint(x, 0, z);
        capRing.push([p[0], p[2]]);
      }
  });
  const capGeometry = (ring: readonly XZ[]) =>
    new THREE.ShapeGeometry(
      new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z))),
    ).rotateX(-Math.PI / 2);
  brick.add(capGeometry(capRing).translate(0, 8, 0), 0x997454);
  const bottomCap = capGeometry(MARINE_GROUND);
  const underside = bottomCap.toNonIndexed();
  bottomCap.dispose();
  const pos = underside.getAttribute('position');
  for (let i = 0; i < pos.count; i += 3)
    for (let axis = 0; axis < 3; axis++) {
      const a = pos.getComponent(i + 1, axis);
      pos.setComponent(i + 1, axis, pos.getComponent(i + 2, axis));
      pos.setComponent(i + 2, axis, a);
    }
  underside.computeVertexNormals();
  granite.add(underside, 0x747b75);
  // Replace only the bottom 8..upperCutY of the upper part whose front edge is
  // identical to the portal facade. Root restarts that original mass at this Y.
  if (upperCutY > 8) {
    UPPER_ENTRY_RING.forEach((a, i) => {
      if (i === 0) return;
      const b = UPPER_ENTRY_RING[(i + 1) % UPPER_ENTRY_RING.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1];
      brick.quad(
        [a[0], 8, a[1]],
        [b[0], 8, b[1]],
        [b[0], upperCutY, b[1]],
        [a[0], upperCutY, a[1]],
        0x936d50,
        [dz, 0, -dx],
      );
    });
    frontBand(brick, 8, upperCutY, 0x936d50);
    brick.add(
      capGeometry(UPPER_ENTRY_RING).translate(0, upperCutY, 0),
      0x936d50,
    );
  }

  // Deep opening reveal. Its wall faces point INTO the visible recess.
  for (const sign of [-1, 1]) {
    interior.quad(
      point(sign * INNER_RX, THRESHOLD_Y, 0),
      point(sign * INNER_RX, THRESHOLD_Y, -1.2),
      point(sign * INNER_RX, SPRING_Y, -1.2),
      point(sign * INNER_RX, SPRING_Y, 0),
      0x736959,
      [-sign * U[0], 0, -sign * U[1]],
    );
  }
  for (let i = 0; i < archSegments; i++) {
    const a = arch(INNER_RX, INNER_RY, i),
      b = arch(INNER_RX, INNER_RY, i + 1);
    const mid = Math.PI - ((i + 0.5) / archSegments) * Math.PI;
    const n: XYZ = [
      -Math.cos(mid) * U[0],
      -Math.sin(mid),
      -Math.cos(mid) * U[1],
    ];
    interior.quad(
      point(a[0], a[1], 0),
      point(a[0], a[1], -1.2),
      point(b[0], b[1], -1.2),
      point(b[0], b[1], 0),
      0x786d5b,
      n,
    );
  }
  interior.quad(
    point(-INNER_RX, THRESHOLD_Y, 0),
    point(INNER_RX, THRESHOLD_Y, 0),
    point(INNER_RX, THRESHOLD_Y, LOBBY_BACK),
    point(-INNER_RX, THRESHOLD_Y, LOBBY_BACK),
    0x514f45,
    [0, 1, 0],
  );
  rect(interior, -INNER_RX, INNER_RX, THRESHOLD_Y, 6.53, LOBBY_BACK, 0x141b1a);
  // Side returns behind the bronze front and a dark ceiling keep the recess volumetric.
  for (const sign of [-1, 1])
    box(
      interior,
      [0.08, 6.36, 1.6],
      [sign * (INNER_RX - 0.04), 3.34, -2],
      0x282b27,
    );
  box(interior, [INNER_RX * 2, 0.08, 1.6], [0, 6.49, -2], 0x252a26);

  // Four nested ceramic archivolts: every voussoir is an original shallow solid.
  const bands = [
    { ix: 2.55, ox: 2.77, iy: 2.82, oy: 3.01, near: 0.035, far: -0.2 },
    { ix: 2.82, ox: 3.03, iy: 3.06, oy: 3.23, near: 0.1, far: -0.065 },
    { ix: 3.08, ox: 3.31, iy: 3.28, oy: 3.43, near: 0.17, far: 0.025 },
    { ix: 3.36, ox: 3.6, iy: 3.49, oy: 3.64, near: 0.23, far: 0.06 },
  ];
  for (const [row, v] of bands.entries()) {
    const width = v.ox - v.ix;
    for (const sign of [-1, 1])
      box(
        terra,
        [width, SPRING_Y - THRESHOLD_Y, v.near - v.far],
        [
          (sign * (v.ix + v.ox)) / 2,
          (SPRING_Y + THRESHOLD_Y) / 2,
          (v.near + v.far) / 2,
        ],
        row % 2 ? 0xbfa37c : 0xd0b88f,
      );
    for (let i = 0; i < archSegments; i++) {
      const gap = detail ? 0.002 : 0.001;
      const t0 = Math.PI - (i / archSegments) * Math.PI - gap,
        t1 = Math.PI - ((i + 1) / archSegments) * Math.PI + gap;
      const inner0: XYZ = [
        Math.cos(t0) * v.ix,
        SPRING_Y + Math.sin(t0) * v.iy,
        v.near,
      ];
      const outer0: XYZ = [
        Math.cos(t0) * v.ox,
        SPRING_Y + Math.sin(t0) * v.oy,
        v.near,
      ];
      const inner1: XYZ = [
        Math.cos(t1) * v.ix,
        SPRING_Y + Math.sin(t1) * v.iy,
        v.near,
      ];
      const outer1: XYZ = [
        Math.cos(t1) * v.ox,
        SPRING_Y + Math.sin(t1) * v.oy,
        v.near,
      ];
      const vertices = [
        inner0,
        inner1,
        outer1,
        outer0,
        ...[inner0, inner1, outer1, outer0].map(([x, y]): XYZ => [x, y, v.far]),
      ];
      const g = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices.flat(), 3),
      );
      g.setIndex([
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
      ]);
      g.computeVertexNormals();
      // Hard faces: non-indexed before normals avoids soft ceramic slab corners.
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      addLocal(
        terra,
        flat,
        (i + row) % 7 === 0
          ? 0xb99a73
          : (i + row) % 3 === 0
            ? 0xd9c39c
            : 0xcbb18a,
      );
    }
  }

  // Leg bases/caps and original small wave/shell reliefs, restrained in projection.
  for (const sign of [-1, 1]) {
    box(granite, [1.55, 0.25, 0.25], [sign * 3.39, 0.285, 0.065], 0x7f8174);
    box(terra, [1.45, 0.18, 0.24], [sign * 3.4, 3.6, 0.1], 0xd0b68a);
    const cells = detail ? 5 : 3;
    for (let row = 0; row < cells; row++) {
      const y = 0.78 + row * (2.3 / (cells - 1));
      box(terra, [0.48, 0.38, 0.055], [sign * 3.88, y, 0.09], 0xb69772);
      for (let ray = 0; ray < 5; ray++) {
        const a = 0.3 + ray * 0.64;
        beam(
          terra,
          [sign * 3.88, y - 0.1, 0.14],
          [
            sign * 3.88 + Math.cos(a) * 0.19,
            y - 0.1 + Math.sin(a) * 0.22,
            0.14,
          ],
          detail ? 0.017 : 0.014,
          0xd6c095,
          4,
        );
      }
      if (detail) {
        for (let i = 0; i < 7; i++)
          beam(
            terra,
            [
              sign * 3.88 - 0.21 + i * 0.06,
              y + 0.23 + Math.sin(i * 0.8) * 0.035,
              0.14,
            ],
            [
              sign * 3.88 - 0.15 + i * 0.06,
              y + 0.23 + Math.sin((i + 1) * 0.8) * 0.035,
              0.14,
            ],
            0.012,
            0xd9c49d,
            4,
          );
      }
    }
    // Horizontal joints and small alternating inset tile fields on jambs.
    if (detail)
      for (let j = 0; j < 12; j++) {
        const y = 0.53 + j * 0.25;
        box(interior, [0.95, 0.012, 0.012], [sign * 3.1, y, 0.018], 0x514b40);
      }
  }

  // Bronze door wall is 1.2m behind the actual masonry opening.
  const doorZ = -1.2;
  rect(glass, -2.43, 2.43, 0.22, 3.18, doorZ, 0x2e4440);
  for (const x of [-2.46, -1.19, 1.19, 2.46])
    box(bronze, [0.105, 3.03, 0.12], [x, 1.71, doorZ + 0.035], 0x896d46);
  for (const y of [0.23, 2.91, 3.16])
    box(bronze, [4.97, 0.1, 0.12], [0, y, doorZ + 0.035], 0x98794c);
  // Side doors and paired handles.
  for (const x of [-1.83, 1.83]) {
    box(bronze, [0.045, 2.64, 0.055], [x, 1.57, doorZ + 0.03], 0x775d3a);
    for (const side of [-1, 1])
      beam(
        bronze,
        [x + side * 0.12, 1.08, doorZ + 0.12],
        [x + side * 0.12, 1.51, doorZ + 0.12],
        0.021,
        0xb79862,
        6,
      );
  }
  // Central revolving-door drum is a recognizable interpretation, not an animated prop.
  const drumZ = -1.59,
    r = 0.87,
    drumH = 2.64;
  cylinder(bronze, 0.04, drumH, [0, 0.23 + drumH / 2, drumZ], 0xa08a58, 8);
  for (const y of [0.25, 2.89]) {
    const points = Array.from(
      { length: (detail ? 36 : 20) + 1 },
      (_, i): XYZ => {
        const a = (i / (detail ? 36 : 20)) * Math.PI * 2;
        return [Math.cos(a) * r, y, drumZ + Math.sin(a) * r];
      },
    );
    for (let i = 1; i < points.length; i++)
      beam(bronze, points[i - 1], points[i], 0.035, 0x9c8252, 6);
  }
  for (const angle of [0.3, Math.PI / 2 + 0.3]) {
    const g = new THREE.BoxGeometry(r * 2, 2.57, 0.018)
      .translate(0, 1.57, 0)
      .rotateY(angle)
      .translate(0, 0, drumZ);
    addLocal(glass, g, 0x334e47);
    for (const sign of [-1, 1]) {
      const x = Math.cos(angle) * r * sign,
        z = drumZ - Math.sin(angle) * r * sign;
      beam(bronze, [x, 0.28, z], [x, 2.86, z], 0.027, 0x987d4e, 6);
    }
  }
  // Tall transom fills the actual inner arch profile at recessed depth, with
  // original Art Deco verticals and a fan above; no copied logos or sculpture.
  rect(glass, -INNER_RX, INNER_RX, 3.19, SPRING_Y, doorZ, 0x293e38);
  for (let i = 0; i < archSegments; i++) {
    const a = arch(INNER_RX, INNER_RY, i),
      b = arch(INNER_RX, INNER_RY, i + 1);
    glass.quad(
      point(a[0], SPRING_Y, doorZ),
      point(b[0], SPRING_Y, doorZ),
      point(b[0], b[1], doorZ),
      point(a[0], a[1], doorZ),
      i % 4 === 0 ? 0x354f43 : 0x293e38,
      [N[0], 0, N[1]],
    );
  }
  for (const x of [-1.7, -0.85, 0, 0.85, 1.7]) {
    const top = SPRING_Y + INNER_RY * Math.sqrt(1 - (x / INNER_RX) ** 2);
    beam(
      bronze,
      [x, 3.18, doorZ + 0.045],
      [x, top - 0.07, doorZ + 0.045],
      0.028,
      0x9f895b,
      6,
    );
  }
  for (let i = 1; i < 9; i++) {
    const a = (i / 9) * Math.PI;
    beam(
      bronze,
      [0, 3.52, doorZ + 0.06],
      [Math.cos(a) * 2.46, SPRING_Y + Math.sin(a) * 2.73, doorZ + 0.06],
      0.024,
      0x8c754d,
      6,
    );
  }
  for (const y of [3.7, 4.47])
    box(bronze, [4.7, 0.06, 0.08], [0, y, doorZ + 0.045], 0x806c47);
  // Very small light areas; parent day/night system controls emissive intensity.
  for (const x of [-2.25, 2.25]) {
    box(bronze, [0.14, 0.45, 0.11], [x, 2.52, -0.48], 0x806c47);
    box(night, [0.075, 0.32, 0.045], [x, 2.52, -0.41], 0xd7c09b);
  }
  box(night, [1.55, 0.035, 0.035], [0, 3.12, -1.11], 0xdac29c);
  if (detail) {
    // Two-tone threshold inlay, original geometric border.
    for (const x of [-2.3, 2.3])
      box(granite, [0.055, 0.012, 1.7], [x, 0.169, -0.95], 0xb5ac91);
    box(granite, [4.6, 0.012, 0.055], [0, 0.169, -0.16], 0xb5ac91);
  }

  for (const b of [granite, brick, terra, bronze, interior, glass, night])
    b.finish(group);
  const bounds = new THREE.Box3().setFromObject(group);
  let triangles = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      triangles +=
        (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3;
  });
  Object.assign(group.userData, {
    originalProceduralAsset: true,
    units: 'metres',
    axes: '+Y up; building local coordinates, same original placement',
    replacesGroundPrisms: true,
    detail,
    centerShiftM: shift,
    thresholdY,
    entryLiftY: lift,
    upperCutY,
    replaceUpperPartIndex: 1,
    triangles,
    drawCalls: group.children.length,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    contract: MARINE_ENTRY_CONTRACT,
    nightFactor: 0,
  });
  return group;
}
