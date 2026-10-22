/** Loopback opt-in visual QA only. No test damage, speed or break state is
 * injected: entries use public navigation and subsequent native controls. */
import type { CityEngine } from './engine';

export function installVehicleImpactQA(e: CityEngine, panel: HTMLElement) {
  const status = document.createElement('p');
  status.id = 'vehicle-impact-qa-status';
  status.textContent = 'Vehicle impact QA ready';
  panel.appendChild(status);
  let entry: unknown = null,
    sequence = 0;
  let armed = false;
  const button = (name: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = action;
    panel.appendChild(b);
  };
  for (const mode of ['drive', 'tesla'] as const)
    for (const kind of ['tree', 'lamp'] as const)
      button(`Impact QA: ${mode} ${kind} approach`, () => {
        const nav = e.navigation,
          world = e.vehicleImpacts;
        if (!nav || !world) return;
        e.tesla?.deactivate();
        e.applySettings({
          ...e.settings,
          mode: 'drive',
          qualityMode: 'manual',
          quality: 'high',
          autoRotate: false,
          labels: false,
        });
        e.setClock({ hour: 14, running: false });
        const props = [...world.props.values()]
          .filter(
            (p) =>
              p.kind === kind &&
              !world.isBroken(p.id) &&
              (kind !== 'tree' || p.diameterM! < 0.33) &&
              Math.hypot(p.position[0], p.position[2]) < 2500,
          )
          .sort(
            (a, b) => a.heightM - b.heightM || a.position[0] - b.position[0],
          );
        for (const p of props)
          for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const x = p.position[0] - Math.sin(yaw) * 12,
              z = p.position[2] - Math.cos(yaw) * 12;
            let clear = true;
            for (let i = 0; i <= 12 && clear; i++) {
              const xx = x + Math.sin(yaw) * i,
                zz = z + Math.cos(yaw) * i;
              for (const side of [-1, 0, 1])
                if (
                  !nav.clearGround(
                    xx + Math.cos(yaw) * side,
                    zz - Math.sin(yaw) * side,
                    'drive',
                  )
                )
                  clear = false;
              if (Math.abs(nav.roadHeight(xx, zz) - nav.roadHeight(x, z)) > 1)
                clear = false;
            }
            if (!clear) continue;
            const y = nav.roadHeight(x, z);
            nav.startAt('drive', {
              x,
              y,
              z,
              yaw,
              surface: 'ground',
              name: 'Impact approach',
              snappedDistance: 0,
            });
            if (mode === 'tesla') {
              if (!e.tesla?.enter()) continue;
              const actual = e.tesla.state!.position;
              if (Math.hypot(actual[0] - x, actual[2] - z) > 0.5) {
                e.tesla.deactivate();
                continue;
              }
              e.tesla.setView('chase');
            } else {
              nav.cameraDistances.drive = 9;
              nav.snapCamera = true;
            }
            entry = { mode, obstacle: p, x, y, z, yaw };
            status.textContent = `Ready ${mode} facing ${p.id} (diameter ${p.diameterM!.toFixed(3)}m); use native accelerator`;
            return;
          }
        status.textContent = `No clear actual ${kind} approach found`;
      });
  button('Impact QA: Drive bridge barrier approach', () => {
    const nav = e.navigation;
    const segments = e.data.causeway?.main?.segments;
    if (!nav || !segments?.length) return;
    const s = segments[Math.floor(segments.length * 0.4)],
      x = (s.a[0] + s.b[0]) / 2,
      z = (s.a[1] + s.b[1]) / 2;
    const yaw = Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]) + 0.28;
    e.tesla?.deactivate();
    e.applySettings({
      ...e.settings,
      mode: 'drive',
      qualityMode: 'manual',
      quality: 'high',
    });
    nav.startAt('drive', {
      x,
      y: s.h0,
      z,
      yaw,
      surface: 'bridge',
      surfaceId: s.surfaceId,
      layer: s.layer,
      name: 'Barrier approach',
      snappedDistance: 0,
    });
    nav.cameraDistances.drive = 9;
    nav.snapCamera = true;
    entry = { mode: 'drive', case: 'bridge-barrier', x, z, yaw };
    status.textContent =
      'Ready Drive bridge barrier approach; native accelerator at shallow angle';
  });
  const save = (burst = false) => {
    const condition =
      e.settings.mode === 'tesla'
        ? e.tesla?.condition
        : e.navigation?.condition;
    const row = {
      kind: 'vehicle-impact-webgl-v1',
      burst,
      entry,
      mode: e.settings.mode,
      viewport: [innerWidth, innerHeight],
      quality: e.settings.quality,
      qualityMode: e.settings.qualityMode,
      valid: !e.disposed && !document.hidden,
      damage: condition?.damage,
      visuals: condition?.visuals.stats(),
      broken: [...(e.vehicleImpacts?.broken ?? [])],
      feedback: e.impactFeedback?.stats(),
      tesla: e.renderer.domElement.dataset.tesla,
      drive: {
        position: e.navigation?.position.toArray(),
        speed: e.navigation?.speed,
        yaw: e.navigation?.yaw,
      },
      calls: e.renderer.info.render.calls,
      triangles: e.renderer.info.render.triangles,
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `impact-${e.settings.mode}-${++sequence}-${Date.now()}`,
        row,
        screenshot: e.screenshot(),
      }),
    }).then((r) => {
      status.textContent = r.ok
        ? 'Impact checkpoint saved'
        : `Save failed ${r.status}`;
    });
  };
  button('Impact QA: save checkpoint', () => save());
  button('Impact QA: arm next collision capture', () => {
    armed = true;
    status.textContent = 'Armed actual next impact frame capture';
  });
  if (e.impactFeedback) {
    const emit = e.impactFeedback.emit.bind(e.impactFeedback);
    e.impactFeedback.emit = (event) => {
      const result = emit(event);
      if (armed && result) {
        armed = false;
        requestAnimationFrame(() => requestAnimationFrame(() => save(true)));
      }
      return result;
    };
  }
}
