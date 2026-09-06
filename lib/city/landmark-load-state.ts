import type { LandmarkTicket } from './landmark-worker-client';
export type LandmarkLoadStatus =
  | 'idle'
  | 'loading'
  | 'preparing'
  | 'prepared'
  | 'ready'
  | 'failed'
  | 'disposed';
export interface LandmarkLoadHooks<T> {
  load(): LandmarkTicket<T>;
  /** Optional GPU compile/upload preparation. Honor AbortSignal; never attach here. */
  prepare?(group: T, signal: AbortSignal): void | Promise<void>;
  attach(group: T): void;
  release(group: T): void;
  error?(message: string): void;
}

/** Medium remains the owner's visible fallback until commit() succeeds. */
export class LandmarkLoadState<T> {
  status: LandmarkLoadStatus = 'idle';
  value: T | null = null;
  private token = 0;
  private ticket: LandmarkTicket<T> | null = null;
  private staged: T | null = null;
  private controller: AbortController | null = null;
  constructor(private hooks: LandmarkLoadHooks<T>) {}
  start() {
    if (this.status !== 'idle') return;
    const token = ++this.token;
    this.status = 'loading';
    try {
      this.ticket = this.hooks.load();
      this.ticket.promise.then(
        (group) => {
          if (token !== this.token || this.status === 'disposed') {
            this.hooks.release(group);
            return;
          }
          this.ticket = null;
          this.staged = group;
          this.controller = new AbortController();
          this.status = 'preparing';
          Promise.resolve()
            .then(() => {
              if (token !== this.token) return;
              return this.hooks.prepare?.(group, this.controller!.signal);
            })
            .then(() => {
              if (token === this.token) this.status = 'prepared';
            })
            .catch((error) => {
              if (token === this.token) this.failed(error);
            });
        },
        (error) => {
          if (token === this.token) this.failed(error);
        },
      );
    } catch (error) {
      if (token === this.token) this.failed(error);
    }
  }
  commit() {
    if (this.status !== 'prepared' || this.staged === null) return false;
    const group = this.staged;
    try {
      this.hooks.attach(group);
    } catch (error) {
      this.failed(error);
      return false;
    }
    this.value = group;
    this.staged = null;
    this.controller = null;
    this.status = 'ready';
    return true;
  }
  private failed(error: unknown) {
    this.status = 'failed';
    this.ticket = null;
    this.releaseStaged();
    this.hooks.error?.(error instanceof Error ? error.message : String(error));
  }
  private releaseStaged() {
    this.controller?.abort();
    this.controller = null;
    if (this.staged !== null) {
      this.hooks.release(this.staged);
      this.staged = null;
    }
  }
  cancel() {
    if (this.status === 'ready' || this.status === 'disposed') return;
    ++this.token;
    this.ticket?.cancel();
    this.ticket = null;
    this.releaseStaged();
    this.status = 'idle';
  }
  /** Failed jobs do not retry every frame. An explicit retry is possible. */
  retry() {
    if (this.status === 'failed') {
      this.status = 'idle';
      this.start();
    }
  }
  dispose() {
    if (this.status === 'disposed') return;
    ++this.token;
    this.ticket?.cancel();
    this.ticket = null;
    this.releaseStaged();
    // A committed group's resources belong to Engine's scene traversal.
    this.value = null;
    this.status = 'disposed';
  }
}
