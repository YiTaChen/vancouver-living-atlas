// MAIN ONLY: consume explicit actual local surface samples before dispatch.
import {
  planBCPlaceEntries,
  bcPlaceEntryPoint,
  type BCPlaceEntry,
} from './assets/bc-place-envelope';
import { planHarbourPodium } from './assets/harbour-podium';
import { HARBOUR_PODIUM } from './assets/secondary-landmarks';
import { conventionEntryEdges } from './assets/convention-centre';
import { planConventionEntries } from './assets/convention-entry';
import {
  assertResolvedPlan,
  type ResolvedGroundPlanBase,
} from './landmark-worker-protocol';
import type { ResolvedExtraPlan } from './landmark-extra-plan';

/** Check the full recess, not merely the three outside shell samples. The
 * callback MUST already exclude upper/protected levels and unknown surfaces.
 * An unsupported/stepped/buried recess is retained as original solid wall. */
export function bcPlaceRecessRejection(
  entry: BCPlaceEntry,
  sampleLocal: (x: number, z: number) => number | null | undefined,
): string | undefined {
  const heights: number[] = [];
  for (const u of [-3.3, 0, 3.3])
    for (const depth of [-0.1, 1, 2.02]) {
      const p = bcPlaceEntryPoint(entry, u, entry.thresholdY, depth),
        h = sampleLocal(p[0], p[2]);
      if (h === null || h === undefined || !Number.isFinite(h))
        return 'Missing same-level actual surface across full 2 m entry recess';
      heights.push(h);
    }
  const low = Math.min(...heights),
    high = Math.max(...heights);
  if (high - low > 0.18) return 'Full entry/recess relief exceeds 18 cm';
  if (high > entry.thresholdY + 0.025)
    return 'Actual recess surface intrudes above the planned threshold';
  if (entry.thresholdY - low > 0.2)
    return 'Threshold lacks same-level support across the recess';
  // The retained first concrete ring begins at local 7.55 m. Do not cut it.
  if (entry.headY > 7.5 || entry.headY - high < 2.4)
    return 'Insufficient actual ground-to-head clearance below retained ring';
  return undefined;
}

export function resolveExtraLandmarkPlan(
  kind: ResolvedExtraPlan['kind'],
  placement: ResolvedGroundPlanBase['placement'],
  sourceRevision: string,
  sampleLocal: (x: number, z: number) => number | null | undefined,
): ResolvedExtraPlan {
  if (typeof sampleLocal !== 'function')
    throw new Error('Explicit actual-surface sampler required');
  const base = {
    schema: 1 as const,
    kind,
    sourceRevision,
    placement: { ...placement },
  };
  assertResolvedPlan(base, kind);
  // A null actual sample means NO entry, and never means a default threshold.
  if (kind === 'bc-place') {
    const plan = planBCPlaceEntries({ actualSurface: sampleLocal }),
      entries: BCPlaceEntry[] = [],
      rejected = [...plan.rejected];
    for (const entry of plan.entries) {
      const reason = bcPlaceRecessRejection(entry, sampleLocal);
      if (reason) rejected.push({ index: entry.index, reason });
      else entries.push(entry);
    }
    rejected.sort((a, b) => a.index - b.index);
    return { ...base, kind, entries, rejected };
  }
  if (kind === 'harbour')
    return {
      ...base,
      kind,
      bays: planHarbourPodium(HARBOUR_PODIUM, { actualSurface: sampleLocal }),
    };
  if (kind === 'convention')
    return {
      ...base,
      kind,
      entries: conventionEntryEdges().flatMap(
        (edge) =>
          planConventionEntries(edge, { actualSurface: sampleLocal }).entries,
      ),
    };
  return { ...base, kind: 'vancouver-house' };
}
