import * as THREE from 'three';

export const IMPACT_PARTICLE_CAPACITY = 128;
export type ImpactFeedbackVector = readonly [number, number, number];
export interface ImpactFeedbackEvent {
  point: ImpactFeedbackVector;
  normal: ImpactFeedbackVector;
  velocity: ImpactFeedbackVector;
  kind: string;
  severity: number;
  scrape?: boolean | number;
}
const clamp = (value: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, value));
const finiteVector = (value: ImpactFeedbackVector) =>
  value.length === 3 && value.every((component) => Number.isFinite(component));

/** Bounded presentation only: collision/speed/damage remain owned by the impact
 * solver. One persistent Points draw supplies chips, dust and sparks in world
 * space; no texture, shadow map, per-particle object or physics body is added.
 * Audio is silent/unallocated until the user explicitly enables it. */
export class ImpactFeedback {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions = new Float32Array(IMPACT_PARTICLE_CAPACITY * 3);
  private readonly velocities = new Float32Array(IMPACT_PARTICLE_CAPACITY * 3);
  private readonly colors = new Float32Array(IMPACT_PARTICLE_CAPACITY * 3);
  private readonly sizes = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private readonly alphas = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private readonly kinds = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private readonly life = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private readonly duration = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private readonly floors = new Float32Array(IMPACT_PARTICLE_CAPACITY);
  private count = 0;
  private budget = IMPACT_PARTICLE_CAPACITY;
  private seed = 0x1a71a5;
  private elapsed = 0;
  private scrapeCooldown = 0;
  private shakeAmount = 0;
  private disposed = false;
  private readonly reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private audioRequested = false;
  private audioEnabled = false;
  private audioRevision = 0;
  private context: AudioContext | null = null;
  private lastAudio = -Infinity;
  private readonly voices = new Set<{
    oscillator: OscillatorNode;
    gain: GainNode;
  }>();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['position', this.positions, 3],
      ['color', this.colors, 3],
      ['aSize', this.sizes, 1],
      ['aAlpha', this.alphas, 1],
      ['aKind', this.kinds, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage),
      );
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uPointScale: { value: 600 }, uPerspective: { value: 1 } },
      vertexShader: `
        attribute float aSize, aAlpha, aKind;
        attribute vec3 color;
        uniform float uPointScale, uPerspective;
        varying vec3 vColor;
        varying float vAlpha, vKind;
        void main() {
          vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
          gl_Position=projectionMatrix*viewPosition;
          gl_PointSize=clamp(aSize*uPointScale/mix(1.0,max(1.0,-viewPosition.z),uPerspective),1.0,18.0);
          vColor=color;vAlpha=aAlpha;vKind=aKind;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha, vKind;
        void main() {
          vec2 uv=gl_PointCoord*2.0-1.0;
          float mask;
          if(vKind>1.5) mask=1.0-smoothstep(0.35,1.0,length(uv*vec2(3.5,1.0)));
          else if(vKind>0.5) mask=1.0-step(0.8,max(abs(uv.x),abs(uv.y)*1.7));
          else mask=1.0-smoothstep(0.1,1.0,length(uv));
          if(mask*vAlpha<0.01) discard;
          gl_FragColor=vec4(vColor,mask*vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'Bounded vehicle impact chips dust and sparks';
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  get shake() {
    return this.reducedMotion ? 0 : this.shakeAmount;
  }

  private random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }

  emit(event: ImpactFeedbackEvent) {
    if (
      this.disposed ||
      !finiteVector(event.point) ||
      !finiteVector(event.normal) ||
      !finiteVector(event.velocity) ||
      event.point.some((value) => Math.abs(value) > 1e7) ||
      !Number.isFinite(event.severity) ||
      (typeof event.scrape === 'number' && !Number.isFinite(event.scrape))
    )
      return false;
    const length = Math.hypot(...event.normal);
    if (!Number.isFinite(length) || length < 1e-7) return false;
    const severity = clamp(event.severity),
      scrape =
        typeof event.scrape === 'number'
          ? clamp(event.scrape)
          : event.scrape
            ? 1
            : 0;
    if (severity <= 0 && scrape <= 0) return false;
    this.shakeAmount = Math.max(
      this.shakeAmount,
      severity * 0.12 + scrape * 0.008,
    );
    this.sound(event.kind, severity, scrape);
    if (scrape > 0 && this.scrapeCooldown > 0) return true;
    if (scrape > 0) this.scrapeCooldown = 0.045;
    const tree = /tree|wood/.test(event.kind),
      metal = /lamp|rail|metal|vehicle/.test(event.kind),
      amount = Math.round(scrape > 0 ? 2 + 5 * scrape : 6 + 24 * severity),
      nx = event.normal[0] / length,
      ny = event.normal[1] / length,
      nz = event.normal[2] / length;
    for (let added = 0; added < amount && this.count < this.budget; added++) {
      const index = this.count++,
        offset = index * 3,
        kind = tree
          ? this.random() < 0.75
            ? 1
            : 0
          : metal && this.random() < 0.8
            ? 2
            : 0,
        impulse = 0.7 + severity * 5,
        duration =
          kind === 2 ? 0.15 + this.random() * 0.28 : 0.35 + this.random() * 0.5;
      this.positions[offset] = event.point[0] + nx * 0.08;
      this.positions[offset + 1] = event.point[1] + ny * 0.08;
      this.positions[offset + 2] = event.point[2] + nz * 0.08;
      for (let axis = 0; axis < 3; axis++)
        this.velocities[offset + axis] =
          (event.normal[axis] / length) * impulse +
          (this.random() - 0.5) * impulse * 1.7 +
          clamp(event.velocity[axis], -80, 80) * 0.045;
      this.velocities[offset + 1] += kind === 0 ? 0.8 : 1.7;
      this.colors[offset] =
        kind === 2 ? 2.2 : kind === 1 ? 0.42 + this.random() * 0.15 : 0.57;
      this.colors[offset + 1] =
        kind === 2 ? 1.05 + this.random() * 0.5 : kind === 1 ? 0.24 : 0.53;
      this.colors[offset + 2] = kind === 2 ? 0.18 : kind === 1 ? 0.09 : 0.45;
      this.sizes[index] =
        kind === 0 ? 0.17 + this.random() * 0.16 : kind === 1 ? 0.075 : 0.1;
      this.kinds[index] = kind;
      this.life[index] = this.duration[index] = duration;
      this.floors[index] = event.point[1] - 0.6;
      this.alphas[index] = kind === 0 ? 0.35 : 0.95;
    }
    this.publish();
    return true;
  }

  update(dt: number, camera?: THREE.Camera, quality?: string) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += Math.min(dt, 10);
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);
    this.shakeAmount *= Math.exp(-Math.min(dt, 10) * 10);
    if (this.shakeAmount < 1e-5) this.shakeAmount = 0;
    this.budget =
      quality === 'balanced' || quality === 'low' || quality === 'compatible'
        ? 64
        : IMPACT_PARTICLE_CAPACITY;
    this.count = Math.min(this.count, this.budget);
    if (camera instanceof THREE.OrthographicCamera) {
      this.points.material.uniforms.uPerspective.value = 0;
      this.points.material.uniforms.uPointScale.value =
        (512 * camera.zoom) / Math.max(1, camera.top - camera.bottom);
    } else {
      this.points.material.uniforms.uPerspective.value = 1;
      if (camera instanceof THREE.PerspectiveCamera)
        this.points.material.uniforms.uPointScale.value =
          300 / Math.tan((camera.fov * Math.PI) / 360);
    }
    const step = Math.min(dt, 0.1),
      drag = Math.exp(-step * 2.2);
    let index = 0;
    while (index < this.count) {
      this.life[index] -= dt;
      if (this.life[index] <= 0) {
        const last = --this.count;
        for (let axis = 0; axis < 3; axis++) {
          this.positions[index * 3 + axis] = this.positions[last * 3 + axis];
          this.velocities[index * 3 + axis] = this.velocities[last * 3 + axis];
          this.colors[index * 3 + axis] = this.colors[last * 3 + axis];
        }
        this.life[index] = this.life[last];
        this.duration[index] = this.duration[last];
        this.sizes[index] = this.sizes[last];
        this.alphas[index] = this.alphas[last];
        this.kinds[index] = this.kinds[last];
        this.floors[index] = this.floors[last];
        continue;
      }
      const offset = index * 3;
      for (let axis = 0; axis < 3; axis++) {
        this.velocities[offset + axis] *= drag;
        this.positions[offset + axis] += this.velocities[offset + axis] * step;
      }
      this.velocities[offset + 1] -= (this.kinds[index] === 0 ? 2 : 9.8) * step;
      if (this.positions[offset + 1] < this.floors[index]) {
        this.positions[offset + 1] = this.floors[index];
        this.velocities[offset + 1] =
          Math.abs(this.velocities[offset + 1]) * 0.15;
        this.life[index] = Math.min(this.life[index], 0.12);
      }
      this.alphas[index] =
        ((this.kinds[index] === 0 ? 0.35 : 0.95) * this.life[index]) /
        this.duration[index];
      index++;
    }
    this.publish();
  }

  private publish() {
    this.points.geometry.setDrawRange(0, this.count);
    this.points.visible = this.count > 0;
    for (const attribute of Object.values(this.points.geometry.attributes))
      attribute.needsUpdate = true;
  }

  /** Call from an explicit user sound toggle/gesture. Enabling failure leaves
   * the visual system usable and silent; disabling releases all audio nodes. */
  async setAudioEnabled(enabled: boolean) {
    if (this.disposed) return false;
    this.audioRequested = enabled;
    const revision = ++this.audioRevision;
    if (!enabled) {
      this.audioEnabled = false;
      this.stopVoices();
      const context = this.context;
      this.context = null;
      if (context) await context.close().catch(() => undefined);
      return true;
    }
    if (typeof AudioContext === 'undefined') return false;
    try {
      const context = this.context ?? new AudioContext();
      this.context = context;
      await context.resume();
      if (
        this.disposed ||
        !this.audioRequested ||
        revision !== this.audioRevision
      )
        return false;
      this.audioEnabled = context.state === 'running';
      return this.audioEnabled;
    } catch {
      if (revision === this.audioRevision) this.audioEnabled = false;
      return false;
    }
  }

  private sound(kind: string, severity: number, scrape: number) {
    const context = this.context;
    if (
      !this.audioEnabled ||
      !context ||
      context.state !== 'running' ||
      this.voices.size >= 4 ||
      this.elapsed - this.lastAudio < (scrape > 0 ? 0.12 : 0.045)
    )
      return;
    this.lastAudio = this.elapsed;
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      metallic = /lamp|rail|metal/.test(kind),
      seconds = scrape > 0 ? 0.07 : 0.12 + severity * 0.1,
      now = context.currentTime,
      voice = { oscillator, gain };
    oscillator.type = scrape > 0 ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(
      metallic ? 180 + severity * 140 : 75 + severity * 65,
      now,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      scrape > 0 ? 100 : 38,
      now + seconds,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      (0.025 + severity * 0.075) * (scrape > 0 ? 0.4 : 1),
      now + 0.004,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    oscillator.connect(gain);
    gain.connect(context.destination);
    this.voices.add(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    oscillator.start(now);
    oscillator.stop(now + seconds + 0.01);
  }

  private stopVoices() {
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
      oscillator.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
  }

  stats() {
    return {
      capacity: IMPACT_PARTICLE_CAPACITY,
      budget: this.budget,
      active: this.count,
      drawCalls: this.count > 0 && !this.disposed ? 1 : 0,
      bufferBytes:
        this.positions.byteLength +
        this.velocities.byteLength +
        this.colors.byteLength +
        this.sizes.byteLength +
        this.alphas.byteLength +
        this.kinds.byteLength +
        this.life.byteLength +
        this.duration.byteLength +
        this.floors.byteLength,
      audioEnabled: this.audioEnabled,
      audioAllocated: this.context !== null,
      voices: this.voices.size,
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.count = 0;
    this.shakeAmount = 0;
    this.audioRequested = this.audioEnabled = false;
    this.audioRevision++;
    this.stopVoices();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.points.visible = false;
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
