import * as THREE from 'three';

/** Original low-cost crowns for the city-wide tree instances. These are
 * botanical approximations, not surveyed individual crown shapes. The near
 * camera textured trees remain responsible for branches and individual leaves. */
export type CanopyDetail = 'medium' | 'distant';
export const CANOPY_TRIANGLE_BUDGETS = {
  broadleaf: { medium: 240, distant: 60 },
  conifer: { medium: 42, distant: 42 },
} as const;

const TAU = Math.PI * 2;
type Point = readonly [number, number, number];
type Lobe = readonly [Point, Point];

// Overlapping crown sections leave an irregular outline and visible shoulders;
// their centres follow a branching crown instead of three oversized spheres.
const BROADLEAF_LOBES: readonly Lobe[] = [
  [
    [0.005, 0.8, -0.015],
    [0.2, 0.235, 0.19],
  ],
  [
    [-0.12, 0.64, 0.065],
    [0.165, 0.19, 0.17],
  ],
  [
    [0.14, 0.66, -0.03],
    [0.17, 0.21, 0.16],
  ],
];

/** Baked crown occlusion is deliberately subtle. Existing per-tree green
 * instance colours remain the palette; shaded interiors are not black blobs. */
function crownColor(x: number, y: number, z: number, section: number) {
  const top = THREE.MathUtils.clamp((y - 0.36) / 0.66, 0, 1);
  const exposed = THREE.MathUtils.clamp(Math.hypot(x, z) / 0.26, 0, 1);
  const variation = Math.sin(section * 2.71) * 0.045;
  const light = 0.66 + top * 0.23 + exposed * 0.09 + variation;
  return [light * 0.96, light, light * 0.91];
}

export function createCanopyGeometry(
  conifer: boolean,
  detail: CanopyDetail = 'medium',
): THREE.BufferGeometry {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [];
  const vertex = (
    point: THREE.Vector3,
    normal: THREE.Vector3,
    section: number,
  ) => {
    positions.push(point.x, point.y, point.z);
    normals.push(normal.x, normal.y, normal.z);
    colors.push(...crownColor(point.x, point.y, point.z, section));
  };

  if (!conifer) {
    // Three evenly tessellated lobes retain rounded branch masses at 80 triangles each.
    // Distant icosahedra reuse the same branch positions (60 triangles total).
    const primitive =
      detail === 'medium'
        ? new THREE.IcosahedronGeometry(1, 1)
        : new THREE.IcosahedronGeometry(1, 0);
    const source = primitive.index ? primitive.toNonIndexed() : primitive;
    const sourcePosition = source.getAttribute('position');
    for (const [section, [centre, scale]] of BROADLEAF_LOBES.entries()) {
      const rotation = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(
          Math.sin(section * 1.3) * 0.18,
          section * 2.399963,
          Math.cos(section * 1.7) * 0.16,
        ),
      );
      for (let i = 0; i < sourcePosition.count; i++) {
        const radial = new THREE.Vector3()
          .fromBufferAttribute(sourcePosition, i)
          .applyMatrix4(rotation);
        // A position-based ripple keeps shared vertices welded while removing
        // regular polyhedron edges. It is deterministic across loads and LODs.
        const ripple =
          1 + Math.sin(radial.x * 5.1 + radial.z * 3.7 + section) * 0.045;
        const point = new THREE.Vector3(
          centre[0] + radial.x * scale[0] * ripple,
          centre[1] + radial.y * scale[1] * ripple,
          centre[2] + radial.z * scale[2] * ripple,
        );
        const normal = new THREE.Vector3(
          radial.x / scale[0],
          radial.y / scale[1],
          radial.z / scale[2],
        ).normalize();
        vertex(point, normal, section);
      }
    }
    source.dispose();
    if (source !== primitive) primitive.dispose();
  } else {
    // Four closed, offset bough whorls replace three identical cone hats.
    // Five points per whorl x two fans x four tiers = 40 triangles (was 42).
    const tiers = [
      [0.34, 0.67, 0.25],
      [0.49, 0.81, 0.205],
      [0.65, 0.92, 0.15],
      [0.8, 1.0, 0.095],
    ];
    for (const [tier, [base, tip, radius]] of tiers.entries()) {
      const ring: THREE.Vector3[] = [],
        ringNormals: THREE.Vector3[] = [];
      const offsetX = Math.sin(tier * 1.7) * 0.012,
        offsetZ = Math.cos(tier * 2.3) * 0.009;
      for (let side = 0; side < 5; side++) {
        const angle = (side / 5) * TAU + tier * 1.03,
          reach = radius * (0.9 + Math.sin(side * 2.3 + tier * 1.8) * 0.1);
        ring.push(
          new THREE.Vector3(
            offsetX + Math.cos(angle) * reach,
            base + Math.sin(side * 2.1 + tier) * 0.035,
            offsetZ + Math.sin(angle) * reach,
          ),
        );
        ringNormals.push(
          new THREE.Vector3(Math.cos(angle), 0.6, Math.sin(angle)).normalize(),
        );
      }
      const top = new THREE.Vector3(offsetX, tip, offsetZ),
        bottom = new THREE.Vector3(offsetX, base + 0.055, offsetZ);
      for (let side = 0; side < 5; side++) {
        const next = (side + 1) % 5;
        // With Y up, clockwise viewed from above faces outwards.
        vertex(top, new THREE.Vector3(0, 1, 0), tier);
        vertex(ring[next], ringNormals[next], tier);
        vertex(ring[side], ringNormals[side], tier);
        vertex(bottom, new THREE.Vector3(0, -1, 0), tier);
        vertex(
          ring[side],
          ringNormals[side].clone().setY(-0.55).normalize(),
          tier,
        );
        vertex(
          ring[next],
          ringNormals[next].clone().setY(-0.55).normalize(),
          tier,
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = `original-${conifer ? 'conifer' : 'broadleaf'}-canopy-${detail}`;
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  // Keep the full canopy within the existing 0.3 x tree-height clearance disk
  // and make source height exact. No municipal XY/height or collision changes.
  const bounds = geometry.boundingBox!,
    maxRadius = positions.reduce(
      (max, _, index) =>
        index % 3 === 0
          ? Math.max(max, Math.hypot(positions[index], positions[index + 2]))
          : max,
      0,
    ),
    horizontal = Math.min(1, 0.285 / maxRadius);
  geometry.scale(horizontal, 1 / bounds.max.y, horizontal);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    originalProceduralAsset: true,
    conifer,
    detail,
    normalizedHeight: 1,
    maximumCrownRadius: 0.285,
    triangles: positions.length / 9,
  };
  return geometry;
}
