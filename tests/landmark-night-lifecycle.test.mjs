import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const THREE = await import('three'),
  { LandmarkDetail } = await import(cityModule('landmark-detail'));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup() {
  const load = deferred(),
    prewarm = deferred();
  let calls = 0,
    cancelled = 0,
    admitted = false;
  const e = {
    landmarks: new THREE.Group(),
    camera: { position: new THREE.Vector3(0, 20, 0) },
    settings: { quality: 'ultra', buildings: true },
    uniforms: { night: { value: 0.2 } },
    data: {},
    renderer: { shadowMap: {} },
    elevation: () => 0,
    landmarkWorker: {
      request: () => {
        calls++;
        return {
          promise: load.promise,
          cancel() {
            cancelled++;
            load.reject(
              Object.assign(Error('cancelled'), { name: 'AbortError' }),
            );
          },
        };
      },
      admitGroup: () => {
        if (admitted) return false;
        admitted = true;
        return true;
      },
      beginFrame() {
        admitted = false;
      },
    },
    prepareLandmark: () => prewarm.promise,
  };
  const create = () => {
    const g = new THREE.Group();
    g.name = 'Test landmark';
    g.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(10, 20, 10),
        new THREE.MeshStandardMaterial(),
      ),
    );
    g.userData.placement = { lon: -123.128, lat: 49.286, yaw: 0, baseY: 0 };
    g.userData.solidFootprints = [
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
        [-5, -5],
      ],
    ];
    return g;
  };
  const plan = {
      schema: 1,
      kind: 'science',
      sourceRevision: 'test',
      placement: { lon: -123.128, lat: 49.286, yaw: 0, baseY: 0 },
    },
    d = new LandmarkDetail(e, create, plan);
  const ultra = create(),
    lit = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
  ultra.children[0].material = lit;
  ultra.userData.nightMaterials = [{ material: lit, intensity: 2 }];
  ultra.userData.nightPoints = [[0, 20, 0]];
  return {
    e,
    d,
    load,
    prewarm,
    ultra,
    lit,
    calls: () => calls,
    cancelled: () => cancelled,
    frame() {
      e.landmarkWorker.beginFrame();
      d.update();
    },
  };
}
test('actual LandmarkDetail retains medium during worker and prewarm; attaches once using current night state', async () => {
  const f = setup();
  f.frame();
  assert.equal(f.d.medium.visible, true);
  assert.equal(f.d.ultra, null);
  f.load.resolve(f.ultra);
  await flush();
  f.frame();
  assert.equal(f.d.medium.visible, true);
  assert.equal(f.ultra.parent, null);
  f.e.uniforms.night.value = 0.8;
  f.prewarm.resolve();
  await flush();
  f.frame();
  assert.equal(f.d.medium.visible, false);
  assert.equal(f.d.ultra, f.ultra);
  assert.equal(f.lit.emissiveIntensity, 1.6);
  assert.equal(f.e.data.nightMaterials.length, 1);
  assert.equal(f.e.data.nightObjects.length, 1);
  assert.equal(f.e.data.solidWaterFootprints.length, 1);
  for (let i = 0; i < 10; i++) f.frame();
  assert.equal(f.calls(), 1);
  assert.equal(f.e.data.nightMaterials.length, 1);
  assert.equal(f.e.data.nightObjects.length, 1);
  f.e.settings.quality = 'high';
  f.frame();
  assert.equal(f.d.medium.visible, true);
  assert.equal(f.ultra.visible, false);
  f.e.settings.quality = 'ultra';
  f.frame();
  assert.equal(f.d.medium.visible, false);
  assert.equal(f.calls(), 1);
  f.d.disposePending();
});
test('inactive mode cancels pending replacement, error never hides medium, dispose releases unattached geometry', async () => {
  const f = setup();
  f.frame();
  f.e.settings.quality = 'balanced';
  f.frame();
  await flush();
  assert.equal(f.cancelled(), 1);
  assert.equal(f.d.medium.visible, true);
  assert.equal(f.d.loadState.status, 'idle');
  f.d.disposePending();
  const g = setup();
  g.frame();
  g.load.reject(Error('worker unavailable'));
  await flush();
  for (let i = 0; i < 10; i++) g.frame();
  assert.equal(g.d.medium.visible, true);
  assert.equal(g.calls(), 1);
  assert.match(g.e.data.landmarkWorkerErrors['Test landmark'], /unavailable/);
  g.d.disposePending();
  const h = setup();
  let disposed = 0;
  h.ultra.children[0].geometry.addEventListener('dispose', () => disposed++);
  h.frame();
  h.load.resolve(h.ultra);
  await flush();
  h.d.disposePending();
  assert.equal(disposed, 1);
  h.prewarm.resolve();
  await flush();
  assert.equal(h.ultra.parent, null);
  assert.equal(disposed, 1);
  assert.equal(h.e.data.nightMaterials.length, 0);
});

test('night points are prepared once before upload, registered only on commit, and safely disposed if cancelled', async () => {
  const f = setup();
  f.frame();
  f.load.resolve(f.ultra);
  await flush();
  const points = f.ultra.children.find((o) => o.isPoints);
  assert.ok(points);
  assert.equal(f.e.data.nightObjects, undefined);
  f.d.prepareNightGeometry(f.ultra);
  assert.equal(f.ultra.children.filter((o) => o.isPoints).length, 1);
  let geo = 0,
    material = 0,
    texture = 0;
  points.geometry.addEventListener('dispose', () => geo++);
  points.material.addEventListener('dispose', () => material++);
  points.material.map.addEventListener('dispose', () => texture++);
  f.e.settings.quality = 'high';
  f.frame();
  await flush();
  assert.deepEqual([geo, material, texture], [1, 1, 1]);
  assert.equal(f.e.data.nightObjects, undefined);
  assert.equal(f.d.medium.visible, true);
  f.prewarm.resolve();
  await flush();
  assert.equal(f.ultra.parent, null);
  f.d.disposePending();
});
