/** Original BC Place envelope / representative entrance refinement. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid), 2026.
 * Source dimensions, roof geometry, placements and collision polygons stay with
 * the existing factory. ETFE is a thin saddle-shaped single layer, not cushions.
 * See prototype-bc-place-notes.md for measured/source/interpretation distinctions.
 */
import * as THREE from 'three';
type XYZ = readonly [number, number, number];
type Colour = THREE.ColorRepresentation;
const TAU = Math.PI * 2;
export type BCPlaceEntryOptions = {
  resolvedPlan?: ReturnType<typeof planBCPlaceEntries>;
  /** Actual selected walk-surface height in BUILDING LOCAL metres. null means
   * no real surface here. Do not provide terrain+an invented sidewalk offset. */
  actualSurface?: (
    localX: number,
    localZ: number,
    gate: number,
  ) => number | null | undefined;
};
export type BCPlaceEntry = {
  index: number;
  angle: number;
  halfAngle: number;
  thresholdY: number;
  headY: number;
  center: XYZ;
  normal: XYZ;
  tangent: XYZ;
  status: 'legacy-representative' | 'sampled-walk-surface';
};
export const BC_PLACE_ENVELOPE_CONTRACT = {
  placement: { lon: -123.1120067, lat: 49.2766985, yaw: 0.677, baseY: 5 },
  facade: {
    bottomY: 32,
    topY: 41.6,
    rows: 4,
    mediumColumns: 144,
    detailColumns: 432,
  },
  representativeGates: 24,
  legacyThresholdY: 1.3,
  doorHeightM: 3.4,
  doorWidthM: 6.8,
  maximumThresholdY: 3.6,
  doorRecessM: 2.0,
  material:
    'Single-layer ETFE saddle interpretation; opaque PBR approximation, no inflated cushions.',
  entryStatus:
    'Retained 24 source-model angular divisions; not surveyed real gate positions or labels.',
} as const;

export function bcPlaceWallPoint(angle: number, y: number, inset = 0): XYZ {
  const t = Math.min(1, Math.max(0, y / 12)),
    upper = Math.max(0, (y - 12) / 18.5),
    rx = y <= 12 ? 106 + 6 * t : 112 + 0.6 * upper,
    rz = y <= 12 ? 86 + 5 * t : 91 + 0.5 * upper,
    c = Math.cos(angle),
    s = Math.sin(angle),
    n = Math.hypot(c / rx, s / rz);
  return [rx * c - (inset * c) / rx / n, y, rz * s - (inset * s) / rz / n];
}
function entryAt(
  index: number,
  thresholdY: number,
  status: BCPlaceEntry['status'],
): BCPlaceEntry {
  const angle = (index / 24) * TAU,
    y = thresholdY + 1.7,
    center = bcPlaceWallPoint(angle, y),
    rx = 106 + 0.5 * y,
    rz = 86 + (5 / 12) * y,
    c = Math.cos(angle),
    s = Math.sin(angle),
    nn = Math.hypot(c / rx, s / rz),
    normal: XYZ = [c / rx / nn, 0, s / rz / nn],
    tangent: XYZ = [-normal[2], 0, normal[0]],
    halfAngle = 3.4 / Math.hypot(rx * s, rz * c);
  return {
    index,
    angle,
    halfAngle,
    thresholdY,
    headY: thresholdY + 3.4,
    center,
    normal,
    tangent,
    status,
  };
}
/** Default preserves old source-model threshold. With callback, only safely
 * surface-supported entries are cut; no guessed stairs and no 8m-ring cutting. */
export function planBCPlaceEntries(options: BCPlaceEntryOptions = {}) {
  const entries: BCPlaceEntry[] = [],
    rejected: { index: number; reason: string }[] = [];
  for (let index = 0; index < 24; index++) {
    let threshold = 1.3,
      valid = true,
      reason = '';
    if (options.actualSurface) {
      for (let iteration = 0; iteration < 4; iteration++) {
        const e = entryAt(index, threshold, 'sampled-walk-surface'),
          samples: number[] = [];
        for (const du of [-2.8, 0, 2.8]) {
          // Probe just OUTSIDE the actual sloping shell at the prospective threshold.
          const a = e.angle + (du * e.halfAngle) / 3.4,
            p = bcPlaceWallPoint(a, threshold, -0.08),
            value = options.actualSurface(p[0], p[2], index);
          if (
            value === null ||
            value === undefined ||
            !Number.isFinite(value)
          ) {
            valid = false;
            reason = 'No selected actual walk surface';
            break;
          }
          samples.push(value);
        }
        if (!valid) break;
        if (Math.max(...samples) - Math.min(...samples) > 0.18) {
          valid = false;
          reason = 'Cross-door surface relief exceeds 18cm';
          break;
        }
        const next = Math.max(...samples) + 0.02;
        if (next < 0 || next > 3.6) {
          valid = false;
          reason =
            'Threshold outside retained low-entry band; no invented stairs or structural-ring cuts';
          break;
        }
        const delta = Math.abs(next - threshold);
        threshold = next;
        if (delta < 0.025) break;
        if (iteration === 3) {
          valid = false;
          reason = 'Surface/curved-shell threshold did not converge';
        }
      }
    }
    if (valid)
      entries.push(
        entryAt(
          index,
          threshold,
          options.actualSurface
            ? 'sampled-walk-surface'
            : 'legacy-representative',
        ),
      );
    else rejected.push({ index, reason });
  }
  return { entries, rejected };
}

class Surface {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  index: number[] = [];
  quad(a: XYZ, b: XYZ, c: XYZ, d: XYZ, color: Colour, desired?: XYZ) {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
      normal = ab.cross(ac);
    if (normal.lengthSq() < 1e-15)
      throw new Error('Degenerate BC envelope quad');
    const points = [a, b, c, d];
    if (desired && normal.dot(new THREE.Vector3(...desired)) < 0) {
      points.reverse();
      normal.negate();
    }
    normal.normalize();
    const base = this.p.length / 3,
      co = new THREE.Color(color),
      width = Math.hypot(...points[1].map((v, k) => v - points[0][k])),
      height = Math.hypot(...points[3].map((v, k) => v - points[0][k]));
    for (let i = 0; i < 4; i++) {
      this.p.push(...points[i]);
      this.n.push(normal.x, normal.y, normal.z);
      this.c.push(co.r, co.g, co.b);
      this.uv.push(i === 1 || i === 2 ? width : 0, i >= 2 ? height : 0);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.index);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
const angularDistance = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Replacement for ONLY the two outer bowl profile rows (0..12..30.5m).
 * Original inner bowl / cap / underside rows are left byte-for-byte in factory.
 */
export function createBCPlaceOuterWall(
  segments: number,
  entries: readonly BCPlaceEntry[],
): THREE.BufferGeometry {
  const out = new Surface(),
    cuts = Array.from({ length: segments + 1 }, (_, i) => (i / segments) * TAU);
  for (const e of entries)
    for (const a of [e.angle - e.halfAngle, e.angle + e.halfAngle])
      cuts.push((a + TAU) % TAU);
  cuts.sort((a, b) => a - b);
  const angles = cuts.filter((v, i) => !i || v - cuts[i - 1] > 1e-9);
  for (let i = 1; i < angles.length; i++) {
    const a = angles[i - 1],
      b = angles[i],
      mid = (a + b) / 2,
      entry = entries.find(
        (e) => Math.abs(angularDistance(mid, e.angle)) < e.halfAngle - 1e-8,
      );
    for (const [bottom, top] of [
      [0, 12],
      [12, 30.5],
    ]) {
      const ys = [bottom, top];
      if (entry)
        for (const y of [entry.thresholdY, entry.headY])
          if (y > bottom && y < top) ys.push(y);
      ys.sort((a, b) => a - b);
      for (let j = 1; j < ys.length; j++) {
        const y0 = ys[j - 1],
          y1 = ys[j];
        if (
          entry &&
          (y0 + y1) / 2 > entry.thresholdY &&
          (y0 + y1) / 2 < entry.headY
        )
          continue;
        out.quad(
          bcPlaceWallPoint(a, y0),
          bcPlaceWallPoint(b, y0),
          bcPlaceWallPoint(b, y1),
          bcPlaceWallPoint(a, y1),
          0x999e96,
          [Math.cos(mid), 0, Math.sin(mid)],
        );
      }
    }
  }
  return out.geometry();
}
/** Small saddle undulation lies INSIDE the previous smooth clerestory surface. */
export function bcPlaceEtfePoint(
  column: number,
  row: number,
  u: number,
  v: number,
  columns: number,
): XYZ {
  const y = 32 + (row + v) * 2.4,
    angle = ((column + u) / columns) * TAU,
    rx = 112.1 - 0.6 * ((y - 32) / 9.6),
    rz = 91.1 - 0.6 * ((y - 32) / 9.6),
    // Arch support between vertical borders. Adjacent row edges are continuous.
    inset =
      0.13 - 0.1 * Math.sin(Math.PI * u) * (2 * v - 1) * (row % 2 ? -1 : 1),
    c = Math.cos(angle),
    s = Math.sin(angle),
    length = Math.hypot(c / rx, s / rz);
  return [
    rx * c - (inset * c) / rx / length,
    y,
    rz * s - (inset * s) / rz / length,
  ];
}
export function bcPlaceEntryPoint(
  entry: BCPlaceEntry,
  u: number,
  y: number,
  inset: number,
): XYZ {
  return [
    entry.center[0] + entry.tangent[0] * u - entry.normal[0] * inset,
    y,
    entry.center[2] + entry.tangent[2] * u - entry.normal[2] * inset,
  ];
}

export function createBCPlaceEnvelope(
  detail: boolean,
  options: BCPlaceEntryOptions = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'BC Place / layered ETFE and recessed entry replacement';
  group.userData.nightMaterials = [];
  const plan = options.resolvedPlan ?? planBCPlaceEntries(options),
    film = new Surface(),
    trim = new Surface(),
    doors = new Surface(),
    columns = detail ? 432 : 144;
  // Four horizontal rows. Medium groups three narrow source-scale divisions.
  // Exact original radii/band heights remain; the panel tessellation is interpretive.
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < columns; col++)
      for (let u = 0; u < 2; u++) {
        const a = u / 2,
          b = (u + 1) / 2,
          angle = ((col + 0.5) / columns) * TAU;
        film.quad(
          bcPlaceEtfePoint(col, row, a, 0, columns),
          bcPlaceEtfePoint(col, row, b, 0, columns),
          bcPlaceEtfePoint(col, row, b, 1, columns),
          bcPlaceEtfePoint(col, row, a, 1, columns),
          [0x91a4a7, 0x859b9f, 0x9daeb0, 0x8d9fa1][
            (row + Math.floor(col / 12)) % 4
          ],
          [Math.cos(angle), 0, Math.sin(angle)],
        );
      }
  // Three internal horizontal seams, matching the four film rows. Retained
  // lower structure / roof closure handle the two outer edges. Ring curvature
  // needs fewer segments than the narrow ETFE cells; avoid duplicate masts.
  const seamSegments = detail ? 144 : 72;
  for (const y of [34.4, 36.8, 39.2])
    for (let i = 0; i < seamSegments; i++) {
      const a = (i / seamSegments) * TAU,
        b = ((i + 1) / seamSegments) * TAU,
        mid = (a + b) / 2;
      const point = (angle: number, yy: number): XYZ => {
        const t = (yy - 32) / 9.6;
        return [
          (112.1 - 0.6 * t - 0.005) * Math.cos(angle),
          yy,
          (91.1 - 0.6 * t - 0.005) * Math.sin(angle),
        ];
      };
      const y0 = Math.max(32, y - 0.035),
        y1 = Math.min(41.6, y + 0.035);
      trim.quad(
        point(a, y0),
        point(b, y0),
        point(b, y1),
        point(a, y1),
        0xbac5c0,
        [Math.cos(mid), 0, Math.sin(mid)],
      );
    }
  // Flexible closure between retained clerestory and original roof edge. It is
  // an accordion-like visual joint, not a structural deformation simulation.
  const n = detail ? 144 : 72,
    closure = [
      { y: 41.6, x: 111.5, z: 90.5 },
      { y: 41.88, x: 111.28, z: 90.28 },
      { y: 42.12, x: 111.78, z: 90.78 },
      { y: 42.6, x: 112, z: 91 },
    ];
  for (let j = 1; j < closure.length; j++)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU,
        b = ((i + 1) / n) * TAU,
        p = closure[j - 1],
        q = closure[j];
      trim.quad(
        [p.x * Math.cos(a), p.y, p.z * Math.sin(a)],
        [p.x * Math.cos(b), p.y, p.z * Math.sin(b)],
        [q.x * Math.cos(b), q.y, q.z * Math.sin(b)],
        [q.x * Math.cos(a), q.y, q.z * Math.sin(a)],
        0x6f807f,
        [Math.cos((a + b) / 2), 0, Math.sin((a + b) / 2)],
      );
    }
  for (const e of plan.entries) {
    const { thresholdY: bottom, headY: top, angle, halfAngle } = e,
      left = angle - halfAngle,
      right = angle + halfAngle,
      p = (u: number, y: number, d: number) => bcPlaceEntryPoint(e, u, y, d),
      l = -3.35,
      r = 3.35;
    const fa = bcPlaceWallPoint(left, bottom),
      fb = bcPlaceWallPoint(right, bottom),
      fc = bcPlaceWallPoint(right, top),
      fd = bcPlaceWallPoint(left, top),
      back = 2;
    // True outer-shell aperture with deep jambs, soffit and a contained threshold.
    trim.quad(fa, p(l, bottom, back), p(l, top, back), fd, 0x697672, e.tangent);
    trim.quad(p(r, bottom, back), fb, fc, p(r, top, back), 0x697672, [
      -e.tangent[0],
      0,
      -e.tangent[2],
    ]);
    trim.quad(fd, p(l, top, back), p(r, top, back), fc, 0x7e8880, [0, -1, 0]);
    trim.quad(
      fa,
      fb,
      p(r, bottom, back),
      p(l, bottom, back),
      0xa1a89e,
      [0, 1, 0],
    );
    // Six interpreted leaves; no real gate letters, signs, advertising or handles per bolt.
    for (let leaf = 0; leaf < 6; leaf++) {
      const a = l + 0.08 + leaf * (6.54 / 6),
        b = l + 0.08 + (leaf + 1) * (6.54 / 6) - 0.055;
      doors.quad(
        p(a, bottom + 0.12, back),
        p(b, bottom + 0.12, back),
        p(b, top - 0.18, back),
        p(a, top - 0.18, back),
        leaf % 2 ? 0x29474e : 0x354f53,
        e.normal,
      );
      trim.quad(
        p(a - 0.025, bottom + 0.06, back - 0.075),
        p(a + 0.025, bottom + 0.06, back - 0.075),
        p(a + 0.025, top - 0.06, back - 0.075),
        p(a - 0.025, top - 0.06, back - 0.075),
        0x929f9d,
        e.normal,
      );
      if (detail) {
        const u = (a + b) / 2;
        trim.quad(
          p(u - 0.1, bottom + 1.12, back - 0.14),
          p(u + 0.1, bottom + 1.12, back - 0.14),
          p(u + 0.1, bottom + 1.18, back - 0.14),
          p(u - 0.1, bottom + 1.18, back - 0.14),
          0xc0c7c0,
          e.normal,
        );
        trim.quad(
          p(a, bottom + 0.78, back - 0.02),
          p(b, bottom + 0.78, back - 0.02),
          p(b, bottom + 0.82, back - 0.02),
          p(a, bottom + 0.82, back - 0.02),
          0x5e7174,
          e.normal,
        );
      }
    }
    for (const [a, b, y0, y1] of [
      [l, r, bottom, bottom + 0.08],
      [l, r, top - 0.1, top],
      [l, l + 0.07, bottom, top],
      [r - 0.07, r, bottom, top],
    ])
      trim.quad(
        p(a, y0, back - 0.08),
        p(b, y0, back - 0.08),
        p(b, y1, back - 0.08),
        p(a, y1, back - 0.08),
        0xaab5ae,
        e.normal,
      );
  }
  for (const [
    surface,
    name,
    role,
    roughness,
    metalness,
    emissive,
    intensity,
  ] of [
    [
      film,
      'BC Place / single-layer ETFE saddle panels',
      'etfe',
      0.52,
      0.025,
      0x83a7ad,
      0.5,
    ],
    [
      trim,
      'BC Place / closure, clamps and entrance reveals',
      'trim',
      0.7,
      0.12,
      0,
      0,
    ],
    [
      doors,
      'BC Place / inset representative entrance glass',
      'entry-glass',
      0.27,
      0.22,
      0xcca777,
      0.18,
    ],
  ] as const) {
    if (!surface.index.length) continue;
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness,
        metalness,
        emissive,
        emissiveIntensity: 0,
      }),
      mesh = new THREE.Mesh(surface.geometry(), material);
    mesh.name = name;
    mesh.userData.role = role;
    mesh.castShadow = role === 'trim';
    mesh.receiveShadow = true;
    group.add(mesh);
    if (intensity) {
      material.userData.nightIntensity = intensity;
      group.userData.nightMaterials.push({ material, intensity });
    }
  }
  const bounds = new THREE.Box3().setFromObject(group);
  let triangles = 0,
    bytes = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      triangles += o.geometry.index!.count / 3;
      for (const a of Object.values(
        o.geometry.attributes,
      ) as THREE.BufferAttribute[])
        bytes += a.array.byteLength;
      bytes += o.geometry.index!.array.byteLength;
    }
  });
  Object.assign(group.userData, {
    detail,
    entries: plan.entries,
    rejectedEntries: plan.rejected,
    contract: BC_PLACE_ENVELOPE_CONTRACT,
    originalProceduralAsset: true,
    triangles,
    drawCalls: group.children.length,
    geometryBytes: bytes,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    solidFootprints: [],
    thresholdStatus:
      options.resolvedPlan || options.actualSurface
        ? 'Selected actual walk-surface callback; unsafe entries skipped'
        : 'Legacy 1.3m local datum; site contact unverified',
  });
  return group;
}
