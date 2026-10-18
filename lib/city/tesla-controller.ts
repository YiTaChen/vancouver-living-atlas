import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project } from './geo';
import { CityTeslaWorld, type TeslaRoadSpawn } from './tesla-city-world';
import {
  createTesla,
  stepTesla,
  type TeslaInput,
  type TeslaShape,
  type TeslaState,
  type TeslaVec3,
} from './tesla-state';
import {
  createTeslaRoadster,
  TESLA_ROADSTER_DIMENSIONS,
  type TeslaModelQuality,
  type TeslaRoadsterModel,
} from './assets/tesla-roadster';
import { createTeslaRoadsterShape } from './tesla-shape';
import { teslaCameraFrame, type TeslaView } from './tesla-camera';
import {
  TeslaQualityPolicy,
  type TeslaQualityPreference,
} from './tesla-quality';
import { EMPTY_TESLA, type TeslaSnapshot } from './tesla-snapshot';
import { teslaDot, teslaRotate } from './tesla-math';

export type TeslaButton = 'up' | 'down' | 'boost' | 'brake';
export type TeslaCommand = 'jump' | 'flightToggle' | 'adhesionToggle' | 'park';
const AXIS_KEYS: Record<string, string> = {
  KeyW: 'w',
  KeyS: 's',
  KeyA: 'a',
  KeyD: 'd',
  ArrowUp: 'w',
  ArrowDown: 's',
  ArrowLeft: 'a',
  ArrowRight: 'd',
  Space: 'space',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  ControlLeft: 'control',
  ControlRight: 'control',
  KeyC: 'c',
  KeyE: 'e',
  KeyP: 'p',
  KeyF: 'f',
  KeyR: 'r',
  KeyB: 'b',
  KeyQ: 'down',
};
const ROBSON = project([-123.12416073213134, 49.2841737758357]);
const cloneState = (state: TeslaState) => {
  const copy = createTesla([...state.position], state.heading, state.contact);
  copy.quaternion = [...state.quaternion];
  return copy;
};

/** Independent player vehicle: it never replaces the ordinary roadster or aircraft. */
export class TeslaController {
  active = false;
  state: TeslaState | null = null;
  world: CityTeslaWorld | null = null;
  model: TeslaRoadsterModel | null = null;
  readonly vehicle = new THREE.Group();
  readonly shape: TeslaShape = createTeslaRoadsterShape();
  view: TeslaView = 'chase';
  quality: TeslaQualityPreference = 'auto';
  effectiveQuality: TeslaModelQuality = 'medium';
  warning: TeslaSnapshot['warning'] = '';
  distance = 7.5;
  lookYaw = 0;
  lookPitch = 0;
  onChange: (snapshot: TeslaSnapshot) => void = () => {};
  private readonly policy = new TeslaQualityPolicy();
  private inputEnabled = true;
  /** Wall Grip is a session choice, preserved when the vehicle is recreated. */
  private adhesionPreference = true;
  private readonly keys = new Set<string>();
  private readonly keyCodes = new Set<string>();
  private readonly buttons = new Set<TeslaButton>();
  private readonly pulses = new Set<TeslaCommand>();
  private readonly heldPulses = new Map<TeslaButton, number>();
  private axes = { x: 0, y: 0 };
  private entryState: TeslaState | null = null;
  private published = -Infinity;
  private wheelSpin = 0;
  private fanSpin = 0;
  private lastQuality: TeslaModelQuality | null = null;
  private snapCamera = true;
  private disposed = false;
  private readonly pointers = new Map<number, [number, number]>();
  private pinch = 0;
  private originalMinDistance = 28;
  private lastStep = {
    simulatedS: 0,
    droppedS: 0,
    substeps: 0,
    collisions: 0,
    transitions: 0,
    environmentFailures: 0,
  };

  constructor(readonly e: CityEngine) {
    this.vehicle.name = 'Tesla Roadster Rocket player';
    this.vehicle.visible = false;
    const canvas = e.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('pointermove', this.pointerMove, true);
    window.addEventListener('pointerup', this.pointerUp, true);
    window.addEventListener('pointercancel', this.pointerUp, true);
    canvas.addEventListener('wheel', this.wheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.visibility);
  }
  get speedMps() {
    return this.state ? Math.hypot(...this.state.velocity) : 0;
  }
  get sceneryMode(): 'flight' | 'drive' {
    return this.state?.mode === 'ground' ? 'drive' : 'flight';
  }
  get pose() {
    const s = this.state;
    return this.active && s
      ? { x: s.position[0], z: s.position[2], yaw: s.heading, following: true }
      : null;
  }
  get snapshot(): TeslaSnapshot {
    const s = this.state;
    return {
      ...EMPTY_TESLA,
      active: this.active,
      mode: s?.mode ?? 'ground',
      transitioning: !!s?.attachment,
      speedKph: Math.round(this.speedMps * 3.6),
      altitudeM: s
        ? Math.round(
            s.position[1] - this.e.elevation(s.position[0], s.position[2]),
          )
        : 0,
      parked: !!s?.parked,
      wallHolding: !!s?.wallHolding,
      adhesion: s?.adhesionArmed ?? this.adhesionPreference,
      flightAssist: s?.flightAssist ?? true,
      view: this.view,
      quality: this.quality,
      effectiveQuality: this.effectiveQuality,
      warning: this.warning,
    };
  }
  notify() {
    this.onChange(this.snapshot);
  }
  private headingNear(x: number, z: number) {
    const graph = this.e.data.roadGraph;
    let best = Infinity,
      heading = 0;
    if (!graph) return heading;
    for (const edge of graph.edges) {
      if (
        graph.nodes[edge.a].level !== 'ground' ||
        edge.width < 5 ||
        edge.classes.some((c: string) => /lane|bikeway|private/.test(c))
      )
        continue;
      const a = graph.nodes[edge.a].point,
        b = graph.nodes[edge.b].point;
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz),
          ),
        );
      const gap = (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2;
      if (gap < best) {
        best = gap;
        heading = Math.atan2(dx, dz);
      }
    }
    return heading;
  }
  private roadCandidates(
    position: TeslaVec3,
    heading: number,
    radius: number,
    identity: { surfaceId: string; layer: number },
  ) {
    let verified: TeslaRoadSpawn | null = null;
    const open = this.world!.groundPoseNear(
      position,
      this.shape,
      heading,
      radius,
      identity,
      (candidate) => {
        verified ??= candidate;
        return this.world!.hasLaunchClearance(candidate, this.shape);
      },
    );
    return { open, verified: verified as TeslaRoadSpawn | null };
  }
  private roadIdentity(contact: TeslaState['contact']) {
    const identity = contact ? this.world!.identity(contact) : null;
    return identity?.allowedModes.includes('drive')
      ? { surfaceId: identity.surfaceId, layer: identity.layer }
      : null;
  }
  private verifiedEntry(identity: { surfaceId: string; layer: number }) {
    const entry = this.entryState;
    if (!entry?.contact) return null;
    const original = this.roadIdentity(entry.contact);
    if (
      original?.surfaceId !== identity.surfaceId ||
      original.layer !== identity.layer
    )
      return null;
    const proof = this.world!.support({
      pose: entry,
      shape: this.shape,
      preferredSurfaceId: entry.contact.surfaceId,
      maxDistance: this.shape.halfExtents[1] + this.shape.clearance + 0.12,
      adhesion: false,
    });
    const currentIdentity = proof ? this.world!.identity(proof) : null;
    if (
      proof?.surfaceId !== entry.contact.surfaceId ||
      proof.kind !== 'ground' ||
      currentIdentity?.surfaceId !== identity.surfaceId ||
      currentIdentity.layer !== identity.layer ||
      !currentIdentity.allowedModes.includes('drive') ||
      this.world!.sweep({
        from: entry,
        to: entry,
        shape: this.shape,
        ignoreSurfaceId: proof.surfaceId,
      })
    )
      return null;
    return {
      pose: {
        position: [...entry.position] as TeslaVec3,
        quaternion: [...entry.quaternion] as TeslaState['quaternion'],
      },
      contact: proof,
      identity: currentIdentity,
    };
  }
  enter() {
    if (this.disposed) return false;
    if (this.active) return true;
    if (!this.e.closeBusVisit()) return false;
    this.world ??= new CityTeslaWorld(this.e);
    const nav = this.e.navigation;
    const fromStreet = nav && (nav.mode === 'walk' || nav.mode === 'drive');
    const x = fromStreet ? nav.position.x : this.e.controls.target.x;
    const z = fromStreet ? nav.position.z : this.e.controls.target.z;
    const y = fromStreet
      ? nav.position.y
      : (this.e.data.roadRelief?.(x, z) ?? this.e.elevation(x, z)) + 1.05;
    const localHeading = fromStreet ? nav.yaw : this.headingNear(x, z);
    let heading = localHeading;
    const local = this.roadCandidates([x, y, z], heading, 48, {
      surfaceId: fromStreet ? (nav.surfaceId ?? 'ground') : 'ground',
      layer: fromStreet ? (nav.surfaceLayer ?? 0) : 0,
    });
    let spawn = local.open;
    if (!spawn && !fromStreet) {
      const [rx, rz] = ROBSON,
        ry =
          (this.e.data.roadRelief?.(rx, rz) ?? this.e.elevation(rx, rz)) + 1.05;
      const fallbackHeading = this.headingNear(rx, rz),
        fallback = this.roadCandidates([rx, ry, rz], fallbackHeading, 64, {
          surfaceId: 'ground',
          layer: 0,
        });
      spawn = fallback.open ?? local.verified ?? fallback.verified;
      heading =
        fallback.open || !local.verified ? fallbackHeading : localHeading;
    }
    if (!spawn && fromStreet) spawn = local.verified;
    if (!spawn) {
      this.warning = 'no-spawn';
      this.notify();
      return false;
    }
    this.e.placement?.cancel();
    this.e.flight?.clear();
    this.e.travelReturn?.invalidate(true);
    nav?.setMode('orbit');
    this.adhesionPreference =
      this.state?.adhesionArmed ?? this.adhesionPreference;
    this.state = createTesla(spawn.pose.position, heading, spawn.contact);
    this.state.adhesionArmed = this.adhesionPreference;
    this.state.quaternion = [...spawn.pose.quaternion];
    this.entryState = cloneState(this.state);
    this.clearInput();
    this.originalMinDistance = this.e.controls.minDistance;
    this.e.controls.enabled = false;
    this.e.controls.autoRotate = false;
    this.e.transition = null;
    this.e.applySettings({
      ...this.e.settings,
      mode: 'tesla',
      autoRotate: false,
    });
    this.active = true;
    this.warning = '';
    this.lookYaw = this.lookPitch = 0;
    this.snapCamera = true;
    this.e.controls.enabled = false;
    if (!this.model) {
      this.effectiveQuality = this.selectQuality();
      this.model = createTeslaRoadster({ quality: this.effectiveQuality });
      this.model.group.position.y = -(
        this.shape.halfExtents[1] + this.shape.clearance
      );
      this.vehicle.add(this.model.group);
      this.e.prepareNightReceivers(this.vehicle);
      this.e.scene.add(this.vehicle);
      this.lastQuality = this.effectiveQuality;
    }
    this.vehicle.visible = true;
    this.update(0);
    this.e.onTeslaMode('tesla');
    this.notify();
    return true;
  }
  /** Called by Engine before another mode is activated. */
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.e.settings.mode = 'orbit';
    this.vehicle.visible = false;
    delete this.e.renderer.domElement.dataset.tesla;
    this.clearInput();
    this.e.camera.up.set(0, 1, 0);
    this.e.camera.near = 2;
    this.e.camera.fov = 42;
    this.e.camera.updateProjectionMatrix();
    this.e.controls.minDistance = this.originalMinDistance;
    this.e.controls.enabled = true;
    if (this.state) this.e.controls.target.fromArray(this.state.position);
    this.e.camera.lookAt(this.e.controls.target);
    this.notify();
  }
  leaveToOrbit() {
    if (!this.active) return;
    this.deactivate();
    this.e.applySettings({
      ...this.e.settings,
      mode: 'orbit',
      autoRotate: false,
    });
    this.e.controls.update();
    this.e.onLocalOrbit();
  }
  recover() {
    if (!this.active || !this.state || !this.world) return;
    const s = this.state,
      [x, , z] = s.position;
    const identity = this.roadIdentity(s.contact) ??
        this.roadIdentity(s.attachment?.contact ?? null) ??
        this.roadIdentity(s.departureContact) ??
        this.roadIdentity(this.entryState?.contact ?? null) ?? {
          surfaceId: 'ground',
          layer: 0,
        },
      ordinaryGround = identity.surfaceId === 'ground' && identity.layer === 0,
      y = ordinaryGround
        ? (this.e.data.roadRelief?.(x, z) ?? this.e.elevation(x, z)) + 1.05
        : s.position[1];
    let heading = ordinaryGround ? this.headingNear(x, z) : s.heading;
    const local = this.roadCandidates([x, y, z], heading, 48, identity);
    let spawn = local.open ?? local.verified;
    if (!spawn) {
      spawn = this.verifiedEntry(identity);
      heading = this.entryState?.heading ?? heading;
    }
    if (!spawn) {
      this.clearInput();
      this.warning = 'no-spawn';
      this.notify();
      return;
    }
    this.adhesionPreference = s.adhesionArmed;
    this.state = createTesla(spawn.pose.position, heading, spawn.contact);
    this.state.adhesionArmed = this.adhesionPreference;
    this.state.quaternion = [...spawn.pose.quaternion];
    this.clearInput();
    this.snapCamera = true;
    this.warning = 'recovered';
    this.update(0);
    this.notify();
  }
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.clearInput();
  }
  setAxes(x: number, y: number) {
    if (!this.active || !this.inputEnabled) {
      this.axes = { x: 0, y: 0 };
      return;
    }
    this.axes = {
      x: THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0, -1, 1),
      y: THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0, -1, 1),
    };
  }
  setButton(button: TeslaButton, held: boolean) {
    if (held && this.active && this.inputEnabled) this.buttons.add(button);
    else this.buttons.delete(button);
  }
  pulse(button: TeslaButton) {
    if (!this.active || !this.inputEnabled) return;
    this.heldPulses.set(button, performance.now() + 220);
  }
  command(command: TeslaCommand) {
    if (this.active && this.inputEnabled) this.pulses.add(command);
  }
  setView(view: TeslaView) {
    this.view = view;
    this.lookYaw = this.lookPitch = 0;
    this.snapCamera = true;
    this.updateCamera(0);
    this.notify();
  }
  toggleView() {
    this.setView(this.view === 'chase' ? 'cockpit' : 'chase');
  }
  setQuality(value: TeslaQualityPreference) {
    if (['auto', 'low', 'medium', 'high'].includes(value)) {
      this.quality = value;
      this.notify();
    }
  }
  zoom(factor: number) {
    if (
      !this.active ||
      !this.inputEnabled ||
      !Number.isFinite(factor) ||
      factor <= 0
    )
      return;
    if (this.view === 'cockpit') {
      if (factor > 1) this.setView('chase');
      return;
    }
    const next = this.distance * factor;
    if (next < 3.8) {
      this.setView('cockpit');
      return;
    }
    this.distance = Math.max(3.8, Math.min(24, next));
  }
  clearInput = () => {
    this.keys.clear();
    this.keyCodes.clear();
    this.buttons.clear();
    this.pulses.clear();
    this.heldPulses.clear();
    this.axes = { x: 0, y: 0 };
    this.pointers.clear();
    this.pinch = 0;
  };
  private visibility = () => {
    if (document.hidden) this.clearInput();
  };
  private input(): Partial<TeslaInput> {
    const pressed = (key: string) => this.keys.has(key);
    const button = (code: TeslaButton) =>
      this.buttons.has(code) ||
      (this.heldPulses.get(code) ?? 0) > performance.now();
    return {
      throttle: this.inputEnabled
        ? THREE.MathUtils.clamp(
            (pressed('w') ? 1 : 0) - (pressed('s') ? 1 : 0) + this.axes.y,
            -1,
            1,
          )
        : 0,
      steer: this.inputEnabled
        ? THREE.MathUtils.clamp(
            (pressed('a') ? 1 : 0) - (pressed('d') ? 1 : 0) - this.axes.x,
            -1,
            1,
          )
        : 0,
      lift: this.inputEnabled
        ? Number(pressed('space') || button('up')) -
          Number(pressed('control') || pressed('down') || button('down'))
        : 0,
      boost: this.inputEnabled && (pressed('shift') || button('boost')),
      brake: !this.inputEnabled || pressed('b') || button('brake'),
      jump: this.pulses.has('jump'),
      flightToggle: this.pulses.has('flightToggle'),
      adhesionToggle: this.pulses.has('adhesionToggle'),
      park: this.pulses.has('park'),
    };
  }
  private selectQuality() {
    return this.policy.update(performance.now(), {
      preference: this.quality,
      city: this.e.settings.quality,
      compatible: this.e.compatibleGraphics,
      cockpit: this.view === 'cockpit',
      speedMps: this.speedMps,
    });
  }
  update(dt: number) {
    if (
      !this.active ||
      !this.state ||
      !this.world ||
      !this.model ||
      this.disposed
    )
      return;
    const input = this.input();
    // Panels suspend this personal vehicle, including gravity and a pending
    // wall transition. Closing a panel never resumes a held accelerator.
    this.lastStep = stepTesla(
      this.state,
      input,
      this.inputEnabled ? dt : 0,
      this.world,
      this.shape,
    );
    if (dt > 0) this.pulses.clear();
    const s = this.state;
    this.adhesionPreference = s.adhesionArmed;
    if (s.position[1] > 1800) {
      s.position = [s.position[0], 1800, s.position[2]];
      s.velocity = [s.velocity[0], Math.min(0, s.velocity[1]), s.velocity[2]];
      this.warning = 'boundary';
    }
    if (s.position[1] < -100) {
      this.recover();
      this.warning = 'boundary';
      return;
    }
    const quality = this.selectQuality();
    if (quality !== this.lastQuality) {
      this.model.setQuality(quality);
      this.e.prepareNightReceivers(this.vehicle);
      this.lastQuality = quality;
    }
    this.effectiveQuality = quality;
    this.vehicle.position.fromArray(s.position);
    this.vehicle.quaternion.fromArray(s.quaternion);
    const elapsed = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    this.wheelSpin +=
      (teslaDot(s.velocity, teslaRotate(s.quaternion, [0, 0, 1])) * elapsed) /
      TESLA_ROADSTER_DIMENSIONS.wheelRadius;
    this.fanSpin =
      (this.fanSpin + elapsed * (s.mode === 'wall' ? 80 : 45)) % (Math.PI * 2);
    this.model.update({
      steeringRad: (input.steer ?? 0) * 0.42,
      wheelSpinRad: this.wheelSpin,
      fanSpinRad: this.fanSpin,
      thrust:
        s.mode === 'air' && !s.parked
          ? input.boost
            ? 1
            : 0.48
          : input.boost
            ? 0.8
            : 0,
      brake: input.brake ? 1 : 0,
      night: this.e.clock.hour < 7 || this.e.clock.hour > 19,
      wingDeploy:
        s.mode === 'wall' || s.mode === 'air' || input.boost
          ? 1
          : Math.min(1, this.speedMps / 40),
    });
    this.updateCamera(elapsed);
    const canvas = this.e.renderer.domElement;
    canvas.dataset.travelMode = 'tesla';
    canvas.dataset.cameraView = this.view;
    if (performance.now() - this.published >= 100) {
      this.published = performance.now();
      canvas.dataset.tesla = JSON.stringify({
        ...this.snapshot,
        position: s.position,
        quaternion: s.quaternion,
        heading: s.heading,
        contact: s.contact?.surfaceId ?? null,
        model: this.model.stats(),
        world: this.world.stats(),
        step: this.lastStep,
      });
      this.notify();
    }
  }
  private updateCamera(dt: number) {
    if (!this.active || !this.state || !this.world) return;
    const frame = teslaCameraFrame(this.state, this.view, {
      heading: this.state.heading,
      distance: this.distance,
      lookYaw: this.lookYaw,
      lookPitch: this.lookPitch,
      clearance: this.shape.clearance,
      wallNormal:
        this.state.mode === 'wall' ? this.state.contact?.normal : undefined,
    });
    if (this.view === 'chase') {
      const hit = this.world.cameraSweep(
        frame.target.toArray(),
        frame.position.toArray(),
        0.2,
      );
      if (hit)
        frame.position.lerpVectors(
          frame.target,
          frame.position,
          Math.max(0.03, hit.fraction - 0.035),
        );
      frame.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().lookAt(frame.position, frame.target, frame.up),
      );
    }
    const camera = this.e.camera;
    const alpha =
      this.snapCamera || this.view === 'cockpit'
        ? 1
        : 1 - Math.exp(-Math.max(0, dt) * 12);
    // The ideal chase segment is collision-tested; never smooth through a wall.
    const motionHit = this.world.cameraSweep(
      camera.position.toArray(),
      frame.position.toArray(),
      0.12,
    );
    const blend = motionHit ? 1 : alpha;
    camera.position.lerp(frame.position, blend);
    camera.quaternion.slerp(frame.quaternion, blend);
    camera.up.copy(frame.up);
    if (camera.near !== frame.near || camera.fov !== frame.fov) {
      camera.near = frame.near;
      camera.fov = frame.fov;
      camera.updateProjectionMatrix();
    }
    this.e.controls.target.copy(frame.target);
    this.snapCamera = false;
  }
  private keyDown = (event: KeyboardEvent) => {
    if (
      !this.active ||
      !this.inputEnabled ||
      event.defaultPrevented ||
      event.metaKey ||
      event.altKey
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="slider"],[role="combobox"]',
      )
    )
      return;
    const key = AXIS_KEYS[event.code];
    if (!key) return;
    // A key held across blur or a modal needs a new physical down event.
    if (event.repeat && !this.keyCodes.has(event.code)) return;
    if (
      (event.ctrlKey && key !== 'control') ||
      (key === 'space' && target?.closest('button,a,[role="radio"]'))
    )
      return;
    if (event.code.startsWith('Arrow') && target?.closest('[role="radio"]'))
      return;
    event.preventDefault();
    this.keyCodes.add(event.code);
    this.keys.add(key);
    if (event.repeat) return;
    if (key === 'space') this.command('jump');
    if (key === 'f') this.command('flightToggle');
    if (key === 'e') this.command('adhesionToggle');
    if (key === 'p') this.command('park');
    if (key === 'c') this.toggleView();
    if (key === 'r') this.recover();
  };
  private keyUp = (event: KeyboardEvent) => {
    const key = AXIS_KEYS[event.code];
    this.keyCodes.delete(event.code);
    if (key && ![...this.keyCodes].some((code) => AXIS_KEYS[code] === key))
      this.keys.delete(key);
  };
  private pointerDown = (event: PointerEvent) => {
    if (!this.active || !this.inputEnabled || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.e.renderer.domElement.focus({ preventScroll: true });
    this.e.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
  };
  private pointerMove = (event: PointerEvent) => {
    const prior = this.pointers.get(event.pointerId);
    if (!this.active || !prior) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()],
        next = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (this.pinch > 0) this.zoom(this.pinch / Math.max(1, next));
      this.pinch = next;
      return;
    }
    this.lookYaw -= (event.clientX - prior[0]) * 0.006;
    this.lookPitch = THREE.MathUtils.clamp(
      this.lookPitch + (event.clientY - prior[1]) * 0.004,
      -0.65,
      0.95,
    );
  };
  private pointerUp = (event: PointerEvent) => {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.delete(event.pointerId);
      this.pinch = 0;
    }
  };
  private wheel = (event: WheelEvent) => {
    if (
      !this.active ||
      !this.inputEnabled ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.zoom(
      Math.exp(
        THREE.MathUtils.clamp(
          event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.002),
          -0.4,
          0.4,
        ),
      ),
    );
  };
  destroy() {
    if (this.disposed) return;
    this.deactivate();
    this.disposed = true;
    const canvas = this.e.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('pointermove', this.pointerMove, true);
    window.removeEventListener('pointerup', this.pointerUp, true);
    window.removeEventListener('pointercancel', this.pointerUp, true);
    canvas.removeEventListener('wheel', this.wheel, true);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.visibility);
    this.model?.dispose();
    this.world?.dispose();
    this.vehicle.removeFromParent();
    this.vehicle.clear();
    this.onChange = () => {};
  }
}
