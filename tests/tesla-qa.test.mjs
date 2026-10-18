import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { installTeslaQA, teslaQAWallCandidates } = await import(
  cityModule('tesla-qa')
);
const { createTesla } = await import(cityModule('tesla-state'));
const { inPolygon } = await import(cityModule('geo'));

class Element extends EventTarget {
  constructor(tag = 'section') {
    super();
    this.tagName = tag.toUpperCase();
  }
  children = [];
  style = {};
  value = '';
  textContent = '';
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute() {}
}
async function dom(action) {
  const saved = new Map(),
    previousEnv = process.env.VANCOUVER_VISUAL_QA;
  const replace = (name, value) => {
    if (!saved.has(name))
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  let now = 0,
    sequence = 0,
    onFrame = () => {};
  const cancelled = new Set(),
    document = Object.assign(new EventTarget(), {
      hidden: false,
      createElement: (tag) => new Element(tag),
    });
  replace('document', document);
  replace('location', { hostname: '127.0.0.1' });
  replace('performance', { now: () => now });
  replace('innerWidth', 800);
  replace('innerHeight', 600);
  replace('requestAnimationFrame', (callback) => {
    const id = ++sequence;
    queueMicrotask(() => {
      if (!cancelled.has(id)) {
        now += 50;
        onFrame(now);
        callback(now);
      }
    });
    return id;
  });
  replace('cancelAnimationFrame', (id) => cancelled.add(id));
  replace('fetch', async () => ({ ok: true }));
  process.env.VANCOUVER_VISUAL_QA = '1';
  try {
    await action({
      document,
      replace,
      frame: (hook) => {
        onFrame = hook;
      },
    });
  } finally {
    if (previousEnv === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = previousEnv;
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
const click = (panel, text) => {
  const button = panel.children.find(
    (element) => element.tagName === 'BUTTON' && element.textContent === text,
  );
  assert.ok(button, text);
  return button.onclick();
};
const lease = () => ({
  active: false,
  starts: 0,
  ends: 0,
  isRunning() {
    return this.active;
  },
  begin() {
    if (this.active) return false;
    this.active = true;
    this.starts++;
    return true;
  },
  end() {
    assert.ok(this.active);
    this.active = false;
    this.ends++;
  },
});
function fixture() {
  const events = [],
    held = new Set(),
    contact = {
      surfaceId: 'ground:asphalt:fixture',
      kind: 'ground',
      point: [0, 0, 0],
      normal: [0, 1, 0],
      adherable: true,
    };
  const t = {
    active: true,
    state: createTesla([0, 0.682, 0], 0, contact),
    speedMps: 0,
    quality: 'auto',
    effectiveQuality: 'medium',
    view: 'chase',
    lastStep: {
      substeps: 2,
      collisions: 0,
      simulatedS: 0.016,
      droppedS: 0,
      transitions: 0,
      environmentFailures: 0,
    },
    shape: { halfExtents: [1.04, 0.62, 2.34], clearance: 0.06 },
    world: { stats: () => ({ sources: 8, cachedTiles: 1 }) },
    model: {
      stats: () => ({
        quality: t.effectiveQuality,
        triangles: 25_664,
        meshes: 36,
      }),
    },
    get snapshot() {
      return {
        active: this.active,
        mode: this.state.mode,
        parked: this.state.parked,
        quality: this.quality,
        effectiveQuality: this.effectiveQuality,
        view: this.view,
        altitudeM: 40,
      };
    },
    deactivate() {
      this.active = false;
      events.push(['deactivate']);
    },
    enter() {
      this.active = true;
      events.push(['enter']);
      return true;
    },
    clearInput() {
      held.clear();
      events.push(['clear']);
    },
    setButton(button, down) {
      events.push(['button', button, down]);
      if (down) held.add(button);
      else held.delete(button);
    },
    setAxes(x, y) {
      events.push(['axes', x, y]);
    },
    command(command) {
      events.push(['command', command]);
    },
    setView(view) {
      this.view = view;
      events.push(['view', view]);
    },
    setQuality(quality) {
      this.quality = quality;
      events.push(['quality', quality]);
    },
  };
  const camera = new THREE.PerspectiveCamera(62, 4 / 3, 0.035, 10_000);
  camera.position.set(1, 2, 3);
  camera.up.set(0, 0, 1);
  const e = {
    tesla: t,
    disposed: false,
    contextLost: false,
    pageSuspended: false,
    settings: { mode: 'tesla', quality: 'high', qualityMode: 'auto' },
    data: { flightBuildingVolumes: [] },
    camera,
    controls: { target: new THREE.Vector3() },
    renderer: {
      domElement: { width: 1000, height: 750 },
      getPixelRatio: () => 1.25,
      info: {
        render: { calls: 5, triangles: 12, points: 0, lines: 0 },
        memory: { geometries: 4, textures: 2 },
      },
    },
    stats: { fps: 42 },
    uniforms: { night: { value: 0 } },
    clock: { hour: 14 },
    navigation: {
      blur() {
        events.push(['nav-blur']);
      },
    },
    flight: {
      clear() {
        events.push(['flight-clear']);
      },
    },
    elevation: () => 5,
    setClock(clock) {
      this.clock = clock;
    },
    applySettings(settings) {
      this.settings = settings;
      events.push(['settings']);
    },
    screenshot() {
      this.renderer.info.render.calls = 99;
      return 'data:image/png;base64,bGl2ZQ==';
    },
  };
  return { e, t, events, held };
}

test('Tesla QA requires both explicit instrumentation and a loopback origin', async () => {
  await dom(async ({ replace }) => {
    const e = new Proxy(
        {},
        {
          get() {
            throw Error('guard touched engine');
          },
        },
      ),
      panel = new Element();
    process.env.VANCOUVER_VISUAL_QA = '0';
    installTeslaQA(e, panel, lease());
    assert.equal(panel.children.length, 0);
    process.env.VANCOUVER_VISUAL_QA = '1';
    replace('location', { hostname: 'vancouver.example' });
    installTeslaQA(e, panel, lease());
    assert.equal(panel.children.length, 0);
  });
});

test('wall candidates use bounded actual exterior faces and outward normals instead of synthetic walls', () => {
  const polygon = [
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
    ],
    volumes = [
      { polygon, minY: 0, maxY: 30 },
      { polygon, minY: 0, maxY: 4 },
    ],
    candidates = teslaQAWallCandidates(volumes, [0, 0], 2);
  assert.equal(candidates.length, 2);
  for (const wall of candidates) {
    assert.equal(wall.building, 0);
    assert.ok(wall.length >= 14);
    assert.equal(
      inPolygon(
        wall.midpoint.map((v, i) => v + wall.normal[i] * 0.1),
        polygon,
      ),
      false,
    );
  }
  assert.equal(teslaQAWallCandidates(volumes, [1000, 1000]).length, 0);
  assert.equal(teslaQAWallCandidates(volumes, [0, 0], 0).length, 0);
});

test('all Tesla actions respect another QA lease, and Stop cannot release a different owner', async () => {
  await dom(async () => {
    const panel = new Element(),
      busy = lease();
    busy.active = true;
    installTeslaQA(
      new Proxy(
        {},
        {
          get() {
            throw Error('busy action touched engine');
          },
        },
      ),
      panel,
      busy,
    );
    for (const button of panel.children.filter(
      (element) => element.tagName === 'BUTTON',
    ))
      await button.onclick();
    assert.equal(busy.starts, 0);
    assert.equal(busy.ends, 0);
    assert.equal(busy.active, true);
  });
});

test('Robson/view/model-tier controls call public APIs while keeping city quality independent', async () => {
  await dom(async () => {
    const { e, t, events } = fixture(),
      panel = new Element(),
      lock = lease();
    installTeslaQA(e, panel, lock);
    await click(panel, 'Tesla QA: spawn Robson');
    assert.ok(events.some((event) => event[0] === 'enter'));
    assert.equal(lock.active, false);
    const settingsCalls = events.filter(
      (event) => event[0] === 'settings',
    ).length;
    for (const quality of ['low', 'medium', 'high', 'auto'])
      await click(panel, `Tesla QA: ${quality}`);
    await click(panel, 'Tesla QA: cockpit');
    await click(panel, 'Tesla QA: chase');
    assert.equal(t.view, 'chase');
    assert.equal(t.quality, 'auto');
    assert.equal(e.settings.quality, 'high');
    assert.equal(e.settings.qualityMode, 'auto');
    assert.equal(
      events.filter((event) => event[0] === 'settings').length,
      settingsCalls,
    );
  });
});

test('launch holds real public lift input for three foreground seconds and clears it on completion or hidden abort', async () => {
  await dom(async ({ frame, document }) => {
    const { e, t, events, held } = fixture(),
      panel = new Element(),
      lock = lease();
    installTeslaQA(e, panel, lock);
    frame(() => {
      if (events.some((event) => event[0] === 'command' && event[1] === 'jump'))
        t.state.mode = 'air';
    });
    await click(panel, 'Tesla QA: launch fly');
    assert.ok(
      events.some((event) => event[0] === 'command' && event[1] === 'jump'),
    );
    assert.ok(
      events.some(
        (event) => event[0] === 'button' && event[1] === 'up' && event[2],
      ),
    );
    const report = JSON.parse(
      panel.children.find((element) => element.tagName === 'TEXTAREA').value,
    );
    assert.equal(report.result, 'completed');
    assert.ok(report.trace.at(-1).elapsedMs >= 3000);
    assert.equal(held.size, 0);
    assert.equal(lock.ends, 1);
    frame(() => {
      document.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await click(panel, 'Tesla QA: launch fly');
    assert.equal(held.size, 0);
    assert.equal(lock.ends, 2);
    assert.equal(lock.active, false);
  });
});

test('a missing actual wall approach fails closed without mutating the real pose or declaring adhesion', async () => {
  await dom(async () => {
    const { e, t } = fixture(),
      panel = new Element(),
      lock = lease(),
      before = structuredClone(t.state);
    Object.freeze(t.state);
    Object.freeze(t.state.position);
    Object.freeze(t.state.quaternion);
    installTeslaQA(e, panel, lock);
    await click(panel, 'Tesla QA: approach real wall + park');
    assert.deepEqual(t.state, before);
    assert.equal(lock.active, false);
    assert.match(
      panel.children[0].textContent,
      /No clear asphalt-to-building approach/,
    );
  });
});

test('capture saves the submitted frame, real state, wall-camera up, active LOD and unique names; failures release its lease', async () => {
  await dom(async ({ replace }) => {
    const { e, t } = fixture(),
      panel = new Element(),
      lock = lease(),
      uploads = [];
    replace('fetch', async (_url, options) => {
      uploads.push(JSON.parse(options.body));
      return { ok: true };
    });
    installTeslaQA(e, panel, lock);
    panel.children.find((element) => element.tagName === 'INPUT').value =
      'My take #1';
    await click(panel, 'Tesla QA: save checkpoint');
    await click(panel, 'Tesla QA: save checkpoint');
    assert.equal(uploads.length, 2);
    assert.notEqual(uploads[0].name, uploads[1].name);
    assert.match(uploads[0].name, /^tesla-my-take-1-ground-chase-auto-/);
    assert.equal(uploads[0].row.renderer.calls, 99);
    assert.deepEqual(uploads[0].row.camera.up, [0, 0, 1]);
    assert.deepEqual(uploads[0].row.state, t.state);
    assert.deepEqual(uploads[0].row.steps, t.lastStep);
    assert.equal(uploads[0].row.activeLOD.quality, 'medium');
    assert.ok(uploads[0].row.capturedAt);
    assert.equal(uploads[0].row.valid, true);
    e.screenshot = () => {
      throw Error('lost framebuffer');
    };
    await click(panel, 'Tesla QA: save checkpoint');
    assert.equal(lock.active, false);
    e.screenshot = () => 'data:image/png;base64,';
    replace('fetch', async () => ({ ok: false, status: 503 }));
    await click(panel, 'Tesla QA: save checkpoint');
    assert.equal(lock.active, false);
    assert.equal(lock.starts, 4);
    assert.equal(lock.ends, 4);
  });
});
