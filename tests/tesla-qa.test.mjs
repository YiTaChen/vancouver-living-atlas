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
        wallHolding: this.state.wallHolding,
        adhesion: this.state.adhesionArmed,
        surfaceHolding: this.state.surfaceHolding,
        vortexAvailable: true,
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

// This controller double exercises helper input sequencing and evidence. Actual
// facade attachment/support physics has separate real-geometry regressions.
function wallFixture(frame, behavior = 'hold') {
  const setup = fixture(),
    { e, t, events } = setup;
  let placement,
    axes = [0, 0],
    wallEvent = -1,
    wallArrivedAt = null,
    releasedAt = null,
    heldAt = null;
  const surfaceId = 'building:0:wall:fixture';
  e.data.flightBuildingVolumes = [
    {
      polygon: [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
      ],
      minY: 0,
      maxY: 30,
    },
  ];
  t.world.groundPoseNear = (position, _shape, heading) => ({
    pose: {
      position: [position[0], 0.682, position[2]],
      quaternion: [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)],
    },
    contact: {
      surfaceId: 'ground:asphalt:fixture',
      kind: 'ground',
      point: [position[0], 0, position[2]],
      normal: [0, 1, 0],
      adherable: true,
    },
    identity: { surfaceId: 'ground', layer: 0, allowedModes: ['drive'] },
  });
  t.world.hasLaunchClearance = () => true;
  t.world.planWallToRoof = () => ({
    contact: { surfaceId: 'building:0:roof', kind: 'roof' },
  });
  t.world.sweep = ({ from, to }) => {
    const dx = from.position[0] - to.position[0],
      dz = from.position[2] - to.position[2],
      length = Math.hypot(dx, dz);
    return {
      surfaceId,
      kind: 'wall',
      point: [...to.position],
      normal: [dx / length, 0, dz / length],
      adherable: true,
      fraction: 0.8,
    };
  };
  e.navigation.startAt = (_mode, point) => {
    placement = point;
    events.push(['nav-start', point]);
    return true;
  };
  t.enter = () => {
    t.active = true;
    t.state = createTesla([placement.x, 0.682, placement.z], placement.yaw, {
      surfaceId: 'ground:asphalt:fixture',
      kind: 'ground',
      point: [placement.x, 0, placement.z],
      normal: [0, 1, 0],
      adherable: true,
    });
    events.push(['enter']);
    return true;
  };
  const setAxes = t.setAxes.bind(t),
    command = t.command.bind(t);
  t.setAxes = (x, y) => {
    axes = [x, y];
    setAxes(x, y);
  };
  t.command = (value) => {
    command(value);
    if (value === 'park') t.state.parked = true;
  };
  frame((now) => {
    if (axes[1] > 0 && wallEvent < 0) {
      t.state.mode = 'wall';
      t.state.contact = {
        surfaceId,
        kind: 'wall',
        point: [0, 2, 0],
        normal: [0, 0, -1],
        adherable: true,
      };
      t.state.velocity = [0, 1, 0];
      events.push(['physical-wall-arrival']);
      wallEvent = events.length - 1;
      wallArrivedAt = now;
    } else if (
      behavior === 'roof-hold' &&
      wallEvent >= 0 &&
      axes[1] > 0 &&
      now - wallArrivedAt >= 400
    ) {
      t.state.mode = 'ground';
      t.state.contact = {
        surfaceId: 'building:0:roof',
        kind: 'roof',
        point: [0, 30, 0],
        normal: [0, 1, 0],
        adherable: true,
      };
      t.state.position = [0, 30.682, 3];
      events.push(['physical-roof-arrival']);
    } else if (wallEvent >= 0 && axes[1] === 0) {
      releasedAt ??= now;
      if (behavior === 'manual-park') t.state.parked = true;
      if (behavior !== 'never-hold' && now - releasedAt >= 200) {
        t.state.velocity = [0, 0, 0];
        t.state.wallHolding = true;
        t.state.surfaceHolding = true;
        heldAt ??= now;
        if (behavior === 'drift' && now - heldAt > 1000)
          t.state.position[0] += 0.001;
      }
    }
  });
  return { ...setup, wallEvent: () => wallEvent };
}

const runReport = (panel) =>
  JSON.parse(
    panel.children.find((element) => element.tagName === 'TEXTAREA').value,
  );

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

function groundEntryFixture(behavior = 'valid', offset = 1.25) {
  const setup = fixture(),
    { e, t, events } = setup;
  let placement,
    state = t.state;
  // The helper may read the actual controller's result, never replace or move
  // it. Only this public-controller double may create its newly proved state.
  const freezePose = (s) => {
    Object.freeze(s.position);
    Object.freeze(s.quaternion);
    Object.freeze(s.contact);
    return Object.freeze(s);
  };
  state = freezePose(state);
  Object.defineProperty(t, 'state', {
    get: () => state,
    set() {
      throw Error('QA assigned Tesla state');
    },
  });
  e.transition = { source: 'previous overview fly-to' };
  e.data.roadRelief = () => 12;
  e.elevation = () => {
    throw Error('road relief must own this entry height');
  };
  e.navigation.startAt = (mode, point) => {
    assert.equal(
      e.settings.mode,
      'orbit',
      'setup must not enter ordinary drive at the previous viewpoint',
    );
    assert.equal(
      e.transition,
      null,
      'a pending viewpoint animation cannot move the new ground-entry camera',
    );
    events.push(['nav-start', mode, point]);
    placement = point;
    return behavior !== 'nav-rejected';
  };
  t.enter = () => {
    events.push(['enter']);
    if (behavior === 'enter-rejected') return false;
    state = freezePose(
      createTesla([placement.x + offset, 12.68, placement.z], placement.yaw, {
        surfaceId: 'ground:asphalt:actual-park',
        kind: 'ground',
        point: [placement.x, 12, placement.z],
        normal: [0, 1, 0],
        adherable: true,
      }),
    );
    t.active = true;
    return true;
  };
  return setup;
}

test('ground setup uses public street entry with source-derived seeds, records actual spawn and leaves native controls live', async () => {
  for (const { name, seed, yaw, offset, maxSpawnOffsetM } of [
    {
      name: 'Stanley Park Drive',
      seed: [-879.608384031657, -1453.5787111998163],
      yaw: 0.9887633783623333,
      offset: 1.25,
      maxSpawnOffsetM: 50,
    },
    {
      name: 'Stanley Seawall',
      seed: [377.2749101711636, -1595.2078075999482],
      yaw: -2.093918646673578,
      offset: 50,
      maxSpawnOffsetM: 50,
    },
    {
      name: 'Downtown curb approach',
      seed: [1023.97807, 940.37605],
      yaw: 0.7923266488,
      offset: 1.5,
      maxSpawnOffsetM: 2,
    },
  ])
    await dom(async ({ replace }) => {
      const { e, t, events, held } = groundEntryFixture('valid', offset),
        panel = new Element(),
        lock = lease(),
        uploads = [];
      replace('fetch', async (_url, options) => {
        uploads.push(JSON.parse(options.body));
        return { ok: true };
      });
      installTeslaQA(e, panel, lock);
      await click(panel, `Tesla QA: enter ${name}`);
      const report = runReport(panel),
        placed = events.find((event) => event[0] === 'nav-start');
      assert.deepEqual(placed, [
        'nav-start',
        'drive',
        {
          x: seed[0],
          z: seed[1],
          y: 13.05,
          yaw,
          surface: 'ground',
          surfaceId: 'ground',
          layer: 0,
          name: `Tesla QA ${name}`,
          snappedDistance: 0,
        },
      ]);
      assert(
        events.findIndex((event) => event[0] === 'deactivate') <
          events.indexOf(placed),
      );
      assert(
        events.findIndex((event) => event[0] === 'flight-clear') <
          events.indexOf(placed),
      );
      assert(
        events.findIndex((event) => event[0] === 'nav-blur') <
          events.indexOf(placed),
      );
      assert(
        events.indexOf(placed) <
          events.findIndex((event) => event[0] === 'enter'),
      );
      assert.equal(report.result, 'completed');
      assert.deepEqual(report.target.seed, seed);
      assert.ok(Math.abs(report.target.spawnOffsetM - offset) < 1e-9);
      assert.equal(report.target.maxSpawnOffsetM, maxSpawnOffsetM);
      assert.deepEqual(report.target.actualPosition, t.state.position);
      assert.match(report.target.result, /public controller entry proved/);
      assert.equal(t.active, true);
      assert.equal(t.view, 'chase');
      assert.equal(e.clock.hour, 14);
      assert.equal(e.clock.running, false);
      assert.equal(e.settings.labels, false);
      assert.equal(e.settings.quality, 'high');
      assert.equal(e.settings.qualityMode, 'auto');
      assert.equal(held.size, 0);
      assert.equal(
        events.some((event) => event[0] === 'command' || event[0] === 'axes'),
        false,
      );
      await click(panel, 'Tesla QA: save checkpoint');
      assert.deepEqual(uploads[0].row.parkEntry, report.target);
      assert.deepEqual(uploads[0].row.state, t.state);
      assert.equal(lock.active, false);
    });
});

test('ground setup rejects navigation, real controller entry and distant-spawn failures without retaining input or accepting Robson fallback', async () => {
  for (const [name, maxSpawnOffsetM] of [
    ['Stanley Park Drive', 50],
    ['Downtown curb approach', 2],
  ])
    for (const [behavior, offset, error, enters] of [
      ['nav-rejected', 0, /navigation entry was rejected/, 0],
      ['enter-rejected', 0, /no proved full-vehicle spawn/, 1],
      [
        'valid',
        maxSpawnOffsetM + 0.001,
        new RegExp(`different spawn beyond ${maxSpawnOffsetM}m`),
        1,
      ],
    ])
      await dom(async () => {
        const { e, t, events, held } = groundEntryFixture(behavior, offset),
          panel = new Element(),
          lock = lease();
        held.add('up');
        installTeslaQA(e, panel, lock);
        await click(panel, `Tesla QA: enter ${name}`);
        const report = runReport(panel);
        assert.match(report.result, error);
        assert.match(report.target.result, error);
        assert.equal(
          events.filter((event) => event[0] === 'enter').length,
          enters,
        );
        assert.equal(
          events.some((event) => event[0] === 'view'),
          false,
        );
        assert.equal(t.active, false);
        assert.equal(held.size, 0);
        assert.equal(lock.active, false);
        assert.equal(lock.starts, 1);
        assert.equal(lock.ends, 1);
      });
});

test('Downtown curb approach samples current road height through public navigation and rejects a non-finite runtime height', async () => {
  for (const height of [16.5, NaN])
    await dom(async () => {
      const { e, t, events } = groundEntryFixture('valid', 0.25),
        panel = new Element(),
        sampled = [];
      e.data.roadRelief = (x, z) => {
        sampled.push([x, z]);
        return height;
      };
      installTeslaQA(e, panel, lease());
      await click(panel, 'Tesla QA: enter Downtown curb approach');
      const report = runReport(panel),
        placed = events.find((event) => event[0] === 'nav-start');
      assert.deepEqual(sampled, [[1023.97807, 940.37605]]);
      if (Number.isFinite(height)) {
        assert.equal(placed[2].y, height + 1.05);
        assert.equal(report.result, 'completed');
        assert.deepEqual(report.target.actualPosition, t.state.position);
      } else {
        assert.equal(placed, undefined);
        assert.equal(
          events.some((event) => event[0] === 'enter'),
          false,
        );
        assert.match(report.result, /navigation entry was rejected/);
        assert.equal(t.active, false);
      }
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

test('automatic facade QA releases throttle without P or brake and verifies eight seconds of exact wall hold', async () => {
  await dom(async ({ frame }) => {
    const { e, t, events, held, wallEvent } = wallFixture(frame),
      panel = new Element(),
      lock = lease();
    installTeslaQA(e, panel, lock);
    await click(panel, 'Tesla QA: approach real wall + auto hold');
    const report = runReport(panel);
    assert.equal(report.result, 'completed');
    assert.equal(report.kind, 'real-building-wall-auto-hold');
    assert.ok(report.verifiedHoldMs >= 8000);
    assert.deepEqual(report.inputs, {
      throttleReleased: true,
      brakeRequestedOnWall: false,
      parkCommandRequested: false,
    });
    assert.equal(
      events.some((event) => event[0] === 'command' && event[1] === 'park'),
      false,
    );
    assert.equal(
      events.some(
        (event) => event[0] === 'button' && event[1] === 'brake' && event[2],
      ),
      false,
    );
    assert.ok(wallEvent() >= 0);
    assert.equal(t.state.wallHolding, true);
    assert.equal(t.state.parked, false);
    assert.equal(report.trace.at(-1).wallHolding, true);
    assert.equal(report.trace.at(-1).adhesionArmed, true);
    assert.equal(held.size, 0);
    assert.equal(lock.ends, 1);
  });
});

test('automatic hold QA cannot credit manual parking, missing hold, or pose drift and always clears controls', async () => {
  for (const [behavior, error] of [
    ['manual-park', /Manual parking cannot qualify/],
    ['never-hold', /did not settle/],
    ['drift', /lost its exact stationary pose/],
  ]) {
    await dom(async ({ frame }) => {
      const { e, events, held } = wallFixture(frame, behavior),
        panel = new Element(),
        lock = lease();
      installTeslaQA(e, panel, lock);
      await click(panel, 'Tesla QA: approach real wall + auto hold');
      assert.match(runReport(panel).result, error);
      assert.equal(
        events.some((event) => event[0] === 'command' && event[1] === 'park'),
        false,
      );
      assert.equal(held.size, 0);
      assert.equal(lock.ends, 1);
      assert.equal(lock.active, false);
    });
  }
});

test('historical facade QA keeps its explicit manual park workflow and does not claim automatic hold evidence', async () => {
  await dom(async ({ frame }) => {
    const { e, events } = wallFixture(frame),
      panel = new Element();
    installTeslaQA(e, panel, lease());
    await click(panel, 'Tesla QA: approach real wall + park');
    const report = runReport(panel);
    assert.equal(report.result, 'completed');
    assert.equal(report.kind, 'real-building-wall-approach');
    assert.equal(report.inputs.parkCommandRequested, true);
    assert.equal(report.inputs.brakeRequestedOnWall, true);
    assert.equal(report.verifiedHoldMs, undefined);
    assert.equal(
      events.filter((event) => event[0] === 'command' && event[1] === 'park')
        .length,
      1,
    );
  });
});

test('roof QA selects only a proved roof route, then credits public wall arrival and eight seconds of roof auto hold without P', async () => {
  await dom(async ({ frame }) => {
    const { e, t, events, held } = wallFixture(frame, 'roof-hold'),
      panel = new Element(),
      lock = lease();
    const plan = t.world.planWallToRoof;
    t.world.planWallToRoof = (query) => {
      const frontY =
        query.pose.position[1] +
        query.shape.halfExtents[2] +
        query.shape.clearance;
      // The shipped midrise cornice begins .395m below its actual roof.
      // A query inside that visible envelope must not qualify a QA candidate.
      return frontY > e.data.flightBuildingVolumes[0].maxY - 0.395
        ? null
        : plan(query);
    };
    installTeslaQA(e, panel, lock);
    await click(panel, 'Tesla QA: actual wall to roof + auto hold');
    const report = runReport(panel);
    assert.equal(report.result, 'completed');
    assert.equal(report.kind, 'real-building-wall-roof-auto-hold');
    assert.equal(report.target.roofSurfaceId, 'building:0:roof');
    assert.ok(report.verifiedHoldMs >= 8000);
    assert.ok(events.some((event) => event[0] === 'physical-wall-arrival'));
    assert.ok(events.some((event) => event[0] === 'physical-roof-arrival'));
    assert.equal(report.trace.at(-1).surfaceHolding, true);
    assert.equal(t.state.parked, false);
    assert.equal(
      events.some((event) => event[0] === 'command' && event[1] === 'park'),
      false,
    );
    assert.equal(held.size, 0);
    assert.equal(lock.ends, 1);
  });
  await dom(async ({ frame }) => {
    const { e, events } = wallFixture(frame, 'roof-hold'),
      panel = new Element();
    e.tesla.world.planWallToRoof = () => null;
    installTeslaQA(e, panel, lease());
    await click(panel, 'Tesla QA: actual wall to roof + auto hold');
    assert.match(
      runReport(panel).result,
      /No clear asphalt-to-building approach/,
    );
    assert.equal(
      events.some((event) => event[0] === 'nav-start'),
      false,
    );
  });
});

test('Vortex QA proves the complete motion clock, rejects an aborted final step, and distinguishes a subsequent ground landing', async () => {
  for (const variant of [
    'clear',
    'blocked',
    'late-abort',
    'landing',
    'post-finish-obstacle',
  ])
    await dom(async ({ frame }) => {
      const { e, t, events, held } = fixture(),
        panel = new Element(),
        lock = lease();
      let launchedAt = null;
      const motion = {
        elapsedS: 0,
        heading: 0,
        forwardSpeedMps: 30,
        restoreFlightAssist: false,
        gradeMPerM: 0,
      };
      frame((now) => {
        if (
          !events.some(
            (event) => event[0] === 'command' && event[1] === 'vortex',
          )
        )
          return;
        launchedAt ??= now;
        const elapsedS = (now - launchedAt) / 1000;
        const lateAbort = variant === 'late-abort' && elapsedS >= 1.35;
        motion.elapsedS = Math.min(lateAbort ? 1.35 : 1.4, elapsedS);
        t.state.vortex = elapsedS < 1.4 && !lateAbort ? motion : null;
        t.state.quaternion =
          elapsedS > 0.4 && elapsedS < 0.8 ? [0, 0, 1, 0] : [0, 0, 0, 1];
        t.lastStep.collisions =
          variant === 'blocked' ||
          lateAbort ||
          ((variant === 'landing' || variant === 'post-finish-obstacle') &&
            elapsedS >= 1.4)
            ? 1
            : 0;
        if (variant === 'landing' && elapsedS >= 1.4) {
          t.state.mode = 'ground';
          t.state.contact = { ...t.state.contact, kind: 'ground' };
        }
        if (variant === 'post-finish-obstacle' && elapsedS >= 1.4) {
          t.state.mode = 'air';
          t.state.contact = null;
        }
      });
      installTeslaQA(e, panel, lock);
      await click(panel, 'Tesla QA: vortex jump');
      const report = runReport(panel);
      if (
        variant === 'blocked' ||
        variant === 'late-abort' ||
        variant === 'post-finish-obstacle'
      ) {
        assert.match(report.result, /actual collision geometry/);
        assert.equal(
          report.vortexEvidence.completedDuration,
          variant === 'post-finish-obstacle',
        );
      } else {
        assert.equal(report.result, 'completed');
        assert.equal(report.vortexEvidence.sawRoll, true);
        assert.equal(report.vortexEvidence.maximumProgress, 1);
        assert.equal(report.vortexEvidence.uprightAtEnd, true);
        assert.equal(report.vortexEvidence.completedDuration, true);
        assert.equal(
          report.vortexEvidence.postCompletionGroundCollision,
          variant === 'landing',
        );
      }
      assert.equal(
        events.filter(
          (event) => event[0] === 'command' && event[1] === 'vortex',
        ).length,
        1,
      );
      assert.equal(held.size, 0);
      assert.equal(lock.ends, 1);
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
