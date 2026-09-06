import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityModule } from './helpers/city-modules.mjs';
const { FacadePageBuilder } = await import(cityModule('facade-pages'));
const { IncrementalFacadeQueue } = await import(cityModule('facade-queue'));
const { facadeWork } = await import(cityModule('facade-plan'));
const { facadeTemplates } = await import(cityModule('facade-profile'));
const profile = {
  ...facadeTemplates.find((p) => p.kind === 'balcony-slab'),
  wallColor: 0x9faba7,
  seed: 0.35,
};
const officeProfile = {
  ...facadeTemplates.find((p) => p.kind === 'curtain-wall'),
  wallColor: 0x96acaf,
  seed: 0.7,
};
function items(h = 3) {
  return [
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
      h,
      min: 0,
      profile,
    },
  ];
}
function req(id = 'a', version = '1', height = 3) {
  return { id, version, priority: 0, items: items(height) };
}
function build(input, step = 8, pageBoxes = 1024) {
  const b = new FacadePageBuilder(input, { pageBoxes });
  let guard = 0;
  while (!b.done && guard++ < 100000) {
    const t = b.tokens;
    b.step(step);
    assert.ok(b.tokens - t <= step);
  }
  assert.ok(b.done);
  return b;
}
function flatten(pages, name) {
  return Buffer.concat(
    pages.map((p) => {
      const a = p.getAttribute(name).array;
      return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    }),
  );
}
// Independent Three geometry reference: the original public API transform
// sequence, not another hand-coded vertex transform or an archived factory.
function sourceCell(input) {
  const boxes = [...facadeWork(input)]
    .filter(Boolean)
    .map((b) =>
      new THREE.BoxGeometry(b.width, b.height, b.depth)
        .rotateY(b.yaw)
        .translate(b.x, b.y, b.z),
    );
  const geometry = mergeGeometries(boxes);
  boxes.forEach((b) => b.dispose());
  return geometry;
}
function denseInput() {
  return Array.from({ length: 32 }, (_, i) => ({
    ...items(70)[0],
    profile: i % 2 ? officeProfile : profile,
    r: [
      [0, 0],
      [24, 7],
      [20, 29],
      [-4, 22],
    ].map(([x, z]) => [x + i * 32, z]),
    x: 10 + i * 32,
    z: 14.5,
    min: i % 2 ? 15 : 0,
  }));
}
function sourceIndices(pages) {
  let vertexOffset = 0;
  const out = [];
  for (const p of pages) {
    out.push(...Array.from(p.index.array, (i) => i + vertexOffset));
    vertexOffset += p.getAttribute('position').count;
  }
  return Uint32Array.from(out);
}
function compare(b, g) {
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(name).array;
    assert.deepEqual(
      flatten(b.pages, name),
      Buffer.from(a.buffer, a.byteOffset, a.byteLength),
      name + ' bytes',
    );
  }
  assert.deepEqual(sourceIndices(b.pages), Uint32Array.from(g.index.array));
}
function clock(step = 0.025) {
  let t = 0;
  return () => (t += step);
}
function queue(options = {}) {
  let dirty = 0;
  const host = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  const q = new IncrementalFacadeQueue(host, material, {
    now: clock(),
    onShadowDirty: () => dirty++,
    ...options,
  });
  return {
    q,
    host,
    material,
    get dirty() {
      return dirty;
    },
  };
}
function until(q, condition, limit = 10000) {
  let n = 0;
  while (!condition() && n++ < limit) q.pump();
  assert.ok(condition(), 'condition did not settle');
  return n;
}

test('dense synthetic cell retains every Three BoxGeometry attribute byte and triangle order', () => {
  const input = denseInput(),
    source = sourceCell(input),
    b = build(input);
  assert.ok(b.boxes > 1024);
  assert.ok(b.pages.length > 1);
  compare(b, source);
  assert.ok(b.allocatedBytes < 8 * 1024 * 1024);
  assert.equal(b.usedBytes, b.boxes * 840);
  assert.ok(input.some((i) => i.profile.balconies));
  assert.ok(input.some((i) => !i.profile.balconies));
  for (const g of b.pages) {
    const p = g.getAttribute('position'),
      point = new THREE.Vector3();
    assert.ok(g.boundingSphere && Number.isFinite(g.boundingSphere.radius));
    for (const name of ['position', 'normal', 'uv'])
      for (const v of g.getAttribute(name).array) assert.ok(Number.isFinite(v));
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i);
      assert.ok(g.boundingBox.containsPoint(point));
      assert.ok(g.boundingSphere.distanceToPoint(point) < 1e-6);
    }
  }
  source.dispose();
  b.cancel();
});
test('step and page boundaries do not change clockwise, raised-floor or office geometry', () => {
  const office = {
    ...items(70)[0],
    profile: officeProfile,
    min: 15,
    r: [
      [0, 0],
      [24, 7],
      [20, 29],
      [-4, 22],
    ].reverse(),
  };
  const input = [...items(35), office],
    source = sourceCell(input);
  for (const step of [1, 8, 64]) {
    const b = build(input, step, 13);
    compare(b, source);
    b.cancel();
  }
  source.dispose();
});
test('descriptor dimensions retain roof caps, alternating balcony edges and raised-floor clearance', () => {
  const roof = [...facadeWork(items())].filter(Boolean);
  assert.equal(roof.length, 4);
  assert(
    roof.every(
      (b) =>
        b.width === 10 && b.height === 0.5 && b.depth === 0.35 && b.y === 12.9,
    ),
  );
  const rows = [...facadeWork(items(35))].filter(Boolean);
  const slabs = rows.filter((b) => b.height === 0.16 && b.depth === 1.15);
  assert(slabs.length > 0);
  assert(
    slabs.every(
      (b) => Math.abs(b.z + 0.48) < 1e-8 || Math.abs(b.z - 10.48) < 1e-8,
    ),
  );
  const input = [{ ...items(70)[0], profile: officeProfile, min: 15 }];
  const descriptors = [...facadeWork(input)].filter(Boolean);
  const vertical = descriptors.filter((b) => b.height === 54.6);
  assert(vertical.length > 0);
  assert(vertical.every((b) => Math.abs(b.y - b.height / 2 - 25.2) < 1e-8));
  assert(
    descriptors
      .filter((b) => b.height === 0.11)
      .every((b) => b.y > 25.2 && b.y < 80),
  );
});
test('invalid edge scans yield checkpoints and fixed token work; empty input has no geometry', () => {
  const invalid = items();
  invalid[0].r = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const b = new FacadePageBuilder(Array.from({ length: 50 }, () => invalid[0]));
  b.step(8);
  assert.equal(b.tokens, 8);
  assert.equal(b.boxes, 0);
  assert.equal(b.done, false);
  b.cancel();
  assert.equal(b.allocatedBytes, 0);
  const empty = build([]);
  assert.equal(empty.pages.length, 0);
  assert.equal([...facadeWork(items())].filter(Boolean).length, 4);
});
test('whole-cell atomic publication and same-id rebuild keeps previous visible until ready', () => {
  const { q, host } = queue({ pageBoxes: 4 });
  q.select([req()]);
  until(q, () => q.metrics.completed === 1);
  const old = q.records.get('a').ready.group;
  q.select([req('a', '2', 80)]);
  q.pump();
  assert.equal(q.records.get('a').ready.group, old);
  assert.equal(old.visible, true);
  assert.deepEqual(host.children, [old]);
  until(q, () => q.metrics.completed === 2);
  assert.notEqual(q.records.get('a').ready.group, old);
  assert.equal(old.parent, null);
  assert.equal(host.children.length, 1);
  q.dispose();
});
test('quality off cancels pending, retains ready cache, and cache hit needs no new builds or shadows', () => {
  const f = queue({ pageBoxes: 4 });
  const { q, host } = f;
  q.select([req()]);
  until(q, () => q.metrics.completed === 1);
  q.select([req(), req('b', '1', 80)]);
  q.pump();
  assert.equal(q.pendingId, 'b');
  q.select([]);
  assert.equal(q.pendingId, undefined);
  assert.equal(q.pendingBytes, 0);
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].visible, false);
  q.select([req()]);
  const steps = q.metrics.steps,
    dirty = f.dirty;
  for (let i = 0; i < 10; i++) q.pump();
  assert.equal(q.metrics.steps, steps);
  assert.equal(f.dirty, dirty);
  assert.equal(q.metrics.completed, 1);
  assert.equal(host.children[0].visible, true);
  q.dispose();
});
test('LRU evicts inactive geometry within both byte and cell caps; material remains caller-owned', () => {
  const { q, material } = queue({
    pageBoxes: 4,
    maxCacheCells: 2,
    maxCacheBytes: 6720,
  });
  let disposed = 0,
    materialDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  for (const id of ['a', 'b']) {
    q.select([req(id)]);
    until(q, () => q.records.get(id)?.ready);
  }
  q.records
    .get('a')
    .ready.pages[0].addEventListener('dispose', () => disposed++);
  q.select([req('c')]);
  until(q, () => q.records.get('c')?.ready);
  assert.equal(q.records.get('a').ready, null);
  assert.ok(q.records.get('b').ready);
  assert.equal(disposed, 1);
  assert.equal(q.cacheBytes, 6720);
  assert.equal(q.metrics.evicted, 1);
  q.dispose();
  assert.equal(materialDisposals, 0);
  assert.equal(q.cacheBytes, 0);
});
test('cache cap never evicts selected visible cells; over-cap pending stays private', () => {
  const { q, host } = queue({
    pageBoxes: 4,
    maxCacheCells: 1,
    maxCacheBytes: 3360,
  });
  q.select([req('a')]);
  until(q, () => q.metrics.completed === 1);
  q.select([req('a'), req('b')]);
  for (let i = 0; i < 20; i++) q.pump();
  assert.equal(q.metrics.completed, 1);
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].visible, true);
  assert.equal(q.pendingBytes, 3360);
  q.select([req('b')]);
  until(q, () => q.metrics.completed === 2);
  assert.equal(q.cacheBytes, 3360);
  q.dispose();
});
test('oversize cell fails once without replacing old version or retry thrash', () => {
  const { q, host } = queue({ pageBoxes: 4, maxPendingBytes: 3360 });
  q.select([req()]);
  until(q, () => q.metrics.completed === 1);
  const old = host.children[0];
  q.select([req('a', '2', 80)]);
  until(q, () => q.metrics.failed === 1);
  const steps = q.metrics.steps;
  for (let i = 0; i < 20; i++) q.pump();
  assert.equal(q.metrics.failed, 1);
  assert.equal(q.metrics.steps, steps);
  assert.equal(q.pendingBytes, 0);
  assert.equal(host.children[0], old);
  assert.match(q.lastError, /pending byte limit/);
  q.dispose();
});
test('bounded steps respect fake soft deadline without scanning a whole cold cell', () => {
  const { q } = queue({ now: clock(0.05), maxTokensPerStep: 8 });
  q.select([{ ...req(), items: denseInput() }]);
  q.pump();
  assert.ok(q.metrics.steps > 0 && q.metrics.steps <= 14);
  assert.equal(q.metrics.completed, 0);
  assert.ok(q.pendingBytes <= 860160);
  assert.ok(q.metrics.maxPumpMs < 2.5);
  q.dispose();
});
test('GPU preparation must ack every page before publication; one request per pump', () => {
  const tickets = [];
  const { q, host } = queue({
    pageBoxes: 2,
    preparePage: (r) => tickets.push(r),
  });
  q.select([req()]);
  until(q, () => tickets.length === 1);
  assert.equal(host.children.length, 0);
  q.pump();
  assert.equal(tickets.length, 1);
  tickets[0].ack();
  q.pump();
  assert.equal(tickets.length, 2);
  assert.equal(host.children.length, 0);
  tickets[1].ack();
  q.pump();
  assert.equal(host.children.length, 1);
  assert.equal(q.metrics.completed, 1);
  assert.equal(q.records.get('a').ready.pages.length, 2);
  q.dispose();
});
test('late preparation ack after cancellation frees retained page and cannot publish stale state', () => {
  const tickets = [];
  const { q, host } = queue({
    pageBoxes: 4,
    preparePage: (r) => tickets.push(r),
  });
  q.select([req()]);
  until(q, () => tickets.length === 1);
  let disposals = 0;
  tickets[0].mesh.geometry.addEventListener('dispose', () => disposals++);
  q.select([req('b')]);
  assert.equal(tickets[0].signal.aborted, true);
  assert.equal(q.pendingBytes, 3360);
  q.pump();
  assert.equal(tickets.length, 1);
  assert.equal(host.children.length, 0);
  tickets[0].ack();
  assert.equal(disposals, 1);
  assert.equal(q.pendingBytes, 0);
  until(q, () => tickets.length === 2);
  tickets[1].ack();
  q.pump();
  assert.equal(q.records.get('a').ready, null);
  assert.equal(q.metrics.completed, 1);
  assert.equal(q.records.get('b').ready.group, host.children[0]);
  q.dispose();
});
test('synchronous abort acknowledgement disposes the retained page exactly once', () => {
  let ticket,
    disposals = 0;
  const { q } = queue({
    pageBoxes: 4,
    preparePage: (r) => {
      ticket = r;
      r.mesh.geometry.addEventListener('dispose', () => disposals++);
      r.signal.addEventListener('abort', r.ack, { once: true });
    },
  });
  q.select([req()]);
  until(q, () => ticket);
  q.select([]);
  assert.equal(disposals, 1);
  assert.equal(q.pendingBytes, 0);
  q.dispose();
  assert.equal(disposals, 1);
});
test('dispose with preparation in flight aborts, releases on ack, and cannot resurrect scene', () => {
  let ticket,
    disposals = 0;
  const { q, host } = queue({ pageBoxes: 4, preparePage: (r) => (ticket = r) });
  q.select([req()]);
  until(q, () => ticket);
  ticket.mesh.geometry.addEventListener('dispose', () => disposals++);
  q.dispose();
  assert.ok(ticket.signal.aborted);
  assert.equal(disposals, 0);
  assert.equal(q.pendingBytes, 3360);
  ticket.ack();
  assert.equal(disposals, 1);
  assert.equal(q.pendingBytes, 0);
  q.select([req('b')]);
  q.pump();
  assert.equal(host.children.length, 0);
});
test('invalid limits and duplicate IDs reject before work; preparation failure preserves old body', () => {
  for (const options of [
    { budgetMs: 3 },
    { pageBoxes: 0 },
    { pageBoxes: 2049 },
    { maxTokensPerStep: 65 },
    { maxCacheCells: 0.5 },
  ])
    assert.throws(() => queue(options));
  const { q, host } = queue({
    pageBoxes: 4,
    preparePage: () => {
      throw new Error('probe upload failed');
    },
  });
  assert.throws(() => q.select([req(), req()]));
  q.select([req()]);
  until(q, () => q.metrics.failed === 1);
  assert.match(q.lastError, /probe upload failed/);
  assert.equal(host.children.length, 0);
  assert.equal(q.pendingBytes, 0);
  q.dispose();
});
