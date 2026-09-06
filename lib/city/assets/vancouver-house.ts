/** Original Vancouver House balcony-depth study. MIT, 2026.
 * Preserves the current app's placement, height, per-floor projected envelope,
 * and 49m square podium allowance. This is a bounded appearance replacement,
 * not a survey-correct reconstruction of the actual triangular base.
 * See prototype-vancouver-house-notes.md for official references and limits.
 */
import * as THREE from 'three';

type XZ = readonly [number, number];
type XYZ = readonly [number, number, number];
type Colour = THREE.ColorRepresentation;
export const VANCOUVER_HOUSE_CONTRACT = {
  placement: { lon: -123.131029, lat: 49.2749256, yaw: -0.78 },
  // No baseY override: LandmarkDetail must retain elevation(lon,lat).
  storeys: 49,
  storeyM: 3.2,
  topY: 156.85,
  podium: { width: 49, depth: 49, topY: 25 },
  sourceIds: ['osm-742009401', 'osm-1092241825'],
  geometryStatus:
    'Original interpretation within the previous model envelope; source-map exclusion remains unchanged.',
  glassStatus:
    'Opaque PBR back glazing; clear balustrades simplified to fine rails, no transparent interior simulation.',
} as const;

/** EXACT existing floor footprint formula; no added global twist / yaw. */
export function vancouverHouseFloor(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 48)
    throw new Error('Floor index must be 0..48');
  const t = index / 48,
    width = 15 + 29 * Math.pow(t, 0.55),
    shift = (1 - t) * 11;
  return {
    index,
    y: index * 3.2,
    width,
    shift,
    outerWidth: width + 1.8,
    outerDepth: 36.5,
  };
}

/** Allowed envelope of the existing podium + each original slab projection.
 * This is a conservative collision/placement bound, not a union of old solids.
 */
export function inVancouverHouseEnvelope(
  x: number,
  y: number,
  z: number,
  epsilon = 1e-5,
) {
  if (![x, y, z].every(Number.isFinite) || y < -epsilon || y > 156.85 + epsilon)
    return false;
  if (
    y <= 25 + epsilon &&
    Math.abs(x) <= 24.5 + epsilon &&
    Math.abs(z) <= 24.5 + epsilon
  )
    return true;
  for (
    let i = Math.max(0, Math.floor(y / 3.2) - 1);
    i <= Math.min(48, Math.floor(y / 3.2));
    i++
  ) {
    const p = vancouverHouseFloor(i);
    if (
      y >= p.y - epsilon &&
      y <= p.y + 3.25 + epsilon &&
      Math.abs(x - p.shift) <= p.outerWidth / 2 + epsilon &&
      Math.abs(z) <= 18.25 + epsilon
    )
      return true;
  }
  return false;
}

class Batch {
  positions: number[] = [];
  normals: number[] = [];
  uv: number[] = [];
  colours: number[] = [];
  indices: number[] = [];
  name: string;
  role: string;
  material: THREE.MeshStandardMaterial;
  nightIntensity: number;
  constructor(
    name: string,
    role: string,
    roughness: number,
    metalness = 0,
    nightIntensity = 0,
  ) {
    this.name = name;
    this.role = role;
    this.nightIntensity = nightIntensity;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
      emissive: nightIntensity ? 0xffd2a0 : 0x000000,
      emissiveIntensity: 0,
    });
  }
  quad(a: XYZ, b: XYZ, c: XYZ, d: XYZ, colour: Colour, desired?: XYZ) {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.clone().cross(ac);
    if (n.lengthSq() < 1e-15)
      throw new Error(`Degenerate quad in ${this.name}`);
    const points: XYZ[] = [a, b, c, d];
    if (desired && n.dot(new THREE.Vector3(...desired)) < 0) {
      points.reverse();
      n.negate();
    }
    n.normalize();
    const base = this.positions.length / 3,
      co = new THREE.Color(colour);
    const width = Math.hypot(...points[1].map((v, k) => v - points[0][k])),
      height = Math.hypot(...points[3].map((v, k) => v - points[0][k]));
    for (let i = 0; i < 4; i++) {
      this.positions.push(...points[i]);
      this.normals.push(n.x, n.y, n.z);
      this.colours.push(co.r, co.g, co.b);
      this.uv.push(i === 1 || i === 2 ? width : 0, i >= 2 ? height : 0);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  box(
    min: XYZ,
    max: XYZ,
    colour: Colour,
    transform: (p: XYZ) => XYZ = (p) => p,
  ) {
    const [x0, y0, z0] = min,
      [x1, y1, z1] = max;
    const p = (x: number, y: number, z: number) => transform([x, y, z]);
    this.quad(
      p(x0, y0, z1),
      p(x1, y0, z1),
      p(x1, y1, z1),
      p(x0, y1, z1),
      colour,
    );
    this.quad(
      p(x1, y0, z0),
      p(x0, y0, z0),
      p(x0, y1, z0),
      p(x1, y1, z0),
      colour,
    );
    this.quad(
      p(x1, y0, z1),
      p(x1, y0, z0),
      p(x1, y1, z0),
      p(x1, y1, z1),
      colour,
    );
    this.quad(
      p(x0, y0, z0),
      p(x0, y0, z1),
      p(x0, y1, z1),
      p(x0, y1, z0),
      colour,
    );
    this.quad(
      p(x0, y1, z1),
      p(x1, y1, z1),
      p(x1, y1, z0),
      p(x0, y1, z0),
      colour,
    );
    this.quad(
      p(x0, y0, z0),
      p(x1, y0, z0),
      p(x1, y0, z1),
      p(x0, y0, z1),
      colour,
    );
  }
  finish(group: THREE.Group) {
    if (!this.indices.length) {
      this.material.dispose();
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = this.name;
    mesh.castShadow = this.role !== 'glass' && this.role !== 'night';
    mesh.receiveShadow = true;
    mesh.userData.role = this.role;
    group.add(mesh);
    if (this.nightIntensity) {
      this.material.userData.nightIntensity = this.nightIntensity;
      group.userData.nightMaterials.push({
        material: this.material,
        intensity: this.nightIntensity,
      });
    }
    // Do not retain temporary number arrays after the typed buffers have been built.
    this.positions = [];
    this.normals = [];
    this.uv = [];
    this.colours = [];
    this.indices = [];
  }
}

type Facade = {
  a: XZ;
  b: XZ;
  length: number;
  point: (u: number, y: number, inset: number) => XYZ;
  normal: XYZ;
};
function rectangleFacades(width: number, depth: number, shift = 0): Facade[] {
  const r: XZ[] = [
    [shift - width / 2, -depth / 2],
    [shift + width / 2, -depth / 2],
    [shift + width / 2, depth / 2],
    [shift - width / 2, depth / 2],
  ];
  return r.map((a, i) => {
    const b = r[(i + 1) % 4],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      tx = (b[0] - a[0]) / length,
      tz = (b[1] - a[1]) / length,
      nx = tz,
      nz = -tx;
    return {
      a,
      b,
      length,
      normal: [nx, 0, nz] as XYZ,
      point: (u: number, y: number, inset: number): XYZ => [
        a[0] + tx * u - nx * inset,
        y,
        a[1] + tz * u - nz * inset,
      ],
    };
  });
}

/** Alternating half-bay courses, clipped to consistent corner returns. */
export function vancouverHouseBays(
  length: number,
  floor: number,
  target = 5.2,
): [number, number][] {
  const count = Math.max(1, Math.round((length - 0.8) / target)),
    pitch = (length - 0.8) / count,
    start = 0.4,
    end = length - 0.4,
    cuts = [start, end];
  const phase = floor % 2 ? 0.5 : 0;
  for (let i = 0; i <= count; i++) {
    const u = start + (i + phase) * pitch;
    if (u > start + 0.01 && u < end - 0.01) cuts.push(u);
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).map((b, i) => [cuts[i], b]);
}

export function createVancouverHouse(detail: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Vancouver House / recessed balcony lattice';
  group.userData.nightMaterials = [];
  const white = new Batch(
      'Vancouver House / white slabs and privacy returns',
      'structure',
      0.69,
      0.08,
    ),
    core = new Batch(
      'Vancouver House / deep interior and soffits',
      'interior',
      0.87,
      0.01,
    ),
    glass = new Batch(
      'Vancouver House / recessed glazing',
      'glass',
      0.25,
      0.22,
    ),
    frames = new Batch(
      'Vancouver House / dark mullions and clear-guard frames',
      'metal',
      0.42,
      0.45,
    ),
    bronze = new Batch(
      'Vancouver House / restrained warm balcony lining',
      'metal',
      0.52,
      0.4,
    ),
    night = new Batch(
      'Vancouver House / selected warm back glazing',
      'night',
      0.29,
      0.16,
      0.32,
    ),
    roof = new Batch(
      'Vancouver House / recessed roof and podium tops',
      'roof',
      0.87,
      0.03,
    );
  const whiteColor = 0xd9dcd8,
    glassColors = [0x50626a, 0x657780, 0x445860, 0x76888d];
  let pocketCount = 0,
    railCount = 0;
  const pocketProbes: {
    floor: number;
    face: number;
    u: number;
    origin: XYZ;
    direction: XYZ;
    expectedDepth: number;
  }[] = [];
  const facingQuad = (
    batch: Batch,
    face: Facade,
    left: number,
    right: number,
    bottom: number,
    top: number,
    inset: number,
    colour: Colour,
  ) =>
    batch.quad(
      face.point(left, bottom, inset),
      face.point(right, bottom, inset),
      face.point(right, top, inset),
      face.point(left, top, inset),
      colour,
      face.normal,
    );
  const localBox = (
    batch: Batch,
    face: Facade,
    min: XYZ,
    max: XYZ,
    colour: Colour,
  ) => batch.box(min, max, colour, ([u, y, d]) => face.point(u, y, d));
  // Attached fine profiles omit their hidden backs / slab-connected end caps.
  const verticalReveal = (
    batch: Batch,
    face: Facade,
    l: number,
    r: number,
    bottom: number,
    top: number,
    front: number,
    back: number,
    colour: Colour,
  ) => {
    facingQuad(batch, face, l, r, bottom, top, front, colour);
    batch.quad(
      face.point(l, bottom, front),
      face.point(l, bottom, back),
      face.point(l, top, back),
      face.point(l, top, front),
      colour,
    );
    batch.quad(
      face.point(r, bottom, back),
      face.point(r, bottom, front),
      face.point(r, top, front),
      face.point(r, top, back),
      colour,
    );
  };
  const horizontalReveal = (
    batch: Batch,
    face: Facade,
    l: number,
    r: number,
    bottom: number,
    top: number,
    front: number,
    back: number,
    colour: Colour,
  ) => {
    facingQuad(batch, face, l, r, bottom, top, front, colour);
    batch.quad(
      face.point(l, top, front),
      face.point(r, top, front),
      face.point(r, top, back),
      face.point(l, top, back),
      colour,
      [0, 1, 0],
    );
    batch.quad(
      face.point(l, bottom, back),
      face.point(r, bottom, back),
      face.point(r, bottom, front),
      face.point(l, bottom, front),
      colour,
      [0, -1, 0],
    );
  };

  // The opaque rectangular podium is rebuilt with physically recessed glazed bays.
  // Its exact old outer bounds/25m top are retained; adjoining triangle buildings
  // and a new navigable interior are deliberately outside this bounded replacement.
  core.box([-23, 0, -23], [23, 25, 23], 0x465358);
  for (let floor = 0; floor < 5; floor++) {
    const y = floor * 5;
    white.box([-24.5, y, -24.5], [24.5, y + 0.27, 24.5], whiteColor);
    for (const face of rectangleFacades(49, 49)) {
      const bays = vancouverHouseBays(49, 0, 6);
      for (const [left, right] of bays) {
        facingQuad(
          glass,
          face,
          left + 0.13,
          right - 0.13,
          y + 0.35,
          y + 4.66,
          1.42,
          0x526c78,
        );
        localBox(
          white,
          face,
          [left - 0.11, y + 0.27, 0.0],
          [left + 0.11, y + 4.76, 1.5],
          whiteColor,
        );
        if (detail)
          verticalReveal(
            frames,
            face,
            (left + right) / 2 - 0.035,
            (left + right) / 2 + 0.035,
            y + 0.35,
            y + 4.66,
            1.32,
            1.42,
            0x424c50,
          );
      }
      localBox(
        white,
        face,
        [48.49, y + 0.27, 0],
        [48.71, y + 4.76, 1.5],
        whiteColor,
      );
      facingQuad(core, face, 0.4, 48.6, y + 4.66, y + 4.88, 1.4, 0x677374);
    }
  }
  roof.box([-24.5, 24.82, -24.5], [24.5, 25, 24.5], 0x93988e);

  // Original overall curve and 49 floor count retained. Glass is 1.72m behind
  // the outer frame, so both the front opening and side returns have real depth.
  for (let floor = 0; floor < 49; floor++) {
    const p = vancouverHouseFloor(floor),
      y = p.y,
      inset = 1.72;
    // Lower floors inside the preserved podium are intentionally not allocated twice.
    if (y + 3.25 <= 25) continue;
    core.box(
      [p.shift - p.outerWidth / 2 + 1.75, y + 0.12, -16.5],
      [p.shift + p.outerWidth / 2 - 1.75, y + 2.97, 16.5],
      0x39484b,
    );
    white.box(
      [p.shift - p.outerWidth / 2, y + 0.02, -18.25],
      [p.shift + p.outerWidth / 2, y + 0.32, 18.25],
      whiteColor,
    );
    const faces = rectangleFacades(p.outerWidth, p.outerDepth, p.shift);
    faces.forEach((face, faceIndex) => {
      const bays = vancouverHouseBays(face.length, floor);
      const bottom = y + 0.36,
        top = y + 2.91;
      // Every return has two visible pocket side faces plus a white front face;
      // no internal back/top/bottom faces or per-return meshes are needed.
      const boundaryCuts = [...bays.map((b) => b[0]), bays[bays.length - 1][1]];
      for (const u of boundaryCuts) {
        const l = Math.max(0.02, u - 0.14),
          r = Math.min(face.length - 0.02, u + 0.14),
          d = inset + 0.015;
        facingQuad(white, face, l, r, y + 0.32, y + 3.2, 0.02, whiteColor);
        white.quad(
          face.point(l, y + 0.32, 0.02),
          face.point(l, y + 0.32, d),
          face.point(l, y + 3.2, d),
          face.point(l, y + 3.2, 0.02),
          0xd5d7d1,
        );
        white.quad(
          face.point(r, y + 0.32, d),
          face.point(r, y + 0.32, 0.02),
          face.point(r, y + 3.2, 0.02),
          face.point(r, y + 3.2, d),
          0xd5d7d1,
        );
      }
      for (let bay = 0; bay < bays.length; bay++) {
        const [from, to] = bays[bay],
          left = from + 0.145,
          right = to - 0.145;
        if (right - left < 0.25) continue;
        const seed = (floor * 67 + faceIndex * 31 + bay * 17) % 97,
          warm = seed % 7 === 0;
        const material = warm ? night : glass,
          colour = glassColors[seed % glassColors.length];
        facingQuad(material, face, left, right, bottom, top, inset, colour);
        // Alternate a few sheltered copper-tone returns; no furnishings or business marks.
        if (detail && seed % 9 === 0 && right - left > 2.5)
          bronze.quad(
            face.point(left, bottom, 0.12),
            face.point(left, bottom, 1.58),
            face.point(left, top, 1.58),
            face.point(left, top, 0.12),
            0x8d7056,
            [
              (face.b[0] - face.a[0]) / face.length,
              0,
              (face.b[1] - face.a[1]) / face.length,
            ],
          );
        if (detail) {
          verticalReveal(
            frames,
            face,
            (left + right) / 2 - 0.028,
            (left + right) / 2 + 0.028,
            bottom,
            top,
            inset - 0.07,
            inset - 0.008,
            0x566265,
          );
          // Thin guard rails keep the centre of the recess open. No city-wide transparency pass.
          horizontalReveal(
            frames,
            face,
            left,
            right,
            y + 1.38,
            y + 1.42,
            0.18,
            0.23,
            0x8a9695,
          );
          railCount++;
          if (right - left > 3.4)
            verticalReveal(
              frames,
              face,
              (left + right) / 2 - 0.022,
              (left + right) / 2 + 0.022,
              y + 0.36,
              y + 1.38,
              0.18,
              0.23,
              0x7d8a8b,
            );
        } else {
          facingQuad(
            frames,
            face,
            left,
            right,
            y + 1.38,
            y + 1.42,
            0.2,
            0x7b8a8d,
          );
        }
        // Recessed soffit starts behind the front edge, where it can actually cast shade.
        core.quad(
          face.point(left, y + 3.19, 0.16),
          face.point(right, y + 3.19, 0.16),
          face.point(right, y + 3.19, inset),
          face.point(left, y + 3.19, inset),
          0x8a8f88,
          [0, -1, 0],
        );
        pocketCount++;
        if (faceIndex === 0 && bay === 1 && floor >= 8)
          pocketProbes.push({
            floor,
            face: faceIndex,
            u: left * 0.65 + right * 0.35,
            origin: face.point(left * 0.65 + right * 0.35, y + 2, -3),
            direction: [-face.normal[0], 0, -face.normal[2]],
            expectedDepth: 3 + inset,
          });
      }
    });
  }
  // Top datum EXACTLY 156.85m; a recessed roof replaces a featureless final lid.
  const cap = vancouverHouseFloor(48),
    x0 = cap.shift - cap.outerWidth / 2,
    x1 = cap.shift + cap.outerWidth / 2;
  white.box([x0, 156.48, -18.25], [x1, 156.85, -17.87], whiteColor);
  white.box([x0, 156.48, 17.87], [x1, 156.85, 18.25], whiteColor);
  white.box([x0, 156.48, -17.87], [x0 + 0.38, 156.85, 17.87], whiteColor);
  white.box([x1 - 0.38, 156.48, -17.87], [x1, 156.85, 17.87], whiteColor);
  roof.box([x0 + 0.38, 156.4, -17.87], [x1 - 0.38, 156.48, 17.87], 0x90948b);
  if (detail)
    for (const x of [-9, -3, 3, 9]) {
      frames.box([x - 1.6, 156.48, -3], [x + 1.6, 156.72, 3], 0x667171);
      for (let z = -2.6; z < 2.7; z += 0.65)
        frames.box([x - 1.5, 156.72, z], [x + 1.5, 156.78, z + 0.08], 0x969d98);
    }
  for (const batch of [white, core, glass, frames, bronze, night, roof])
    batch.finish(group);
  const bounds = new THREE.Box3().setFromObject(group);
  let triangles = 0,
    bytes = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      triangles += (o.geometry.index?.count ?? 0) / 3;
      for (const a of Object.values(
        o.geometry.attributes,
      ) as THREE.BufferAttribute[])
        bytes += a.array.byteLength;
      bytes += o.geometry.index?.array.byteLength ?? 0;
    }
  });
  Object.assign(group.userData, {
    placement: { ...VANCOUVER_HOUSE_CONTRACT.placement },
    // Existing mapped landmark-footprints.json remains authoritative. The old
    // Builder added no water footprint here (actual base14.14m > 2m cutoff).
    solidFootprints: [],
    originalProceduralAsset: true,
    detail,
    units: 'metres',
    axes: '+Y up; local XZ; placement yaw unchanged',
    triangles,
    drawCalls: group.children.length,
    geometryBytes: bytes,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    contract: VANCOUVER_HOUSE_CONTRACT,
    pocketCount,
    railCount,
    pocketProbes,
  });
  return group;
}
