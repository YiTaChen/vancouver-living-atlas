/**
 * Original Siwash Rock silhouette study. LicenseRef-Vancouver-Living-Atlas-NC-1.0
 * (see LICENSE; prior MIT grants remain valid), 2026.
 *
 * Visual references: City of Vancouver's Stanley Park landmarks photograph and
 * MineralsEd/Geological Survey of Canada's Stanley Park geotour, stop 4.
 * This is an authored interpretation of the fractured sea stack and windswept
 * tree, not a surveyed geological model or a copy of the reference photograph.
 */
import * as THREE from 'three';

export type SiwashRockLevel = 'low' | 'medium' | 'high';

// Use the centroid of the EXISTING Siwash islet, beach-coast.json land[1],
// identified beside the mapped Siwash lookout and BC's approximate place-name
// marker. Keep the source island, coast and navigation data untouched. This is
// a rendering fit to that 13.57m x 10.58m generalized island, not a surveyed
// centre/shape. Scale X/Z only: the authored rock and tree heights stay intact.
export const SIWASH_ROCK_PLACEMENT = {
  lon: -123.1560181124,
  lat: 49.3087515252,
  baseY: 0,
  yaw: 0,
} as const;
export const SIWASH_ROCK_HORIZONTAL_SCALE = 0.72;
export const SIWASH_ROCK_TRIANGLE_LIMITS = {
  low: 500,
  medium: 1500,
  high: 4000,
} as const;
export const SIWASH_ROCK_SOURCES = [
  'https://vancouver.ca/parks-recreation-culture/landmarks-in-stanley-park.aspx',
  'https://vancouver.ca/images/cov/icons/siwash-rock-in-stanley-park.jpg',
  'https://mineralsed.ca/site/assets/files/3451/stanleyparkgeotour2011web_me.pdf',
  'https://apps.gov.bc.ca/pub/bcgnws/names/21433.html',
] as const;

type Point = readonly [number, number, number];
type Profile = readonly [number, number, number, number];
const TAU = Math.PI * 2;
// Height, radius, centre X/Z. Closely spaced shelves make fractures geometric,
// rather than transparent decals. All LODs retain every silhouette control row.
const ROCK_PROFILE: readonly Profile[] = [
  [0, 8.5, 0.1, 0],
  [0.65, 9, -0.1, 0.15],
  [1.6, 8.35, -0.15, 0.25],
  [4.5, 7.8, -0.7, 0.3],
  [4.76, 7.3, -0.7, 0.3],
  [7.4, 7.5, -0.15, -0.3],
  [10.2, 7.1, 0.65, -0.7],
  [10.46, 6.7, 0.65, -0.7],
  [13.2, 5.9, 0.2, -0.4],
  [15.65, 4.5, -0.6, -0.35],
  [17.4, 3.7, -0.75, -0.2],
];
const RADIAL_SHAPE = [
  0.87, 1, 0.9, 0.83, 0.93, 0.83, 0.79, 0.9, 0.93, 0.84, 0.95, 0.86,
] as const;

class Surface {
  positions: number[] = [];
  colours: number[] = [];
  private colour = new THREE.Color();
  triangle(a: Point, b: Point, c: Point, colour: number, shade = 1) {
    // Rings advance clockwise as viewed from above; reverse their authored
    // clockwise faces to give every closed surface outward-facing normals.
    this.positions.push(...a, ...c, ...b);
    this.colour.setHex(colour).multiplyScalar(shade);
    for (let i = 0; i < 3; i++)
      this.colours.push(this.colour.r, this.colour.g, this.colour.b);
  }
  quad(a: Point, b: Point, c: Point, d: Point, colour: number, shade = 1) {
    this.triangle(a, b, d, colour, shade);
    this.triangle(b, c, d, colour, shade * 0.98);
  }
  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(this.colours, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function rockRing(profile: Profile, segments: number): Point[] {
  const [height, radius, cx, cz] = profile;
  return Array.from({ length: segments }, (_, i): Point => {
    const angle = (i / segments) * TAU;
    const section = (i * RADIAL_SHAPE.length) / segments;
    const a = Math.floor(section);
    const t = section - a;
    const radial =
      RADIAL_SHAPE[a] * (1 - t) +
      RADIAL_SHAPE[(a + 1) % RADIAL_SHAPE.length] * t;
    const middle = Math.sin((height / 17.4) * Math.PI);
    const fractureMask = Math.max(0, Math.sin(angle * 2 + height * 0.17));
    const fractureFill = height === 4.76 ? 0.5 : height === 10.46 ? 0.4 : 0;
    // Broad, tilted fracture planes break the outline at different heights.
    // Grooves stop around the back instead of encircling it like masonry rings.
    const grain = segments >= 48 ? 0.13 : segments >= 24 ? 0.055 : 0;
    const r =
      radius * radial +
      middle * (Math.sin(angle * 3 + height * 0.19) * 0.48) +
      fractureFill * (1 - fractureMask) +
      grain *
        Math.sin(angle * 17 + height * 1.7) *
        Math.sin(angle * 7 - height * 0.9);
    const y =
      height +
      Math.min(1, height / 2) *
        (Math.sin(angle * 3 + 0.4) * 0.16 + Math.sin(angle) * 0.25) +
      middle * Math.sin(angle * 2 + height * 0.12) * 0.7;
    return [cx + Math.sin(angle) * r, y, cz + Math.cos(angle) * r];
  });
}

function addRock(surface: Surface, segments: number, subdivide: boolean) {
  const profile: Profile[] = [];
  for (let i = 0; i < ROCK_PROFILE.length; i++) {
    const row = ROCK_PROFILE[i];
    profile.push(row);
    if (subdivide && i < ROCK_PROFILE.length - 1) {
      const next = ROCK_PROFILE[i + 1];
      profile.push([
        (row[0] + next[0]) / 2,
        (row[1] + next[1]) / 2,
        (row[2] + next[2]) / 2,
        (row[3] + next[3]) / 2,
      ]);
    }
  }
  const rings = profile.map((row) => rockRing(row, segments));
  for (let j = 0; j < rings.length - 1; j++) {
    const height = (profile[j][0] + profile[j + 1][0]) / 2;
    const wet = height < 1.6;
    const fracture =
      (height >= 4.5 && height <= 4.76) || (height >= 10.2 && height <= 10.46);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const broken = Math.sin((i / segments) * TAU * 2 + height * 0.17) > 0.15;
      const colour = wet ? 0x414941 : fracture && broken ? 0x49483f : 0x827e6e;
      // Broad light/weathering variation follows the same angular sectors at
      // every LOD. Higher detail adds facets without changing the main mass.
      const shade =
        0.87 +
        Math.sin((i / segments) * TAU * 3 + height * 0.17) * 0.09 +
        Math.sin(i * 29.17 + height * 4.13) * 0.035;
      surface.quad(
        rings[j][i],
        rings[j + 1][i],
        rings[j + 1][next],
        rings[j][next],
        colour,
        shade,
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    surface.triangle([0.1, 0, 0], rings[0][i], rings[0][next], 0x414941);
    const last = rings.length - 1;
    surface.triangle(
      [-0.75, 17.4, -0.2],
      rings[last][next],
      rings[last][i],
      0x777566,
    );
  }
}

function addSummitVegetation(surface: Surface, segments: number) {
  const summit = rockRing(ROCK_PROFILE[ROCK_PROFILE.length - 1], segments);
  const top = summit.map(([x, y, z]): Point => [x, y + 0.12, z]);
  const bottom = summit.map(([x, y, z]): Point => [x, y - 0.18, z]);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    surface.triangle([-0.75, 17.65, -0.2], top[next], top[i], 0x4d603a);
    surface.quad(top[i], top[next], bottom[next], bottom[i], 0x3e5031);
    surface.triangle([-0.75, 17.3, -0.2], bottom[i], bottom[next], 0x3e5031);
  }
}

function addBranch(
  surface: Surface,
  start: Point,
  end: Point,
  radius: number,
  segments: number,
) {
  const axis = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
  const length = axis.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    axis.divideScalar(length),
  );
  const point = (i: number, top: boolean): Point => {
    const angle = (i / segments) * TAU;
    const r = radius * (top ? 0.58 : 1);
    const v = new THREE.Vector3(
      Math.sin(angle) * r,
      top ? length : 0,
      Math.cos(angle) * r,
    )
      .applyQuaternion(rotation)
      .add(new THREE.Vector3(...start));
    return [v.x, v.y, v.z];
  };
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    surface.quad(
      point(i, false),
      point(i, true),
      point(next, true),
      point(next, false),
      0x655e45,
      0.86 + (i % 3) * 0.06,
    );
    surface.triangle(start, point(i, false), point(next, false), 0x615a43);
    surface.triangle(end, point(next, true), point(i, true), 0x615a43);
  }
}

function addCrown(
  surface: Surface,
  center: Point,
  radii: Point,
  segments: number,
  latitudeRings: number,
  colour: number,
  phase: number,
) {
  const [x, y, z] = center;
  const [rx, ry, rz] = radii;
  const rings: Point[][] = Array.from({ length: latitudeRings }, (_, j) => {
    const elevation = ((j + 1) / (latitudeRings + 1)) * Math.PI;
    return Array.from({ length: segments }, (_, i): Point => {
      const angle = (i / segments) * TAU;
      const lobe = 1 + Math.sin(angle * 3 + phase) * 0.14;
      const dx = Math.sin(angle) * Math.sin(elevation) * rx * lobe;
      const dz = Math.cos(angle) * Math.sin(elevation) * rz * lobe;
      return [
        x + dx,
        y + Math.cos(elevation) * ry + dx * 0.1 + dz * 0.04,
        z + dz,
      ];
    });
  });
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    surface.triangle([x, y + ry, z], rings[0][next], rings[0][i], colour);
    const last = rings.length - 1;
    surface.triangle(
      [x, y - ry, z],
      rings[last][i],
      rings[last][next],
      colour,
      0.82,
    );
    for (let j = 0; j < rings.length - 1; j++)
      surface.quad(
        rings[j][i],
        rings[j][next],
        rings[j + 1][next],
        rings[j + 1][i],
        colour,
        0.9 + (i % 3) * 0.04,
      );
  }
}

// Open gaps below a broad wind-shaped crown make the tree legible at orbit
// distance. Branch and crown centres are invariant across all three levels.
const BRANCHES: readonly (readonly [Point, Point, number])[] = [
  [[-1, 17.6, -0.1], [-0.7, 21.1, -0.1], 0.32],
  [[-0.7, 21.1, -0.1], [0.3, 23, 0], 0.24],
  [[-0.8, 20.1, 0], [-3.4, 21.3, 0.2], 0.19],
  [[-0.7, 20.7, 0], [2.8, 21.9, 0.3], 0.18],
  [[-0.7, 21.1, -0.1], [-1.1, 22.7, -1.8], 0.17],
  [[-0.5, 21.7, 0], [2.5, 23, -0.5], 0.15],
  [[-0.5, 21.5, 0], [-2.8, 23, -0.1], 0.16],
  [[-0.6, 20.9, 0], [0.6, 22.1, 1.8], 0.16],
];
const TWIGS: readonly (readonly [Point, Point, number])[] = [
  [[-2.1, 20.7, 0.1], [-3.6, 21.7, -0.6], 0.075],
  [[1.2, 21.4, 0.2], [3.2, 22.2, -0.6], 0.065],
  [[1.1, 22.5, -0.3], [3.2, 23.4, -0.8], 0.06],
  [[-1.5, 22.1, -0.1], [-3.1, 23.2, -0.9], 0.07],
];
const CROWNS: readonly (readonly [Point, Point])[] = [
  [
    [-3.05, 21.65, 0.05],
    [2, 0.75, 1.5],
  ],
  [
    [2.8, 22.1, 0.1],
    [2.05, 0.8, 1.55],
  ],
  [
    [-2.8, 23.1, -0.4],
    [2.1, 0.85, 1.45],
  ],
  [
    [2.3, 23.4, -0.5],
    [2.6, 0.9, 1.65],
  ],
  [
    [-0.8, 22.9, -1.7],
    [1.7, 0.8, 1.3],
  ],
  [
    [0.6, 22.2, 1.65],
    [1.7, 0.8, 1.25],
  ],
];

export function createSiwashRock(level: SiwashRockLevel): THREE.Group {
  const surface = new Surface();
  const rockSegments = level === 'low' ? 12 : level === 'medium' ? 24 : 48;
  const branchSegments = level === 'low' ? 4 : level === 'medium' ? 6 : 8;
  const crownSegments = level === 'low' ? 4 : level === 'medium' ? 8 : 12;
  const crownRings = level === 'low' ? 1 : level === 'medium' ? 3 : 4;
  addRock(surface, rockSegments, level === 'high');
  // An opaque low shrub patch follows the rock's uneven summit.
  addSummitVegetation(surface, rockSegments);
  for (const [start, end, radius] of BRANCHES)
    addBranch(surface, start, end, radius, branchSegments);
  if (level !== 'low')
    for (const [start, end, radius] of TWIGS)
      addBranch(surface, start, end, radius, branchSegments);
  for (let i = 0; i < CROWNS.length; i++)
    addCrown(
      surface,
      CROWNS[i][0],
      CROWNS[i][1],
      crownSegments,
      crownRings,
      i % 2 ? 0x3f5739 : 0x34503b,
      i * 1.7,
    );
  const geometry = surface.geometry();
  geometry.scale(SIWASH_ROCK_HORIZONTAL_SCALE, 1, SIWASH_ROCK_HORIZONTAL_SCALE);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Siwash Rock ${level} opaque surface`;
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'Siwash Rock';
  group.userData.placement = { ...SIWASH_ROCK_PLACEMENT };
  group.userData.detailLevel = level;
  group.userData.triangles = geometry.getAttribute('position').count / 3;
  group.userData.authoring = {
    sources: [...SIWASH_ROCK_SOURCES],
    sourceFootprint: 'public/data/beach-coast.json land[1]',
    horizontalScale: SIWASH_ROCK_HORIZONTAL_SCALE,
    interpretation:
      'Original representative silhouette and surface detailing; not surveyed.',
  };
  group.add(mesh);
  return group;
}
