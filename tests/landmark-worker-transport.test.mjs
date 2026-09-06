import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cityModule } from './helpers/city-modules.mjs';

const THREE = await import('three');
const { LandmarkWorkerClient } = await import(
    cityModule('landmark-worker-client')
  ),
  { createWorkerLandmark } = await import(
    cityModule('landmark-worker-factories')
  ),
  { resolveExtraLandmarkPlan } = await import(
    cityModule('resolve-extra-landmark-plan')
  );
const { packLandmark, unpackLandmark } = await import(
    cityModule('landmark-geometry-packet.js')
  ),
  { applyScienceRedPanelMaterial } = await import(
    cityModule('assets/science-entry')
  ),
  { applyCanadaMembraneMaterial } = await import(
    cityModule('assets/canada-detail')
  );
const shaders = {
  'science-red-v1': applyScienceRedPanelMaterial,
  'canada-membrane-v1': applyCanadaMembraneMaterial,
};
class Port {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  audits = 0;
  constructor() {
    this.worker = new Worker(
      new URL('helpers/landmark-worker-node.mjs', import.meta.url),
    );
    this.worker.on('message', (data) => {
      if (data.audit) {
        assert.equal(data.detached, true);
        this.audits++;
      } else this.onmessage?.({ data });
    });
    this.worker.on('error', (e) => this.onerror?.({ message: e.message }));
    this.worker.on('messageerror', (e) => this.onmessageerror?.(e));
  }
  postMessage(m) {
    this.worker.postMessage(m);
  }
  terminate() {
    void this.worker.terminate();
  }
}
let port;
const client = new LandmarkWorkerClient(
  () => (port = new Port()),
  (packet) => unpackLandmark(THREE, packet, shaders),
);
const existing = JSON.parse(
  readFileSync(
    new URL('fixtures/landmark-worker-stage7-plans.json', import.meta.url),
    'utf8',
  ),
);
const extra = [
  ['bc-place', { lon: -123.1120067, lat: 49.2766985, yaw: 0.677, baseY: 5 }],
  ['harbour', { lon: -123.1120903, lat: 49.2847656, yaw: -0.8, baseY: 12 }],
  ['convention', { lon: -123.1159678, lat: 49.2890752, yaw: -0.403, baseY: 4 }],
  [
    'vancouver-house',
    { lon: -123.131029, lat: 49.2749256, yaw: -0.78, baseY: 8 },
  ],
].map(([kind, placement]) =>
  resolveExtraLandmarkPlan(
    kind,
    placement,
    'CPU-fixture-selected-surface',
    () => 1.2,
  ),
);
function signature(group) {
  const r = packLandmark(THREE, group),
    h = createHash('sha256');
  for (const g of r.packet.geometries) {
    for (const [key, a] of Object.entries(g.attributes)) {
      h.update(key);
      h.update(
        Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength),
      );
    }
    if (g.index) h.update(Buffer.from(g.index.array.buffer));
  }
  h.update(JSON.stringify(group.userData.placement));
  return h.digest('hex');
}
function dispose(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
}
const report = [];
test('actual module worker builds all seven resolved factories without DOM, transfers byte-exact geometry', async () => {
  for (const plan of [...existing, ...extra]) {
    const start = performance.now(),
      g = await client.request(plan.kind, plan, 0).promise,
      elapsed = performance.now() - start,
      expected = createWorkerLandmark(true, plan);
    assert.equal(signature(g), signature(expected));
    assert.deepEqual(g.userData.placement, expected.userData.placement);
    const m = new Set();
    g.traverse((o) => {
      if (o.isMesh) m.add(o.material);
    });
    g.traverse((o) => {
      for (const n of o.userData.nightMaterials || [])
        assert.ok(m.has(n.material));
    });
    report.push({
      kind: plan.kind,
      elapsedMs: elapsed,
      geometryBytes: packLandmark(THREE, g).bytes,
      entries:
        g.userData.entries?.length ??
        g.userData.facadeEntries?.length ??
        g.userData.podiumRefinement?.entries?.length,
    });
    dispose(g);
    dispose(expected);
  }
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(port.audits, 7);
});
test('resolved BC/Harbour/Convention plans equal direct actual-surface geometry and null never invokes legacy defaults', async () => {
  const secondary = await import(cityModule('assets/secondary-landmarks')),
    convention = await import(cityModule('assets/convention-centre'));
  const functions = {
    'bc-place': secondary.createBCPlace,
    harbour: secondary.createHarbourCentre,
    convention: convention.createConventionCentre,
  };
  for (const original of extra.filter((p) => p.kind !== 'vancouver-house'))
    for (const h of [1.2, null]) {
      const plan = resolveExtraLandmarkPlan(
          original.kind,
          original.placement,
          'CPU-fixture-selected-surface',
          () => h,
        ),
        a = createWorkerLandmark(false, plan),
        b = functions[original.kind](false, { actualSurface: () => h });
      b.userData.placement = { ...plan.placement };
      assert.equal(signature(a), signature(b), `${plan.kind}/${h}`);
      if (h === null) {
        const entries = plan.entries ?? plan.bays.filter((b) => b.entry);
        assert.equal(entries.length, 0);
      }
      dispose(a);
      dispose(b);
    }
});
test('missing/corrupt resolved samples and changed placement fail rather than call guessed defaults', async () => {
  const science = structuredClone(existing.find((p) => p.kind === 'science'));
  science.footings.pop();
  await assert.rejects(
    client.request('science', science, 0).promise,
    /Incomplete/,
  );
  for (const p of extra) {
    const bad = structuredClone(p);
    bad.placement.yaw += 0.1;
    assert.throws(() => createWorkerLandmark(false, bad), /placement changed/);
  }
  const bc = structuredClone(extra[0]);
  bc.entries[0].center[0] += 1;
  assert.throws(() => createWorkerLandmark(false, bc), /gate geometry/);
  const harbour = structuredClone(extra[1]);
  harbour.bays[0].origin[0] += 1;
  assert.throws(() => createWorkerLandmark(false, harbour), /source bays/);
  const convention = structuredClone(extra[2]);
  convention.entries[0].left += 0.02;
  assert.throws(() => createWorkerLandmark(false, convention), /source entry/);
});
test('geodata actual Stage8 triangle-derived plans also pass the same worker contract', async () => {
  const plans = JSON.parse(
    readFileSync(
      new URL('fixtures/landmark-worker-stage8-plans.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(plans.length, 4);
  for (const plan of plans) {
    const g = await client.request(plan.kind, plan, 0).promise,
      expected = createWorkerLandmark(true, plan);
    assert.equal(signature(g), signature(expected));
    assert.deepEqual(g.userData.placement, plan.placement);
    report.push({
      kind: plan.kind,
      fixture: 'actual Stage8 ground triangles',
      geometryBytes: packLandmark(THREE, g).bytes,
      acceptedEntries:
        plan.entries?.length ?? plan.bays?.filter((b) => b.entry).length,
    });
    dispose(g);
    dispose(expected);
  }
});
test.after(() => {
  client.dispose();
  console.log(JSON.stringify(report, null, 2));
});
