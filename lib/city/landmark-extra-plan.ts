import type { ResolvedGroundPlanBase } from './landmark-worker-protocol';
import type { BCPlaceEntry } from './assets/bc-place-envelope';
import type { HarbourBay } from './assets/harbour-podium';
import type { ConventionEntry } from './assets/convention-entry';
export type ResolvedExtraPlan =
  | (ResolvedGroundPlanBase & {
      kind: 'bc-place';
      entries: BCPlaceEntry[];
      rejected: { index: number; reason: string }[];
    })
  | (ResolvedGroundPlanBase & { kind: 'harbour'; bays: HarbourBay[] })
  | (ResolvedGroundPlanBase & {
      kind: 'convention';
      entries: ConventionEntry[];
    })
  | (ResolvedGroundPlanBase & { kind: 'vancouver-house' });
