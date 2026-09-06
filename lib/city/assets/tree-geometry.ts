import * as THREE from 'three';

export type TreeDetail = 'medium' | 'ultra';
export interface TreeGeometry {
  trunk: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
}

/** Atlas image order: maple, alder / Douglas-fir, western redcedar. */
export const TREE_ATLAS_CELLS = {
  maple: 0,
  alder: 1,
  douglasFir: 2,
  westernRedcedar: 3,
} as const;

// Measured green interior pixels in foliage-atlas-rgb.png (1254 square).
// aSolid also marks the internal volume so material decoding can preserve it.
export const TREE_SOLID_UV: ReadonlyArray<readonly [number, number]> = [
  [0.413476874, 0.6877990431],
  [0.7531897927, 0.7962519936],
  // Midtone fir needle at image pixel (208,739); the former (351,1116)
  // was a deep shadow RGB(22,46,5), making the opaque crown almost black.
  [0.16626794258373206, 0.4102870813397129],
  [0.6973684211, 0.2388357257],
];

type V3 = THREE.Vector3;
type UV = readonly [number, number];
type RGB = readonly [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function v(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}
function frame(direction: V3) {
  const axis = direction.clone().normalize();
  const helper = Math.abs(axis.y) > 0.92 ? v(1, 0, 0) : UP;
  const right = helper.clone().cross(axis).normalize();
  const across = axis.clone().cross(right).normalize();
  return { axis, right, across };
}
function atlasUV(cell: number, u: number, w: number): UV {
  const pad = 0.008;
  return [
    ((cell % 2) + pad + u * (1 - pad * 2)) / 2,
    (1 - Math.floor(cell / 2) + pad + w * (1 - pad * 2)) / 2,
  ];
}

class Surface {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  solid: number[] = [];
  triangle(
    a: V3,
    b: V3,
    c: V3,
    uv: readonly UV[],
    tint: RGB,
    normals?: readonly V3[],
    solid = 0,
  ) {
    const normal = normals
      ? null
      : b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const [i, point] of [a, b, c].entries()) {
      this.positions.push(point.x, Math.max(0, point.y), point.z);
      this.normals.push(...(normals?.[i] || normal!).toArray());
      this.uvs.push(...uv[i]);
      this.colors.push(...tint);
      this.solid.push(solid);
    }
  }
  finish(name: string) {
    const g = new THREE.BufferGeometry();
    g.name = name;
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aSolid', new THREE.Float32BufferAttribute(this.solid, 1));
    return g;
  }
}

/** Curved, tapered branch with longitudinal bark UVs and non-circular ridges. */
function branch(
  out: Surface,
  path: V3[],
  radii: number[],
  sides: number,
  seed: number,
  cap = false,
) {
  const random = rng(seed),
    rings: V3[][] = [],
    normals: V3[][] = [];
  const lengths = [0];
  for (let i = 1; i < path.length; i++)
    lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  const flute = Array.from({ length: sides }, () => 0.86 + random() * 0.27);
  const phase = random() * TAU;
  for (let j = 0; j < path.length; j++) {
    const f = frame(
      path[Math.min(path.length - 1, j + 1)]
        .clone()
        .sub(path[Math.max(0, j - 1)]),
    );
    rings[j] = [];
    normals[j] = [];
    for (let i = 0; i < sides; i++) {
      const a = phase + (i / sides) * TAU;
      const radial = f.right
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(f.across, Math.sin(a));
      normals[j].push(radial);
      rings[j].push(
        path[j].clone().addScaledVector(radial, radii[j] * flute[i]),
      );
    }
  }
  const tint: RGB = [
    0.9 + random() * 0.1,
    0.87 + random() * 0.1,
    0.82 + random() * 0.12,
  ];
  for (let j = 0; j < path.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const k = (i + 1) % sides;
      const a: UV = [i / sides, lengths[j] * 3],
        b: UV = [(i + 1) / sides, lengths[j] * 3];
      const c: UV = [i / sides, lengths[j + 1] * 3],
        d: UV = [(i + 1) / sides, lengths[j + 1] * 3];
      out.triangle(rings[j][i], rings[j][k], rings[j + 1][i], [a, b, c], tint, [
        normals[j][i],
        normals[j][k],
        normals[j + 1][i],
      ]);
      out.triangle(
        rings[j][k],
        rings[j + 1][k],
        rings[j + 1][i],
        [b, d, c],
        tint,
        [normals[j][k], normals[j + 1][k], normals[j + 1][i]],
      );
    }
  }
  if (cap) {
    const last = path.length - 1;
    for (let i = 1; i < sides - 1; i++) {
      out.triangle(
        rings[0][0],
        rings[0][i + 1],
        rings[0][i],
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        tint,
      );
      out.triangle(
        rings[last][0],
        rings[last][i],
        rings[last][i + 1],
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        tint,
      );
    }
  }
}

/** An irregular lofted tuft; no sphere/cone primitive is used. */
function tuft(
  out: Surface,
  center: V3,
  size: V3,
  direction: V3,
  cell: number,
  random: () => number,
  ultra: boolean,
) {
  const { axis, right, across } = frame(direction);
  const n = 5;
  const rings: V3[][] = [],
    normals: V3[][] = [];
  const levels = ultra ? [-0.42, 0.4] : [0];
  const world = (x: number, y: number, z: number) =>
    center
      .clone()
      .addScaledVector(right, x * size.x)
      .addScaledVector(across, y * size.y)
      .addScaledVector(axis, z * size.z);
  const normal = (x: number, y: number, z: number) =>
    right
      .clone()
      .multiplyScalar(x / size.x)
      .addScaledVector(across, y / size.y)
      .addScaledVector(axis, z / size.z)
      .normalize();
  const low = world(-0.11, 0.03, -0.97),
    high = world(0.09, -0.05, 1.03);
  const tint: RGB = [
    0.82 + random() * 0.14,
    0.87 + random() * 0.13,
    0.76 + random() * 0.16,
  ];
  const sample = TREE_SOLID_UV[cell];
  const uv = [sample, sample, sample];
  for (const [j, z] of levels.entries()) {
    rings[j] = [];
    normals[j] = [];
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * TAU + j * 0.17;
      const radius = 0.78 + random() * 0.27;
      const x = Math.cos(theta) * radius,
        y = Math.sin(theta) * radius;
      rings[j].push(world(x, y, z + (random() - 0.5) * 0.1));
      normals[j].push(normal(x, y, z));
    }
  }
  const last = levels.length - 1;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    out.triangle(
      low,
      rings[0][k],
      rings[0][i],
      uv,
      tint,
      [axis.clone().negate(), normals[0][k], normals[0][i]],
      1,
    );
    out.triangle(
      high,
      rings[last][i],
      rings[last][k],
      uv,
      tint,
      [axis, normals[last][i], normals[last][k]],
      1,
    );
    if (ultra) {
      out.triangle(
        rings[0][i],
        rings[0][k],
        rings[1][i],
        uv,
        tint,
        [normals[0][i], normals[0][k], normals[1][i]],
        1,
      );
      out.triangle(
        rings[0][k],
        rings[1][k],
        rings[1][i],
        uv,
        tint,
        [normals[0][k], normals[1][k], normals[1][i]],
        1,
      );
    }
  }
}

/** Six vertices/four triangles make a folded leaf spray, never a camera billboard. */
function spray(
  out: Surface,
  center: V3,
  direction: V3,
  width: number,
  height: number,
  roll: number,
  cell: number,
  tint: RGB,
) {
  const { axis, right, across } = frame(direction);
  const horizontal = right
    .clone()
    .multiplyScalar(Math.cos(roll))
    .addScaledVector(across, Math.sin(roll));
  const normal = horizontal.clone().cross(axis).normalize();
  const point = (x: number, y: number) =>
    center
      .clone()
      .addScaledVector(horizontal, x * width)
      .addScaledVector(axis, y * height)
      .addScaledVector(normal, (1 - Math.abs(x * 2)) * width * 0.18);
  const lb = point(-0.5, -0.5),
    mb = point(0, -0.5),
    rb = point(0.5, -0.5);
  const lt = point(-0.5, 0.5),
    mt = point(0, 0.5),
    rt = point(0.5, 0.5);
  const uv = (x: number, y: number) => atlasUV(cell, x, y);
  out.triangle(lb, mb, lt, [uv(0, 0), uv(0.5, 0), uv(0, 1)], tint);
  out.triangle(mb, mt, lt, [uv(0.5, 0), uv(0.5, 1), uv(0, 1)], tint);
  out.triangle(mb, rb, mt, [uv(0.5, 0), uv(1, 0), uv(0.5, 1)], tint);
  out.triangle(rb, rt, mt, [uv(1, 0), uv(1, 1), uv(0.5, 1)], tint);
}

export function createTreeGeometry(
  conifer: boolean,
  variant: number,
  detail: TreeDetail,
): TreeGeometry {
  const vi = Number.isFinite(variant) ? ((Math.floor(variant) % 3) + 3) % 3 : 0;
  const ultra = detail === 'ultra';
  const random = rng((conifer ? 0x732b915 : 0x41f615d) + vi * 12347);
  const wood = new Surface(),
    leaves = new Surface();
  let branchSeed = 100 + vi * 379;
  const cell = conifer ? (vi === 1 ? 3 : 2) : vi === 1 ? 1 : 0;
  const shoot = (points: V3[], radii: number[], sides: number, cap = false) =>
    branch(wood, points, radii, sides, branchSeed++, cap);
  const cluster = (p: V3, direction: V3, scale: number) => {
    const size = conifer
      ? v(scale * 0.8, scale * 0.55, scale)
      : v(scale * 1.06, scale * 0.92, scale);
    tuft(leaves, p, size, direction, cell, random, ultra);
    const count = ultra ? (conifer ? 5 : 12) : conifer ? 2 : 4;
    for (let k = 0; k < count; k++) {
      const azimuth = k * 2.399963 + random() * 0.8;
      const y = 1 - ((k + 0.5) / count) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const radial = v(Math.cos(azimuth) * rr, y, Math.sin(azimuth) * rr);
      const position = p
        .clone()
        .addScaledVector(radial, scale * (0.48 + random() * 0.36));
      const orientation = direction
        .clone()
        .multiplyScalar(conifer ? 0.7 : 0.25)
        .addScaledVector(radial, 0.75)
        .add(v(0, 0.2, 0))
        .normalize();
      const tint: RGB = [
        0.84 + random() * 0.15,
        0.9 + random() * 0.1,
        0.8 + random() * 0.17,
      ];
      spray(
        leaves,
        position,
        orientation,
        scale * (conifer ? 1.5 : 1.65),
        scale * (conifer ? 1.9 : 1.7),
        random() * TAU,
        cell,
        tint,
      );
    }
  };
  const lean = v((random() - 0.5) * 0.028, 0, (random() - 0.5) * 0.028);
  const trunkHeight = conifer ? 0.95 : 0.78;
  const trunkSteps = ultra ? 8 : 4;
  const trunkPath: V3[] = [],
    trunkRadii: number[] = [];
  for (let j = 0; j <= trunkSteps; j++) {
    const t = j / trunkSteps;
    trunkPath.push(
      v(
        lean.x * t + Math.sin(t * 4 + vi) * 0.007 * t,
        t * trunkHeight,
        lean.z * t + Math.sin(t * 3) * 0.005 * t,
      ),
    );
    trunkRadii.push((conifer ? 0.023 : 0.021) * Math.pow(1 - t, 1.2) + 0.0024);
  }
  shoot(trunkPath, trunkRadii, ultra ? 7 : 4, true);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + vi * 0.4;
    shoot(
      [v(0, 0.055, 0), v(Math.cos(a) * 0.047, 0.005, Math.sin(a) * 0.047)],
      [0.012, 0.003],
      ultra ? 4 : 3,
    );
  }
  if (conifer) {
    const counts = ultra ? [5, 5, 5, 4, 4, 3, 3] : [4, 4, 4, 3, 2];
    for (let tier = 0; tier < counts.length; tier++) {
      const f = tier / counts.length;
      const height = 0.27 + f * 0.65 + (random() - 0.5) * 0.025;
      for (let k = 0; k < counts[tier]; k++) {
        const a =
          (k / counts[tier]) * TAU +
          tier * 0.82 +
          vi * 0.57 +
          (random() - 0.5) * 0.45;
        const length = (0.235 - f * 0.18) * (0.8 + random() * 0.27);
        const start = v(lean.x * height, height, lean.z * height);
        const middle = start
          .clone()
          .add(
            v(
              Math.cos(a) * length * 0.57,
              vi === 1 ? -0.037 : -0.016,
              Math.sin(a) * length * 0.57,
            ),
          );
        const end = start
          .clone()
          .add(
            v(
              Math.cos(a) * length,
              (random() - 0.45) * 0.04 - (vi === 1 ? 0.022 : 0),
              Math.sin(a) * length,
            ),
          );
        shoot(
          ultra ? [start, middle, end] : [start, end],
          ultra
            ? [0.008 * (1 - f * 0.65), 0.004, 0.0013]
            : [0.007 * (1 - f * 0.65), 0.0013],
          ultra ? 5 : 3,
        );
        const direction = end.clone().sub(start).normalize();
        cluster(middle.clone().lerp(end, 0.32), direction, 0.106 - f * 0.042);
        if (ultra) {
          const aa = a + (k % 2 ? -0.72 : 0.66);
          const tip = middle
            .clone()
            .add(
              v(
                Math.cos(aa) * length * 0.58,
                -0.01 + random() * 0.038,
                Math.sin(aa) * length * 0.58,
              ),
            );
          shoot([middle, tip], [0.0036, 0.0009], 4);
          cluster(tip, tip.clone().sub(middle), 0.075 - f * 0.027);
        }
      }
    }
    // Overlapping inner sprays join branch tiers into a crown with real volume.
    // The top spray also covers the exposed gap immediately below the leader.
    for (const [height, scale] of [
      [0.38, 0.11],
      [0.57, 0.087],
      [0.75, 0.067],
      [0.86, 0.055],
    ])
      cluster(
        v(lean.x * height, height, lean.z * height),
        v(0.1, 1, -0.12),
        scale,
      );
    cluster(
      trunkPath[trunkPath.length - 1].clone().add(v(0, 0.004, 0)),
      v(0.05, 1, 0.1),
      0.044,
    );
  } else {
    for (let leader = 0; leader < 3; leader++) {
      const a = (leader / 3) * TAU + vi * 0.7 + (random() - 0.5) * 0.38;
      const start = v(lean.x * 0.3, 0.26 + leader * 0.048, lean.z * 0.3);
      const middle = v(
        Math.cos(a) * 0.06,
        0.43 + random() * 0.06,
        Math.sin(a) * 0.06,
      );
      const end = v(
        Math.cos(a) * 0.11,
        0.7 + random() * 0.12,
        Math.sin(a) * 0.11,
      );
      const leaderPoints = ultra
        ? [start, middle, middle.clone().lerp(end, 0.55), end]
        : [start, middle, end];
      shoot(
        leaderPoints,
        ultra ? [0.015, 0.01, 0.006, 0.0025] : [0.015, 0.009, 0.0025],
        ultra ? 6 : 4,
      );
      cluster(end, v(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), 0.108);
      for (let k = 0; k < 3; k++) {
        const aa = a + (k - 1) * 0.92 + (random() - 0.5) * 0.28;
        const root = middle.clone().lerp(end, 0.18 + k * 0.22);
        const radius = 0.17 + random() * 0.06;
        const tip = v(
          Math.cos(aa) * radius,
          0.58 + k * 0.08 + random() * 0.04,
          Math.sin(aa) * radius,
        );
        const elbow = root
          .clone()
          .lerp(tip, 0.56)
          .add(v(0, 0.018, 0));
        shoot(
          ultra ? [root, elbow, tip] : [root, tip],
          ultra ? [0.0065, 0.0038, 0.0012] : [0.0065, 0.0012],
          ultra ? 5 : 3,
        );
        cluster(
          tip,
          v(Math.cos(aa) * 0.4, 0.8, Math.sin(aa) * 0.4),
          0.118 + random() * 0.018,
        );
        if (ultra)
          for (const side of [-1, 1]) {
            const direction = v(
              Math.cos(aa + side * 0.9),
              0.7 + random() * 0.4,
              Math.sin(aa + side * 0.9),
            ).normalize();
            const twigTip = elbow
              .clone()
              .addScaledVector(direction, 0.075 + random() * 0.03);
            shoot(
              [
                elbow,
                elbow
                  .clone()
                  .lerp(twigTip, 0.5)
                  .add(v(0, 0.009, 0)),
                twigTip,
              ],
              [0.003, 0.002, 0.0007],
              4,
            );
            cluster(twigTip, direction, 0.082 + random() * 0.016);
          }
      }
    }
    // Fill the centre of the fork, rather than putting a small detached tuft at
    // its highest point. Overlap with the leaders makes a continuous crown.
    cluster(v(lean.x * 0.65, 0.66, lean.z * 0.65), v(0.08, 1, -0.1), 0.15);
  }
  const trunk = wood.finish(
    `tree-${conifer ? 'conifer' : 'broadleaf'}-${vi}-${detail}-wood`,
  );
  const foliage = leaves.finish(
    `tree-${conifer ? 'conifer' : 'broadleaf'}-${vi}-${detail}-foliage`,
  );
  trunk.computeBoundingBox();
  foliage.computeBoundingBox();
  const bounds = trunk.boundingBox!.clone().union(foliage.boundingBox!);
  const width = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z,
  );
  const horizontal = (0.46 + vi * 0.015) / width;
  const transform = new THREE.Matrix4().makeScale(
    horizontal,
    1 / bounds.max.y,
    horizontal,
  );
  for (const geometry of [trunk, foliage]) {
    geometry.applyMatrix4(transform);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {
      conifer,
      variant: vi,
      detail,
      normalizedHeight: 1,
      targetCrownWidth: 0.46 + vi * 0.015,
      originalProceduralAsset: true,
    };
  }
  return { trunk, foliage };
}
