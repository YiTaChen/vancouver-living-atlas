// Worker-safe registry. No engine, DOM, main-only sampler or texture loading.
import {
  createResolvedLandmark,
  type ResolvedGroundPlan,
} from './landmark-resolved-factory';
import {
  createBCPlace,
  createHarbourCentre,
  HARBOUR_PODIUM,
  SECONDARY_LANDMARK_PLACEMENTS,
} from './assets/secondary-landmarks';
import {
  createConventionCentre,
  conventionEntryEdges,
} from './assets/convention-centre';
import {
  createVancouverHouse,
  VANCOUVER_HOUSE_CONTRACT,
} from './assets/vancouver-house';
import { planBCPlaceEntries } from './assets/bc-place-envelope';
import { planHarbourPodium } from './assets/harbour-podium';
import { planConventionEntries } from './assets/convention-entry';
import type { ResolvedExtraPlan } from './landmark-extra-plan';
import { assertResolvedPlan } from './landmark-worker-protocol';
export type ResolvedLandmarkPlan = ResolvedGroundPlan | ResolvedExtraPlan;

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) < 1e-7;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return a === b;
}
function placement(
  actual: ResolvedExtraPlan['placement'],
  expected: { lon: number; lat: number; yaw: number; baseY?: number },
) {
  if (
    actual.lon !== expected.lon ||
    actual.lat !== expected.lat ||
    actual.yaw !== expected.yaw ||
    (expected.baseY !== undefined && actual.baseY !== expected.baseY)
  )
    throw new Error('Preserved landmark placement changed');
}
export function createWorkerLandmark(
  detail: boolean,
  plan: ResolvedLandmarkPlan,
) {
  assertResolvedPlan(plan, plan.kind);
  if (
    plan.kind === 'marine' ||
    plan.kind === 'science' ||
    plan.kind === 'canada'
  )
    return createResolvedLandmark(detail, plan);
  let group;
  if (plan.kind === 'bc-place') {
    placement(plan.placement, SECONDARY_LANDMARK_PLACEMENTS.bcPlace);
    const ids = [...plan.entries, ...plan.rejected].map((e) => e.index);
    if (
      ids.length !== 24 ||
      new Set(ids).size !== 24 ||
      ids.some((i) => !Number.isInteger(i) || i < 0 || i > 23)
    )
      throw new Error('Incomplete BC gate plan');
    const heights = new Map(plan.entries.map((e) => [e.index, e.thresholdY]));
    const expected = planBCPlaceEntries({
      actualSurface: (_x, _z, gate) =>
        heights.has(gate) ? heights.get(gate)! - 0.02 : null,
    }).entries;
    if (
      expected.length !== plan.entries.length ||
      plan.entries.some((e) => {
        const p = expected.find((p) => p.index === e.index);
        return (
          !p ||
          Object.keys(p).some(
            (k) => !same(e[k as keyof typeof e], p[k as keyof typeof p]),
          )
        );
      })
    )
      throw new Error('BC plan changed gate geometry or safe threshold');
    group = createBCPlace(detail, {
      resolvedPlan: { entries: plan.entries, rejected: plan.rejected },
    });
  } else if (plan.kind === 'harbour') {
    placement(plan.placement, SECONDARY_LANDMARK_PLACEMENTS.harbourCentre);
    const expected = planHarbourPodium(HARBOUR_PODIUM, {
      actualSurface: () => null,
    });
    if (
      plan.bays.length !== expected.length ||
      plan.bays.some((b, i) => {
        const p = expected[i];
        for (const k of [
          'edge',
          'index',
          'left',
          'right',
          'origin',
          'tangent',
          'normal',
          'head',
        ] as const)
          if (!same(b[k], p[k])) return true;
        if (!b.entry) return !same(b.threshold, p.threshold);
        return (
          p.reason !== 'No explicit rendered surface across threshold/recess' ||
          b.threshold < 0 ||
          b.head - b.threshold < 2.4
        );
      })
    )
      throw new Error('Harbour plan changed source bays or safe threshold');
    group = createHarbourCentre(detail, { resolvedBays: plan.bays });
  } else if (plan.kind === 'convention') {
    placement(plan.placement, {
      lon: -123.1159678,
      lat: 49.2890752,
      yaw: -0.403,
      baseY: 4,
    });
    const edges = conventionEntryEdges(),
      keys = new Set<string>();
    for (const e of plan.entries) {
      const edge = edges.find(
        (p) => p.roofIndex === e.roofIndex && p.edgeIndex === e.edgeIndex,
      );
      const expected =
        edge &&
        planConventionEntries(edge, {
          actualSurface: () => e.threshold - 0.02,
        }).entries.find((p) => same(p.left, e.left));
      const key = `${e.roofIndex}/${e.edgeIndex}/${e.left}`;
      if (
        !expected ||
        keys.has(key) ||
        Object.keys(expected).some(
          (k) =>
            !same(e[k as keyof typeof e], expected[k as keyof typeof expected]),
        )
      )
        throw new Error(
          'Convention plan changed source entry or safe threshold',
        );
      keys.add(key);
    }
    group = createConventionCentre(detail, { resolvedEntries: plan.entries });
  } else if (plan.kind === 'vancouver-house') {
    placement(plan.placement, VANCOUVER_HOUSE_CONTRACT.placement);
    group = createVancouverHouse(detail);
  } else throw new Error('Unsupported resolved landmark');
  // Harbour/Vancouver House had a main-sampled base; carry that exact snapshot.
  group.userData.placement = { ...plan.placement };
  group.userData.resolvedGroundRevision = plan.sourceRevision;
  return group;
}
