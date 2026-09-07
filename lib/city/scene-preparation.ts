/** Cooperative optional scenery construction. Physical surfaces and travel actors
 * are never owned by this queue. One item must itself be a bounded unit of work. */
export class ScenePreparationQueue {
  private jobs: Generator<void, void, unknown>[] = [];
  private disposed = false;
  readonly stats = { steps: 0, maxPumpMs: 0, finished: 0, failures: 0 };
  add(job: Generator<void, void, unknown>) {
    if (this.disposed) job.return();
    else this.jobs.push(job);
  }
  get pending() {
    return this.jobs.length;
  }
  pump(budgetMs: number, now = () => performance.now()) {
    if (this.disposed || budgetMs <= 0) return;
    const start = now();
    for (
      let steps = 0;
      this.jobs.length && steps < 64 && now() - start < budgetMs;
      steps++
    ) {
      let done = true;
      try {
        done = !!this.jobs[0].next().done;
      } catch {
        this.stats.failures++;
      }
      this.stats.steps++;
      if (done) {
        this.jobs.shift();
        this.stats.finished++;
      }
    }
    this.stats.maxPumpMs = Math.max(this.stats.maxPumpMs, now() - start);
  }
  dispose() {
    this.disposed = true;
    for (const job of this.jobs) job.return();
    this.jobs = [];
  }
}
