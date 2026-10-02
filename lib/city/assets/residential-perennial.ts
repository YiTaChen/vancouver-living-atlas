import { RESIDENTIAL_PERENNIAL as source } from './residential-perennial-data';

/** Blender-authored seven-face plant, using the existing 0.286 m clearance disk.
 * Local source metres are retained; only the existing seeded height is applied.
 * One shared perimeter prevents the old face-dependent radii from opening seams.
 */
export function residentialPerennial(
  x: number,
  z: number,
  base: number,
  seed: number,
  sample: (x: number, z: number, fallback: number) => number | undefined,
) {
  const angle = seed % 7,
    c = Math.cos(angle),
    s = Math.sin(angle),
    height = 0.19 + (seed % 4) * 0.022;
  const vertices = source.vertices.map(([sx, sy, sz]) => {
    const px = x + sx * c - sz * s,
      pz = z + sx * s + sz * c;
    // Tip follows the old plant's center elevation, perimeter follows terrain.
    const y = sy > 0.229 ? base : (sample(px, pz, base) ?? base);
    return [px, y + 0.025 + ((sy - 0.025) / 0.205) * (height - 0.025), pz];
  });
  return {
    positions: source.triangles.flatMap((face) =>
      face.flatMap((i) => vertices[i]),
    ),
    colors: source.colors.flat(2),
  };
}
