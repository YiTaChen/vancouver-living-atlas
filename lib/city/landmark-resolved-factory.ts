import {
  createScienceWorld,
  createCanadaPlace,
} from './assets/primary-landmarks';
import { createMarineBuilding } from './assets/secondary-landmarks';
import { MARINE_ENTRY_CONTRACT } from './assets/marine-entry';
import {
  SCIENCE_ENTRY_CONTRACT,
  scienceCanopyPoint,
} from './assets/science-entry';
import { CANADA_DETAIL_CONTRACT } from './assets/canada-detail';
import type { ResolvedGroundPlan, LandmarkPlacement } from './landmark-plan';
export type { ResolvedGroundPlan } from './landmark-plan';

function samePlacement(a: LandmarkPlacement, b: LandmarkPlacement) {
  return ['lon', 'lat', 'yaw', 'baseY'].every(
    (k) => a[k as keyof LandmarkPlacement] === b[k as keyof LandmarkPlacement],
  );
}
/** Worker-safe adapter: consumes only validated DTO values and pure factories.
 * Unsupported/missing samples throw. The worker runtime retains its existing
 * medium fallback on failure, rather than inventing a different building datum.
 */
export function createResolvedLandmark(
  detail: boolean,
  plan: ResolvedGroundPlan,
) {
  if (!plan || plan.schema !== 1 || !plan.sourceRevision)
    throw new Error('Invalid landmark ground plan');
  if (plan.kind === 'marine') {
    if (
      !samePlacement(plan.placement, MARINE_ENTRY_CONTRACT.placementMustRemain)
    )
      throw new Error('Marine placement changed');
    if (
      !Number.isFinite(plan.thresholdY) ||
      plan.thresholdY < 0.16 ||
      plan.thresholdY > 6
    )
      throw new Error('Invalid Marine threshold');
    return createMarineBuilding(detail, { thresholdY: plan.thresholdY });
  }
  if (plan.kind === 'science') {
    if (!samePlacement(plan.placement, SCIENCE_ENTRY_CONTRACT.placement))
      throw new Error('Science placement changed');
    if (
      !Number.isFinite(plan.thresholdY) ||
      plan.thresholdY < 1 ||
      plan.thresholdY > 2.5 ||
      !Number.isFinite(plan.canopySoffitY) ||
      plan.canopySoffitY - plan.thresholdY < 3.05 ||
      plan.canopySoffitY > 6
    )
      throw new Error('Invalid Science entrance height plan');
    if (
      plan.footings.length !== 6 ||
      !plan.footings.every(
        (p) =>
          p.localXZ.length === 2 &&
          p.localXZ.every(Number.isFinite) &&
          Number.isFinite(p.surfaceY),
      )
    )
      throw new Error('Incomplete Science footing plan');
    const keys = new Set(plan.footings.map((p) => p.localXZ.join(',')));
    if (keys.size !== 6) throw new Error('Duplicate Science footing positions');
    const required = [
      ...[-5.2, 5.2].flatMap((x) =>
        [-5.85, 3.95].map((z) => scienceCanopyPoint(x, 0, z)),
      ),
      ...[-6.12, 6.12].map((x) => scienceCanopyPoint(x, 0, 3.9)),
    ];
    if (
      !required.every(
        (p) =>
          plan.footings.filter(
            (f) => Math.hypot(f.localXZ[0] - p[0], f.localXZ[1] - p[2]) < 1e-7,
          ).length === 1,
      ) ||
      plan.footings.some(
        (f) => f.surfaceY < -20 || f.surfaceY >= plan.canopySoffitY - 0.7,
      )
    )
      throw new Error(
        'Science footing coordinates or heights do not match the factory',
      );
    return createScienceWorld(detail, {
      thresholdY: plan.thresholdY,
      canopySoffitY: plan.canopySoffitY,
      footingSurfaceY: (x, z) => {
        const matches = plan.footings.filter(
          (p) => Math.hypot(p.localXZ[0] - x, p.localXZ[1] - z) < 1e-7,
        );
        if (matches.length !== 1)
          throw new Error(`Unresolved Science footing ${x},${z}`);
        return matches[0].surfaceY;
      },
    });
  }
  if (plan.kind === 'canada') {
    if (
      !samePlacement(plan.placement, CANADA_DETAIL_CONTRACT.placement) ||
      plan.deckTopY !== 1.3
    )
      throw new Error('Canada fixed pier datum changed');
    return createCanadaPlace(detail);
  }
  throw new Error('Unsupported Stage 7 landmark plan');
}
