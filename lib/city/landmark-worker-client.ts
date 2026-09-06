import {
  assertResolvedPlan,
  LANDMARK_WORKER_VERSION,
  type LandmarkId,
  type ResolvedGroundPlanBase,
  type LandmarkJob,
  type LandmarkWorkerResult,
} from './landmark-worker-protocol';

export interface LandmarkWorkerPort {
  postMessage(message: LandmarkJob): void;
  terminate(): void;
  onmessage: ((event: { data: LandmarkWorkerResult }) => void) | null;
  onerror:
    | ((event: { message?: string; preventDefault?: () => void }) => void)
    | null;
  onmessageerror: ((event: unknown) => void) | null;
}
export interface LandmarkWorkerMetric {
  landmark: LandmarkId;
  job: number;
  factoryMs: number;
  decodeMs: number;
  geometryBytes: number;
}
export interface LandmarkTicket<T> {
  promise: Promise<T>;
  cancel(): void;
}
type Job<T> = {
  message: LandmarkJob;
  priority: number;
  cancelled: boolean;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};
const aborted = () =>
  Object.assign(new Error('Landmark request cancelled'), {
    name: 'AbortError',
  });
let sessions = 0;

/** One worker and one active factory. Queue/cancel never runs heavy factories on main. */
export class LandmarkWorkerClient<T> {
  /** Optional diagnostics; does not include queue, packing, transfer or GPU time. */
  onMetrics?: (metric: LandmarkWorkerMetric) => void;
  private port: LandmarkWorkerPort | null = null;
  private jobs: Job<T>[] = [];
  private active: Job<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failure: Error | null = null;
  private disposed = false;
  private sequence = 0;
  private admitted = false;
  readonly session = `landmarks-${++sessions}`;
  constructor(
    private createPort: () => LandmarkWorkerPort,
    private decode: (packet: unknown) => T,
    private timeoutMs = 30_000,
  ) {}
  /** Call once immediately before Engine's landmarkDetails update loop. */
  beginFrame() {
    this.admitted = false;
  }
  admitGroup() {
    if (this.admitted || this.disposed) return false;
    this.admitted = true;
    return true;
  }
  request<P extends ResolvedGroundPlanBase>(
    landmark: LandmarkId,
    plan: P,
    priority: number,
  ): LandmarkTicket<T> {
    let job: Job<T> | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      try {
        if (this.disposed) throw aborted();
        if (this.failure) throw this.failure;
        assertResolvedPlan(plan, landmark);
        // Freeze this job's facts against subsequent caller mutation.
        const snapshot = structuredClone(plan);
        job = {
          message: {
            version: LANDMARK_WORKER_VERSION,
            session: this.session,
            job: ++this.sequence,
            landmark,
            plan: snapshot,
          },
          priority: Number.isFinite(priority) ? priority : Infinity,
          cancelled: false,
          resolve,
          reject,
        };
        this.jobs.push(job);
        this.pump();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      promise,
      cancel: () => {
        if (!job || job.cancelled) return;
        job.cancelled = true;
        job.reject(aborted());
        this.jobs = this.jobs.filter((candidate) => candidate !== job);
        // An active synchronous worker factory cannot process cancellation now.
        // Retain its slot until the matching response, then discard without decoding.
      },
    };
  }
  private pump() {
    if (this.disposed || this.failure || this.active || !this.jobs.length)
      return;
    try {
      if (!this.port) {
        this.port = this.createPort();
        this.port.onmessage = (event) => this.receive(event.data);
        this.port.onerror = (event) => {
          event.preventDefault?.();
          this.fail(new Error(event.message || 'Landmark worker failed'));
        };
        this.port.onmessageerror = () =>
          this.fail(new Error('Landmark worker message could not be decoded'));
      }
      this.jobs.sort(
        (a, b) => a.priority - b.priority || a.message.job - b.message.job,
      );
      this.active = this.jobs.shift()!;
      this.timer = setTimeout(
        () =>
          this.fail(
            new Error('Landmark worker timed out; medium model retained'),
          ),
        this.timeoutMs,
      );
      this.port.postMessage(this.active.message);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private receive(result: LandmarkWorkerResult) {
    if (
      this.disposed ||
      !this.active ||
      result?.session !== this.session ||
      result.job !== this.active.message.job
    )
      return;
    if (result.version !== LANDMARK_WORKER_VERSION) {
      this.fail(new Error('Landmark worker version mismatch'));
      return;
    }
    const job = this.active;
    this.active = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!job.cancelled) {
      if (!result.ok)
        job.reject(
          new Error(result.error || 'Landmark geometry generation failed'),
        );
      else {
        try {
          const callback = this.onMetrics;
          const start = callback ? performance.now() : 0;
          const decoded = this.decode(result.packet);
          if (callback) {
            const metric = {
              landmark: job.message.landmark,
              job: job.message.job,
              factoryMs: result.factoryMs,
              decodeMs: performance.now() - start,
              geometryBytes: result.geometryBytes,
            };
            // A local observer must never break the rendering request's ownership.
            try {
              callback(metric);
            } catch {
              /* observational only */
            }
          }
          job.resolve(decoded);
        } catch (error) {
          job.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
    this.pump();
  }
  private fail(error: Error) {
    if (this.disposed || this.failure) return;
    this.failure = error;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.reject(error);
    this.active = null;
    for (const job of this.jobs) job.reject(error);
    this.jobs.length = 0;
    this.closePort();
  }
  private closePort() {
    if (!this.port) return;
    this.port.onmessage = this.port.onerror = this.port.onmessageerror = null;
    this.port.terminate();
    this.port = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.reject(aborted());
    this.active = null;
    for (const job of this.jobs) job.reject(aborted());
    this.jobs.length = 0;
    this.closePort();
  }
}
