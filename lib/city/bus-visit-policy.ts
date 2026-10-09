import type { VisualQuality } from './quality';

export type BusVisitDetail = 'auto' | 'light' | 'detailed';
export type BusVisitProfile = 'budget' | 'reference-lod0' | 'reference-lod1';
export interface BusVisitPolicy {
  quality: VisualQuality;
  compatible: boolean;
  detail: BusVisitDetail;
}
/** Resolve once when a visit is prepared. The traffic pool always keeps its
 * independent budget LOD1, and quality changes cannot replace an occupied cabin. */
export function busVisitProfile(policy: BusVisitPolicy): BusVisitProfile {
  if (policy.compatible || policy.detail === 'light') return 'budget';
  if (policy.detail === 'detailed') return 'reference-lod0';
  return policy.quality === 'balanced' ? 'reference-lod1' : 'reference-lod0';
}
