import type { VisualQuality } from './quality';

export type AutoQualityMode = 'orbit' | 'walk' | 'drive' | 'boat' | 'flight';
type AutoTier = Extract<VisualQuality, 'balanced' | 'high'>;
type ResolutionScale = 1 | 0.8 | 0.65;

export interface AutoQualityObservation {
  nowMs: number;
  /** Actual foreground RAF interval; this includes CPU work and ordinary hitches. */
  frameMs: number;
  mode: AutoQualityMode;
  speedMps: number;
  altitudeM: number;
  moving: boolean;
  visible: boolean;
  transitioning: boolean;
  /** Compatible graphics can cap the tier while keeping adaptive resolution. */
  maxQuality?: AutoTier;
}

export interface AutoQualitySnapshot {
  quality: VisualQuality;
  /** Linear drawing-buffer/DPR multiplier, rather than a fraction of pixel area. */
  resolutionScale: ResolutionScale;
  /** Policy target, not a guarantee of delivered FPS or a refresh-rate estimate. */
  targetFps: number;
  reason: string;
  /** Median and nearest-rank p95 of the bounded recent foreground window. */
  frameMs: number | null;
  p95Ms: number | null;
  changes: number;
  mode: AutoQualityMode;
  capQuality: AutoTier;
  sampleCount: number;
  samples: number;
  excludedSamples: number;
  timingResets: number;
  decisions: number;
  lastFrameMs: number | null;
  maxFrameMs: number | null;
  /** Cumulative accepted intervals exceeding 100 ms, even when p95 stays low. */
  hitches: number;
  highPromotions: number;
  failedHighUpgrades: number;
  /** Retry delay counts only accepted foreground elapsed time. */
  highRetryMs: number;
}

interface FrameSample {
  nowMs: number;
  frameMs: number;
}

const MODES: readonly AutoQualityMode[] = [
  'orbit',
  'walk',
  'drive',
  'boat',
  'flight',
];
const SCALES: readonly ResolutionScale[] = [1, 0.8, 0.65];
const WINDOW_MS = 6_000;
const WINDOW_CAPACITY = 240;
const WARMUP_MS = 2_000;
const EVALUATION_MS = 500;
const COOLDOWN_MS = 4_000;
const SLOW_DWELL_MS = 2_500;
const PAUSE_GAP_MS = 5_000;

/**
 * Pure Auto policy. It neither sets renderer state nor controls manual High/Ultra.
 * The caller skips observe while manual and calls resetTiming on return to Auto,
 * page restore, load transitions, or a discontinuous clock. No GPU/CPU bottleneck
 * is inferred from RAF intervals: adaptive resolution is a bounded first attempt.
 */
export class AutoQualityController {
  private quality: AutoTier = 'balanced';
  private scale: ResolutionScale = 1;
  private mode: AutoQualityMode = 'orbit';
  private maxQuality: AutoTier = 'high';
  private moving = false;
  private reason = 'warming-up';
  private changes = 0;
  private accepted = 0;
  private excluded = 0;
  private resets = 0;
  private decisions = 0;
  private hitches = 0;
  private promotions = 0;
  private failedPromotions = 0;
  private retryAt = 0;
  private nextChangeAt = 0;
  private foregroundMs = 0;
  private warmupMs = 0;
  private lastNow: number | null = null;
  private nextEvaluationMs = 0;
  private slowSince: number | null = null;
  private headroomSince: number | null = null;
  private highHeadroomSince: number | null = null;
  private frames: FrameSample[] = [];
  private median: number | null = null;
  private p95: number | null = null;
  private maxFrame: number | null = null;
  private lastFrame: number | null = null;

  observe(input: AutoQualityObservation): AutoQualitySnapshot {
    if (!this.validContext(input)) {
      this.excluded++;
      return this.resetTiming('invalid-input');
    }

    const maxQuality = input.maxQuality ?? 'high';
    if (input.mode !== this.mode || maxQuality !== this.maxQuality) {
      this.mode = input.mode;
      this.maxQuality = maxQuality;
      // A mode/cap change is the only evidence of changed context available here.
      // It does not claim to detect another city block or a different GPU load.
      this.failedPromotions = 0;
      this.retryAt = this.foregroundMs;
      this.clearTiming('context-warmup');
    }
    this.moving = input.moving;

    if (this.cap() === 'balanced' && this.quality === 'high') {
      this.change(
        'balanced',
        this.scale,
        this.mode === 'flight' ? 'flight-cap' : 'quality-cap',
      );
    }
    if (!input.visible || input.transitioning) {
      this.excluded++;
      return this.resetTiming(!input.visible ? 'hidden' : 'transition');
    }
    if (
      !Number.isFinite(input.frameMs) ||
      input.frameMs <= 0 ||
      input.frameMs >= PAUSE_GAP_MS
    ) {
      this.excluded++;
      return this.resetTiming('invalid-frame');
    }

    const elapsed = this.lastNow === null ? 0 : input.nowMs - this.lastNow;
    if (
      elapsed < 0 ||
      (this.lastNow !== null && elapsed === 0) ||
      elapsed >= PAUSE_GAP_MS
    ) {
      this.excluded++;
      return this.resetTiming('clock-discontinuity');
    }
    this.lastNow = input.nowMs;
    this.foregroundMs += elapsed;
    this.warmupMs += elapsed;
    this.accepted++;
    this.lastFrame = input.frameMs;
    if (input.frameMs > 100) this.hitches++;
    this.frames.push({ nowMs: input.nowMs, frameMs: input.frameMs });
    while (
      this.frames.length > WINDOW_CAPACITY ||
      (this.frames.length > 0 && input.nowMs - this.frames[0].nowMs > WINDOW_MS)
    ) {
      this.frames.shift();
    }

    // Sorting is bounded and occurs at 2 Hz, not on every rendered frame.
    if (this.foregroundMs >= this.nextEvaluationMs) {
      this.nextEvaluationMs = this.foregroundMs + EVALUATION_MS;
      this.evaluate();
    }
    return this.snapshot();
  }

  snapshot(): AutoQualitySnapshot {
    return {
      quality: this.quality,
      resolutionScale: this.scale,
      targetFps: this.targetFps(),
      reason: this.reason,
      frameMs: this.median,
      p95Ms: this.p95,
      changes: this.changes,
      mode: this.mode,
      capQuality: this.cap(),
      sampleCount: this.frames.length,
      samples: this.accepted,
      excludedSamples: this.excluded,
      timingResets: this.resets,
      decisions: this.decisions,
      lastFrameMs: this.lastFrame,
      maxFrameMs: this.maxFrame,
      hitches: this.hitches,
      highPromotions: this.promotions,
      failedHighUpgrades: this.failedPromotions,
      highRetryMs: Math.max(0, this.retryAt - this.foregroundMs),
    };
  }

  /** Preserve tier, scale, cooldown and remaining retry delay; re-anchor timing. */
  resetTiming(reason = 'warming-up'): AutoQualitySnapshot {
    this.clearTiming(reason);
    return this.snapshot();
  }

  private validContext(input: AutoQualityObservation): boolean {
    return (
      Number.isFinite(input.nowMs) &&
      input.nowMs >= 0 &&
      MODES.includes(input.mode) &&
      Number.isFinite(input.speedMps) &&
      input.speedMps >= 0 &&
      Number.isFinite(input.altitudeM) &&
      typeof input.moving === 'boolean' &&
      typeof input.visible === 'boolean' &&
      typeof input.transitioning === 'boolean' &&
      (input.maxQuality === undefined ||
        input.maxQuality === 'balanced' ||
        input.maxQuality === 'high')
    );
  }

  private cap(): AutoTier {
    return this.mode === 'flight' || this.maxQuality === 'balanced'
      ? 'balanced'
      : 'high';
  }

  private targetFps(): number {
    return this.mode === 'orbit' || this.mode === 'walk' ? 35 : 45;
  }

  private clearTiming(reason: string): void {
    this.resets++;
    this.lastNow = null;
    this.warmupMs = 0;
    this.nextEvaluationMs = this.foregroundMs;
    this.slowSince = null;
    this.headroomSince = null;
    this.highHeadroomSince = null;
    this.frames = [];
    this.median = null;
    this.p95 = null;
    this.maxFrame = null;
    this.lastFrame = null;
    this.reason = reason;
  }

  private evaluate(): void {
    const sorted = this.frames.map((f) => f.frameMs).sort((a, b) => a - b);
    if (sorted.length === 0) return;
    const percentile = (p: number) =>
      sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    this.median = percentile(0.5);
    this.p95 = percentile(0.95);
    this.maxFrame = sorted[sorted.length - 1];
    if (this.warmupMs < WARMUP_MS || sorted.length < 4) return;

    this.decisions++;
    const targetMs = 1_000 / this.targetFps();
    const slowFraction =
      sorted.filter((ms) => ms > targetMs * 1.25).length / sorted.length;
    // The median deadband leaves steady 30 Hz walk/orbit usable. Tail latency
    // requires several slow samples, so one 120 ms hitch cannot lower a tier.
    const slow =
      this.median > targetMs * 1.18 ||
      (this.p95 > targetMs * 1.65 && slowFraction > 0.3);
    // Resolution recovery needs a 10% time margin. Raising the feature tier is
    // more expensive and retains its separate 20% margin and longer dwell.
    const resolutionHeadroom = this.p95 <= targetMs * 0.9;
    const highHeadroom = this.p95 <= targetMs * 0.8;
    if (slow) {
      this.headroomSince = null;
      this.highHeadroomSince = null;
      this.slowSince ??= this.foregroundMs;
      this.reason = 'sustained-load';
      if (
        this.foregroundMs >= this.nextChangeAt &&
        this.foregroundMs - this.slowSince >= SLOW_DWELL_MS
      ) {
        this.lower();
      }
    } else if (resolutionHeadroom) {
      this.slowSince = null;
      this.headroomSince ??= this.foregroundMs;
      this.highHeadroomSince = highHeadroom
        ? (this.highHeadroomSince ?? this.foregroundMs)
        : null;
      this.reason =
        this.foregroundMs < this.retryAt ? 'high-retry-backoff' : 'headroom';
      if (this.foregroundMs >= this.nextChangeAt) this.raise();
    } else {
      this.slowSince = null;
      this.headroomSince = null;
      this.highHeadroomSince = null;
      this.reason = 'stable';
    }
  }

  private lower(): void {
    const travel =
      this.mode === 'drive' || this.mode === 'boat' || this.mode === 'flight';
    if (this.quality === 'high' && (!travel || this.scale !== 1)) {
      this.failedPromotions++;
      this.retryAt =
        this.foregroundMs +
        Math.min(240_000, 60_000 * 2 ** Math.min(2, this.failedPromotions - 1));
      this.change('balanced', this.scale, 'lower-quality');
    } else {
      const nextScale = SCALES[SCALES.indexOf(this.scale) + 1];
      if (nextScale !== undefined)
        this.change(this.quality, nextScale, 'lower-resolution');
      else this.reason = 'resolution-floor';
    }
  }

  private raise(): void {
    if (this.headroomSince === null) return;
    const stableMs = this.foregroundMs - this.headroomSince;
    const movingTravel =
      this.moving && this.mode !== 'walk' && this.mode !== 'orbit';
    if (this.scale !== 1) {
      if (stableMs >= (movingTravel ? 12_000 : 8_000)) {
        this.change(
          this.quality,
          SCALES[SCALES.indexOf(this.scale) - 1],
          'restore-resolution',
        );
      }
    } else if (
      this.quality === 'balanced' &&
      this.cap() === 'high' &&
      this.highHeadroomSince !== null &&
      this.foregroundMs - this.highHeadroomSince >=
        (this.moving ? 24_000 : 18_000) &&
      this.foregroundMs >= this.retryAt
    ) {
      this.promotions++;
      this.change('high', this.scale, 'raise-quality');
    }
  }

  private change(
    quality: AutoTier,
    scale: ResolutionScale,
    reason: string,
  ): void {
    if (quality === this.quality && scale === this.scale) return;
    this.quality = quality;
    this.scale = scale;
    this.changes++;
    this.nextChangeAt = this.foregroundMs + COOLDOWN_MS;
    this.clearTiming(reason);
  }
}
