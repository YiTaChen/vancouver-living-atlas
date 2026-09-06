/** Opt-in local QA build only. Stripped from normal Firebase builds. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';
import { project } from './geo';
import { auditCausewayTravel } from './causeway-qa';
import { installReleaseQAControls } from './release-qa-controls';

const cases = [
  { id: 'downtown', view: 'downtown' },
  { id: 'water-street', street: 'WATER ST' },
  { id: 'robson-drive', street: 'ROBSON ST', drive: true },
  { id: 'robson-walk', street: 'ROBSON ST', forward: true },
  {
    id: 'burrard-drive',
    street: 'BURRARD ST',
    streetTarget: [-123.118, 49.2865],
    drive: true,
  },
  { id: 'coal-harbour-boat', boatAt: [-123.125, 49.295], forward: true },
  { id: 'open-harbour-boat', boatAt: [-123.12, 49.296], forward: true },
  { id: 'causeway', coord: [-123.1419028, 49.3118075], offset: [110, 85, 170] },
  { id: 'causeway-south', coord: [-123.13665, 49.29624], offset: [90, 62, 90] },
  {
    id: 'causeway-underpass',
    coord: [-123.1367278, 49.2973427],
    offset: [22, 3, -10],
    targetY: 7,
  },
  {
    id: 'lions-walkway',
    coord: [-123.14057818, 49.3132481],
    offset: [-18, 8, 45],
    targetY: 65.95,
  },
  {
    id: 'lions-west-entry',
    coord: [-123.14207, 49.3125],
    offset: [-75, 35, 20],
  },
  {
    id: 'second-beach',
    coord: [-123.15096, 49.29418],
    offset: [-150, 95, 100],
  },
  { id: 'third-beach', coord: [-123.15734, 49.30363], offset: [-170, 95, 90] },
  {
    id: 'north-coast-road',
    coord: [-123.140683, 49.31332],
    offset: [-80, 55, -35],
  },
  {
    id: 'north-coast-trail',
    coord: [-123.147165, 49.313101],
    offset: [-40, 55, -70],
  },
  {
    id: 'northwest-coast-trail',
    coord: [-123.156028, 49.306809],
    offset: [-80, 50, 20],
  },
  { id: 'second-sand', walkAt: [-123.1500073169, 49.2944261588] },
  { id: 'third-sand', walkAt: [-123.1564938289, 49.3043524973] },
  {
    id: 'second-boat',
    boatAt: [-123.1512467778, 49.2944261588],
    forward: true,
  },
  { id: 'science', view: 'science' },
  {
    id: 'marine-entry',
    landmarkPose: {
      coord: [-123.117146, 49.287449],
      yaw: 0.77,
      baseY: 14.22,
      camera: [8, 6, 34],
      target: [0.87, 4.6, 15],
    },
  },
  {
    id: 'science-entry',
    landmarkPose: {
      coord: [-123.1039114, 49.2733499],
      yaw: 0,
      baseY: 3.4,
      camera: [57, 6, -76],
      target: [40, 3.3, -52],
    },
  },
  {
    id: 'canada-gallery',
    landmarkPose: {
      coord: [-123.111352, 49.2886214],
      yaw: -1.073,
      baseY: 3.5,
      camera: [59, 10, -32],
      target: [34, 12, -8],
    },
  },
  {
    id: 'canada-sails',
    landmarkPose: {
      coord: [-123.111352, 49.2886214],
      yaw: -1.073,
      baseY: 3.5,
      camera: [90, 36, 75],
      target: [0, 43, 8],
    },
  },
  {
    id: 'canada-pier',
    landmarkPose: {
      coord: [-123.111352, 49.2886214],
      yaw: -1.073,
      baseY: 3.5,
      camera: [85, -1.6, -55],
      target: [34, 9, -20],
    },
  },
  {
    id: 'bc-entry',
    landmarkPose: {
      coord: [-123.1120067, 49.2766985],
      yaw: 0.677,
      baseY: 5,
      camera: [-115, 7, -28],
      target: [-106.87, 3, 0],
    },
  },
  {
    id: 'bc-envelope',
    landmarkPose: {
      coord: [-123.1120067, 49.2766985],
      yaw: 0.677,
      baseY: 5,
      camera: [150, 65, 155],
      target: [50, 30, 40],
    },
  },
  {
    id: 'harbour-entry',
    landmarkPose: {
      coord: [-123.1120903, 49.2847656],
      yaw: -0.8,
      baseY: 17.96477617737215,
      camera: [10, 6, 44],
      target: [38.15, 4, 35.75],
    },
  },
  {
    id: 'harbour-tower',
    landmarkPose: {
      coord: [-123.1120903, 49.2847656],
      yaw: -0.8,
      baseY: 17.96477617737215,
      camera: [150, 170, 140],
      target: [0, 100, 0],
    },
  },
  {
    id: 'convention-entry',
    landmarkPose: {
      coord: [-123.1159678, 49.2890752],
      yaw: -0.403,
      baseY: 4,
      camera: [-105, 8, -44],
      target: [-71.65, 4, -30.64],
    },
  },
  {
    id: 'convention-roof',
    landmarkPose: {
      coord: [-123.1159678, 49.2890752],
      yaw: -0.403,
      baseY: 4,
      camera: [-190, 95, 125],
      target: [-35, 12, -10],
    },
  },
  {
    id: 'house-balconies',
    landmarkPose: {
      coord: [-123.131029, 49.2749256],
      yaw: -0.78,
      baseY: 14.140882560018866,
      camera: [57, 88, 67],
      target: [5, 78, 0],
    },
  },
  {
    id: 'house-podium',
    landmarkPose: {
      coord: [-123.131029, 49.2749256],
      yaw: -0.78,
      baseY: 14.140882560018866,
      camera: [62, 18, 74],
      target: [5, 14, 10],
    },
  },
  { id: 'marine', view: 'marine' },
  { id: 'canada', view: 'canada' },
] as const;

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0
  );
}

export function installVisualQA(e: CityEngine) {
  const panel = document.createElement('section');
  panel.id = 'visual-qa-panel';
  panel.setAttribute('aria-label', 'Visual QA laboratory');
  panel.style.cssText =
    'position:fixed;z-index:10000;left:100px;top:95px;width:390px;padding:12px;background:#102a30ed;color:white;font:13px monospace;border:1px solid #93c9c9;max-height:65vh;overflow:auto';
  const label = document.createElement('strong');
  label.textContent = 'LOCAL VISUAL QA — not a public feature';
  const status = document.createElement('p');
  status.id = 'visual-qa-status';
  status.textContent = 'Ready';
  const output = document.createElement('textarea');
  output.id = 'visual-qa-report';
  output.setAttribute('aria-label', 'Visual QA report');
  output.style.cssText = 'display:block;width:100%;height:70px;color:white';
  panel.appendChild(label);
  panel.appendChild(status);
  let running = false,
    selectedCase = 'downtown';
  const button = (name: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = fn;
    panel.appendChild(b);
  };
  const apply = (id: string, quality: VisualQuality) => {
    const test = cases.find((c) => c.id === id)!;
    selectedCase = id;
    e.navigation?.setMode('orbit');
    e.setClock({ hour: 14, running: false });
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      quality,
      labels: false,
      autoRotate: false,
    });
    if ('view' in test) e.flyTo(test.view, false);
    if ('coord' in test) {
      const [x, z] = project([...test.coord]);
      const y = 'targetY' in test ? test.targetY : e.elevation(x, z);
      e.camera.position.set(
        x + test.offset[0],
        y + test.offset[1],
        z + test.offset[2],
      );
      e.controls.target.set(x, y, z);
      e.controls.update();
    }
    if ('landmarkPose' in test) {
      const p = test.landmarkPose,
        origin = project(p.coord);
      const world = (v: readonly number[]): [number, number, number] => [
        origin[0] + Math.cos(p.yaw) * v[0] + Math.sin(p.yaw) * v[2],
        p.baseY + v[1],
        origin[1] - Math.sin(p.yaw) * v[0] + Math.cos(p.yaw) * v[2],
      ];
      e.camera.position.set(...world(p.camera));
      e.controls.target.set(...world(p.target));
      e.controls.update();
    }
    if ('street' in test) {
      const mode = 'drive' in test ? 'drive' : 'walk';
      if ('streetTarget' in test) {
        const [x, z] = project(test.streetTarget);
        e.controls.target.set(x, 0, z);
      }
      e.navigation!.setMode(mode, test.street);
      e.settings.mode = mode;
      e.applySettings({ ...e.settings, mode });
      e.navigation!.cameraDistances[mode] = mode === 'drive' ? 10 : 0;
      e.navigation!.snapCamera = true;
      e.navigation!.update(0);
    }
    if ('walkAt' in test || 'boatAt' in test) {
      const mode = 'walkAt' in test ? 'walk' : 'boat';
      const coord = 'walkAt' in test ? test.walkAt : test.boatAt;
      const [x, z] = project(coord);
      e.applySettings({ ...e.settings, mode });
      const valid = e.navigation!.startAt(mode, {
        x,
        z,
        y: mode === 'boat' ? 0.1 : e.elevation(x, z),
        yaw: mode === 'boat' ? Math.PI / 2 : -Math.PI / 2,
        surface: mode === 'boat' ? 'water' : 'ground',
        waterId: mode === 'boat' ? 'sea' : undefined,
        name: test.id,
        snappedDistance: 0,
      });
      if (valid === false) throw new Error('Coast QA start is no longer valid');
      e.navigation!.cameraDistances[mode] = mode === 'boat' ? 18 : 0;
      e.navigation!.snapCamera = true;
      e.navigation!.update(0);
    }
    e.renderer.shadowMap.needsUpdate = true;
    status.textContent = `${id} / ${quality}`;
  };
  async function collect(ms: number, traceTravel = false) {
    const gaps: number[] = [];
    const trace: {
      elapsedMs: number;
      position: number[];
      mode: string;
      speed: number;
    }[] = [];
    let hidden = false,
      previous = performance.now();
    let nextTrace = 0;
    const start = previous;
    await new Promise<void>((resolve) => {
      function frame(now: number) {
        hidden ||= document.hidden;
        gaps.push(now - previous);
        previous = now;
        if (traceTravel && now - start >= nextTrace) {
          const nav = e.navigation!;
          trace.push({
            elapsedMs: now - start,
            position: nav.position.toArray(),
            mode: nav.mode,
            speed: nav.speed,
          });
          nextTrace += 1000;
        }
        if (e.disposed || now - start >= ms) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    return { gaps, hidden, elapsed: previous - start, trace };
  }
  async function run(
    quality: VisualQuality,
    only?: string | readonly string[],
    durationMs = 8000,
  ) {
    if (running) return;
    running = true;
    const results = [];
    try {
      for (const test of cases.filter(
        (c) =>
          !only ||
          (typeof only === 'string' ? c.id === only : only.includes(c.id)),
      )) {
        apply(test.id, quality);
        await collect(2500);
        const start = e.navigation!.position.toArray();
        if ('drive' in test || 'forward' in test) e.navigation!.keys.add('w');
        status.textContent = `Measuring ${test.id} / ${quality} / ${durationMs / 1000}s`;
        const sample = await collect(durationMs, durationMs > 8000);
        e.navigation!.keys.clear();
        const info = e.renderer.info;
        const row = {
          id: `${test.id}${durationMs > 8000 ? '-long' : ''}`,
          quality,
          hour: 14,
          sampleMs: sample.elapsed,
          ...(sample.trace.length ? { travelTrace: sample.trace } : {}),
          valid: !sample.hidden && !e.disposed,
          viewport: [innerWidth, innerHeight],
          dpr: devicePixelRatio,
          render: [e.renderer.domElement.width, e.renderer.domElement.height],
          fps: (sample.gaps.length / sample.elapsed) * 1000,
          p50Ms: percentile(sample.gaps, 0.5),
          p95Ms: percentile(sample.gaps, 0.95),
          p99Ms: percentile(sample.gaps, 0.99),
          maxMs: Math.max(...sample.gaps),
          over50Ms: sample.gaps.filter((n) => n > 50).length,
          over100Ms: sample.gaps.filter((n) => n > 100).length,
          frames: sample.gaps.length,
          start,
          end: e.navigation!.position.toArray(),
          camera: e.camera.position.toArray(),
          target: e.controls.target.toArray(),
          triangles: info.render.triangles,
          calls: info.render.calls,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          nearTrees: e.data.detailedTreeCount || 0,
        };
        results.push(row);
        panel.style.visibility = 'hidden';
        const screenshot = e.screenshot();
        panel.style.visibility = '';
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${quality}-${test.id}${durationMs > 8000 ? '-long' : ''}`,
            row,
            screenshot,
          }),
        });
        if (!response.ok) throw new Error(`QA save failed: ${response.status}`);
        output.value = JSON.stringify(results, null, 2);
      }
      status.textContent = `Completed ${quality}: ${results.length} cases`;
    } catch (error) {
      status.textContent = String(error);
    } finally {
      running = false;
      e.navigation?.keys.clear();
    }
  }
  button('Save startup timing', () => {
    if (running) return;
    const measurement = e.startupQA?.snapshot();
    if (!measurement) {
      status.textContent = 'No startup recorder';
      return;
    }
    const row = {
      kind: 'startup-wall-v1',
      id: 'startup',
      valid: measurement.valid,
      measurement,
      viewport: [innerWidth, innerHeight],
      render: [e.renderer.domElement.width, e.renderer.domElement.height],
    };
    output.value = JSON.stringify(row, null, 2);
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'startup-timing', row }),
    })
      .then((r) => {
        status.textContent = r.ok
          ? 'Saved startup timing'
          : `Save failed ${r.status}`;
      })
      .catch((error) => {
        status.textContent = String(error);
      });
  });
  installReleaseQAControls(e, {
    button,
    apply,
    selectedCase: () => selectedCase,
    isColdCase: (id) => {
      const test = cases.find((c) => c.id === id);
      return !!test && ('view' in test || 'landmarkPose' in test);
    },
    begin: () => {
      if (running) return false;
      running = true;
      return true;
    },
    end: () => {
      running = false;
    },
    panel,
    status,
    output,
  });
  const secondaryCases = [
    'bc-entry',
    'harbour-entry',
    'convention-entry',
    'house-balconies',
  ];
  button('Measure secondary High', () => void run('high', secondaryCases));
  button('Measure secondary Ultra', () => void run('ultra', secondaryCases));
  button('Run High baseline', () => void run('high'));
  button('Audit Causeway travel', () => {
    if (running) return;
    running = true;
    status.textContent = 'Replaying actual navigation on Causeway source lines';
    void auditCausewayTravel(e)
      .then(async (row) => {
        output.value = JSON.stringify(row, null, 2);
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'causeway-travel-audit', row }),
        });
        status.textContent = response.ok
          ? `Causeway travel: ${row.valid ? 'PASS' : 'FAIL'}`
          : `Save failed ${response.status}`;
      })
      .catch((error) => {
        status.textContent = String(error);
      })
      .finally(() => {
        running = false;
      });
  });
  button('Run Ultra baseline', () => void run('ultra'));
  button('Measure selected High', () => void run('high', selectedCase));
  button('Measure selected Ultra', () => void run('ultra', selectedCase));
  button(
    'Measure selected 60s',
    () => void run(e.settings.quality, selectedCase, 60000),
  );
  button('Save current view', () => {
    if (running) return;
    running = true;
    const id = `${selectedCase}-${e.clock.hour.toFixed(2).replace('.', 'p')}h`;
    const row = {
      kind: 'visual-check',
      id,
      quality: e.settings.quality,
      hour: e.clock.hour,
      valid: !document.hidden && !e.disposed,
      viewport: [innerWidth, innerHeight],
      render: [e.renderer.domElement.width, e.renderer.domElement.height],
      camera: e.camera.position.toArray(),
      target: e.controls.target.toArray(),
      mode: e.navigation!.mode,
      position: e.navigation!.position.toArray(),
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${row.quality}-${id}`,
        row,
        screenshot: e.screenshot(),
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`QA save failed: ${response.status}`);
        status.textContent = `Saved ${id}`;
      })
      .catch((error) => {
        status.textContent = String(error);
      })
      .finally(() => {
        running = false;
      });
  });
  for (const test of cases)
    button(test.id, () => {
      if (!running) apply(test.id, e.settings.quality);
    });
  button('14:00', () => e.setClock({ hour: 14, running: false }));
  button('19:00', () => e.setClock({ hour: 19, running: false }));
  button('23:00', () => e.setClock({ hour: 23, running: false }));
  button('Hide QA panel', () => {
    panel.style.display = 'none';
  });
  panel.appendChild(output);
  document.body.appendChild(panel);
  const gl = e.renderer.getContext(),
    ext = gl.getExtension('WEBGL_debug_renderer_info');
  void fetch('/__visual-qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'capabilities',
      row: {
        renderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        userAgent: navigator.userAgent,
        landmarkGroundPlans: e.data.landmarkGroundPlans,
        createdAt: new Date().toISOString(),
      },
    }),
  });
}
