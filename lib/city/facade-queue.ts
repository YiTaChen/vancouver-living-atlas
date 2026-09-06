import * as THREE from 'three';
import type { FacadeInput } from './facade-plan';
import { FacadePageBuilder } from './facade-pages';
export interface FacadeRequest {
  id: string;
  items: readonly FacadeInput[];
  version: string;
  priority: number;
}
interface Ready {
  group: THREE.Group;
  pages: THREE.BufferGeometry[];
  version: string;
  bytes: number;
  usedBytes: number;
  boxes: number;
  used: number;
}
interface Record {
  request: FacadeRequest;
  ready: Ready | null;
  failedVersion?: string;
}
interface Job {
  token: number;
  request: FacadeRequest;
  builder: FacadePageBuilder;
  group: THREE.Group;
  prepared: Set<number>;
  prepareCursor: number;
  controller: AbortController;
}
export interface FacadeQueueOptions {
  budgetMs?: number;
  maxTokensPerStep?: number;
  pageBoxes?: number;
  maxCacheCells?: number;
  maxCacheBytes?: number;
  maxPendingBytes?: number;
  now?: () => number;
  onShadowDirty?: () => void;
  /** Optional actual GPU preparation hook, one page request per pump. ack() only
   * after completion; respect signal before rendering/using an obsolete page. */
  preparePage?: (request: {
    token: number;
    pageIndex: number;
    mesh: THREE.Mesh;
    signal: AbortSignal;
    /** Success when omitted; active asynchronous failures must not publish. */
    ack: (error?: unknown) => void;
  }) => void;
}
/** Single active builder + bounded completed cache. Call pump EVERY frame,
 * even when the 20 m camera selection threshold did not change. */
export class IncrementalFacadeQueue {
  readonly records = new Map<string, Record>();
  readonly host: THREE.Group;
  readonly material: THREE.Material;
  readonly metrics = {
    steps: 0,
    pumps: 0,
    completed: 0,
    cancelled: 0,
    evicted: 0,
    failed: 0,
    maxStepMs: 0,
    maxPumpMs: 0,
    budgetOverruns: 0,
  };
  lastError: string | null = null;
  private requests: FacadeRequest[] = [];
  private job: Job | null = null;
  private preparing: {
    job: Job;
    mesh: THREE.Mesh;
    index: number;
    retained: boolean;
  } | null = null;
  private serial = 0;
  private tick = 0;
  private disposed = false;
  private options: Required<
    Omit<FacadeQueueOptions, 'onShadowDirty' | 'preparePage'>
  > &
    Pick<FacadeQueueOptions, 'onShadowDirty' | 'preparePage'>;
  constructor(
    host: THREE.Group,
    material: THREE.Material,
    options: FacadeQueueOptions = {},
  ) {
    this.host = host;
    this.material = material;
    this.options = {
      budgetMs: options.budgetMs ?? 2,
      maxTokensPerStep: options.maxTokensPerStep ?? 8,
      pageBoxes: options.pageBoxes ?? 1024,
      maxCacheCells: options.maxCacheCells ?? 32,
      maxCacheBytes: options.maxCacheBytes ?? 96 * 1024 * 1024,
      maxPendingBytes: options.maxPendingBytes ?? 8 * 1024 * 1024,
      now: options.now ?? (() => performance.now()),
      onShadowDirty: options.onShadowDirty,
      preparePage: options.preparePage,
    };
    const o = this.options;
    if (
      ![
        o.budgetMs,
        o.maxTokensPerStep,
        o.pageBoxes,
        o.maxCacheCells,
        o.maxCacheBytes,
        o.maxPendingBytes,
      ].every(Number.isFinite) ||
      o.budgetMs <= 0 ||
      o.budgetMs > 2 ||
      !Number.isInteger(o.maxCacheCells) ||
      o.maxCacheCells < 1 ||
      !Number.isInteger(o.maxTokensPerStep) ||
      o.maxTokensPerStep < 1 ||
      o.maxTokensPerStep > 64 ||
      !Number.isInteger(o.pageBoxes) ||
      o.pageBoxes < 1 ||
      o.pageBoxes > 2048 ||
      o.maxCacheBytes <= 0 ||
      o.maxPendingBytes <= 0
    )
      throw new Error('Invalid facade queue limits');
  }
  get cacheBytes() {
    return [...this.records.values()].reduce(
      (n, r) => n + (r.ready?.bytes ?? 0),
      0,
    );
  }
  get pendingBytes() {
    return (
      (this.job?.builder.allocatedBytes ?? 0) +
      (this.preparing?.retained
        ? this.preparing.job.builder.allocatedPageBytes
        : 0)
    );
  }
  get pendingToken() {
    return this.job?.token;
  }
  get pendingId() {
    return this.job?.request.id;
  }
  select(requests: readonly FacadeRequest[]) {
    if (this.disposed) return;
    if (new Set(requests.map((r) => r.id)).size !== requests.length)
      throw new Error('Duplicate facade request');
    this.tick++;
    this.requests = [...requests].sort((a, b) => a.priority - b.priority);
    let dirty = false;
    const active = new Set(this.requests.map((r) => r.id));
    for (const request of this.requests) {
      let record = this.records.get(request.id);
      if (!record) {
        record = { request, ready: null };
        this.records.set(request.id, record);
      } else record.request = request;
      if (record.ready) record.ready.used = this.tick;
    }
    for (const [id, record] of this.records)
      if (record.ready) {
        const visible = active.has(id);
        if (record.ready.group.visible !== visible) {
          record.ready.group.visible = visible;
          dirty = true;
        }
      }
    if (
      this.job &&
      !this.requests.some(
        (r) =>
          r.id === this.job!.request.id &&
          r.version === this.job!.request.version,
      )
    )
      this.cancelJob();
    if (dirty) this.options.onShadowDirty?.();
  }
  private cancelJob() {
    const job = this.job;
    if (!job) return;
    const keep = this.preparing?.job === job ? this.preparing : undefined;
    // Mark retention BEFORE abort: a well-behaved hook may ack synchronously in
    // its abort listener. That ack must dispose the retained page exactly once.
    if (keep) keep.retained = true;
    job.builder.cancel(keep?.mesh.geometry);
    job.group.clear();
    this.job = null;
    this.metrics.cancelled++;
    job.controller.abort();
  }
  private next() {
    if (this.preparing) return; // One global GPU preparation; aborted hooks must ack to release it.
    const r = this.requests.find((r) => {
      const c = this.records.get(r.id)!;
      return c.ready?.version !== r.version && c.failedVersion !== r.version;
    });
    if (!r) return;
    this.job = {
      token: ++this.serial,
      request: r,
      builder: new FacadePageBuilder(r.items, {
        pageBoxes: this.options.pageBoxes,
        maxBytes: this.options.maxPendingBytes,
      }),
      group: new THREE.Group(),
      prepared: new Set(),
      prepareCursor: 0,
      controller: new AbortController(),
    };
    this.job.group.name = 'Facade reveals and balconies';
  }
  private capacity(job: Job) {
    const old = this.records.get(job.request.id)?.ready,
      required = job.builder.allocatedBytes;
    if (required > this.options.maxCacheBytes) return false;
    const wanted = new Set(this.requests.map((r) => r.id));
    const candidates = [...this.records.entries()]
      .filter(([id, r]) => r.ready && !wanted.has(id))
      .sort((a, b) => a[1].ready!.used - b[1].ready!.used);
    const readyCount = () =>
      [...this.records.values()].filter((r) => r.ready).length;
    while (
      this.cacheBytes - (old?.bytes ?? 0) + required >
        this.options.maxCacheBytes ||
      readyCount() + (old ? 0 : 1) > this.options.maxCacheCells
    ) {
      const candidate = candidates.shift();
      if (!candidate) return false;
      this.release(candidate[1]);
      this.metrics.evicted++;
    }
    return true;
  }
  private release(record: Record) {
    if (!record.ready) return;
    this.host.remove(record.ready.group);
    record.ready.pages.forEach((g) => g.dispose());
    record.ready.group.clear();
    record.ready = null;
  }
  private publish(job: Job) {
    if (
      this.job !== job ||
      job.controller.signal.aborted ||
      !this.requests.some(
        (r) => r.id === job.request.id && r.version === job.request.version,
      )
    )
      return;
    if (!this.capacity(job)) return;
    const record = this.records.get(job.request.id)!;
    // No page has been attached to the visible scene before this synchronous swap.
    const previous = record.ready;
    job.group.visible = true;
    this.host.add(job.group);
    record.ready = {
      group: job.group,
      pages: [...job.builder.pages],
      version: job.request.version,
      bytes: job.builder.allocatedBytes,
      usedBytes: job.builder.usedBytes,
      boxes: job.builder.boxes,
      used: this.tick,
    };
    if (previous) {
      this.host.remove(previous.group);
      previous.pages.forEach((g) => g.dispose());
      previous.group.clear();
    }
    this.job = null;
    this.metrics.completed++;
    this.options.onShadowDirty?.();
  }
  pump() {
    if (this.disposed) return;
    this.metrics.pumps++;
    const now = this.options.now,
      start = now();
    let stepCount = 0,
      preparedThisPump = false;
    // Time is a soft deadline checked between bounded operations. A hard wall-
    // clock guarantee is impossible during GC/OS pauses; record any overshoot.
    while (now() - start < this.options.budgetMs && stepCount < 256) {
      if (!this.job) this.next();
      const job = this.job;
      if (!job) break;
      if (!job.builder.done) {
        const began = now();
        try {
          job.builder.step(this.options.maxTokensPerStep);
        } catch (error) {
          this.records.get(job.request.id)!.failedVersion = job.request.version;
          this.lastError = String(error);
          this.metrics.failed++;
          this.cancelJob();
          continue;
        }
        this.metrics.steps++;
        stepCount++;
        this.metrics.maxStepMs = Math.max(
          this.metrics.maxStepMs,
          now() - began,
        );
        continue;
      }
      // Geometry/page creation is already bounded in builder.step; mesh creation
      // and optional upload scheduling happen at most once in a pump.
      if (job.prepareCursor < job.builder.pages.length) {
        if (preparedThisPump || this.preparing) break;
        preparedThisPump = true;
        const i = job.prepareCursor++,
          mesh = new THREE.Mesh(job.builder.pages[i], this.material);
        mesh.name = 'Facade reveals and balconies';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        job.group.add(mesh);
        if (this.options.preparePage) {
          const ticket = { job, mesh, index: i, retained: false };
          this.preparing = ticket;
          try {
            this.options.preparePage({
              token: job.token,
              pageIndex: i,
              mesh,
              signal: job.controller.signal,
              ack: (error?: unknown) => {
                if (this.preparing !== ticket) return;
                this.preparing = null;
                // Cancelled resources may still be borrowed by the renderer.
                // Dispose only after its completion/abort acknowledgement.
                if (ticket.retained) {
                  mesh.geometry.dispose();
                  return;
                }
                if (this.job !== job || job.controller.signal.aborted) return;
                if (error !== undefined) {
                  this.records.get(job.request.id)!.failedVersion =
                    job.request.version;
                  this.lastError = String(error);
                  this.metrics.failed++;
                  this.cancelJob();
                } else job.prepared.add(i);
              },
            });
          } catch (error) {
            this.preparing = null;
            this.records.get(job.request.id)!.failedVersion =
              job.request.version;
            this.lastError = String(error);
            this.metrics.failed++;
            this.cancelJob();
          }
        } else job.prepared.add(i);
        continue;
      }
      if (job.prepared.size === job.builder.pages.length) {
        this.publish(job);
        if (this.job === job) break;
      } else break;
    }
    const elapsed = now() - start;
    this.metrics.maxPumpMs = Math.max(this.metrics.maxPumpMs, elapsed);
    if (elapsed > this.options.budgetMs) this.metrics.budgetOverruns++;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelJob();
    for (const r of this.records.values()) this.release(r);
    this.records.clear();
    this.requests = [];
  }
}
