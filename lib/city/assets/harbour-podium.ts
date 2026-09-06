/** Original Spencer podium depth refinement, not a surveyed heritage replica. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid).
 * Source footprint / 21m model roof retained. No interior navigation is added. */
import * as THREE from 'three';
import {
  FacadeSurface,
  finishFacade,
  type Point2,
  type Point3,
} from './facade-surface';
export type HarbourPodiumOptions = {
  resolvedBays?: HarbourBay[];
  /** Explicitly selected rendered surface Y in building-local metres, or null.
   * No callback => preserve window bays, do not invent any grounded doorway. */
  actualSurface?: (x: number, z: number) => number | null | undefined;
};
export type HarbourBay = {
  edge: number;
  index: number;
  left: number;
  right: number;
  origin: Point2;
  tangent: Point2;
  normal: Point2;
  entry: boolean;
  threshold: number;
  head: number;
  reason?: string;
};
const YAW = -0.8;
export const HARBOUR_PODIUM_CONTRACT = {
  height: 21,
  rows: 4,
  windowRecess: 0.42,
  entryRecess: 0.95,
  modelWindowTop: 5.35,
  minimumClearance: 2.4,
  entryStatus: 'Selected source-model bays; not surveyed entrance positions.',
} as const;
export function harbourPoint(
  bay: HarbourBay,
  u: number,
  y: number,
  depth = 0,
): Point3 {
  return [
    bay.origin[0] + bay.tangent[0] * u - bay.normal[0] * depth,
    y,
    bay.origin[1] + bay.tangent[1] * u - bay.normal[1] * depth,
  ];
}
export function planHarbourPodium(
  ring: readonly Point2[],
  options: HarbourPodiumOptions = {},
) {
  const area = ring.reduce((n, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return n + a[0] * b[1] - b[0] * a[1];
    }, 0),
    bays: HarbourBay[] = [];
  ring.forEach((a, edge) => {
    const b = ring[(edge + 1) % ring.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    if (length < 0.05) return;
    const tangent: Point2 = [dx / length, dz / length],
      normal: Point2 =
        area > 0 ? [tangent[1], -tangent[0]] : [-tangent[1], tangent[0]],
      count = Math.max(1, Math.floor(length / 4.7)),
      pitch = length / count;
    const worldNormalX = Math.cos(YAW) * normal[0] + Math.sin(YAW) * normal[1];
    for (let index = 0; index < count; index++) {
      const width = Math.max(0, Math.min(pitch - 1.1, 3.1)),
        center = (index + 0.5) * pitch,
        bay: HarbourBay = {
          edge,
          index,
          left: center - width / 2,
          right: center + width / 2,
          origin: a,
          tangent,
          normal,
          entry: false,
          threshold: 1.85,
          head: 5.35,
        };
      // One representative central bay per long westward-facing source edge.
      // Contact, rather than a claimed gate location, decides whether it is a door.
      const candidate =
        length > 25 &&
        worldNormalX < -0.4 &&
        index === Math.floor(count / 2) &&
        width >= 2.4;
      if (candidate && options.actualSurface) {
        const heights: number[] = [];
        let invalid = false;
        for (const u of [bay.left + 0.1, center, bay.right - 0.1])
          for (const depth of [-0.04, 0.95]) {
            const p = harbourPoint(bay, u, 0, depth),
              h = options.actualSurface(p[0], p[2]);
            if (h === null || h === undefined || !Number.isFinite(h)) {
              invalid = true;
              break;
            }
            heights.push(h);
          }
        const threshold = Math.max(...heights) + 0.025;
        if (invalid)
          bay.reason = 'No explicit rendered surface across threshold/recess';
        else if (Math.max(...heights) - Math.min(...heights) > 0.18)
          bay.reason = 'Threshold/recess relief exceeds 18cm';
        else if (threshold < 0 || bay.head - threshold < 2.4)
          bay.reason = 'No safe opening in retained podium ground band';
        else {
          bay.entry = true;
          bay.threshold = threshold;
        }
      } else if (candidate)
        bay.reason = 'No actual-surface callback; retained as window';
      bays.push(bay);
    }
  });
  return bays;
}
export function createHarbourPodium(
  detail: boolean,
  ring: readonly Point2[],
  options: HarbourPodiumOptions = {},
) {
  const stone = new FacadeSurface(),
    glass = new FacadeSurface(),
    bays = options.resolvedBays ?? planHarbourPodium(ring, options),
    faceColor = 0xb8ad91;
  // Exact source polygon top/bottom caps; no solid extruded walls behind recesses.
  const indices = THREE.ShapeUtils.triangulateShape(
    ring.map((p) => new THREE.Vector2(...p)),
    [],
  );
  for (const triangle of indices) {
    const p = triangle.map((i) => ring[i]);
    stone.triangle(
      [p[0][0], 21, p[0][1]],
      [p[1][0], 21, p[1][1]],
      [p[2][0], 21, p[2][1]],
      faceColor,
      [0, 1, 0],
    );
    stone.triangle(
      [p[0][0], 0, p[0][1]],
      [p[1][0], 0, p[1][1]],
      [p[2][0], 0, p[2][1]],
      faceColor,
      [0, -1, 0],
    );
  }
  for (const b of bays) {
    const edgeEnd = ring[(b.edge + 1) % ring.length],
      length = Math.hypot(edgeEnd[0] - b.origin[0], edgeEnd[1] - b.origin[1]),
      count = Math.max(1, Math.floor(length / 4.7)),
      pitch = length / count,
      start = b.index * pitch,
      end = (b.index + 1) * pitch,
      normal: Point3 = [b.normal[0], 0, b.normal[1]],
      p = (u: number, y: number, d = 0) => harbourPoint(b, u, y, d);
    const face = (
      u0: number,
      u1: number,
      y0: number,
      y1: number,
      c = faceColor,
      d = 0,
    ) => {
      if (u1 - u0 > 0.001 && y1 - y0 > 0.001)
        stone.quad(
          p(u0, y0, d),
          p(u1, y0, d),
          p(u1, y1, d),
          p(u0, y1, d),
          c,
          normal,
        );
    };
    if (b.right - b.left < 0.55) {
      face(start, end, 0, 21);
      continue;
    }
    face(start, b.left, 0, 21);
    face(b.right, end, 0, 21);
    let previous = 0;
    for (let row = 0; row < 4; row++) {
      const center = row * 4.15 + 3.6,
        h = row === 0 ? 3.5 : 2.85,
        low = row === 0 ? b.threshold : center - h / 2,
        high = center + h / 2,
        depth = row === 0 && b.entry ? 0.95 : 0.42;
      face(b.left, b.right, previous, low);
      previous = high;
      const left = b.left,
        right = b.right;
      stone.quad(
        p(left, low),
        p(left, low, depth),
        p(left, high, depth),
        p(left, high),
        0x9b987f,
        [b.tangent[0], 0, b.tangent[1]],
      );
      stone.quad(
        p(right, low, depth),
        p(right, low),
        p(right, high),
        p(right, high, depth),
        0xaaa086,
        [-b.tangent[0], 0, -b.tangent[1]],
      );
      stone.quad(
        p(left, low),
        p(right, low),
        p(right, low, depth),
        p(left, low, depth),
        0xd9cbb0,
        [0, 1, 0],
      );
      stone.quad(
        p(left, high),
        p(left, high, depth),
        p(right, high, depth),
        p(right, high),
        0x8e8b77,
        [0, -1, 0],
      );
      glass.quad(
        p(left, low, depth),
        p(right, low, depth),
        p(right, high, depth),
        p(left, high, depth),
        (b.index + row) % 3 === 0 ? 0x3c5358 : 0x40575a,
        normal,
      );
      // Slender recessed steel sash; frontage and openings stay physically aligned.
      const inset = depth - 0.035,
        frame = 0x59625c,
        w = right - left;
      for (const [u0, u1, y0, y1] of [
        [left, left + 0.055, low, high],
        [right - 0.055, right, low, high],
        [left, right, low, low + 0.055],
        [left, right, high - 0.055, high],
      ])
        face(u0, u1, y0, y1, frame, inset);
      for (const f of [1 / 3, 2 / 3])
        face(
          left + w * f - 0.022,
          left + w * f + 0.022,
          low,
          high,
          frame,
          inset,
        );
      for (const f of detail ? [0.25, 0.5, 0.75] : [0.5])
        face(
          left,
          right,
          low + (high - low) * f - 0.018,
          low + (high - low) * f + 0.018,
          frame,
          inset,
        );
      if (row === 0 && b.entry) {
        for (const f of [0.44, 0.56])
          face(
            left + w * f - 0.03,
            left + w * f + 0.03,
            low + 0.9,
            Math.min(low + 1.28, high - 0.12),
            0xaab0a2,
            depth - 0.075,
          );
        if (high - low > 2.9)
          face(left, right, low + 2.55, low + 2.61, frame, inset);
      }
      // A shallow sloped sill has real top/front depth without increasing envelope.
      if (!b.entry || row > 0) {
        face(left - 0.045, right + 0.045, low - 0.1, low, 0xd8cbb0, 0.005);
        stone.quad(
          p(left - 0.045, low, 0.005),
          p(right + 0.045, low, 0.005),
          p(right, low + 0.04, 0.14),
          p(left, low + 0.04, 0.14),
          0xe0d3b8,
          [0, 1, 0],
        );
      }
    }
    face(b.left, b.right, previous, 21);
    // Preserve six horizontal datum bands, within the previous trim projection.
    for (const y of [1.6, 5.9, 10.1, 14.3, 18.5, 20.8]) {
      if (b.entry && y === 1.6) {
        face(start, b.left, y - 0.13, y + 0.13, 0xe0d2b2, -0.075);
        face(b.right, end, y - 0.13, y + 0.13, 0xe0d2b2, -0.075);
      } else
        face(
          start,
          end,
          y - (y > 20 ? 0.36 : 0.13),
          Math.min(21, y + (y > 20 ? 0.36 : 0.13)),
          0xe0d2b2,
          -0.075,
        );
    }
    if (detail) {
      // Restrained stepped pilaster channels, not unsourced replicated heraldry.
      const u = start + 0.25;
      face(u, u + 0.09, 5.55, 20.2, 0xc8bb9c, -0.06);
      face(u + 0.13, u + 0.2, 5.55, 20.2, 0xa1967e, -0.061);
    }
  }
  return finishFacade(
    'Harbour Centre / original recessed Spencer podium',
    detail,
    [
      { surface: stone, role: 'masonry', roughness: 0.79, metalness: 0.04 },
      {
        surface: glass,
        role: 'glass',
        roughness: 0.29,
        metalness: 0.21,
        emissive: 0xd7ba87,
        night: 0.16,
      },
    ],
    {
      bays,
      entries: bays.filter((b) => b.entry),
      contract: HARBOUR_PODIUM_CONTRACT,
      noInteriorAccess: true,
    },
  );
}
