export type SceneryMode = 'orbit' | 'walk' | 'drive' | 'boat' | 'flight';
export type SceneryPosition = readonly [number, number, number];
/** Observation/admission only: never changes physical position or quality tier. */
export interface SceneryMotionState {
  readonly nowMs: number;
  readonly mode: SceneryMode;
  readonly auto: boolean;
  readonly positionXYZ: SceneryPosition;
  readonly lookAheadXYZ: SceneryPosition;
  readonly speedMps: number;
  readonly altitudeM: number;
  readonly moving: boolean;
  readonly fast: boolean;
  readonly stationaryForMs: number;
  readonly allowNewDetails: boolean;
  readonly preparationBudgetMs: number;
  readonly admissionsPerFrame: number;
  readonly selectionIntervalMs: number;
}

export class SceneryMotionTracker {
  private previous: {
    nowMs: number;
    position: SceneryPosition;
    mode: SceneryMode;
  } | null = null;
  private speed = 0;
  private moving = false;
  private fast = false;
  private stoppedAt = 0;
  reset() {
    this.previous = null;
    this.speed = 0;
    this.moving = false;
    this.fast = false;
    this.stoppedAt = 0;
  }
  update(
    nowMs: number,
    cameraXYZ: SceneryPosition,
    mode: SceneryMode,
    altitudeM: number,
    speedMps?: number,
    auto = false,
  ): SceneryMotionState {
    if (
      ![nowMs, ...cameraXYZ, altitudeM].every(Number.isFinite) ||
      nowMs < 0 ||
      (speedMps !== undefined && !Number.isFinite(speedMps)) ||
      !['orbit', 'walk', 'drive', 'boat', 'flight'].includes(mode)
    )
      throw new Error('Invalid scenery motion observation');
    const position = [...cameraXYZ] as [number, number, number];
    const prior = this.previous,
      dt = prior ? (nowMs - prior.nowMs) / 1000 : 0;
    const delta = prior
      ? position.map((v, i) => v - prior.position[i])
      : [0, 0, 0];
    const distance = Math.hypot(...delta);
    // Camera cuts, mode changes and hidden-tab gaps are not physical velocity.
    const continuous =
      !!prior &&
      prior.mode === mode &&
      dt > 0 &&
      dt <= 1 &&
      distance <= Math.max(90, Math.abs(speedMps ?? 0) * dt * 4 + 40);
    if (!continuous) {
      this.speed = 0;
      this.moving = false;
      this.fast = false;
      this.stoppedAt = prior ? nowMs : nowMs - 250;
    }
    if (speedMps !== undefined) this.speed = Math.min(320, Math.abs(speedMps));
    else if (continuous) {
      const measured = Math.min(320, distance / dt);
      this.speed += (measured - this.speed) * (1 - Math.exp(-dt / 0.15));
    }
    const wasMoving = this.moving;
    this.moving = this.speed > (this.moving ? 0.55 : 1.2);
    if (wasMoving && !this.moving) this.stoppedAt = nowMs;
    const fastAt =
      mode === 'flight'
        ? 24
        : mode === 'drive' || mode === 'boat'
          ? 14
          : mode === 'orbit'
            ? 35
            : 6;
    this.fast = this.moving && this.speed > fastAt * (this.fast ? 0.72 : 1);
    const stationaryForMs = this.moving
      ? 0
      : Math.max(0, nowMs - this.stoppedAt);
    const leadSeconds =
      mode === 'drive' || mode === 'boat'
        ? 1.5
        : mode === 'flight'
          ? 0.8
          : mode === 'walk'
            ? 0.65
            : 0;
    const maxLead =
      mode === 'drive' || mode === 'boat' ? 90 : mode === 'flight' ? 120 : 8;
    const lead =
      continuous && this.moving && distance > 1e-6
        ? Math.min(maxLead, this.speed * leadSeconds)
        : 0;
    // Ground detail selection cannot be projected into another height/layer.
    const horizontal = Math.hypot(delta[0], delta[2]);
    const lookAhead: [number, number, number] = [
      position[0] + (horizontal > 1e-6 ? (delta[0] / horizontal) * lead : 0),
      position[1],
      position[2] + (horizontal > 1e-6 ? (delta[2] / horizontal) * lead : 0),
    ];
    const allowNewDetails =
      !auto ||
      (!(mode === 'flight' && (this.fast || (altitudeM > 80 && this.moving))) &&
        (this.moving || stationaryForMs >= 250));
    this.previous = { nowMs, position, mode };
    return Object.freeze({
      nowMs,
      mode,
      auto,
      positionXYZ: Object.freeze(position),
      lookAheadXYZ: Object.freeze(lookAhead),
      speedMps: this.speed,
      altitudeM,
      moving: this.moving,
      fast: this.fast,
      stationaryForMs,
      allowNewDetails,
      preparationBudgetMs: this.fast ? 0.2 : this.moving ? 0.65 : 1.25,
      admissionsPerFrame: allowNewDetails ? (this.fast ? 1 : 2) : 0,
      selectionIntervalMs: this.fast ? 350 : this.moving ? 220 : 120,
    });
  }
}

/** One Engine-owned allowance shared by optional CPU/GPU preparation work.
 * Only callback execution consumes time; elapsed render/frame time never does.
 * An indivisible operation may overrun once, then later work is skipped. */
export class DetailWorkBudget {
  readonly stats = {
    frames: 0,
    attempts: 0,
    skipped: 0,
    admissions: 0,
    usedMs: 0,
    overruns: 0,
    maxWorkMs: 0,
  };
  private budgetMs = 0;
  private tokens = 0;
  private running = false;
  constructor(private readonly now: () => number = () => performance.now()) {}
  reset(budgetMs: number, admissionsPerFrame: number) {
    if (
      !Number.isFinite(budgetMs) ||
      budgetMs < 0 ||
      budgetMs > 2 ||
      !Number.isSafeInteger(admissionsPerFrame) ||
      admissionsPerFrame < 0 ||
      admissionsPerFrame > 8
    )
      throw new Error('Invalid scenery preparation allowance');
    this.budgetMs = budgetMs;
    this.tokens = admissionsPerFrame;
    this.stats.frames++;
    this.stats.usedMs = 0;
  }
  remainingMs() {
    return Math.max(0, this.budgetMs - this.stats.usedMs);
  }
  run(work: () => void, options: { admission?: boolean } = {}) {
    this.stats.attempts++;
    if (
      this.running ||
      this.remainingMs() <= 0 ||
      (options.admission && this.tokens <= 0)
    ) {
      this.stats.skipped++;
      return false;
    }
    if (options.admission) {
      this.tokens--;
      this.stats.admissions++;
    }
    const start = this.now();
    this.running = true;
    try {
      work();
    } finally {
      this.running = false;
      const elapsed = Math.max(0, this.now() - start);
      this.stats.usedMs += elapsed;
      this.stats.maxWorkMs = Math.max(this.stats.maxWorkMs, elapsed);
      if (this.stats.usedMs > this.budgetMs) this.stats.overruns++;
    }
    return true;
  }
}
