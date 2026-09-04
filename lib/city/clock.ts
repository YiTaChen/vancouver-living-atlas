export interface ClockState {
  hour: number;
  rate: number;
  running: boolean;
}

export const CLOCK_RATES = [1, 10, 30, 60, 120, 300] as const;
export const DEFAULT_CLOCK: Readonly<ClockState> = {
  hour: 16,
  rate: 30,
  running: true,
};

export function wrapHour(hour: number) {
  return ((hour % 24) + 24) % 24;
}

export function formatClock(hour: number) {
  const minutes = Math.floor(wrapHour(hour) * 60 + 1e-7) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Preserve the existing daylight arc while making the night-to-midnight cycle continuous. */
export function sunAngle(hour: number) {
  const h = wrapHour(hour);
  if (h >= 6 && h < 20.5) return ((h - 6) / 14.5) * Math.PI;
  return Math.PI + (((h < 6 ? h + 24 : h) - 20.5) / 9.5) * Math.PI;
}

/** Monotonic scene clock. It never advances navigation, waves or traffic time. */
export class CityClock {
  private state: ClockState = { ...DEFAULT_CLOCK };
  private previous: number | null = null;
  private visible = true;
  constructor(initial: Partial<ClockState> = {}) {
    this.configure(initial, 0);
    this.previous = null;
  }
  get hour() {
    return this.state.hour;
  }
  snapshot(): ClockState {
    return { ...this.state };
  }
  resetTimebase(now: number) {
    if (Number.isFinite(now)) this.previous = now;
  }
  tick(now: number) {
    if (!Number.isFinite(now)) return false;
    if (this.previous !== null && now <= this.previous) return false;
    const elapsed =
      this.previous === null ? 0 : Math.max(0, now - this.previous);
    this.previous = now;
    if (!this.visible || !this.state.running || elapsed === 0) return false;
    this.state.hour = wrapHour(
      this.state.hour + (elapsed * this.state.rate) / 3_600_000,
    );
    return true;
  }
  configure(patch: Partial<ClockState>, now: number) {
    this.tick(now);
    if (patch.hour !== undefined && Number.isFinite(patch.hour))
      this.state.hour = wrapHour(patch.hour);
    if (patch.rate !== undefined && Number.isFinite(patch.rate))
      this.state.rate = Math.max(1, Math.min(300, patch.rate));
    if (typeof patch.running === 'boolean') this.state.running = patch.running;
    return this.snapshot();
  }
  setVisible(visible: boolean, now: number) {
    this.tick(now);
    this.visible = visible;
  }
}
