/** One model-backed collision/support shape for runtime, tests and offline QA. */
import {
  TESLA_ROADSTER_DIMENSIONS,
  TESLA_ROADSTER_GROUND_SUPPORT,
} from './assets/tesla-roadster-contract';
import type { TeslaShape, TeslaVec3 } from './tesla-state';

export function createTeslaRoadsterShape(clearance = 0.06): TeslaShape {
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 1)
    throw new Error('Invalid Tesla collision clearance');
  const height = TESLA_ROADSTER_DIMENSIONS.halfExtents[1] + clearance;
  return {
    halfExtents: [...TESLA_ROADSTER_DIMENSIONS.halfExtents],
    clearance,
    groundSupport: {
      wheelContacts: TESLA_ROADSTER_GROUND_SUPPORT.wheelContacts.map(
        (point) => [point[0], point[1] - height, point[2]] as TeslaVec3,
      ) as [TeslaVec3, TeslaVec3, TeslaVec3, TeslaVec3],
      chassisClearance: TESLA_ROADSTER_GROUND_SUPPORT.chassisClearance,
      suspensionTravel: TESLA_ROADSTER_GROUND_SUPPORT.suspensionTravel,
      bodySections: TESLA_ROADSTER_GROUND_SUPPORT.bodySections.map(
        (section) => ({ ...section }),
      ),
    },
  };
}
