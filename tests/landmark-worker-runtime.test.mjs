import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { LandmarkWorkerClient } = await import(
    cityModule('landmark-worker-client')
  ),
  { LandmarkLoadState } = await import(cityModule('landmark-load-state')),
  { LANDMARK_WORKER_VERSION } = await import(
    cityModule('landmark-worker-protocol')
  );
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const plan = {
  schema: 1,
  kind: 'science',
  sourceRevision: 'test-selected-triangle-v1',
  placement: { lon: -123.11, lat: 49.27, yaw: 0, baseY: 3.4 },
  footings: [{ surfaceY: 1 }],
};
class Port {
  sent = [];
  terminated = 0;
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  postMessage(m) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated++;
  }
  reply(index = 0, extra = {}) {
    const m = this.sent[index];
    this.onmessage?.({
      data: {
        version: LANDMARK_WORKER_VERSION,
        session: m.session,
        job: m.job,
        ok: true,
        packet: { id: m.job },
        ...extra,
      },
    });
  }
}
test('one active worker, stable priority queue, immutable plan snapshot, per-frame admission', async () => {
  const port = new Port(),
    client = new LandmarkWorkerClient(
      () => port,
      (p) => p,
    );
  const original = structuredClone(plan),
    a = client.request('science', original, 20);
  original.footings[0].surfaceY = 90;
  const b = client.request('science', plan, 50),
    c = client.request('science', plan, 1);
  assert.equal(port.sent.length, 1);
  assert.equal(port.sent[0].plan.footings[0].surfaceY, 1);
  port.reply(0);
  assert.deepEqual(await a.promise, { id: 1 });
  assert.equal(port.sent[1].job, 3);
  port.reply(1);
  await c.promise;
  assert.equal(port.sent[2].job, 2);
  port.reply(2);
  await b.promise;
  client.beginFrame();
  assert.equal(client.admitGroup(), true);
  assert.equal(client.admitGroup(), false);
  client.beginFrame();
  assert.equal(client.admitGroup(), true);
  client.dispose();
  assert.equal(port.terminated, 1);
});
test('queued/active cancellation rejects promptly, never decodes stale buffers, then advances', async () => {
  const port = new Port();
  let decoded = 0;
  const client = new LandmarkWorkerClient(
      () => port,
      (p) => {
        decoded++;
        return p;
      },
    ),
    a = client.request('science', plan, 1),
    b = client.request('science', plan, 2),
    c = client.request('science', plan, 3);
  const pa = assert.rejects(a.promise, { name: 'AbortError' }),
    pb = assert.rejects(b.promise, { name: 'AbortError' });
  b.cancel();
  a.cancel();
  await Promise.all([pa, pb]);
  assert.equal(port.sent.length, 1);
  port.reply(0);
  assert.equal(decoded, 0);
  assert.equal(port.sent[1].job, 3);
  port.reply(1);
  await c.promise;
  assert.equal(decoded, 1);
  client.dispose();
});
test('session/job guards ignore stale results; matching wrong version closes worker and keeps fallback', async () => {
  const port = new Port(),
    client = new LandmarkWorkerClient(
      () => port,
      (p) => p,
    ),
    a = client.request('science', plan, 0),
    p = assert.rejects(a.promise, /version mismatch/);
  port.reply(0, { session: 'stale' });
  port.reply(0, { job: 999 });
  assert.equal(port.terminated, 0);
  port.reply(0, { version: 'old-bundle' });
  await p;
  assert.equal(port.terminated, 1);
  await assert.rejects(
    client.request('science', plan, 0).promise,
    /version mismatch/,
  );
  client.dispose();
});
test('worker error, message error, timeout, unavailable Worker and disposal reject without synchronous factory fallback', async () => {
  for (const cause of ['error', 'message', 'dispose']) {
    const port = new Port(),
      client = new LandmarkWorkerClient(
        () => port,
        (p) => p,
      ),
      a = client.request('science', plan, 0),
      b = client.request('science', plan, 1),
      pa = assert.rejects(a.promise),
      pb = assert.rejects(b.promise);
    if (cause === 'error') port.onerror({ message: 'test-worker-error' });
    else if (cause === 'message') port.onmessageerror({});
    else client.dispose();
    await Promise.all([pa, pb]);
    assert.equal(port.terminated, 1);
    client.dispose();
  }
  const timeoutPort = new Port(),
    timeoutClient = new LandmarkWorkerClient(
      () => timeoutPort,
      (p) => p,
      5,
    );
  await assert.rejects(
    timeoutClient.request('science', plan, 0).promise,
    /timed out/,
  );
  assert.equal(timeoutPort.terminated, 1);
  timeoutClient.dispose();
  const unavailable = new LandmarkWorkerClient(
    () => {
      throw Error('Worker unavailable');
    },
    (p) => p,
  );
  await assert.rejects(
    unavailable.request('science', plan, 0).promise,
    /unavailable/,
  );
  unavailable.dispose();
});
test('callback, missing and nonfinite ground are rejected before worker creation', async () => {
  let ports = 0;
  const client = new LandmarkWorkerClient(
    () => {
      ports++;
      return new Port();
    },
    (p) => p,
  );
  for (const invalid of [
    { ...plan, callback: () => 7 },
    { ...plan, sourceRevision: '' },
    { ...plan, placement: { ...plan.placement, baseY: NaN } },
    { ...plan, kind: 'harbour' },
  ])
    await assert.rejects(client.request('science', invalid, 0).promise);
  assert.equal(ports, 0);
  client.dispose();
});
test('medium remains until complete prepare + admitted commit; night/attach hook runs exactly once', async () => {
  const load = deferred(),
    prepare = deferred(),
    attached = [],
    released = [];
  const state = new LandmarkLoadState({
      load: () => ({ ...load, cancel() {} }),
      prepare: () => prepare.promise,
      attach: (g) => attached.push(g),
      release: (g) => released.push(g),
    }),
    g = { name: 'ultra' };
  state.start();
  assert.equal(state.status, 'loading');
  assert.equal(state.commit(), false);
  load.resolve(g);
  await flush();
  assert.equal(state.status, 'preparing');
  assert.equal(state.value, null);
  assert.equal(state.commit(), false);
  prepare.resolve();
  await flush();
  assert.equal(state.status, 'prepared');
  assert.equal(state.value, null);
  assert.equal(state.commit(), true);
  assert.equal(state.commit(), false);
  assert.equal(state.value, g);
  assert.deepEqual(attached, [g]);
  state.dispose();
  assert.deepEqual(released, []);
});
test('late response after cancel/dispose and cancelled preparation release resources exactly once', async () => {
  for (const action of ['cancel', 'dispose']) {
    const load = deferred(),
      released = [],
      state = new LandmarkLoadState({
        load: () => ({ ...load, cancel() {} }),
        attach() {
          assert.fail('stale attach');
        },
        release: (g) => released.push(g),
      }),
      g = {};
    state.start();
    state[action]();
    load.resolve(g);
    await flush();
    assert.deepEqual(released, [g]);
  }
  const load = deferred(),
    prepare = deferred(),
    released = [];
  let signal;
  const state = new LandmarkLoadState({
      load: () => ({ ...load, cancel() {} }),
      prepare: (_g, s) => {
        signal = s;
        return prepare.promise;
      },
      attach() {
        assert.fail('cancelled attach');
      },
      release: (g) => released.push(g),
    }),
    g = {};
  state.start();
  load.resolve(g);
  await flush();
  state.cancel();
  assert.equal(signal.aborted, true);
  assert.deepEqual(released, [g]);
  prepare.resolve();
  await flush();
  assert.equal(state.status, 'idle');
  assert.deepEqual(released, [g]);
});
test('factory or prewarm failure retains medium and does not retry on repeated start', async () => {
  for (const phase of ['load', 'prepare']) {
    let calls = 0;
    const released = [],
      errors = [],
      g = {};
    const state = new LandmarkLoadState({
      load: () => {
        calls++;
        return {
          promise:
            phase === 'load'
              ? Promise.reject(Error('factory'))
              : Promise.resolve(g),
          cancel() {},
        };
      },
      prepare: () => Promise.reject(Error('upload')),
      attach() {
        assert.fail('failure attach');
      },
      release: (g) => released.push(g),
      error: (m) => errors.push(m),
    });
    state.start();
    await flush();
    assert.equal(state.status, 'failed');
    for (let i = 0; i < 10; i++) state.start();
    assert.equal(calls, 1);
    assert.equal(state.value, null);
    assert.equal(errors.length, 1);
    assert.equal(released.length, phase === 'load' ? 0 : 1);
    state.dispose();
  }
});
