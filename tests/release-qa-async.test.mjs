import { cityModule } from './helpers/city-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
const source = fs.readFileSync(
  new URL('../lib/city/release-qa-observer.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

test('async QA measures attachment separately, samples medium-to-ready and only counts the real submitted group', async () => {
  let now = 0,
    id = 0,
    previousMetrics = 0;
  const raf = new Map(),
    events = new Map();
  const document = {
    hidden: false,
    addEventListener: (k, v) => events.set(k, v),
    removeEventListener: (k) => events.delete(k),
  };
  const context = {
    exports: {},
    performance: { now: () => now },
    document,
    requestAnimationFrame: (fn) => {
      raf.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (n) => raf.delete(n),
    setTimeout: () => 1,
    clearTimeout() {},
  };
  vm.runInNewContext(js, context);
  const tick = () => {
    const calls = [...raf.values()];
    raf.clear();
    calls.forEach((fn) => fn());
  };
  const holder = new THREE.Group(),
    medium = new THREE.Group();
  holder.name = 'Test';
  holder.add(medium);
  const originalMetric = () => {
    previousMetrics++;
  };
  const client = { onMetrics: originalMetric };
  const detail = {
    holder,
    medium,
    ultra: null,
    loadState: { status: 'idle' },
    update() {
      if (this.loadState.status === 'idle') {
        e.landmarkWorker = client;
        this.loadState.status = 'loading';
      }
      if (this.loadState.status === 'prepared') {
        now += 2;
        this.ultra = new THREE.Group();
        this.ultra.add(
          new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshBasicMaterial(),
          ),
        );
        holder.add(this.ultra);
        this.loadState.status = 'ready';
        medium.visible = false;
      }
    },
  };
  const e = {
    data: {},
    landmarkDetails: [detail],
    landmarkWorker: null,
    disposed: false,
    clock: { hour: 14 },
    uniforms: { night: { value: 0 } },
    navigation: {
      position: new THREE.Vector3(),
      mode: 'orbit',
      keys: new Set(),
      update() {},
    },
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3() },
    settings: { quality: 'ultra' },
    renderer: {
      domElement: {
        width: 100,
        height: 100,
        addEventListener() {},
        removeEventListener() {},
      },
      info: {
        render: { triangles: 12, calls: 1 },
        memory: { geometries: 1, textures: 0 },
      },
    },
    renderScene() {
      detail.update();
      if (detail.ultra) detail.ultra.children[0].onAfterRender();
    },
  };
  const originalUpdate = detail.update,
    originalRender = e.renderScene;
  const pending = context.exports.measureReleaseWindow(e, {
    durationMs: 1000,
    expectedMode: 'orbit',
    action() {},
  });
  now = 16;
  e.renderScene();
  tick();
  assert.equal(medium.visible, true);
  now = 220;
  client.onMetrics({
    landmark: 'science',
    job: 1,
    factoryMs: 80,
    decodeMs: 4,
    geometryBytes: 9000,
  });
  detail.loadState.status = 'preparing';
  e.renderScene();
  tick();
  assert.equal(medium.visible, true);
  now = 500;
  detail.loadState.status = 'prepared';
  e.renderScene();
  tick();
  now = 1050;
  tick();
  const result = await pending;
  const row = result.landmarks[0];
  assert.equal(row.constructionMs.length, 0);
  assert.equal(row.attachmentUpdateMs.length, 1);
  assert.equal(row.attachmentUpdateMs[0], 2);
  assert.equal(row.firstAttachedMs, 502);
  assert.equal(row.firstSubmittedMs, 502);
  assert.deepEqual(
    Array.from(row.loadStateTimeline, (x) => x.state),
    ['idle', 'loading', 'preparing', 'prepared', 'ready'],
  );
  assert.equal(result.workerJobs.length, 1);
  assert.equal(result.workerJobs[0].factoryMs, 80);
  assert.equal(result.workerJobs[0].receivedMs, 220);
  assert.equal(previousMetrics, 1);
  assert.equal(result.renderCPU.maxMs, 2);
  assert.equal(result.valid, true);
  assert.equal(client.onMetrics, originalMetric);
  assert.equal(detail.update, originalUpdate);
  assert.equal(e.renderScene, originalRender);
  assert.equal(raf.size, 0);
  assert.equal(events.size, 0);
  detail.ultra.children[0].geometry.dispose();
  detail.ultra.children[0].material.dispose();
});

test('worker diagnostics preserve request success when an observer throws, and do not decode cancelled results', async () => {
  const { LandmarkWorkerClient } = await import(
    cityModule('landmark-worker-client')
  );
  const { LANDMARK_WORKER_VERSION } = await import(
    cityModule('landmark-worker-protocol')
  );
  let decodes = 0,
    observed;
  const port = {
    sent: [],
    postMessage(m) {
      this.sent.push(m);
    },
    terminate() {},
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  const client = new LandmarkWorkerClient(
    () => port,
    (packet) => {
      decodes++;
      return packet;
    },
  );
  client.onMetrics = (m) => {
    observed = m;
    throw Error('QA instrumentation only');
  };
  const plan = {
    schema: 1,
    kind: 'science',
    sourceRevision: 'fixture',
    placement: { lon: -123.1, lat: 49.3, yaw: 0, baseY: 1 },
  };
  const a = client.request('science', plan, 0),
    message = port.sent[0];
  port.onmessage({
    data: {
      version: LANDMARK_WORKER_VERSION,
      session: message.session,
      job: message.job,
      ok: true,
      packet: { mesh: 1 },
      factoryMs: 21,
      geometryBytes: 800,
    },
  });
  assert.deepEqual(await a.promise, { mesh: 1 });
  assert.equal(observed.factoryMs, 21);
  assert.equal(observed.geometryBytes, 800);
  assert.ok(Number.isFinite(observed.decodeMs));
  assert.equal(observed.landmark, 'science');
  const b = client.request('science', plan, 0),
    reject = assert.rejects(b.promise, { name: 'AbortError' });
  b.cancel();
  await reject;
  const second = port.sent[1];
  port.onmessage({
    data: {
      version: LANDMARK_WORKER_VERSION,
      session: second.session,
      job: second.job,
      ok: true,
      packet: {},
      factoryMs: 1,
      geometryBytes: 1,
    },
  });
  assert.equal(decodes, 1);
  assert.equal(observed.job, message.job);
  client.dispose();
});
