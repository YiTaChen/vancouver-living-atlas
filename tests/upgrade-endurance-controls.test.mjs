import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { installUpgradeEnduranceQA } = await import(
  cityModule('upgrade-endurance-qa')
);

async function fixture(action) {
  const originals = new Map();
  const replace = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  };
  let now = 0,
    token = 0,
    running = false;
  const rafs = new Map(),
    controls = new Map(),
    buttons = [],
    saved = [],
    applies = [];
  const document = Object.assign(new EventTarget(), { hidden: false });
  replace('document', document);
  replace('performance', { now: () => now });
  replace('innerWidth', 800);
  replace('innerHeight', 600);
  replace('requestAnimationFrame', (callback) => {
    rafs.set(++token, callback);
    return token;
  });
  replace('cancelAnimationFrame', (id) => rafs.delete(id));
  replace('fetch', async (_url, options) => {
    saved.push(JSON.parse(options.body));
    return { ok: true };
  });
  const nav = {
    keys: new Set(),
    mode: 'walk',
    position: new THREE.Vector3(),
    yaw: 0,
    touchX: 0,
    touchY: 0,
    surface: 'ground',
    forceBlocked: false,
    blocked() {
      return this.forceBlocked;
    },
    protectedStep() {
      return { y: 0 };
    },
    clearGround() {
      return true;
    },
    roadHeight() {
      return 1.25;
    },
    cameraDistances: { walk: 0 },
    startAt(mode, point) {
      this.mode = mode;
      this.position.set(point.x, point.y, point.z);
      this.yaw = point.yaw;
      this.keys.clear();
      return true;
    },
    move(dx, dz) {
      if (!this.blocked(this.position.x + dx, this.position.z + dz))
        this.position.add(new THREE.Vector3(dx, 0, dz));
    },
    update(dt) {
      if (this.keys.has('w')) {
        const step = Math.min(0.05, dt) * 4;
        this.move(Math.sin(this.yaw) * step, Math.cos(this.yaw) * step);
      }
    },
  };
  const canvas = Object.assign(new EventTarget(), { width: 800, height: 600 });
  const engine = {
    disposed: false,
    navigation: nav,
    settings: { quality: 'high' },
    clock: { hour: 14 },
    data: { travelSurfaces: { lookup: () => [] } },
    renderer: {
      domElement: canvas,
      info: {
        memory: { geometries: 20, textures: 3 },
        render: { calls: 10, triangles: 100 },
      },
      setSize(w, h) {
        canvas.width = w;
        canvas.height = h;
      },
    },
    container: { clientWidth: 800, clientHeight: 600 },
    camera: { aspect: 4 / 3, updateProjectionMatrix() {} },
    setClock({ hour }) {
      this.clock.hour = hour;
    },
    resizeQuality() {},
    renderScene() {},
    destroy() {
      this.disposed = true;
    },
    screenshot: () => 'data:image/png;base64,',
    architecturalDetails: {
      records: new Map([['one', {}]]),
      stats: { visibleInstances: 12 },
    },
    streetscapeKit: {
      snapshot: () => ({ cacheCells: 2, visibleBays: 3, loaded: true }),
    },
  };
  const originalMethods = {
    move: nav.move,
    blocked: nav.blocked,
    protectedStep: nav.protectedStep,
    update: nav.update,
    render: engine.renderScene,
    destroy: engine.destroy,
  };
  const ui = {
    panel: { querySelectorAll: () => buttons },
    status: { textContent: '' },
    output: { value: '' },
    button(label, callback) {
      controls.set(label, callback);
      buttons.push({ textContent: label, disabled: false });
    },
    begin() {
      if (running) return false;
      running = true;
      return true;
    },
    end() {
      running = false;
    },
    apply(route) {
      applies.push({ route, now, held: [...nav.keys] });
      nav.mode = 'walk';
      nav.position.set(route === 'robson-walk' ? 0 : 1000, 0, 0);
      nav.yaw = 0;
    },
  };
  installUpgradeEnduranceQA(engine, ui);
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const advance = async (ms = 100) => {
    now += ms;
    if (!engine.disposed) {
      nav.update(ms / 1000);
      engine.renderScene();
    }
    const batch = [...rafs.values()];
    rafs.clear();
    batch.forEach((callback) => callback(now));
    await flush();
  };
  const restoreAssertions = () => {
    assert.strictEqual(nav.move, originalMethods.move);
    assert.strictEqual(nav.blocked, originalMethods.blocked);
    assert.strictEqual(nav.protectedStep, originalMethods.protectedStep);
    assert.strictEqual(nav.update, originalMethods.update);
    assert.strictEqual(engine.renderScene, originalMethods.render);
    assert.strictEqual(engine.destroy, originalMethods.destroy);
    assert.equal(nav.keys.size, 0);
  };
  try {
    await action({
      controls,
      buttons,
      engine,
      nav,
      document,
      saved,
      applies,
      ui,
      advance,
      flush,
      running: () => running,
      restoreAssertions,
    });
  } finally {
    controls.get('Stop upgrade endurance')();
    await flush();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('ten-leg control uses resets only between legs and separates reset distance from actual W movement', async () => {
  await fixture(async (f) => {
    f.controls.get('Upgrade route endurance 10m')();
    for (let i = 0; i < 7000 && f.running(); i++) await f.advance();
    assert.equal(f.running(), false);
    assert.equal(f.saved.length, 1);
    const { row } = f.saved[0];
    assert.equal(row.completed, true);
    assert.equal(row.valid, true);
    assert.equal(row.legs.length, 10);
    assert.equal(row.resets.length, 10);
    assert.equal(row.observedWalkingMs, 600000);
    assert(row.totalWallMs >= 625000);
    assert.deepEqual(
      f.applies.map((p) => p.route),
      Array.from({ length: 10 }, (_, i) =>
        i % 2 ? 'water-street' : 'robson-walk',
      ),
    );
    assert(f.applies.every((p) => p.held.length === 0));
    assert(
      row.legs.every(
        (leg) => leg.frames.frames === 600 && leg.trace.length >= 13,
      ),
    );
    const waterResets = row.resets.filter(
      (reset) => reset.route === 'water-street',
    );
    assert.equal(waterResets.length, 5);
    assert(
      waterResets.every(
        (reset) =>
          reset.sourcePlacement?.lengthMeters > 300 &&
          reset.sourcePlacement.blockedSamples === 0 &&
          reset.sourcePlacement.protectedSamples === 0,
      ),
    );
    assert(
      row.resets
        .filter((reset) => reset.route === 'robson-walk')
        .every((reset) => reset.sourcePlacement === null),
    );
    // Large between-route resets must never appear as walking distance.
    assert(row.traveledMeters > 1199 && row.traveledMeters < 1201);
    f.restoreAssertions();
  });
});

test('Water setup places once on the source segment before W and a full-speed 60s leg retains endpoint reserve', async () => {
  await fixture(async (f) => {
    const placements = [],
      originalStart = f.nav.startAt;
    f.nav.startAt = function (mode, point) {
      placements.push({ point, held: [...this.keys] });
      return originalStart.call(this, mode, point);
    };
    f.controls.get('Upgrade route endurance 10m')();
    for (let i = 0; i < 625; i++) await f.advance(100);
    assert.equal(f.applies.length, 2);
    assert.equal(placements.length, 1);
    assert.deepEqual(placements[0].held, []);
    await f.advance(2500);
    for (let i = 0; i < 1200; i++) await f.advance(50);
    f.controls.get('Stop upgrade endurance')();
    await f.flush();
    const { row } = f.saved[0],
      leg = row.legs[1];
    assert.equal(
      placements.length,
      1,
      'initial placement must not recur during walking',
    );
    assert.equal(leg.route, 'water-street');
    assert.equal(leg.completed, true);
    assert.equal(leg.continuousMotion, true);
    assert(Math.abs(leg.counters.traveledMeters - 240) < 1e-6);
    assert.equal(leg.startYaw, leg.endYaw);
    const source = row.resets[1].sourcePlacement;
    assert.match(source.source, /2973,3794/);
    assert.match(source.source, /29:0,846:0/);
    assert(source.lengthMeters - leg.counters.traveledMeters > 60);
    assert.deepEqual([leg.start[0], leg.start[2]], source.start);
    f.restoreAssertions();
  });
});

test('Water full-segment live preflight rejects changed ground or protected surfaces before its leg starts', async () => {
  for (const obstruction of ['ground', 'protected'])
    await fixture(async (f) => {
      if (obstruction === 'ground') f.nav.clearGround = () => false;
      else
        f.engine.data.travelSurfaces.lookup = () => [
          { surfaceId: 'protected-test' },
        ];
      f.controls.get('Upgrade route endurance 10m')();
      for (let i = 0; i < 630 && f.running(); i++) await f.advance(100);
      assert.equal(f.running(), false);
      const { row } = f.saved[0];
      assert.equal(row.valid, false);
      assert.equal(row.legs.length, 1);
      assert.equal(row.legs[0].route, 'robson-walk');
      assert.match(row.failure, /Water Street.*preflight failed/);
      assert.equal(f.nav.keys.size, 0);
      f.restoreAssertions();
    });
});

test('hidden, manual stop and dispose abort immediately, clear input, restore hooks and save invalid partial evidence', async () => {
  for (const reason of ['hidden', 'stop', 'dispose'])
    await fixture(async (f) => {
      f.controls.get('Upgrade route endurance 10m')();
      await f.advance(2500);
      await f.advance();
      assert(f.nav.keys.has('w'));
      if (reason === 'hidden') {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event('visibilitychange'));
      } else if (reason === 'dispose') f.engine.destroy();
      else f.controls.get('Stop upgrade endurance')();
      assert.equal(f.nav.keys.size, 0);
      await f.flush();
      assert.equal(f.running(), false);
      const { row } = f.saved[0];
      assert.equal(row.valid, false);
      assert.equal(row.completed, false);
      assert.equal(row.legs.length, 1);
      assert.equal(row.flags.hidden, reason === 'hidden');
      assert.equal(row.flags.disposed, reason === 'dispose');
      f.restoreAssertions();
    });
});

test('real blocked move outcomes are counted and cannot be misreported as continuous motion', async () => {
  await fixture(async (f) => {
    f.controls.get('Upgrade route endurance 10m')();
    await f.advance(2500);
    f.nav.forceBlocked = true;
    await f.advance();
    f.controls.get('Stop upgrade endurance')();
    await f.flush();
    const leg = f.saved[0].row.legs[0];
    assert.equal(leg.counters.moveCalls, 1);
    assert.equal(leg.counters.blockedMoveCalls, 1);
    assert.equal(leg.counters.groundRejections, 1);
    assert.equal(leg.counters.traveledMeters, 0);
    assert.equal(leg.continuousMotion, false);
    f.restoreAssertions();
  });
});

test('continuous Robson run stops at the observed endpoint after all nine source crossings and eight intervals', async () => {
  await fixture(async (f) => {
    f.controls.get('Upgrade Robson corridor 8 blocks')();
    for (let i = 0; i < 7500 && f.running(); i++) await f.advance(50);
    assert.equal(f.running(), false);
    const { row } = f.saved[0];
    assert.equal(row.id, 'robson-corridor-8-blocks');
    assert.equal(row.valid, true);
    assert.equal(row.completed, true);
    assert.equal(row.legs.length, 1);
    assert.equal(row.resets.length, 1);
    assert.equal(row.resets[0].kind, 'initial-placement');
    assert.equal(f.applies.length, 1);
    assert(row.observedWalkingMs < 360000);
    assert(row.traveledMeters >= 1346.883 && row.traveledMeters < 1347.2);
    const leg = row.legs[0];
    assert.equal(leg.stopReason, 'end-gate');
    assert.equal(leg.corridor.crossed.length, 9);
    assert.equal(leg.corridor.completedBlockIntervals, 8);
    assert.equal(leg.corridor.reachedEnd, true);
    assert(Math.abs(leg.corridor.end.lateralMeters) < 1e-6);
    f.restoreAssertions();
  });
});

test('a capped-physics corridor timeout reports actual partial crossings rather than claiming route completion from time', async () => {
  await fixture(async (f) => {
    f.controls.get('Upgrade Robson corridor 8 blocks')();
    for (let i = 0; i < 4900 && f.running(); i++) await f.advance(100);
    const { row } = f.saved[0];
    assert.equal(row.environmentValid, true);
    assert.equal(row.completed, false);
    assert.equal(row.valid, false);
    assert.equal(row.observedWalkingMs, 480000);
    assert(row.traveledMeters > 959.9 && row.traveledMeters < 960.1);
    assert.equal(row.legs[0].stopReason, 'time-limit');
    assert.equal(row.legs[0].corridor.completedBlockIntervals, 5);
    assert.equal(row.legs[0].corridor.reachedEnd, false);
    f.restoreAssertions();
  });
});

test('changed source obstacles, lateral departure and external teleports invalidate corridor evidence and release W', async () => {
  for (const reason of ['source-obstruction', 'lateral-departure', 'teleport'])
    await fixture(async (f) => {
      if (reason === 'source-obstruction') f.nav.clearGround = () => false;
      f.controls.get('Upgrade Robson corridor 8 blocks')();
      if (reason === 'source-obstruction') {
        await f.flush();
        assert.equal(f.saved[0].row.legs.length, 0);
        assert.match(f.saved[0].row.failure, /preflight failed/);
      } else {
        await f.advance(2500);
        if (reason === 'lateral-departure') f.nav.position.x += 50;
        else
          f.nav.position.add(
            new THREE.Vector3(
              Math.sin(f.nav.yaw) * 50,
              0,
              Math.cos(f.nav.yaw) * 50,
            ),
          );
        await f.advance();
        const leg = f.saved[0].row.legs[0];
        assert.equal(leg.corridor.reachedEnd, false);
        assert.equal(leg.corridor.completedBlockIntervals, 0);
        if (reason === 'lateral-departure')
          assert.equal(leg.flags.leftSourceCorridor, true);
        else assert.equal(leg.flags.unobservedDisplacement, true);
      }
      assert.equal(f.saved[0].row.valid, false);
      assert.equal(f.running(), false);
      f.restoreAssertions();
    });
});

test('endurance disables every other panel action, keeps Stop available and restores pre-existing disabled states', async () => {
  await fixture(async (f) => {
    f.ui.button('Existing QA action', () => {});
    f.ui.button('Already unavailable QA action', () => {});
    f.buttons.at(-1).disabled = true;
    const prior = f.buttons.map((button) => button.disabled);
    f.controls.get('Upgrade route endurance 10m')();
    assert(
      f.buttons.every(
        (button) =>
          button.disabled === (button.textContent !== 'Stop upgrade endurance'),
      ),
    );
    f.controls.get('Stop upgrade endurance')();
    await f.flush();
    assert.deepEqual(
      f.buttons.map((button) => button.disabled),
      prior,
    );
    assert.equal(f.running(), false);
    f.restoreAssertions();
  });
});
