import type { Extent, Profile } from './facade-profile';

/** Original representative heritage relief, in metres along an unchanged wall.
 * It is a shallow finish layer, not surveyed architecture or a new entrance.
 * Shop openings remain completely clear, including when the GLB falls back. */
export type HeritageOpening = { center: number; threshold: number };
export type HeritageRelief = {
  kind:
    | 'plinth'
    | 'plinth-cap'
    | 'pier'
    | 'pier-foot'
    | 'pier-cap'
    | 'course'
    | 'course-shadow';
  u: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  offset: number;
  color: number;
};
export const HERITAGE_RELIEF = {
  openingHalfWidth: 2.75,
  maxProjection: 0.3,
  maximumBoxesPerEdge: 96,
  sampleStep: 0.75,
} as const;

/** All samples are from actual pavement at the finish's outer edge. Reject
 * interrupted pavement and abrupt grades rather than invent steps/ground. */
function grades(
  left: number,
  right: number,
  pavement: (u: number) => number | null,
): { low: number; high: number } | null {
  const count = Math.max(
    1,
    Math.ceil((right - left) / HERITAGE_RELIEF.sampleStep),
  );
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i <= count; i++) {
    const y = pavement(left + ((right - left) * i) / count);
    if (y === null || !Number.isFinite(y)) return null;
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return high - low <= 0.18 + 1e-8 ? { low, high } : null;
}

export function heritageFrontage(
  length: number,
  ground: number,
  profile: Profile,
  extent: Extent,
  openings: readonly HeritageOpening[],
  pavement: (u: number) => number | null,
): HeritageRelief[] {
  if (
    profile.kind !== 'heritage-brick' ||
    extent.minHeightM !== 0 ||
    ![length, ground, extent.heightM].every(Number.isFinite) ||
    length < 9 ||
    length > 75
  )
    return [];
  const accepted = openings
    .filter(
      (o) =>
        Number.isFinite(o.center) &&
        Number.isFinite(o.threshold) &&
        o.center >= HERITAGE_RELIEF.openingHalfWidth &&
        o.center <= length - HERITAGE_RELIEF.openingHalfWidth &&
        o.threshold >= ground,
    )
    .sort((a, b) => a.center - b.center);
  if (!accepted.length) return [];
  const boxes: HeritageRelief[] = [];
  const stone = [0x9f9686, 0xaaa08a, 0xa69982][profile.seed % 3];
  const cap = [0xb8ae99, 0xb9af99, 0xbbae97][profile.seed % 3];
  const top = Math.min(
    ground + profile.groundStoreyM + profile.pane[2] * profile.storeyM - 0.22,
    ground + extent.heightM - 0.35,
  );
  const courseBottom = top - 0.38;
  // A common datum joins the small shop bays to their parent building. It
  // remains behind the existing hood/crown and below the upper-window sill.
  if (accepted.every((o) => o.threshold + 2.65 < courseBottom)) {
    for (const [kind, height, y, depth, offset, color] of [
      ['course-shadow', 0.065, courseBottom + 0.02, 0.13, 0.08, 0x625e51],
      ['course', 0.24, courseBottom + 0.17, 0.26, 0.12, stone],
      ['course', 0.085, top - 0.0425, 0.3, 0.15, cap],
    ] as const)
      boxes.push({
        kind,
        u: length / 2,
        width: length - 0.12,
        height,
        y,
        depth,
        offset,
        color,
      });
  }
  // Subtract every full fallback/hood opening. This also leaves the much
  // narrower detailed GLB entrance clear at every LOD and on load failure.
  const gaps: [number, number][] = [];
  let cursor = 0.12;
  for (const opening of accepted) {
    const left = opening.center - HERITAGE_RELIEF.openingHalfWidth;
    if (left > cursor + 0.24) gaps.push([cursor, left]);
    cursor = Math.max(
      cursor,
      opening.center + HERITAGE_RELIEF.openingHalfWidth,
    );
  }
  if (cursor < length - 0.36) gaps.push([cursor, length - 0.12]);
  for (const [left, right] of gaps) {
    const grade = grades(left, right, pavement);
    if (!grade || grade.low < ground) continue;
    const baseTop = grade.high + 0.52;
    if (baseTop + 1.5 >= courseBottom) continue;
    const u = (left + right) / 2,
      width = right - left;
    // Embed the foot 3 cm into the lowest measured pavement so a gentle grade
    // cannot leave a floating bottom edge; no walkable/collision plane changes.
    const bottom = grade.low - 0.03;
    boxes.push(
      {
        kind: 'plinth',
        u,
        y: (bottom + baseTop) / 2,
        width,
        height: baseTop - bottom,
        depth: 0.16,
        offset: 0.08,
        color: stone,
      },
      {
        kind: 'plinth-cap',
        u,
        y: baseTop + 0.035,
        width,
        height: 0.07,
        depth: 0.23,
        offset: 0.115,
        color: cap,
      },
    );
    // Narrow piers articulate the long blank gaps without becoming obstacles
    // in the walking corridor. All relief stays inside a 30 cm wall envelope.
    const pierWidth = Math.min(0.38, width - 0.08);
    if (pierWidth >= 0.24) {
      const bottomY = baseTop + 0.07,
        pierTop = courseBottom - 0.05;
      boxes.push(
        {
          kind: 'pier',
          u,
          y: (bottomY + pierTop) / 2,
          width: pierWidth,
          height: pierTop - bottomY,
          depth: 0.18,
          offset: 0.09,
          color: stone,
        },
        {
          kind: 'pier-foot',
          u,
          y: bottomY + 0.08,
          width: pierWidth + 0.06,
          height: 0.16,
          depth: 0.25,
          offset: 0.125,
          color: cap,
        },
        {
          kind: 'pier-cap',
          u,
          y: pierTop - 0.08,
          width: pierWidth + 0.08,
          height: 0.16,
          depth: 0.28,
          offset: 0.14,
          color: cap,
        },
      );
    }
  }
  return boxes.slice(0, HERITAGE_RELIEF.maximumBoxesPerEdge);
}
