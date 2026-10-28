import { project } from './geo';

/** First-round art-direction pilot, following the unchanged City of Vancouver
 * Robson/Burrard centreline endpoints. This is an appearance envelope, not a
 * surveyed business district or a change to roads, parcels or collision. */
export const STREET_SHOWCASE_SEGMENTS = Object.freeze([
  Object.freeze({
    roadName: 'ROBSON ST',
    a: Object.freeze(project([-123.12482, 49.284602])),
    b: Object.freeze(project([-123.1208034, 49.2819963])),
  }),
  Object.freeze({
    roadName: 'BURRARD ST',
    a: Object.freeze(project([-123.1211101, 49.2844195])),
    b: Object.freeze(project([-123.1244038, 49.2822407])),
  }),
]);

export const STREET_SHOWCASE_FADE = Object.freeze({ coreM: 32, outerM: 85 });
export const STREET_SHOWCASE_BOUNDS = Object.freeze({
  minX:
    Math.min(...STREET_SHOWCASE_SEGMENTS.flatMap((s) => [s.a[0], s.b[0]])) -
    STREET_SHOWCASE_FADE.outerM,
  minZ:
    Math.min(...STREET_SHOWCASE_SEGMENTS.flatMap((s) => [s.a[1], s.b[1]])) -
    STREET_SHOWCASE_FADE.outerM,
  maxX:
    Math.max(...STREET_SHOWCASE_SEGMENTS.flatMap((s) => [s.a[0], s.b[0]])) +
    STREET_SHOWCASE_FADE.outerM,
  maxZ:
    Math.max(...STREET_SHOWCASE_SEGMENTS.flatMap((s) => [s.a[1], s.b[1]])) +
    STREET_SHOWCASE_FADE.outerM,
});

export function streetSegmentDistance(
  x: number,
  z: number,
  a: readonly number[],
  b: readonly number[],
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Shared CPU/shader mask. Consumers independently gate altitude and mode so
 * distant aircraft, rocket space, interior travel and the rest of the city keep
 * their previous appearance. End caps also fade, rather than cutting at a box. */
export function streetShowcaseWeight(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  if (
    x < STREET_SHOWCASE_BOUNDS.minX ||
    x > STREET_SHOWCASE_BOUNDS.maxX ||
    z < STREET_SHOWCASE_BOUNDS.minZ ||
    z > STREET_SHOWCASE_BOUNDS.maxZ
  )
    return 0;
  // This is shared by per-frame camera, pedestrian and vehicle policies. Keep
  // the hot path free of temporary arrays and callback allocations.
  let distance = Infinity;
  for (let i = 0; i < STREET_SHOWCASE_SEGMENTS.length; i++) {
    const s = STREET_SHOWCASE_SEGMENTS[i];
    distance = Math.min(distance, streetSegmentDistance(x, z, s.a, s.b));
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      (distance - STREET_SHOWCASE_FADE.coreM) /
        (STREET_SHOWCASE_FADE.outerM - STREET_SHOWCASE_FADE.coreM),
    ),
  );
  return 1 - t * t * (3 - 2 * t);
}

const glslPoint = (p: readonly number[]) =>
  `vec2(${p[0].toFixed(6)},${p[1].toFixed(6)})`;
/** Same metre-space smoothstep as streetShowcaseWeight; GLSL is generated from
 * the exact CPU constants to avoid independently drifting pilot regions. */
export const STREET_SHOWCASE_GLSL = `
float atlasStreetSegmentDistanceSquared(vec2 p, vec2 a, vec2 b) {
  vec2 d=b-a;
  float t=clamp(dot(p-a,d)/max(dot(d,d),.000001),0.,1.);
  vec2 delta=p-a-d*t;
  return dot(delta,delta);
}
float atlasStreetShowcaseWeight(vec2 worldXZ) {
  if (worldXZ.x<${STREET_SHOWCASE_BOUNDS.minX.toFixed(6)} || worldXZ.x>${STREET_SHOWCASE_BOUNDS.maxX.toFixed(6)} ||
      worldXZ.y<${STREET_SHOWCASE_BOUNDS.minZ.toFixed(6)} || worldXZ.y>${STREET_SHOWCASE_BOUNDS.maxZ.toFixed(6)}) return 0.;
  // sqrt(min(a,b)) == min(sqrt(a),sqrt(b)) for non-negative squared
  // distances. Keep metre-space smoothstep and fade thresholds unchanged.
  float d=sqrt(min(
    atlasStreetSegmentDistanceSquared(worldXZ,${glslPoint(STREET_SHOWCASE_SEGMENTS[0].a)},${glslPoint(STREET_SHOWCASE_SEGMENTS[0].b)}),
    atlasStreetSegmentDistanceSquared(worldXZ,${glslPoint(STREET_SHOWCASE_SEGMENTS[1].a)},${glslPoint(STREET_SHOWCASE_SEGMENTS[1].b)})
  ));
  return 1.-smoothstep(${STREET_SHOWCASE_FADE.coreM.toFixed(1)},${STREET_SHOWCASE_FADE.outerM.toFixed(1)},d);
}
`;

/** Restrained Pacific Northwest finish hierarchy, shared by the pilot details.
 * Colours are authored scene dressing, not measured material assignments. */
export const STREET_SHOWCASE_PALETTE = Object.freeze({
  limestone: 0xb6b3a5,
  concrete: 0x8d9691,
  anodizedMetal: 0x394c4b,
  bronze: 0x817662,
  glazing: 0x284245,
  canopy: Object.freeze([0x355851, 0x626c63, 0x785b48, 0x435b69]),
  warmInterior: 0xd8bd8e,
});

export const STREET_SHOWCASE_DETAIL_BUDGET = Object.freeze({
  maxPlannedBays: 360,
  maxVisibleBays: 100,
  maxVisibleBoxes: 1800,
  highRangeM: 210,
  balancedRangeM: 125,
  selectionMoveM: 18,
  maximumCameraHeightM: 70,
  maxFrontageDistanceM: 38,
});
