import type { TeslaModelQuality } from './assets/tesla-roadster-contract';
import type { VisualQuality } from './quality';

export type TeslaQualityPreference = 'auto' | TeslaModelQuality;

/** The single player's mesh has a separate preference from city resolution.
 * Auto changes need a sustained context, never a fresh mesh per camera frame. */
export function preferredTeslaQuality(input: {
  preference: TeslaQualityPreference;
  city: VisualQuality;
  compatible: boolean;
  cockpit: boolean;
  speedMps: number;
}): TeslaModelQuality {
  if (input.preference !== 'auto') return input.preference;
  if (input.compatible) return 'low';
  if (input.cockpit) return input.city === 'balanced' ? 'medium' : 'high';
  if (Math.abs(input.speedMps) > 42) return 'low';
  return input.city === 'ultra' ? 'high' : 'medium';
}

export class TeslaQualityPolicy {
  private current: TeslaModelQuality = 'medium';
  private candidate: TeslaModelQuality = 'medium';
  private since = 0;
  private initialized = false;
  update(
    nowMs: number,
    input: Parameters<typeof preferredTeslaQuality>[0],
  ): TeslaModelQuality {
    const desired = preferredTeslaQuality(input);
    if (!this.initialized || input.preference !== 'auto') {
      this.initialized = true;
      this.current = this.candidate = desired;
      this.since = nowMs;
    } else if (desired !== this.candidate) {
      this.candidate = desired;
      this.since = nowMs;
    } else if (nowMs - this.since >= 2200) this.current = desired;
    return this.current;
  }
}
