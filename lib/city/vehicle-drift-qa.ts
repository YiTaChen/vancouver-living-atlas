/** Loopback-only observer. Native controls supply all acceleration, steering
 * and drift input; this recorder never places, repairs or moves a vehicle. */
import type { CityEngine } from './engine';

export function installVehicleDriftQA(e: CityEngine, panel: HTMLElement) {
  const status = document.createElement('p');
  status.textContent = 'Vehicle drift QA ready';
  panel.appendChild(status);
  let recording = false,
    sequence = 0;
  let entry: {
    mode: string;
    model: string;
    position: number[];
    initialDamage: number;
    broken: number;
  } | null = null;
  let previous: { x: number; z: number; t: number } | null = null;
  const samples: unknown[] = [],
    pressed = new Set<string>();
  const observeKey = (event: KeyboardEvent) => {
    if (
      !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'Space', 'KeyB'].includes(
        event.code,
      )
    )
      return;
    if (event.type === 'keydown') pressed.add(event.code);
    else pressed.delete(event.code);
  };
  window.addEventListener('keydown', observeKey);
  window.addEventListener('keyup', observeKey);
  const sample = () => {
    if (!recording || document.hidden || e.disposed) return;
    const tesla =
      e.settings.mode === 'tesla' && e.tesla?.active ? e.tesla : null;
    const state = tesla?.state;
    const nav = e.navigation;
    if (
      (!tesla && (e.settings.mode !== 'drive' || nav?.mode !== 'drive')) ||
      entry?.mode !== e.settings.mode
    ) {
      recording = false;
      status.textContent = 'Drift recording ended: mode changed';
      return;
    }
    const position = state ? [...state.position] : nav!.position.toArray();
    const yaw = state?.heading ?? nav!.yaw;
    const t = performance.now();
    const dx = previous ? position[0] - previous.x : 0;
    const dz = previous ? position[2] - previous.z : 0;
    const travelYaw = Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : null;
    const speedKph = state
      ? Math.hypot(...state.velocity) * 3.6
      : nav!.speed * 3.6;
    samples.push({
      t,
      position,
      bodyYaw: yaw,
      travelYaw,
      observedSlip:
        travelYaw === null
          ? null
          : Math.atan2(Math.sin(travelYaw - yaw), Math.cos(travelYaw - yaw)),
      observedSpeedKph:
        previous && t > previous.t
          ? (Math.hypot(dx, dz) * 3600) / (t - previous.t)
          : 0,
      speedKph,
      slipAngle: state?.drift.slipAngle ?? nav!.drift.slipAngle,
      active: state?.drift.active ?? nav!.drift.active,
      intensity: tesla ? tesla.snapshot.driftIntensity : nav!.driftIntensity,
      physicalKeys: [...pressed],
      touchDrift: tesla ? undefined : nav!.touchDrift,
      surface: state?.contact?.surfaceId ?? nav?.surfaceId ?? 'ground',
      effects: e.driftEffects?.stats(),
      damage: (tesla?.condition ?? nav!.condition).damage.overall,
      police: tesla ? false : nav?.trafficStop?.active,
    });
    previous = { x: position[0], z: position[2], t };
    if (samples.length >= 1200) {
      recording = false;
      status.textContent = 'Drift recorder reached its sample limit';
    }
  };
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = action;
    panel.appendChild(b);
  };
  button('Drift QA: record native input', () => {
    const tesla =
      e.settings.mode === 'tesla' && e.tesla?.active ? e.tesla : null;
    const nav = e.navigation;
    if (!tesla && (e.settings.mode !== 'drive' || nav?.mode !== 'drive')) {
      status.textContent = 'Choose the public Drive or Tesla mode first';
      return;
    }
    entry = {
      mode: e.settings.mode,
      model: tesla ? 'tesla' : nav!.carModel,
      position: tesla?.state
        ? [...tesla.state.position]
        : nav!.position.toArray(),
      initialDamage: (tesla?.condition ?? nav!.condition).damage.overall,
      broken: e.vehicleImpacts?.broken.size ?? 0,
    };
    samples.length = 0;
    previous = null;
    recording = true;
    status.textContent = 'Recording native drift controls';
    sample();
  });
  button('Drift QA: save checkpoint', () => {
    sample();
    const row = {
      kind: 'vehicle-drift-native-v1',
      entry,
      samples: [...samples],
      quality: e.settings.quality,
      qualityMode: e.settings.qualityMode,
      viewport: [innerWidth, innerHeight],
      effects: e.driftEffects?.stats(),
      valid:
        entry !== null &&
        entry.mode === e.settings.mode &&
        entry.model ===
          (e.settings.mode === 'tesla' ? 'tesla' : e.navigation?.carModel) &&
        !e.disposed &&
        !document.hidden,
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `vehicle-drift-${++sequence}-${Date.now()}`,
        row,
        screenshot: e.screenshot(),
      }),
    }).then((response) => {
      status.textContent = response.ok
        ? 'Drift checkpoint saved'
        : `Drift save failed ${response.status}`;
    });
  });
  const timer = setInterval(() => {
    if (e.disposed) {
      clearInterval(timer);
      window.removeEventListener('keydown', observeKey);
      window.removeEventListener('keyup', observeKey);
      return;
    }
    sample();
  }, 50);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      window.removeEventListener('keydown', observeKey);
      window.removeEventListener('keyup', observeKey);
    },
    { once: true },
  );
}
