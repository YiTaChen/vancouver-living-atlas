/** Opt-in WebGL2 timer queries. Never waits for the GPU or changes scene quality. */
interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface RuntimeGpuSample {
  frameId: number;
  gpuElapsedMs: number;
}

export class RuntimeGpuTiming {
  private extension: TimerExtension | null = null;
  private active: { query: WebGLQuery; frameId: number } | null = null;
  private pending: { query: WebGLQuery; frameId: number }[] = [];
  private depth = 0;
  private disposed = false;
  status: 'unsupported' | 'ready' | 'context-lost' | 'failed' | 'disposed' =
    'unsupported';
  readonly stats = { issued: 0, skipped: 0, disjoint: 0, discarded: 0 };

  constructor(private readonly gl: WebGL2RenderingContext) {
    try {
      this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (this.extension) this.status = 'ready';
    } catch {
      this.status = 'failed';
    }
  }

  private usable() {
    if (this.disposed || this.status !== 'ready' || !this.extension)
      return false;
    if (this.gl.isContextLost()) {
      // Lost-context objects are invalid; do not issue GL cleanup commands.
      this.stats.discarded += this.pending.length + Number(!!this.active);
      this.pending = [];
      this.active = null;
      this.status = 'context-lost';
      return false;
    }
    return true;
  }

  begin(frameId: number) {
    try {
      if (!this.usable() || !this.extension) return;
      if (this.depth++ > 0) {
        this.stats.skipped++;
        return;
      }
      // Respect queries belonging to another owner and bound outstanding work.
      if (
        this.active ||
        this.pending.length >= 4 ||
        this.gl.getQuery(this.extension.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY)
      ) {
        this.stats.skipped++;
        return;
      }
      const query = this.gl.createQuery();
      if (!query) {
        this.stats.skipped++;
        return;
      }
      this.active = { query, frameId };
      this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
      this.stats.issued++;
    } catch {
      this.fail();
    }
  }

  end() {
    try {
      if (!this.depth || --this.depth > 0) return;
      if (!this.usable() || !this.extension || !this.active) return;
      if (
        this.gl.getQuery(
          this.extension.TIME_ELAPSED_EXT,
          this.gl.CURRENT_QUERY,
        ) !== this.active.query
      ) {
        this.gl.deleteQuery(this.active.query);
        this.stats.discarded++;
        this.active = null;
        return;
      }
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    } catch {
      this.fail();
    }
  }

  poll(): RuntimeGpuSample[] {
    const results: RuntimeGpuSample[] = [];
    try {
      if (!this.usable() || !this.extension) return results;
      if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
        this.stats.disjoint++;
        this.reset();
        return results;
      }
      // Remove each completed query immediately so a later polling failure cannot
      // count/delete an already accepted result again during cleanup.
      for (let index = this.pending.length - 1; index >= 0; index--) {
        const item = this.pending[index];
        if (
          !this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE)
        ) {
          continue;
        }
        const nanoseconds: unknown = this.gl.getQueryParameter(
          item.query,
          this.gl.QUERY_RESULT,
        );
        this.gl.deleteQuery(item.query);
        this.pending.splice(index, 1);
        if (
          typeof nanoseconds === 'number' &&
          Number.isFinite(nanoseconds) &&
          nanoseconds >= 0
        )
          results.push({
            frameId: item.frameId,
            gpuElapsedMs: nanoseconds / 1_000_000,
          });
        else this.stats.discarded++;
      }
    } catch {
      this.fail();
    }
    return results.reverse();
  }

  reset() {
    const active = this.active,
      pending = this.pending;
    this.active = null;
    this.pending = [];
    this.depth = 0;
    this.stats.discarded += pending.length + Number(!!active);
    try {
      if (!this.gl.isContextLost()) {
        if (
          active &&
          this.extension &&
          this.gl.getQuery(
            this.extension.TIME_ELAPSED_EXT,
            this.gl.CURRENT_QUERY,
          ) === active.query
        )
          this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
        if (active) this.gl.deleteQuery(active.query);
        for (const item of pending) this.gl.deleteQuery(item.query);
      }
    } catch {
      /* Diagnostics must never interrupt rendering. */
    }
  }

  private fail() {
    this.reset();
    this.status = 'failed';
  }

  snapshot() {
    return { status: this.status, pending: this.pending.length, ...this.stats };
  }

  dispose() {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.status = 'disposed';
  }
}
