import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createFacadePagePreparation, createFacadePreparationMetrics } =
  await import(cityModule('facade-page-preparation'));
const { IncrementalFacadeQueue } = await import(cityModule('facade-queue'));
const { LandmarkGpuWarmup } = await import(cityModule('gpu-landmark-warmup'));
const { facadeTemplates } = await import(cityModule('facade-profile'));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const profile = {
  ...facadeTemplates.find((p) => p.balconies),
  wallColor: 0x9faba7,
  seed: 0.35,
};
const request = (version = '1', height = 3) => ({
  id: 'cell',
  version,
  priority: 0,
  items: [
    {
      r: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      x: 5,
      z: 5,
      ground: 10,
      h: height,
      min: 0,
      profile,
    },
  ],
});
function deferredWarmer() {
  const calls = [];
  return {
    calls,
    prepare(group, signal, holder) {
      return new Promise((resolve, reject) => {
        const call = { group, signal, holder, settled: false };
        const settle = (error) => {
          if (call.settled) return;
          call.settled = true;
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () =>
          settle(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        Object.assign(call, {
          resolve: () => settle(),
          reject: (e) => settle(e),
        });
        calls.push(call);
        signal.addEventListener('abort', abort, { once: true });
      });
    },
  };
}
function fixture(warmer) {
  let time = 0;
  const holder = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    requests = [];
  const preparationMetrics = createFacadePreparationMetrics();
  const prepare = createFacadePagePreparation(
    () => warmer,
    holder,
    preparationMetrics,
  );
  const q = new IncrementalFacadeQueue(holder, material, {
    now: () => (time += 0.025),
    pageBoxes: 2,
    preparePage: (r) => {
      requests.push(r);
      prepare(r);
    },
  });
  return { q, holder, material, requests, preparationMetrics };
}
function pumpUntil(q, predicate) {
  let guard = 0;
  while (!predicate() && guard++ < 5000) q.pump();
  assert(predicate(), 'queue did not settle');
}
class Renderer {
  autoClear = false;
  autoClearColor = false;
  autoClearDepth = true;
  autoClearStencil = false;
  xr = { enabled: true };
  shadowMap = {
    autoUpdate: true,
    needsUpdate: true,
    enabled: true,
    type: THREE.PCFShadowMap,
  };
  info = {
    autoReset: false,
    render: { frame: 12, calls: 2, triangles: 4, points: 0, lines: 0 },
  };
  localClippingEnabled = false;
  clippingPlanes = [];
  debug = { checkShaderErrors: false, onShaderError: null };
  target = new THREE.WebGLRenderTarget(120, 70);
  face = 0;
  level = 0;
  color = new THREE.Color(0x142331);
  alpha = 0.63;
  lost = false;
  draws = [];
  getRenderTarget() {
    return this.target;
  }
  getActiveCubeFace() {
    return this.face;
  }
  getActiveMipmapLevel() {
    return this.level;
  }
  setRenderTarget(target, face = 0, level = 0) {
    this.target = target;
    this.face = face;
    this.level = level;
  }
  getClearColor(out) {
    return out.copy(this.color);
  }
  getClearAlpha() {
    return this.alpha;
  }
  setClearColor(color, alpha = 1) {
    this.color.set(color);
    this.alpha = alpha;
  }
  getContext() {
    return { isContextLost: () => this.lost };
  }
  compile(object, camera, scene) {
    this.onCompile?.(object, camera, scene);
  }
  render(scene, camera) {
    const objects = [];
    scene.traverse((o) => {
      if (o.isMesh) objects.push(o);
    });
    this.draws.push({ scene, camera, objects });
    this.info.render.frame++;
  }
}
function actualWarmer() {
  const renderer = new Renderer(),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 30000),
    target = new THREE.WebGLRenderTarget(100, 100, {
      type: THREE.HalfFloatType,
    });
  scene.add(new THREE.HemisphereLight());
  const warmer = new LandmarkGpuWarmup({
    renderer,
    scene,
    camera,
    colorTarget: () => target,
    unavailable: () => false,
  });
  return { warmer, renderer, scene };
}

test('borrowed proxy preserves source parent/order, geometry/material ownership and complete detached transform', async () => {
  const warmer = deferredWarmer(),
    holder = new THREE.Group(),
    owner = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 4),
      new THREE.MeshStandardMaterial(),
    ),
    sibling = new THREE.Object3D();
  holder.position.set(100, 4, -20);
  holder.rotation.y = 0.8;
  owner.position.set(9, 2, 3);
  owner.rotation.y = 0.3;
  mesh.position.set(2, 7, 1);
  owner.add(sibling, mesh);
  mesh.castShadow = mesh.receiveShadow = true;
  let acks = 0,
    disposes = 0;
  mesh.geometry.addEventListener('dispose', () => disposes++);
  mesh.material.addEventListener('dispose', () => disposes++);
  const originalChildren = [...owner.children];
  const geometryBytes = () =>
    Object.fromEntries(
      [
        ...Object.entries(mesh.geometry.attributes),
        ['index', mesh.geometry.index],
      ].map(([name, attribute]) => [
        name,
        Buffer.from(
          new Uint8Array(
            attribute.array.buffer,
            attribute.array.byteOffset,
            attribute.array.byteLength,
          ),
        ),
      ]),
    );
  const originalGeometry = geometryBytes();
  const originalPosition = mesh.position.toArray();
  const originalQuaternion = mesh.quaternion.toArray();
  let wallTime = 0;
  const preparationMetrics = createFacadePreparationMetrics();
  const prepare = createFacadePagePreparation(
    () => warmer,
    holder,
    preparationMetrics,
    () => wallTime,
  );
  prepare({
    token: 1,
    pageIndex: 0,
    mesh,
    signal: new AbortController().signal,
    ack: (error) => {
      assert.equal(error, undefined);
      acks++;
    },
  });
  const call = warmer.calls[0],
    proxy = call.group.children[0];
  assert.equal(call.group.parent, null);
  assert.deepEqual(call.group.userData, {
    preparationKind: 'facade',
    facadeToken: 1,
    pageIndex: 0,
  });
  assert.equal(preparationMetrics.requested, 1);
  assert.equal(preparationMetrics.pending, 1);
  assert.equal(proxy.geometry, mesh.geometry);
  assert.equal(proxy.material, mesh.material);
  assert.notEqual(proxy, mesh);
  assert.deepEqual(proxy.matrix.elements, mesh.matrixWorld.elements);
  assert.equal(proxy.matrixAutoUpdate, false);
  assert(proxy.castShadow && proxy.receiveShadow);
  assert.equal(mesh.parent, owner);
  assert.deepEqual(owner.children, originalChildren);
  assert.equal(acks, 0);
  wallTime = 37;
  call.resolve();
  await flush();
  assert.deepEqual(preparationMetrics, {
    requested: 1,
    succeeded: 1,
    cancelled: 0,
    failed: 0,
    pending: 0,
    totalAsyncWallMs: 37,
    lastAsyncWallMs: 37,
    maxAsyncWallMs: 37,
  });
  assert.equal(acks, 1);
  assert.equal(disposes, 0);
  assert.equal(call.group.children.length, 0);
  assert.deepEqual(geometryBytes(), originalGeometry);
  assert.deepEqual(mesh.position.toArray(), originalPosition);
  assert.deepEqual(mesh.quaternion.toArray(), originalQuaternion);
  assert.equal(mesh.parent, owner);
  assert.deepEqual(owner.children, originalChildren);
});
test('already aborted, attached source, unavailable or synchronously failing warmer always acknowledge once', async () => {
  for (const mode of ['aborted', 'attached', 'unavailable', 'throw']) {
    const holder = new THREE.Group(),
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial(),
      ),
      controller = new AbortController();
    let calls = 0,
      acks = 0,
      result;
    if (mode === 'aborted') controller.abort();
    if (mode === 'attached') holder.add(mesh);
    const warmer = {
      prepare() {
        calls++;
        throw new Error('sync prepare failure');
      },
    };
    createFacadePagePreparation(
      () => (mode === 'unavailable' ? null : warmer),
      holder,
    )({
      token: 1,
      pageIndex: 0,
      mesh,
      signal: controller.signal,
      ack: (e) => {
        acks++;
        result = e;
      },
    });
    await flush();
    assert.equal(acks, 1);
    assert.equal(calls, mode === 'throw' ? 1 : 0);
    if (mode === 'aborted') assert.equal(result, undefined);
    else assert(result instanceof Error);
    assert.equal(mesh.parent, mode === 'attached' ? holder : null);
  }
});
test('asynchronous GPU failure retains the previous cell and fails that version once', async () => {
  const { warmer, renderer } = actualWarmer(),
    f = fixture(warmer),
    { q, holder } = f;
  q.select([request()]);
  for (let frame = 0; q.metrics.completed < 1 && frame < 20; frame++) {
    q.pump();
    warmer.tick();
    await flush();
  }
  assert.equal(q.metrics.completed, 1);
  const previous = holder.children[0];
  renderer.onCompile = () => renderer.debug.onShaderError?.();
  q.select([request('2', 35)]);
  pumpUntil(q, () => f.requests.length === 3);
  warmer.tick();
  await flush();
  assert.equal(q.metrics.failed, 1);
  assert.equal(f.preparationMetrics.failed, 1);
  assert.equal(f.preparationMetrics.succeeded, 2);
  assert.equal(f.preparationMetrics.pending, 0);
  assert.match(q.lastError, /shader compilation failed/);
  assert.equal(holder.children[0], previous);
  assert.equal(previous.visible, true);
  assert.equal(q.pendingBytes, 0);
  const steps = q.metrics.steps;
  for (let i = 0; i < 10; i++) {
    q.pump();
    warmer.tick();
    await flush();
  }
  assert.equal(q.metrics.steps, steps);
  assert.equal(q.metrics.completed, 1);
  q.dispose();
  warmer.dispose();
});
test('shared public scheduler warms at most one page per tick and publishes only after every page succeeds', async () => {
  const { warmer, renderer } = actualWarmer(),
    { q, holder, requests } = fixture(warmer);
  holder.position.set(80, 4, 20);
  holder.rotation.y = 0.2;
  q.select([request()]);
  pumpUntil(q, () => requests.length === 1);
  const source = requests[0].mesh,
    sourceParent = source.parent;
  q.pump();
  assert.equal(requests.length, 1);
  warmer.tick();
  assert.equal(renderer.draws.length, 1);
  assert.equal(holder.children.length, 0);
  assert.equal(source.parent, sourceParent);
  const expected = holder.matrixWorld.clone().multiply(source.matrixWorld);
  assert.deepEqual(
    renderer.draws[0].objects[0].matrixWorld.elements,
    expected.elements,
  );
  await flush();
  q.pump();
  assert.equal(requests.length, 2);
  assert.equal(holder.children.length, 0);
  warmer.tick();
  assert.equal(renderer.draws.length, 2);
  await flush();
  q.pump();
  assert.equal(q.metrics.completed, 1);
  assert.equal(holder.children.length, 1);
  assert.equal(holder.children[0].children.length, 2);
  assert.equal(source.parent, sourceParent);
  q.dispose();
  warmer.dispose();
});
test('abort inside a synchronous compile does not release borrowed buffers until the render stack unwinds', async () => {
  const { warmer, renderer } = actualWarmer(),
    { q, holder, requests, material } = fixture(warmer);
  let materialDisposes = 0;
  material.addEventListener('dispose', () => materialDisposes++);
  q.select([request()]);
  pumpUntil(q, () => requests.length === 1);
  let disposed = 0;
  requests[0].mesh.geometry.addEventListener('dispose', () => disposed++);
  renderer.onCompile = () => {
    q.select([]);
    assert.equal(disposed, 0);
  };
  warmer.tick();
  assert.equal(disposed, 0);
  assert.equal(renderer.draws.length, 0);
  assert(q.pendingBytes > 0);
  await flush();
  assert.equal(disposed, 1);
  assert.equal(q.pendingBytes, 0);
  assert.equal(holder.children.length, 0);
  assert.equal(q.metrics.failed, 0);
  assert.equal(materialDisposes, 0);
  q.dispose();
  warmer.dispose();
  assert.equal(disposed, 1);
  assert.equal(materialDisposes, 0);
});
test('cancelled stale page completion cannot fail or publish the replacement job', async () => {
  const warmer = deferredWarmer(),
    { q, holder, requests } = fixture(warmer);
  q.select([request()]);
  pumpUntil(q, () => requests.length === 1);
  let disposed = 0;
  requests[0].mesh.geometry.addEventListener('dispose', () => disposed++);
  q.select([request('2')]);
  assert.equal(disposed, 0);
  assert(q.pendingBytes > 0);
  q.pump();
  assert.equal(requests.length, 1);
  await flush();
  assert.equal(disposed, 1);
  assert.equal(q.pendingBytes, 0);
  assert.equal(q.metrics.failed, 0);
  pumpUntil(q, () => requests.length === 2);
  warmer.calls[1].resolve();
  await flush();
  q.pump();
  assert.equal(requests.length, 3);
  warmer.calls[2].resolve();
  await flush();
  q.pump();
  assert.equal(q.metrics.completed, 1);
  assert.equal(q.records.get('cell').ready.version, '2');
  assert.equal(holder.children.length, 1);
  assert.equal(disposed, 1);
  q.dispose();
});
test('context invalidation settles a waiting page without another frame or successful publication', async () => {
  const { warmer } = actualWarmer(),
    { q, holder, requests, material } = fixture(warmer);
  let materialDisposes = 0;
  material.addEventListener('dispose', () => materialDisposes++);
  q.select([request()]);
  pumpUntil(q, () => requests.length === 1);
  warmer.invalidate('context lost');
  await flush();
  assert.equal(q.metrics.failed, 1);
  assert.equal(q.pendingBytes, 0);
  assert.equal(holder.children.length, 0);
  assert.match(q.lastError, /context lost/);
  assert.equal(materialDisposes, 0);
  q.dispose();
  warmer.dispose();
});
test('queue teardown acknowledges late cancellation once and never disposes the shared material', async () => {
  const warmer = deferredWarmer(),
    { q, holder, requests, material } = fixture(warmer);
  let materialDisposes = 0;
  material.addEventListener('dispose', () => materialDisposes++);
  q.select([request()]);
  pumpUntil(q, () => requests.length === 1);
  let disposed = 0;
  requests[0].mesh.geometry.addEventListener('dispose', () => disposed++);
  q.dispose();
  assert.equal(disposed, 0);
  await flush();
  assert.equal(disposed, 1);
  assert.equal(q.pendingBytes, 0);
  assert.equal(materialDisposes, 0);
  assert.equal(holder.children.length, 0);
  warmer.calls[0].resolve();
  await flush();
  assert.equal(disposed, 1);
});
