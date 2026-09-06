import { project } from './geo';
import { landmarkLocalXZ } from './landmark-ground';
import { MARINE_ENTRY_CONTRACT, marineEntryPoint } from './assets/marine-entry';
import {
  SCIENCE_ENTRY_CONTRACT,
  scienceCanopyPoint,
} from './assets/science-entry';
import { CANADA_DETAIL_CONTRACT } from './assets/canada-detail';
import type { GroundPlanResult, ResolvedGroundPlan } from './landmark-plan';

/** MAIN THREAD ONLY. Run once after final ground topology, before factories.
 * An absent or implausible actual mesh sample is an explicit unavailable result.
 * Never manufacture a sidewalk by adding 1.18 to a DEM/road-height field.
 */
export function resolveLandmarkGroundPlan(
  kind: ResolvedGroundPlan['kind'],
  sampleWorld: (x: number, z: number) => number | undefined,
  sourceRevision: string,
): GroundPlanResult {
  const unavailable = (reason: string): GroundPlanResult => ({
    status: 'unavailable',
    kind,
    reason,
  });
  if (!sourceRevision) return unavailable('Ground source revision is required');
  if (kind === 'canada')
    return {
      status: 'ready',
      plan: {
        schema: 1,
        kind,
        sourceRevision,
        placement: { ...CANADA_DETAIL_CONTRACT.placement },
        deckTopY: 1.3,
      },
    };
  const placement =
    kind === 'marine'
      ? { ...MARINE_ENTRY_CONTRACT.placementMustRemain }
      : { ...SCIENCE_ENTRY_CONTRACT.placement };
  const origin = project([placement.lon, placement.lat]);
  const sample = (x: number, z: number) =>
    sampleWorld(...landmarkLocalXZ(origin, placement.yaw, x, z));
  if (kind === 'marine') {
    const approachSamples = [];
    for (const u of [
      -MARINE_ENTRY_CONTRACT.aperture.halfWidth,
      0,
      MARINE_ENTRY_CONTRACT.aperture.halfWidth,
    ]) {
      const d = 0.25,
        p = marineEntryPoint(u, 0, d),
        worldSurfaceY = sample(p[0], p[2]);
      if (worldSurfaceY === undefined || !Number.isFinite(worldSurfaceY))
        return unavailable(`No rendered ground at Marine portal u=${u}`);
      approachSamples.push({
        u,
        d,
        localXZ: [p[0], p[2]] as [number, number],
        worldSurfaceY,
      });
    }
    // The flat threshold clears all three measured approach points by 15 mm.
    // This preserves building/door XY. It does not add or flatten a forecourt.
    const thresholdY =
      Math.max(...approachSamples.map((s) => s.worldSurfaceY)) -
      placement.baseY +
      0.015;
    if (thresholdY < 0.16 || thresholdY > 6)
      return unavailable(
        `Marine local threshold outside supported range: ${thresholdY}`,
      );
    return {
      status: 'ready',
      plan: {
        schema: 1,
        kind,
        sourceRevision,
        placement,
        thresholdY,
        approachSamples,
      },
    };
  }
  if (kind !== 'science') return unavailable('Unsupported Stage 7 landmark');
  const thresholdY = SCIENCE_ENTRY_CONTRACT.defaultThresholdY,
    canopySoffitY = SCIENCE_ENTRY_CONTRACT.defaultCanopySoffitY;
  const specs = [
    ...[-5.2, 5.2].flatMap((x) =>
      [-5.85, 3.95].map((z) => ({ id: `support:${x}:${z}`, x, z })),
    ),
    ...[-6.12, 6.12].map((x) => ({ id: `pipe:${x}`, x, z: 3.9 })),
  ];
  const footings = [];
  for (const { id, x, z } of specs) {
    const p = scienceCanopyPoint(x, 0, z),
      height = sample(p[0], p[2]);
    if (height === undefined || !Number.isFinite(height))
      return unavailable(`No rendered ground at Science ${id}`);
    const surfaceY = height - placement.baseY;
    if (surfaceY < -20 || surfaceY >= canopySoffitY - 0.7)
      return unavailable(
        `Science ${id} is incompatible with the retained canopy datum`,
      );
    footings.push({ id, localXZ: [p[0], p[2]] as [number, number], surfaceY });
  }
  return {
    status: 'ready',
    plan: {
      schema: 1,
      kind,
      sourceRevision,
      placement,
      thresholdY,
      canopySoffitY,
      footings,
    },
  };
}
