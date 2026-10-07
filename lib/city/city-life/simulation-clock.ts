/** Isolated city-life prototype. Seconds are REAL simulation seconds, never the sky clock. */
export class SimulationClock {
  private accumulator = 0;
  private hidden = false;
  time = 0;
  constructor(
    readonly step = 0.05,
    readonly maxSteps = 4,
  ) {
    if (
      !Number.isFinite(step) ||
      step <= 0 ||
      !Number.isInteger(maxSteps) ||
      maxSteps < 1
    )
      throw new Error('Invalid bounded clock');
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    // No hidden-tab debt, including a partial pre-hide step.
    this.accumulator = 0;
  }
  advance(elapsed: number, tick: (dt: number, time: number) => void) {
    if (this.hidden || !Number.isFinite(elapsed) || elapsed <= 0) return 0;
    this.accumulator = Math.min(
      this.accumulator + elapsed,
      this.step * this.maxSteps,
    );
    let count = 0;
    while (this.accumulator + 1e-10 >= this.step && count < this.maxSteps) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      this.time += this.step;
      tick(this.step, this.time);
      count++;
    }
    return count;
  }
  get interpolationAlpha() {
    return this.accumulator / this.step;
  }
}
