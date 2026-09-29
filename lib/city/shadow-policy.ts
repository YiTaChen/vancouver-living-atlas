type Point = readonly [number, number, number];
type Mode = 'orbit' | 'walk' | 'drive' | 'boat' | 'flight';
type Quality = 'balanced' | 'high' | 'ultra';

export const SHADOW_DEPTH = { near: 100, far: 9500 } as const;
export type ShadowCoverage = {
  mode: Mode;
  quality: Quality;
  extent: number;
  /** Unsnapped world-space center retained across solar refreshes. */
  center: Point;
  anchor: Point;
  mapSize: number;
  texelMetres: number;
  sunElevationSine: number;
  normalBias: number;
  depthOffsetMetres: number;
  bias: number;
};
type Input = {
  mode: Mode;
  quality: Quality;
  distance: number;
  focus: Point;
  /** Target-to-light direction; translating coverage must preserve this vector. */
  sunDirection: Point;
  mapSize: number;
  previous?: ShadowCoverage | null;
  /** Snap to the current solar basis when a refresh is already scheduled. */
  refreshing?: boolean;
};

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalized = (a: Point): Point => {
  const size = Math.hypot(...a);
  return size > 0 && Number.isFinite(size)
    ? [a[0] / size, a[1] / size, a[2] / size]
    : [0, 0, 1];
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Camera-aligned basis matching a directional shadow camera's lookAt(up=Y). */
export function shadowBasis(direction: Point) {
  let forward = normalized(direction);
  let right = cross([0, 1, 0], forward);
  // Match Matrix4.lookAt's exact parallel-up fallback rather than switching
  // reference axes near the pole (which would rotate the texel lattice).
  if (dot(right, right) === 0) {
    forward = normalized([forward[0], forward[1], forward[2] + 0.0001]);
    right = cross([0, 1, 0], forward);
  }
  right = normalized(right);
  return { right, up: cross(forward, right), forward };
}

/** Snap only the light-plane coordinates; translation along the light is coarser
 * because it does not set the shadow texel phase. */
export function snapShadowAnchor(
  focus: Point,
  direction: Point,
  texelMetres: number,
): Point {
  const { right, up, forward } = shadowBasis(direction);
  // Normally these offsets are zero. At a perfectly vertical sun Three adds
  // a tiny lookAt perturbation, so snap the camera position's phase as well.
  const lightX = dot(direction, right),
    lightY = dot(direction, up);
  const x =
    Math.round((dot(focus, right) + lightX) / texelMetres) * texelMetres -
    lightX;
  const y =
    Math.round((dot(focus, up) + lightY) / texelMetres) * texelMetres - lightY;
  const z = Math.round(dot(focus, forward) / 16) * 16;
  return [
    right[0] * x + up[0] * y + forward[0] * z,
    right[1] * x + up[1] * y + forward[1] * z,
    right[2] * x + up[2] * y + forward[2] * z,
  ];
}

/** Original cached-shadow policy. Better density uses the existing maps, not a
 * larger render target. Recentring has a margin so walking does not redraw the
 * city shadow map for every texel crossed. Bias is expressed in world metres. */
export function shadowCoverage(input: Input): ShadowCoverage {
  const { mode, quality, focus, sunDirection, previous } = input;
  const mapSize = Math.max(1, Math.round(input.mapSize));
  const samePreset =
    previous?.mode === mode &&
    previous?.quality === quality &&
    previous.mapSize === mapSize;
  const distance = Number.isFinite(input.distance)
    ? Math.max(0, input.distance)
    : 4500;
  let extent =
    mode === 'orbit'
      ? Math.min(2700, Math.ceil(Math.max(160, distance * 0.95) / 32) * 32)
      : 170;
  // Expand immediately, but a small zoom-in does not resize cached coverage.
  if (samePreset && extent < previous.extent && extent > previous.extent * 0.85)
    extent = previous.extent;
  const texelMetres = (extent * 2) / mapSize;
  const global = mode === 'orbit' && extent === 2700;
  let center: Point = global ? [0, 0, 0] : focus;
  let anchor: Point = center;
  if (!global) {
    const sameExtent = samePreset && previous.extent === extent;
    let keepAnchor = false;
    if (sameExtent) {
      const delta: Point = [
        focus[0] - previous.center[0],
        focus[1] - previous.center[1],
        focus[2] - previous.center[2],
      ];
      const basis = shadowBasis(sunDirection);
      keepAnchor =
        Math.max(
          Math.abs(dot(delta, basis.right)),
          Math.abs(dot(delta, basis.up)),
        ) <
          extent * 0.2 && Math.abs(dot(delta, basis.forward)) < 512;
    }
    center = keepAnchor ? previous!.center : focus;
    anchor = keepAnchor ? previous!.anchor : center;
    // Preserve exact cached coordinates on ordinary frames. Solar refreshes may
    // resnap that same unsnapped centre, avoiding accumulated quantization drift.
    if (!keepAnchor || input.refreshing)
      anchor = snapShadowAnchor(center, sunDirection, texelMetres);
  }
  const reuseBias =
    samePreset &&
    previous.extent === extent &&
    anchor.every((value, i) => value === previous.anchor[i]) &&
    !input.refreshing;
  // The light moves more frequently than its cached shadow map. Bias belongs
  // to that map's solar basis; changing it on every light tick would also mark
  // the map dirty and bypass the engine's existing solar refresh throttle.
  const sunElevationSine = reuseBias
    ? previous.sunElevationSine
    : Math.max(0.05, Math.abs(normalized(sunDirection)[1]));
  const grazing = clamp((0.7 - sunElevationSine) / 0.45, 0, 1);
  const normalBias = reuseBias
    ? previous.normalBias
    : clamp(
        texelMetres * 0.65 + grazing * Math.min(0.14, texelMetres * 0.9),
        0.1,
        1.2,
      );
  const baseDepthOffset = clamp(texelMetres * 0.2, 0.04, 0.35);
  // A horizontal receiver spans texel*tan(sun-zenith) in light depth. At low
  // sun, r185's disk+bilinear PCF footprint needs more than the midday offset.
  // A normal displacement already clears normalBias/sin(elevation) of that
  // depth span; only supply the remaining allowance, capped in world metres.
  const receiverSlope = Math.sqrt(1 - sunElevationSine ** 2) / sunElevationSine;
  const pcfDepthSpan = texelMetres * 1.75 * receiverSlope;
  const depthOffsetMetres = reuseBias
    ? previous.depthOffsetMetres
    : clamp(
        baseDepthOffset + Math.max(0, pcfDepthSpan - normalBias / sunElevationSine),
        baseDepthOffset,
        0.8,
      );
  return {
    mode,
    quality,
    extent,
    center,
    anchor,
    mapSize,
    texelMetres,
    sunElevationSine,
    normalBias,
    depthOffsetMetres,
    bias: -depthOffsetMetres / (SHADOW_DEPTH.far - SHADOW_DEPTH.near),
  };
}
