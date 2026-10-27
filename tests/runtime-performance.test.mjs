import test from 'node:test';
// Function identity/ownership checks intentionally retain unbound references.
/* oxlint-disable typescript/unbound-method */
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { createRuntimePerformanceDiagnostics, runtimePerformanceFlags } =
  await import(cityModule('runtime-performance'));
const { RuntimeGpuTiming } = await import(cityModule('runtime-gpu-timing'));
const context = { visible: true, mode: 'walk', quality: 'balanced' };

function harness(options = {}) {
  let now = 0;
  const diagnostics = createRuntimePerformanceDiagnostics({
    enabled: true,
    observerClass: null,
    performance: null,
    now: () => now,
    ...options,
  });
  return {
    diagnostics,
    at(value) {
      now = value;
    },
    add(value) {
      now += value;
    },
  };
}

test('diagnostics require exact explicit opt-in and disabled creation touches no instrumentation', () => {
  assert.equal(createRuntimePerformanceDiagnostics(), null);
  assert.equal(
    createRuntimePerformanceDiagnostics({
      enabled: false,
      get observerClass() {
        throw new Error('disabled observer');
      },
    }),
    null,
  );
  assert.deepEqual(
    runtimePerformanceFlags(
      '?runtimePerf=0&runtimePerfGpu=1&runtimePerfTrace=1',
    ),
    { enabled: false, trace: false, gpu: false },
  );
  assert.deepEqual(
    runtimePerformanceFlags(
      '?runtimePerf=1&runtimePerfGpu=1&runtimePerfTrace=1',
    ),
    { enabled: true, trace: true, gpu: true },
  );
  assert.deepEqual(runtimePerformanceFlags('?runtimePerf=true'), {
    enabled: false,
    trace: false,
    gpu: false,
  });
});

test('RAF intervals, current CPU spans and GPU unavailability remain distinct; hitches retain preceding work', () => {
  const h = harness(),
    d = h.diagnostics;
  h.at(10);
  d.beginFrame(10, context);
  assert.equal(
    d.measure('navigation', () => {
      h.add(2);
      return 7;
    }),
    7,
  );
  d.measure('render', () => {
    h.add(1);
    d.measure('driver', () => h.add(3));
  });
  d.endFrame();
  h.at(1215);
  d.beginFrame(1215, context);
  assert.throws(
    () =>
      d.measure('navigation', () => {
        h.add(4);
        throw new Error('original');
      }),
    /original/,
  );
  d.endFrame();
  const report = d.snapshot();
  assert.equal(report.frames[0].rafIntervalMs, null);
  assert.equal(report.frames[0].cpuFrameMs, 6);
  assert.equal(report.frames[0].spans.render.totalMs, 4);
  assert.equal(report.frames[0].spans.driver.totalMs, 3);
  assert.equal(report.frames[1].rafIntervalMs, 1205);
  assert.equal(report.frames[1].cpuFrameMs, 4);
  assert.equal(report.hitches[0].cause, 'unattributed');
  assert.equal(report.hitches[0].precedingFrame.id, 1);
  assert.equal(report.hitches[0].precedingFrame.cpuFrameMs, 6);
  assert.equal(report.gpu.status, 'disabled');
  assert.deepEqual(report.gpu.samples, []);
  assert.match(report.interpretation.cpu, /nested spans overlap/);
  d.dispose();
});

test('foreground long intervals survive; explicit hidden/page/context resets and invalid clocks start new anchors', () => {
  const h = harness(),
    d = h.diagnostics;
  const frame = (at, ctx = context) => {
    h.at(at);
    d.beginFrame(at, ctx);
    d.endFrame();
  };
  frame(0);
  frame(10_000);
  assert.equal(d.snapshot().hitches[0].rafIntervalMs, 10_000);
  h.at(10_001);
  d.setVisible(false);
  frame(30_000, { ...context, visible: false });
  h.at(40_000);
  d.setVisible(true);
  frame(40_001);
  assert.equal(d.snapshot().frames.at(-1).rafIntervalMs, null);
  for (const reason of [
    'pagehide',
    'pageshow',
    'context-lost',
    'context-restored',
  ]) {
    d.reset(reason);
    frame(50_000 + d.snapshot().stats.frames);
    assert.equal(d.snapshot().frames.at(-1).rafIntervalMs, null);
  }
  frame(1);
  assert.equal(d.snapshot().frames.at(-1).rafIntervalMs, null);
  assert.equal(d.beginFrame(NaN, context), false);
  frame(100);
  assert.equal(d.snapshot().frames.at(-1).rafIntervalMs, null);
  assert.equal(d.snapshot().stats.hitches, 1);
  d.dispose();
});

test('actual render context reflects quality/mode changes after frame start and is preserved over end fallback', () => {
  const h = harness(),
    d = h.diagnostics;
  d.beginFrame(0, context);
  d.setRenderContext({ mode: 'skytrain', quality: 'high' });
  d.endFrame({ mode: 'orbit', quality: 'ultra' });
  const frame = d.snapshot().frames[0];
  assert.deepEqual(frame.startContext, { mode: 'walk', quality: 'balanced' });
  assert.deepEqual(frame.renderContext, { mode: 'skytrain', quality: 'high' });
  assert.equal(frame.mode, 'skytrain');
  assert.equal(frame.quality, 'high');
  frame.startContext.quality = 'ultra';
  frame.renderContext.quality = 'ultra';
  assert.equal(d.snapshot().frames[0].startContext.quality, 'balanced');
  assert.equal(d.snapshot().frames[0].renderContext.quality, 'high');
  h.at(20);
  d.beginFrame(20, context);
  d.endFrame({ mode: 'drive', quality: 'high' });
  assert.equal(d.snapshot().frames[1].quality, 'high');
  d.setRenderContext({ mode: 'orbit', quality: 'ultra' });
  assert.equal(
    d.snapshot().frames[1].quality,
    'high',
    'out-of-frame rendering does not relabel the last frame',
  );
  d.dispose();
});

test('rings, labels and snapshots stay bounded without mutating previously captured frames', () => {
  const h = harness(),
    d = h.diagnostics;
  for (let i = 0; i < 400; i++) {
    h.at(i * 110);
    d.beginFrame(i * 110, context);
    for (let label = 0; label < 56; label++)
      d.measure(`label${label}`, () => h.add(0.01));
    d.endFrame();
  }
  const report = d.snapshot();
  assert.equal(report.frames.length, 300);
  assert.equal(report.hitches.length, 40);
  assert.equal(report.dropped.frames, 100);
  assert.equal(report.dropped.hitches, 359);
  assert.equal(report.frames[0].id, 101);
  assert.equal(report.frames.at(-1).id, 400);
  assert.equal(Object.keys(report.frames[0].spans).length, 48);
  report.frames[0].spans.label0.totalMs = -10;
  report.hitches[0].precedingFrame.spans.label0.totalMs = -20;
  assert.ok(d.snapshot().frames[0].spans.label0.totalMs > 0);
  assert.ok(d.snapshot().hitches[0].precedingFrame.spans.label0.totalMs > 0);
  d.dispose();
});

test('pilot wrapper and late landmark span both survive the actual engine label order up to the bounded cap', () => {
  const h = harness(),
    d = h.diagnostics;
  // The engine registers wrappers before opening a frame; explicit traffic,
  // railway, harbour and landmark spans are admitted during that frame.
  const labels = [
    'tickClock',
    'renderScene',
    'updateShadowFrustum',
    'updateLabels',
    'updateAutoQuality',
    'controls',
    'navigation',
    'bus',
    'flight',
    'tesla',
    'skytrain',
    'interactions',
    'impacts',
    'impact-feedback',
    'drift',
    'pedestrians',
    'travel-return',
    'waves',
    'trees',
    'facades',
    'architecture',
    'street-showcase',
    'streetscape',
    'street-furniture',
    'interiors',
    'soundscape',
    'render-submit',
    'landmark-warmup',
    'scenery-preparation',
    'pedestrian-prepare',
    'pedestrian-renderer',
  ];
  const systems = labels.map((label) => {
    const target = { update: () => h.add(1) };
    d.wrap(target, 'update', label);
    return target;
  });
  d.beginFrame(0, context);
  for (const system of systems) system.update();
  for (const label of ['traffic', 'railway', 'harbour', 'landmark-detail'])
    d.measure(label, () => h.add(1));
  for (let i = labels.length + 4; i < 48; i++)
    d.measure(`extra${i}`, () => h.add(1));
  assert.equal(
    d.measure('overflow', () => 9),
    9,
    'a rejected diagnostic label still executes the original work',
  );
  d.endFrame();
  const report = d.snapshot(),
    spans = report.frames[0].spans;
  assert.equal(report.limits.labels, 48);
  assert.equal(Object.keys(spans).length, 48);
  assert.equal(spans['street-showcase'].calls, 1);
  assert.equal(spans['landmark-detail'].totalMs, 1);
  assert.equal(spans['pedestrian-prepare'].calls, 1);
  assert.equal(spans['pedestrian-renderer'].calls, 1);
  assert.equal(report.stats.labelLimit, 1);
  assert.equal(spans.overflow, undefined);
  d.dispose();
});

test('method wrappers preserve receiver, arguments, returns/errors and ownership; dispose is idempotent', () => {
  const h = harness(),
    d = h.diagnostics;
  class Target {
    run(n) {
      h.add(2);
      if (n < 0) throw new Error('original');
      return this.value + n;
    }
  }
  const target = new Target();
  target.value = 4;
  // Compare function identity without invoking a detached method.
  const original = target.run;
  d.wrap(target, 'run', 'actor');
  d.beginFrame(0, context);
  assert.equal(target.run(3), 7);
  assert.throws(() => target.run(-1), /original/);
  d.endFrame();
  assert.deepEqual(d.snapshot().frames[0].spans.actor, {
    calls: 2,
    totalMs: 4,
    maxMs: 2,
  });
  d.dispose();
  d.dispose();
  assert.equal(target.run, original);
  assert.equal(Object.hasOwn(target, 'run'), false);
  assert.equal(target.run(2), 6);
  const other = harness().diagnostics;
  other.wrap(target, 'run', 'actor');
  const replacement = () => 10;
  target.run = replacement;
  other.dispose();
  assert.equal(target.run, replacement);
});

test('PerformanceObserver reports only supported types and rejects stale, invalid or hidden events', () => {
  const instances = [];
  class Observer {
    static supportedEntryTypes = ['longtask'];
    constructor(callback) {
      this.callback = callback;
      instances.push(this);
    }
    observe(options) {
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
    emit(entries) {
      this.callback({ getEntries: () => entries });
    }
  }
  const h = harness({ observerClass: Observer }),
    d = h.diagnostics;
  assert.equal(instances.length, 1);
  assert.deepEqual(instances[0].options, { type: 'longtask', buffered: false });
  instances[0].emit([
    { entryType: 'longtask', startTime: 1, duration: 70 },
    { entryType: 'gc', startTime: 1, duration: 2 },
    { entryType: 'longtask', startTime: 2, duration: NaN },
  ]);
  h.at(10);
  d.setVisible(false);
  instances[0].emit([{ entryType: 'longtask', startTime: 11, duration: 70 }]);
  h.at(100);
  d.setVisible(true);
  instances[0].emit([{ entryType: 'longtask', startTime: 12, duration: 70 }]);
  for (let i = 0; i < 110; i++)
    instances[0].emit([
      { entryType: 'longtask', startTime: 101 + i, duration: 51 },
    ]);
  const report = d.snapshot();
  assert.deepEqual(report.observerSupport, {
    longtask: 'observing',
    gc: 'unsupported',
  });
  assert.equal(report.browserEvents.length, 100);
  assert.equal(report.dropped.browserEvents, 11);
  assert.equal(report.stats.rejectedEntries, 4);
  d.dispose();
  assert.equal(instances[0].disconnected, true);
  instances[0].emit([{ entryType: 'longtask', startTime: 999, duration: 70 }]);
  assert.equal(d.snapshot().browserEvents.length, 100);
});

test('trace entries use explicit numeric CPU ranges, clear only owned entries, and trace failure is harmless', () => {
  const calls = [];
  const performance = Object.fromEntries(
    ['measure', 'mark', 'clearMeasures', 'clearMarks'].map((key) => [
      key,
      (...args) => calls.push({ key, args }),
    ]),
  );
  const h = harness({ trace: true, performance }),
    d = h.diagnostics;
  h.at(10);
  d.beginFrame(10, context);
  d.measure('render', () => h.add(4));
  d.endFrame();
  h.at(200);
  d.beginFrame(200, context);
  d.endFrame();
  assert.ok(
    calls.some(
      ({ key, args }) =>
        key === 'measure' &&
        args[0] === 'atlas.runtime.render' &&
        args[1].start === 10 &&
        args[1].end === 14,
    ),
  );
  assert.ok(
    calls.some(
      ({ key, args }) => key === 'mark' && args[0] === 'atlas.runtime.hitch',
    ),
  );
  assert.ok(
    calls
      .filter(({ key }) => key.startsWith('clear'))
      .every(
        ({ args }) => args.length === 1 && args[0].startsWith('atlas.runtime.'),
      ),
  );
  d.dispose();
  const broken = harness({
    trace: true,
    performance: {
      ...performance,
      measure() {
        throw new Error('unsupported timing options');
      },
    },
  });
  broken.diagnostics.beginFrame(0, context);
  broken.diagnostics.endFrame();
  assert.equal(broken.diagnostics.snapshot().trace.failed, true);
  broken.diagnostics.dispose();
});

function gpuHarness({ supported = true } = {}) {
  let sequence = 0,
    active = null,
    disjoint = false,
    lost = false,
    available = false;
  const deleted = [],
    queried = [];
  const extension = { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 };
  const gl = {
    CURRENT_QUERY: 1,
    QUERY_RESULT_AVAILABLE: 2,
    QUERY_RESULT: 3,
    getExtension() {
      return supported ? extension : null;
    },
    isContextLost() {
      return lost;
    },
    getQuery() {
      return active;
    },
    createQuery() {
      return { id: ++sequence };
    },
    beginQuery(_target, query) {
      active = query;
    },
    endQuery() {
      active = null;
    },
    getParameter() {
      return disjoint;
    },
    getQueryParameter(query, parameter) {
      queried.push(parameter);
      return parameter === 2 ? available : query.id * 2_000_000;
    },
    deleteQuery(query) {
      deleted.push(query);
    },
  };
  return {
    gl,
    deleted,
    queried,
    setDisjoint(v) {
      disjoint = v;
    },
    setLost(v) {
      lost = v;
    },
    setAvailable(v) {
      available = v;
    },
    setActive(v) {
      active = v;
    },
  };
}

test('GPU timing polls availability without blocking and associates elapsed results with their render frame', () => {
  const h = gpuHarness(),
    timer = new RuntimeGpuTiming(h.gl);
  timer.begin(7);
  timer.end();
  assert.deepEqual(timer.poll(), []);
  assert.ok(
    !h.queried.includes(h.gl.QUERY_RESULT),
    'never asks for result until available',
  );
  h.setAvailable(true);
  assert.deepEqual(timer.poll(), [{ frameId: 7, gpuElapsedMs: 2 }]);
  assert.equal(h.deleted.length, 1);
  timer.dispose();
  timer.dispose();
});

test('GPU query capacity, other owners, disjoint invalidation, lost contexts and unsupported extensions fail safely', () => {
  const unsupported = new RuntimeGpuTiming(gpuHarness({ supported: false }).gl);
  unsupported.begin(1);
  unsupported.end();
  assert.deepEqual(unsupported.poll(), []);
  assert.equal(unsupported.snapshot().status, 'unsupported');
  unsupported.dispose();
  const h = gpuHarness(),
    timer = new RuntimeGpuTiming(h.gl);
  h.setActive({ external: true });
  timer.begin(0);
  timer.end();
  assert.equal(timer.snapshot().issued, 0);
  h.setActive(null);
  for (let i = 0; i < 6; i++) {
    timer.begin(i);
    timer.end();
  }
  assert.equal(timer.snapshot().pending, 4);
  assert.equal(timer.snapshot().issued, 4);
  h.setDisjoint(true);
  h.setAvailable(true);
  assert.deepEqual(timer.poll(), []);
  assert.equal(timer.snapshot().disjoint, 1);
  assert.equal(timer.snapshot().discarded, 4);
  h.setDisjoint(false);
  timer.begin(10);
  timer.end();
  const deleted = h.deleted.length;
  h.setLost(true);
  assert.deepEqual(timer.poll(), []);
  assert.equal(timer.snapshot().status, 'context-lost');
  assert.equal(h.deleted.length, deleted, 'no GL deletion on lost context');
  timer.dispose();
  const broken = gpuHarness();
  broken.gl.beginQuery = () => {
    throw new Error('driver');
  };
  const failed = new RuntimeGpuTiming(broken.gl);
  assert.doesNotThrow(() => failed.begin(1));
  assert.equal(failed.snapshot().status, 'failed');
  failed.dispose();
});

test('nested GPU scopes keep the outer query and cleanup never ends a newer external owner', () => {
  const h = gpuHarness(),
    timer = new RuntimeGpuTiming(h.gl);
  timer.begin(1);
  timer.begin(2);
  timer.end();
  assert.equal(timer.snapshot().pending, 0);
  timer.end();
  h.setAvailable(true);
  assert.deepEqual(timer.poll(), [{ frameId: 1, gpuElapsedMs: 2 }]);
  timer.begin(3);
  const external = { external: true };
  h.setActive(external);
  timer.end();
  assert.equal(h.gl.getQuery(), external);
  assert.equal(timer.snapshot().discarded, 1);
  timer.dispose();
  assert.equal(h.gl.getQuery(), external);
});

test('a later GPU polling failure does not double-count already accepted query results', () => {
  const h = gpuHarness(),
    timer = new RuntimeGpuTiming(h.gl);
  timer.begin(1);
  timer.end();
  timer.begin(2);
  timer.end();
  h.setAvailable(true);
  const get = h.gl.getQueryParameter.bind(h.gl);
  h.gl.getQueryParameter = (query, parameter) => {
    if (query.id === 1) throw new Error('driver polling failure');
    return get(query, parameter);
  };
  assert.deepEqual(timer.poll(), [{ frameId: 2, gpuElapsedMs: 4 }]);
  assert.equal(timer.snapshot().status, 'failed');
  assert.equal(timer.snapshot().discarded, 1);
  assert.equal(h.deleted.length, 2);
  timer.dispose();
});

test('runtime diagnostics export only optional valid GPU render samples and reset pending ownership', () => {
  const gl = gpuHarness(),
    h = harness({ gpuContext: gl.gl }),
    d = h.diagnostics;
  d.beginFrame(0, context);
  d.beginGpu();
  h.add(1);
  d.endGpu();
  d.endFrame();
  gl.setAvailable(true);
  h.at(20);
  d.beginFrame(20, context);
  d.endFrame();
  assert.deepEqual(d.snapshot().gpu.samples, [{ frameId: 1, gpuElapsedMs: 2 }]);
  h.at(40);
  d.beginFrame(40, context);
  d.beginGpu();
  d.endGpu();
  d.endFrame();
  d.reset('pagehide');
  assert.equal(d.snapshot().gpu.pending, 0);
  assert.equal(d.snapshot().gpu.discarded, 1);
  d.dispose();
});
