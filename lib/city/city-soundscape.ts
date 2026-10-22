import {
  finiteSoundPoint,
  FootstepTracker,
  soundClamp,
  soundscapeMix,
  SOUNDSCAPE_VOICE_LIMIT,
  type FootstepEvent,
  type SoundscapeFrame,
} from './soundscape-policy';

type VisibilityHost = Pick<
  Document,
  'hidden' | 'addEventListener' | 'removeEventListener'
>;
interface SoundscapeOptions {
  /** Injection for lifecycle tests; the default is evaluated only on enable. */
  contextFactory?: () => AudioContext;
  visibility?: VisibilityHost | null;
}
interface Loop {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  quietSince: number | null;
}
interface Voice {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
}

/** Bounded original procedural city audio: no downloads or autoplay.
 * At most five nearby noise loops and eight brief voices share one 96 KiB
 * noise buffer. Silent loops retire, and hidden/disabled pages release nodes. */
export class CitySoundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private outdoorBus: GainNode | null = null;
  private outdoorFactor = 1;
  private noise: AudioBuffer | null = null;
  private readonly loops = new Map<string, Loop>();
  private readonly voices = new Set<Voice>();
  private readonly footsteps = new FootstepTracker();
  private requested = false;
  private pageActive = true;
  private disposed = false;
  private revision = 0;
  private volume = 0.65;
  private error: 'unavailable' | 'resume-failed' | null = null;
  private lastMix = -Infinity;
  private nextBird = Infinity;
  private nextGull = Infinity;
  private nextHorn = Infinity;
  private seed = 0x24c0a57;
  private readonly visibility: VisibilityHost | null;
  private readonly contextFactory: () => AudioContext;

  constructor(options: SoundscapeOptions = {}) {
    this.visibility =
      options.visibility === undefined
        ? typeof document === 'undefined'
          ? null
          : document
        : options.visibility;
    this.contextFactory =
      options.contextFactory ??
      (() => {
        const Audio =
          globalThis.AudioContext ??
          (
            globalThis as typeof globalThis & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!Audio) throw new Error('Web Audio unavailable');
        return new Audio();
      });
    this.visibility?.addEventListener(
      'visibilitychange',
      this.visibilityChanged,
    );
  }

  private get active() {
    return this.pageActive && !this.visibility?.hidden;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }
  private resetTiming() {
    this.footsteps.reset();
    this.lastMix = -Infinity;
    this.nextBird = this.nextGull = this.nextHorn = Infinity;
  }

  /** Invoke directly from a user click/tap. No other method creates a context. */
  async setEnabled(enabled: boolean) {
    if (this.disposed) return false;
    this.requested = enabled;
    const revision = ++this.revision;
    this.error = null;
    if (!enabled) {
      const context = this.context;
      this.clearNodes();
      this.context = null;
      if (context) await context.close().catch(() => undefined);
      return true;
    }
    try {
      const context = this.context ?? this.contextFactory();
      this.context = context;
      await context.resume();
      if (this.disposed || !this.requested || revision !== this.revision)
        return false;
      if (!this.active) {
        await context.suspend();
        return true;
      }
      if (context.state !== 'running')
        throw new Error('Audio context did not resume');
      this.resetTiming();
      return true;
    } catch {
      if (revision === this.revision) {
        this.error = this.context ? 'resume-failed' : 'unavailable';
        this.requested = false;
        const context = this.context;
        this.clearNodes();
        this.context = null;
        if (context) await context.close().catch(() => undefined);
      }
      return false;
    }
  }

  setVolume(value: number) {
    this.volume = soundClamp(value);
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.04,
      );
    if (this.volume === 0) this.clearNodes();
  }

  /** Engine suspension/context loss is separate from document visibility. */
  setPageActive(active: boolean) {
    if (this.pageActive === active || this.disposed) return;
    this.pageActive = active;
    this.visibilityChanged();
  }
  private visibilityChanged = () => {
    this.clearNodes();
    const context = this.context;
    if (!context || this.disposed || !this.requested) return;
    const revision = this.revision;
    const operation = this.active ? context.resume() : context.suspend();
    void operation.catch(() => {
      if (!this.disposed && revision === this.revision)
        this.error = 'resume-failed';
    });
  };

  private output(context: AudioContext) {
    if (!this.master) {
      this.master = context.createGain();
      this.master.gain.setValueAtTime(this.volume, context.currentTime);
      this.master.connect(context.destination);
    }
    return this.master;
  }
  private noiseBuffer(context: AudioContext) {
    if (!this.noise) {
      // A shared two-second 12 kHz buffer avoids city-wide per-emitter assets.
      this.noise = context.createBuffer(1, 24000, 12000);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = this.random() * 2 - 1;
    }
    return this.noise;
  }

  private outdoorOutput(context: AudioContext) {
    if (!this.outdoorBus) {
      this.outdoorBus = context.createGain();
      this.outdoorBus.gain.setValueAtTime(
        this.outdoorFactor,
        context.currentTime,
      );
      this.outdoorBus.connect(this.output(context));
    }
    return this.outdoorBus;
  }

  private updateLoop(
    key: string,
    amount: number,
    frequency: number,
    pan: number,
    now: number,
  ) {
    const context = this.context!;
    let loop = this.loops.get(key);
    if (!loop && amount > 0.0005 && this.loops.size < 5) {
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain(),
        stereo = context.createStereoPanner();
      source.buffer = this.noiseBuffer(context);
      source.loop = true;
      filter.type = key.startsWith('train:') ? 'bandpass' : 'lowpass';
      filter.Q.value = key.startsWith('train:') ? 0.7 : 0.45;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(stereo);
      stereo.connect(this.output(context));
      loop = { source, filter, gain, pan: stereo, quietSince: null };
      this.loops.set(key, loop);
      source.start(context.currentTime, this.random() * 1.8);
    }
    if (!loop) return;
    loop.gain.gain.setTargetAtTime(amount, context.currentTime, 0.18);
    loop.filter.frequency.setTargetAtTime(frequency, context.currentTime, 0.15);
    loop.pan.pan.setTargetAtTime(
      soundClamp(pan, -1, 1),
      context.currentTime,
      0.12,
    );
    if (amount > 0.0005) loop.quietSince = null;
    else {
      loop.quietSince ??= now;
      if (now - loop.quietSince >= 1200) this.stopLoop(key, loop);
    }
  }
  private stopLoop(key: string, loop: Loop) {
    try {
      loop.source.stop();
    } catch {
      /* Already stopped. */
    }
    loop.source.disconnect();
    loop.filter.disconnect();
    loop.gain.disconnect();
    loop.pan.disconnect();
    this.loops.delete(key);
  }
  private finishVoice(voice: Voice) {
    voice.source.onended = null;
    for (const node of voice.nodes) node.disconnect();
    this.voices.delete(voice);
  }
  private registerVoice(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
    duration: number,
  ) {
    const voice = { source, nodes };
    this.voices.add(voice);
    source.onended = () => this.finishVoice(voice);
    source.start(this.context!.currentTime);
    source.stop(this.context!.currentTime + duration + 0.015);
  }
  private step(event: FootstepEvent) {
    const context = this.context!;
    if (this.voices.size >= SOUNDSCAPE_VOICE_LIMIT) return;
    const [frequency, duration] = {
      pavement: [950, 0.075],
      grass: [2200, 0.055],
      sand: [600, 0.12],
      wood: [400, 0.1],
      metal: [1800, 0.13],
    }[event.surface] ?? [950, 0.075];
    const source = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      gain = context.createGain();
    source.buffer = this.noiseBuffer(context);
    filter.type = event.surface === 'metal' ? 'bandpass' : 'lowpass';
    filter.frequency.value = frequency;
    filter.Q.value = event.surface === 'metal' ? 5 : 0.7;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.output(context));
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(event.gain, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    this.registerVoice(source, [source, filter, gain], duration);
  }
  private call(kind: 'bird' | 'gull' | 'horn', amount: number) {
    if (amount < 0.002 || this.voices.size >= SOUNDSCAPE_VOICE_LIMIT) return;
    const context = this.context!,
      now = context.currentTime;
    const source = context.createOscillator(),
      gain = context.createGain(),
      pan = context.createStereoPanner();
    const horn = kind === 'horn',
      gull = kind === 'gull';
    const duration = horn ? 1.6 : gull ? 0.65 : 0.18;
    const base = horn ? 165 : gull ? 700 : 1800 + this.random() * 1100;
    source.type = horn ? 'triangle' : 'sine';
    source.frequency.setValueAtTime(base, now);
    source.frequency.exponentialRampToValueAtTime(
      base * (horn ? 1.04 : gull ? 1.5 : 1.7),
      now + duration * 0.35,
    );
    source.frequency.exponentialRampToValueAtTime(
      base * (gull ? 0.75 : 0.95),
      now + duration,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      amount * (horn ? 0.55 : 0.35),
      now + (horn ? 0.3 : 0.025),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    pan.pan.value = this.random() * 1.6 - 0.8;
    source.connect(gain);
    gain.connect(pan);
    pan.connect(this.outdoorOutput(context));
    this.registerVoice(source, [source, gain, pan], duration);
  }

  update(frame: SoundscapeFrame) {
    const context = this.context;
    if (!finiteSoundPoint(frame.listener) || !Number.isFinite(frame.now)) {
      this.clearNodes();
      return;
    }
    if (
      this.disposed ||
      !this.requested ||
      !this.active ||
      !this.volume ||
      !context ||
      context.state !== 'running'
    ) {
      this.footsteps.reset();
      return;
    }
    const step = this.footsteps.sample(frame);
    if (step) this.step(step);
    if (frame.now - this.lastMix >= 0 && frame.now - this.lastMix < 80) return;
    this.lastMix = frame.now;
    const mix = soundscapeMix(frame);
    this.outdoorFactor = frame.interior ? 0.07 : 1;
    this.outdoorBus?.gain.setTargetAtTime(
      this.outdoorFactor,
      context.currentTime,
      0.18,
    );
    // Gentle shore swell is presentation time, never replayed after suspension.
    this.updateLoop(
      'waves',
      mix.waves * (0.73 + 0.27 * Math.sin(frame.now * 0.0007)),
      800,
      0,
      frame.now,
    );
    this.updateLoop('harbour', mix.harbour, 160, 0, frame.now);
    const liveTrains = new Set(mix.trains.map((train) => `train:${train.id}`));
    for (const [key] of this.loops)
      if (key.startsWith('train:') && !liveTrains.has(key))
        this.updateLoop(key, 0, 100, 0, frame.now);
    for (const train of mix.trains)
      this.updateLoop(
        `train:${train.id}`,
        train.gain,
        train.frequency,
        train.pan,
        frame.now,
      );
    if (!Number.isFinite(this.nextBird)) this.nextBird = frame.now + 1200;
    if (!Number.isFinite(this.nextGull)) this.nextGull = frame.now + 3300;
    if (!Number.isFinite(this.nextHorn)) this.nextHorn = frame.now + 12000;
    if (frame.now >= this.nextBird) {
      this.call('bird', mix.birds / this.outdoorFactor);
      this.nextBird = frame.now + 2500 + this.random() * 5000;
    }
    if (frame.now >= this.nextGull) {
      this.call('gull', mix.gulls / this.outdoorFactor);
      this.nextGull = frame.now + 6500 + this.random() * 9000;
    }
    if (frame.now >= this.nextHorn) {
      this.call('horn', mix.harbour / this.outdoorFactor);
      this.nextHorn = frame.now + 25000 + this.random() * 20000;
    }
  }

  /** Fast guard for the world's slower environment sampler. */
  get enabled() {
    return (
      !this.disposed &&
      this.requested &&
      this.active &&
      this.context?.state === 'running'
    );
  }

  get snapshot() {
    return {
      requested: this.requested,
      enabled: this.enabled,
      volume: this.volume,
      allocated: !!this.context,
      loops: this.loops.size,
      voices: this.voices.size,
      bufferBytes: this.noise ? 24000 * 4 : 0,
      disposed: this.disposed,
      error: this.error,
    };
  }
  private clearNodes() {
    this.resetTiming();
    for (const [key, loop] of this.loops) this.stopLoop(key, loop);
    for (const voice of this.voices) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        /* Already stopped. */
      }
      this.finishVoice(voice);
    }
    this.master?.disconnect();
    this.master = null;
    this.outdoorBus?.disconnect();
    this.outdoorBus = null;
    this.noise = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.requested = false;
    this.revision++;
    this.visibility?.removeEventListener(
      'visibilitychange',
      this.visibilityChanged,
    );
    this.clearNodes();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
