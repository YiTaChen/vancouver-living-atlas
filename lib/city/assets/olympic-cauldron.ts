/**
 * Original Olympic Cauldron study, Jack Poole Plaza, 2026.
 * LicenseRef-Vancouver-Living-Atlas-NC-1.0; see LICENSE.
 * Published 10m height / 12m width / 1.2m arms: Vancouver Convention Centre
 * and Glotman Simpson. Visible arm endpoints and panel joints are photo-based
 * interpretations, not an engineering survey. No source photography is used.
 */
import * as THREE from 'three';

type Point = readonly [number, number, number];

export const OLYMPIC_CAULDRON_CONTRACT = {
  heightM: 10,
  publishedWidthM: 12,
  armSectionM: 1.2,
  contactDatumM: 0,
  armCount: 4,
  state: 'unlit',
  sourcePrecision:
    'Published overall dimensions; visible arm endpoints, panel joints and cross-section bevels interpreted from photographs. The published 16.5m arm length is not asserted as this visible above-ground span.',
  sources: [
    'https://www.vancouverconventioncentre.com/about-us/our-story/olympic-legacy',
    'https://glotmansimpson.com/project/olympic-cauldron-at-vancouver-convention-centre/',
  ],
} as const;

/** Opaque, independently owned material batches: safe for normal city disposal.
 * No cached geometry, textures, per-frame callbacks, lights or engine imports. */
class Surface {
  positions: number[] = [];
  colors: number[] = [];
  triangle(
    a: Point,
    b: Point,
    c: Point,
    color: number,
    outward?: THREE.Vector3,
  ) {
    if (outward) {
      const normal = new THREE.Vector3(...b)
        .sub(new THREE.Vector3(...a))
        .cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a)));
      if (normal.dot(outward) < 0) [b, c] = [c, b];
    }
    const co = new THREE.Color(color);
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.colors.push(co.r, co.g, co.b);
  }
  quad(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    color: number,
    outward?: THREE.Vector3,
  ) {
    this.triangle(a, b, c, color, outward);
    this.triangle(a, c, d, color, outward);
  }
  mesh(name: string, roughness: number, metalness: number) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(this.colors, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
    });
    material.name = name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

// A square prism with broad glass planes and narrow clipped crystal corners.
// Local U is horizontal, V perpendicular to the sloping arm's centreline.
const SECTION: readonly (readonly [number, number])[] = [
  [-0.42, -0.6],
  [0.42, -0.6],
  [0.6, -0.42],
  [0.6, 0.42],
  [0.42, 0.6],
  [-0.42, 0.6],
  [-0.6, 0.42],
  [-0.6, -0.42],
];
const PALETTE = [0xc5d9dd, 0xdce8e7, 0xb3cdd3, 0xe3eae5, 0xc8dcdf, 0xa9c4cd];

/** Detached meshes can still be disposed by the engine's normal traversal.
 * This helper is useful for isolated previews and has an idempotent contract. */
export function disposeOlympicCauldron(group: THREE.Group): void {
  if (group.userData.cauldronDisposed) return;
  group.userData.cauldronDisposed = true;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(m);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function makeOlympicCauldron(): THREE.Group {
  const glass = new Surface(),
    metal = new Surface(),
    dark = new Surface();
  const arms: { foot: number[]; tip: number[]; visibleLengthM: number }[] = [];
  const authoringParts: {
    name: string;
    ranges: { first: number; count: number }[];
  }[] = [];

  function crystal(foot: Point, tip: Point, seed: number, core = false) {
    const first = [glass, metal, dark].map(
      (surface) => surface.positions.length / 3,
    );
    const start = new THREE.Vector3(...foot),
      end = new THREE.Vector3(...tip);
    const axis = end.clone().sub(start),
      length = axis.length(),
      direction = axis.clone().normalize();
    const u = core
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    const v = direction.clone().cross(u).normalize();
    const segments = core ? 20 : 24;
    // Keep the first perpendicular panel joint clear of the horizontal end
    // cuts. Otherwise a low corner of that ring could protrude below a foot
    // (or above its burner), folding the final panel back over its end cap.
    const station = (segment: number) =>
      core || segment === 0 || segment === segments
        ? segment / segments
        : 0.065 + ((segment - 1) / (segments - 2)) * 0.87;
    const point = (t: number, side: number, radius = 1): Point => {
      const section = SECTION[(side + SECTION.length) % SECTION.length];
      // Central crystal narrows slightly towards its elevated burner crown.
      const taper = core ? 1.02 - 0.14 * t : 1;
      const offset = u
        .clone()
        .multiplyScalar(section[0] * radius * taper)
        .addScaledVector(v, section[1] * radius * taper);
      const centre = start.clone().addScaledVector(axis, t);
      // Both end faces meet a horizontal world plane. The feet never penetrate
      // the contact datum; upper mouths stay level like the observed burners.
      if (t === 0 || t === 1)
        centre.addScaledVector(direction, -offset.y / direction.y);
      return centre.add(offset).toArray() as [number, number, number];
    };
    for (let segment = 0; segment < segments; segment++) {
      const t0 = station(segment),
        t1 = station(segment + 1);
      for (let side = 0; side < 8; side++) {
        const next = (side + 1) % 8;
        const mid = ((side + 0.5) * Math.PI) / 4;
        const outward = u
          .clone()
          .multiplyScalar(Math.sin(mid))
          .addScaledVector(v, -Math.cos(mid));
        const a = point(t0, side),
          b = point(t0, next),
          c = point(t1, next),
          d = point(t1, side);
        // Distinct triangular frosted faces suggest the fractured, mirror-backed
        // cladding without transparency sorting or photographic textures.
        const color = PALETTE[(side * 3 + segment * 5 + seed) % PALETTE.length];
        const alternate =
          PALETTE[
            (side * 3 + segment * 5 + seed + (segment % 4 === 0 ? 2 : 0)) %
              PALETTE.length
          ];
        glass.triangle(a, b, c, color, outward);
        glass.triangle(a, c, d, alternate, outward);
      }
    }
    // Slim longitudinal metal edges. Their shallow box sections give a true
    // highlight from all sides and avoid coplanar overlay/z-fighting.
    for (let side = 0; side < 8; side += 2) {
      {
        const a = new THREE.Vector3(...point(0, side, 1.009));
        const b = new THREE.Vector3(...point(1, side, 1.009));
        const edgeU = u.clone().multiplyScalar(0.012);
        const edgeV = v.clone().multiplyScalar(0.012);
        const pts = [
          edgeU.clone().add(edgeV),
          edgeU.clone().sub(edgeV),
          edgeU.clone().negate().sub(edgeV),
          edgeU.clone().negate().add(edgeV),
        ];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4;
          const outward = pts[edge].clone().add(pts[next]);
          metal.quad(
            a.clone().add(pts[edge]).toArray() as [number, number, number],
            a.clone().add(pts[next]).toArray() as [number, number, number],
            b.clone().add(pts[next]).toArray() as [number, number, number],
            b.clone().add(pts[edge]).toArray() as [number, number, number],
            0x9cabb0,
            outward,
          );
        }
      }
    }
    // Small transverse joints follow the sloping crystal, rather than world Y.
    for (let seam = 1; seam < segments; seam++) {
      const t = station(seam),
        half = 0.008 / length;
      for (let side = 0; side < 8; side++) {
        const next = (side + 1) % 8;
        const s = SECTION[side],
          n = SECTION[next];
        const outward = u
          .clone()
          .multiplyScalar(s[0] + n[0])
          .addScaledVector(v, s[1] + n[1]);
        dark.quad(
          point(t - half, side, 1.006),
          point(t - half, next, 1.006),
          point(t + half, next, 1.006),
          point(t + half, side, 1.006),
          0x627b83,
          outward,
        );
      }
    }
    // Hollow burner crown: silver rim and recessed charcoal basin. There is no
    // flame in the permanent, everyday state of the landmark.
    const up = new THREE.Vector3(0, 1, 0);
    for (let side = 0; side < 8; side++) {
      const next = (side + 1) % 8;
      const a = point(1, side, 1.01),
        b = point(1, next, 1.01);
      const c = point(1, next, 0.78),
        d = point(1, side, 0.78);
      metal.quad(a, b, c, d, 0x87969c, up);
      const bottomC: Point = [c[0], c[1] - 0.16, c[2]],
        bottomD: Point = [d[0], d[1] - 0.16, d[2]];
      dark.quad(
        d,
        c,
        bottomC,
        bottomD,
        0x26363d,
        u
          .clone()
          .multiplyScalar(-SECTION[side][0])
          .addScaledVector(v, -SECTION[side][1]),
      );
      dark.triangle(
        [tip[0], tip[1] - 0.16, tip[2]],
        bottomD,
        bottomC,
        0x17272f,
        up,
      );
      // Solid small ground cap closes the crystal at the contact plane.
      metal.triangle(
        foot,
        point(0, next),
        point(0, side),
        0x7e9299,
        up.clone().negate(),
      );
    }
    authoringParts.push({
      name: core
        ? 'central-crystal'
        : `crossing-arm-${authoringParts.length + 1}`,
      ranges: [glass, metal, dark].map((surface, i) => ({
        first: first[i],
        count: surface.positions.length / 3 - first[i],
      })),
    });
  }

  // Four diagonal arms cross near the central crystal and continue upward on
  // the opposite side. They must not end in a teepee at the crossing point.
  for (const [i, [x, z]] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].entries()) {
    const foot: Point = [x * 5, 0, z * 5];
    const tip: Point = [-x * 2.7, 8.65, -z * 2.7];
    crystal(foot, tip, i * 2);
    arms.push({
      foot: [...foot],
      tip: [...tip],
      visibleLengthM: Math.hypot(tip[0] - foot[0], tip[1], tip[2] - foot[2]),
    });
  }
  crystal([0, 0, 0], [0, 10, 0], 3, true);

  const group = new THREE.Group();
  group.name = 'olympic-cauldron';
  group.add(
    glass.mesh('olympic-cauldron/frosted-crystal', 0.3, 0.17),
    metal.mesh('olympic-cauldron/steel-edges-and-rims', 0.32, 0.72),
    dark.mesh('olympic-cauldron/joints-and-unlit-burners', 0.7, 0.2),
  );
  // Longitudinal micro-ribs may end a millimetre below a clipped foot plane.
  // Clamp their tiny end bevel to the exact world contact datum.
  for (const child of group.children as THREE.Mesh[]) {
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) < 0) positions.setY(i, 0);
    child.geometry.computeVertexNormals();
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const geometryBytes = group.children.reduce(
    (sum, child) =>
      sum +
      Object.values((child as THREE.Mesh).geometry.attributes).reduce(
        (n, attr) => n + attr.array.byteLength,
        0,
      ),
    0,
  );
  const triangles = group.children.reduce(
    (sum, child) =>
      sum + (child as THREE.Mesh).geometry.getAttribute('position').count / 3,
    0,
  );
  Object.assign(group.userData, {
    originalProceduralAsset: true,
    contract: OLYMPIC_CAULDRON_CONTRACT,
    cauldronArms: arms,
    authoringParts,
    contactDatumM: 0,
    triangles,
    drawCalls: 3,
    geometryBytes,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  });
  return group;
}
