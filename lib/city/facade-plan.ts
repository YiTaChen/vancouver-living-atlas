/** Original MIT. Exact deterministic descriptor sequence of the current
 * FacadeDetails.build. Checkpoints bound scans even when an edge emits no boxes. */
import { fitBays, windowRows, type Profile } from './facade-profile';
export interface FacadeInput {
  r: number[][];
  x: number;
  z: number;
  ground: number;
  h: number;
  min: number;
  profile: Profile;
}
export interface FacadeBox {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export function* facadeWork(
  items: readonly FacadeInput[],
): Generator<FacadeBox | null> {
  for (const { r, ground, h, min, profile } of items) {
    const area = r.reduce((s, a, i) => {
        const b = r[(i + 1) % r.length];
        return s + a[0] * b[1] - b[0] * a[1];
      }, 0),
      residential = profile.balconies;
    yield null;
    for (let edge = 0; edge < r.length; edge++) {
      const a = r[edge],
        b = r[(edge + 1) % r.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 8 || length > 100) {
        yield null;
        continue;
      }
      const nx = (area > 0 ? dz : -dz) / length,
        nz = (area > 0 ? -dx : dx) / length,
        yaw = -Math.atan2(dz, dx),
        grid = fitBays(profile, length),
        balcony = residential && edge % 2 === 0 && length < 55;
      const box = (
        width: number,
        height: number,
        depth: number,
        u: number,
        y: number,
        offset: number,
      ): FacadeBox => ({
        width,
        height,
        depth,
        x: a[0] + dx * u + nx * offset,
        y: ground + y,
        z: a[1] + dz * u + nz * offset,
        yaw,
      });
      for (const row of windowRows(profile, { minHeightM: min, heightM: h })) {
        const y = profile.groundStoreyM + row * profile.storeyM;
        if (y < min + 0.2) {
          yield null;
          continue;
        }
        if (balcony) {
          const span = grid.endM - grid.originM;
          yield box(span, 0.16, 1.15, 0.5, y, 0.48);
          yield box(span, 0.075, 0.075, 0.5, y + 1.05, 1.035);
          for (let j = 0; j <= grid.count; j++)
            yield box(
              0.065,
              1.05,
              0.065,
              (grid.originM + j * grid.pitchM) / length,
              y + 0.525,
              1.035,
            );
        } else yield box(length, 0.11, 0.13, 0.5, y, 0.035);
        yield null;
      }
      if (!residential)
        for (let j = 1; j < grid.count; j++)
          yield box(
            profile.frameWidthM,
            h - min - 0.4,
            profile.frameDepthM,
            (grid.originM + j * grid.pitchM) / length,
            (h + min) / 2,
            0.055,
          );
      yield box(length, 0.5, 0.35, 0.5, h - 0.1, 0.04);
      yield null;
    }
  }
}
