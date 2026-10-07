import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { LandmarkDetail } = await import(cityModule('landmark-detail'));
const { AutoQualityController } = await import(cityModule('auto-quality'));
const { DetailWorkBudget } = await import(cityModule('scenery-motion'));
const { QUALITY } = await import(cityModule('quality'));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const tickets = [];
  const preparations = [];
  let cancellations = 0;
  let workerAdmissions = 0;
  let workMs = 0;
  const e = {
    landmarks: new THREE.Group(),
    camera: { position: new THREE.Vector3(0, 10, 0) },
    settings: { quality: 'ultra', buildings: true },
    sceneryMotion: { allowNewDetails: true },
    detailWorkBudget: new DetailWorkBudget(() => workMs),
    renderer: { shadowMap: { needsUpdate: false } },
    uniforms: { night: { value: 0 } },
    data: {},
    elevation: () => 0,
    landmarkWorker: {
      request() {
        const ticket = deferred();
        tickets.push(ticket);
        return {
          promise: ticket.promise,
          cancel() {
            cancellations++;
          },
        };
      },
      admitGroup() {
        workerAdmissions++;
        return true;
      },
    },
    prepareLandmark() {
      const preparation = deferred();
      preparations.push(preparation);
      return preparation.promise;
    },
  };
  const create = () => {
    const g = new THREE.Group();
    g.name = 'Landmark policy fixture';
    g.userData.placement = { lon: -123.128, lat: 49.286, baseY: 0 };
    g.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(10, 20, 10),
        new THREE.MeshStandardMaterial(),
      ),
    );
    return g;
  };
  const detail = new LandmarkDetail(e, create, {
    schema: 1,
    kind: 'science',
    sourceRevision: 'test',
    placement: { lon: -123.128, lat: 49.286, baseY: 0, yaw: 0 },
  });
  const frame = (distance = 0, { budget = 1.25, tokens = 2 } = {}) => {
    // Camera is level with the box, so distance is exactly to its nearest face.
    e.camera.position.set(detail.bounds.max.x + distance, 10, 0);
    e.detailWorkBudget.reset(budget, tokens);
    detail.update();
  };
  const watchDisposal = (group) => {
    let disposed = 0;
    group.children[0].geometry.addEventListener('dispose', () => disposed++);
    return () => disposed;
  };
  const close = () => {
    detail.disposePending();
    e.landmarks.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  };
  return {
    e,
    detail,
    frame,
    tickets,
    preparations,
    create,
    watchDisposal,
    close,
    cancellations: () => cancellations,
    workerAdmissions: () => workerAdmissions,
    consumeMs: (ms) => {
      workMs += ms;
    },
  };
}

test('actual Auto Balanced and High retain all medium landmarks without admitting Ultra jobs', () => {
  const f = fixture();
  const controller = new AutoQualityController();
  try {
    for (let nowMs = 0; nowMs <= 40_000; nowMs += 1_000 / 60) {
      f.e.settings.quality = controller.observe({
        nowMs,
        frameMs: 1_000 / 60,
        mode: 'orbit',
        speedMps: 0,
        altitudeM: 10,
        moving: false,
        visible: true,
        transitioning: false,
      }).quality;
      f.frame(nowMs % 2 ? 0 : 10_000);
      assert.equal(f.detail.medium.visible, true);
      assert.equal(f.detail.medium.parent, f.detail.holder);
      assert.equal(f.detail.holder.parent, f.e.landmarks);
    }
    assert.equal(controller.snapshot().quality, 'high');
    assert.equal(f.tickets.length, 0);
    assert.equal(f.detail.ultra, null);
  } finally {
    f.close();
  }
});

test('distance hysteresis preserves one in-flight job across boundary jitter and cancels outside exit band', async () => {
  const f = fixture();
  const range = QUALITY.ultra.landmarkDistance;
  try {
    f.frame(range - 1);
    assert.equal(f.tickets.length, 1);
    for (const distance of [range + 1, range - 2, range + 20, range * 1.11])
      f.frame(distance);
    assert.equal(f.tickets.length, 1);
    assert.equal(f.cancellations(), 0);
    assert.equal(f.detail.loadState.status, 'loading');
    assert.equal(f.detail.medium.visible, true);
    f.frame(range * 1.12 + 1);
    assert.equal(f.cancellations(), 1);
    assert.equal(f.detail.loadState.status, 'idle');
    f.frame(range + 1);
    assert.equal(f.tickets.length, 1, 'exit resets the entry threshold');
    f.frame(range - 1);
    assert.equal(f.tickets.length, 2);
    const stale = f.create(),
      disposed = f.watchDisposal(stale);
    f.tickets[0].resolve(stale);
    await flush();
    assert.equal(disposed(), 1);
    assert.equal(stale.parent, null);
    assert.equal(
      f.detail.loadState.status,
      'loading',
      'stale result cannot replace the current job',
    );
  } finally {
    f.close();
  }
});

test('motion admission pauses new jobs and prepared commits without cancelling active work or cached display', async () => {
  const f = fixture();
  try {
    f.e.sceneryMotion.allowNewDetails = false;
    f.frame();
    assert.equal(f.tickets.length, 0);
    f.e.sceneryMotion.allowNewDetails = true;
    f.frame();
    f.e.sceneryMotion.allowNewDetails = false;
    for (let i = 0; i < 10; i++) f.frame();
    assert.equal(f.tickets.length, 1);
    assert.equal(f.cancellations(), 0);
    const group = f.create();
    f.tickets[0].resolve(group);
    await flush();
    f.preparations[0].resolve();
    await flush();
    f.frame();
    assert.equal(f.detail.loadState.status, 'prepared');
    assert.equal(group.parent, null);
    assert.equal(f.detail.medium.visible, true);
    assert.equal(f.workerAdmissions(), 0);
    f.e.sceneryMotion.allowNewDetails = true;
    f.frame(0, { budget: 0 });
    assert.equal(f.detail.loadState.status, 'prepared');
    f.frame(0, { tokens: 0 });
    assert.equal(f.detail.loadState.status, 'prepared');
    assert.equal(f.workerAdmissions(), 0);
    f.frame();
    assert.equal(f.detail.loadState.status, 'ready');
    assert.equal(group.parent, f.detail.holder);
    assert.equal(f.detail.medium.visible, false);
    assert.equal(f.workerAdmissions(), 1);
    f.e.sceneryMotion.allowNewDetails = false;
    for (let i = 0; i < 10; i++) f.frame();
    assert.equal(
      group.visible,
      true,
      'already committed details remain usable during motion',
    );
    assert.equal(f.detail.medium.visible, false);
    assert.equal(f.tickets.length, 1);
    assert.equal(f.workerAdmissions(), 1);
  } finally {
    f.close();
  }
});

test('tier downgrade cancels preparing work, releases detached geometry once, and rejects late preparation', async () => {
  const f = fixture();
  try {
    f.frame();
    const group = f.create(),
      disposed = f.watchDisposal(group);
    f.tickets[0].resolve(group);
    await flush();
    assert.equal(f.detail.loadState.status, 'preparing');
    f.e.settings.quality = 'high';
    f.frame();
    assert.equal(f.detail.loadState.status, 'idle');
    assert.equal(disposed(), 1);
    assert.equal(f.detail.medium.visible, true);
    f.preparations[0].resolve();
    await flush();
    f.frame();
    assert.equal(f.detail.ultra, null);
    assert.equal(group.parent, null);
    assert.equal(disposed(), 1);
    assert.equal(f.workerAdmissions(), 0);
  } finally {
    f.close();
  }
});

test('committed cache survives quality or layer changes and hides with exactly one shadow refresh per swap', async () => {
  const f = fixture();
  try {
    f.frame();
    const group = f.create(),
      disposed = f.watchDisposal(group);
    f.tickets[0].resolve(group);
    await flush();
    f.preparations[0].resolve();
    await flush();
    f.frame();
    assert.equal(f.e.renderer.shadowMap.needsUpdate, true);
    f.e.renderer.shadowMap.needsUpdate = false;
    f.frame();
    assert.equal(f.e.renderer.shadowMap.needsUpdate, false);
    f.e.settings.quality = 'balanced';
    f.frame();
    assert.equal(f.detail.medium.visible, true);
    assert.equal(group.visible, false);
    assert.equal(f.e.renderer.shadowMap.needsUpdate, true);
    f.e.renderer.shadowMap.needsUpdate = false;
    f.frame();
    assert.equal(f.e.renderer.shadowMap.needsUpdate, false);
    assert.equal(disposed(), 0);
    f.e.settings.quality = 'ultra';
    f.frame();
    assert.equal(group.visible, true);
    assert.equal(f.tickets.length, 1);
    assert.equal(f.workerAdmissions(), 1);
    f.e.settings.buildings = false;
    f.frame();
    assert.equal(group.visible, false);
    assert.equal(f.detail.medium.visible, true);
    f.e.settings.buildings = true;
    f.e.sceneryMotion.allowNewDetails = false;
    f.frame();
    assert.equal(group.visible, true);
    assert.equal(f.tickets.length, 1);
    assert.equal(disposed(), 0);
  } finally {
    f.close();
  }
});

test('shared preparation allowance prevents landmark commit after earlier optional work exhausts it', async () => {
  const f = fixture();
  try {
    f.frame();
    f.tickets[0].resolve(f.create());
    await flush();
    f.preparations[0].resolve();
    await flush();
    f.e.detailWorkBudget.reset(1.25, 2);
    f.e.detailWorkBudget.run(() => f.consumeMs(2));
    f.detail.update();
    assert.equal(f.e.detailWorkBudget.stats.overruns, 1);
    assert.equal(f.detail.loadState.status, 'prepared');
    assert.equal(f.workerAdmissions(), 0);
    assert.equal(f.detail.medium.visible, true);
    f.frame();
    assert.equal(f.detail.loadState.status, 'ready');
    assert.equal(f.workerAdmissions(), 1);
  } finally {
    f.close();
  }
});
