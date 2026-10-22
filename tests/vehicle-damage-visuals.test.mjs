import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { VehicleDamageVisuals } = await import(
  cityModule('vehicle-damage-visuals')
);
const { createTeslaRoadster } = await import(
  cityModule('assets/tesla-roadster')
);
const { makeRoadster } = await import(cityModule('assets/roadster'));

function fixture() {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), material);
  body.position.y = 0.75;
  root.add(body);
  const effects = new VehicleDamageVisuals(root);
  const front = {
    localPoint: [0, 0.75, 2],
    localNormal: [0, 0, 1],
    severity: 0.8,
    scrape: false,
  };
  return { root, body, material, effects, front };
}

test('front impact attaches finite marks and an inward dent to the actual body while leaving shared source data untouched', () => {
  const { root, body, material, effects, front } = fixture();
  const original = body.geometry;
  const positions = Array.from(original.getAttribute('position').array);
  const materialVersion = material.version;
  const other = new THREE.Mesh(original, material);
  assert.equal(effects.record(front), true);
  assert.notEqual(body.geometry, original);
  assert.equal(other.geometry, original);
  assert.deepEqual(
    Array.from(original.getAttribute('position').array),
    positions,
  );
  assert.equal(material.version, materialVersion);
  assert.ok(effects.stats().dentedVertices > 0);
  const p = body.geometry.getAttribute('position');
  let movedFront = 0;
  for (let i = 0; i < p.count; i++) {
    assert.ok([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite));
    if (
      Math.abs(p.getX(i)) < 0.3 &&
      Math.abs(p.getY(i)) < 0.3 &&
      p.getZ(i) > 1.8 &&
      p.getZ(i) < 1.999
    )
      movedFront++;
    assert.ok(p.getZ(i) <= 2.000001 && p.getZ(i) >= -2.000001);
  }
  assert.ok(movedFront > 0);
  const marks = effects.group.children[0].geometry.getAttribute('position');
  assert.ok(marks.count > 0);
  for (let i = 0; i < marks.count; i++) {
    assert.ok(Math.abs(marks.getX(i)) < 0.5);
    assert.ok(marks.getY(i) > 0.3 && marks.getY(i) < 1.2);
    assert.ok(marks.getZ(i) > 1.8 && marks.getZ(i) < 2.01);
  }
  assert.equal(effects.stats().draws, 1);
  assert.equal(effects.stats().textures, 0);
  effects.dispose();
  assert.equal(body.geometry, original);
  assert.ok(root.children.includes(body));
});

test('scrape stays on the struck side and never paints the opposite body face', () => {
  const { effects, body } = fixture();
  assert.equal(
    effects.record({
      localPoint: [1, 0.65, 0],
      localNormal: [1, 0, 0],
      severity: 0.6,
      scrape: true,
    }),
    true,
  );
  const marks = effects.group.children[0].geometry.getAttribute('position');
  assert.ok(marks.count > 0);
  for (let i = 0; i < marks.count; i++) {
    assert.ok(marks.getX(i) > 0.9);
    assert.ok(Math.abs(marks.getZ(i)) < 0.6);
  }
  assert.ok(effects.stats().dentedVertices > 0);
  const p = body.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (p.getX(i) < 0) assert.equal(p.getX(i), -1);
  effects.dispose();
});

test('damage remains in the root frame when the car rotates, translates or climbs a wall', () => {
  const { effects, root, front } = fixture();
  root.position.set(1000, 80, -400);
  root.rotation.set(0.8, 1.3, Math.PI / 2);
  assert.equal(effects.record(front), true);
  const p = effects.group.children[0].geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(p.getX(i)) < 0.5);
    assert.ok(p.getZ(i) > 1.8 && p.getZ(i) < 2.01);
  }
  const before = Array.from(p.array);
  root.position.set(-40, 10, 15);
  root.rotation.set(-0.2, 0.1, -0.5);
  effects.update(1 / 60);
  assert.deepEqual(Array.from(p.array), before);
  effects.dispose();
});

test('LOD refresh replays retained marks onto the visible mesh and ignores hidden tiers', () => {
  const { root, body, effects, front, material } = fixture();
  const alternate = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 4, 6, 4, 8),
    material,
  );
  alternate.position.y = 0.75;
  alternate.visible = false;
  root.add(alternate);
  const untouched = alternate.geometry;
  assert.equal(effects.record(front), true);
  assert.equal(alternate.geometry, untouched);
  body.visible = false;
  alternate.visible = true;
  effects.refresh();
  assert.notEqual(alternate.geometry, untouched);
  assert.equal(effects.stats().marks, 1);
  assert.ok(effects.stats().dentedVertices > 0);
  assert.ok(effects.stats().triangles > 0);
  effects.reset();
  assert.equal(alternate.geometry, untouched);
  assert.equal(effects.stats().marks, 0);
  assert.equal(effects.stats().draws, 0);
  assert.equal(effects.stats().ownedMeshes, 0);
  effects.dispose();
});

test('cockpit-hidden root still records damage on its selected visible body model', () => {
  const { root, effects, front } = fixture();
  root.visible = false;
  assert.equal(effects.record(front), true);
  assert.equal(effects.stats().marks, 1);
  assert.ok(effects.stats().dentedVertices > 0);
  effects.dispose();
});

test('native Drive tree impact snaps the actual26.1cm hull-to-low-bumper gap onto real roadster paint', () => {
  const root = new THREE.Group();
  const model = makeRoadster();
  root.add(model.group);
  const effects = new VehicleDamageVisuals(root);
  assert.equal(
    effects.record({
      localPoint: [-0.053355, 0.703842, 2.4],
      localNormal: [0, 0, 1],
      severity: 0.21036,
      scrape: false,
    }),
    true,
  );
  const stats = effects.stats();
  assert.equal(stats.marks, 1);
  assert.ok(stats.dentedVertices > 0);
  assert.ok(stats.triangles > 0);
  assert.equal(stats.draws, 1);
  const p = effects.group.children[0].geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(p.getX(i)) < 0.5);
    assert.ok(p.getY(i) < 0.7 && p.getY(i) > 0.2);
    assert.ok(p.getZ(i) < 2.27 && p.getZ(i) > 2.0);
  }
  effects.dispose();
});

test('actual native Tesla trim hit dents allLODs without seam separation, inverted faces, cumulative refinement or source mutation', () => {
  // Native capture impact-tesla-8-1792657836403.json. The model sits68cm
  // below the physical pose centre; severity yields3.8690033273% panel damage.
  const mark = {
    localPoint: [-0.26291411131192854, -0.032232134698179295, 2.34],
    localNormal: [0, 0, 1],
    severity: 0.1852252169188094,
    scrape: false,
  };
  for (const quality of ['low', 'medium', 'high']) {
    const root = new THREE.Group(),
      baselineRoot = new THREE.Group(),
      model = createTeslaRoadster({ quality }),
      baseline = createTeslaRoadster({ quality });
    model.group.position.y = baseline.group.position.y = -0.68;
    root.add(model.group);
    baselineRoot.add(baseline.group);
    const body = model.group.getObjectByName('body:titanium'),
      original = body.geometry,
      originalPositions = Array.from(original.getAttribute('position').array),
      effects = new VehicleDamageVisuals(root),
      noDent = new VehicleDamageVisuals(baselineRoot, { maxDentDepthM: 0 });
    assert.equal(effects.record(mark), true, quality);
    assert.equal(noDent.record(mark), true, quality);
    const stats = effects.stats();
    assert.ok(stats.dentedVertices > 0, quality);
    assert.ok(stats.triangles > 0, quality);
    assert.ok(
      stats.refinedTriangles > 0 &&
        stats.refinedTriangles <= stats.maximumRefinedMeshTriangles,
    );
    assert.ok(stats.refinedVertices <= stats.maximumRefinedMeshVertices);
    assert.equal(body.geometry.index === null, original.index === null);
    assert.deepEqual(
      Array.from(original.getAttribute('position').array),
      originalPositions,
    );
    const plain = baseline.group.getObjectByName('body:titanium').geometry,
      p = body.geometry.getAttribute('position'),
      base = plain.getAttribute('position'),
      index = body.geometry.index,
      positions = Array.from(p.array),
      same = new Map();
    assert.equal(p.count, base.count);
    for (let i = 0; i < p.count; i++) {
      const key = [base.getX(i), base.getY(i), base.getZ(i)].join(','),
        actual = [p.getX(i), p.getY(i), p.getZ(i)];
      assert.ok(actual.every(Number.isFinite));
      if (same.has(key))
        assert.deepEqual(actual, same.get(key), `${quality}:coincident seam`);
      else same.set(key, actual);
    }
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      oldNormal = new THREE.Vector3(),
      newNormal = new THREE.Vector3(),
      edge = new THREE.Vector3();
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      const ia = index ? index.getX(i) : i,
        ib = index ? index.getX(i + 1) : i + 1,
        ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(base, ia);
      b.fromBufferAttribute(base, ib);
      c.fromBufferAttribute(base, ic);
      oldNormal.subVectors(b, a).cross(edge.subVectors(c, a));
      if (oldNormal.lengthSq() < 1e-18) continue;
      a.fromBufferAttribute(p, ia);
      b.fromBufferAttribute(p, ib);
      c.fromBufferAttribute(p, ic);
      newNormal.subVectors(b, a).cross(edge.subVectors(c, a));
      assert.ok(
        oldNormal.dot(newNormal) > oldNormal.lengthSq() * 0.05,
        `${quality}:face${i / 3}`,
      );
    }
    for (let i = 0; i < 8; i++) effects.refresh();
    assert.equal(effects.stats().refinedVertices, stats.refinedVertices);
    assert.equal(effects.stats().refinedTriangles, stats.refinedTriangles);
    assert.deepEqual(
      Array.from(body.geometry.getAttribute('position').array),
      positions,
    );
    effects.reset();
    assert.equal(body.geometry, original);
    assert.equal(effects.stats().refinedVertices, 0);
    effects.dispose();
    noDent.dispose();
    model.dispose();
    baseline.dispose();
  }
});

test('local refinement preserves indexed groups, drawRange, normalized colors and custom attributes with hard budgets', () => {
  const { body, effects, front } = fixture(),
    original = body.geometry,
    count = original.getAttribute('position').count,
    colors = new THREE.Uint8BufferAttribute(
      new Uint8Array(count * 3).fill(183),
      3,
      true,
    ),
    custom = new THREE.Float32BufferAttribute(
      Float32Array.from({ length: count }, (_, i) => i / count),
      1,
    );
  original.setAttribute('color', colors);
  original.setAttribute('customImpactUv', custom);
  original.setDrawRange(24, 6); // BoxGeometry's front materialgroup only.
  const groups = structuredClone(original.groups),
    index = Array.from(original.index.array),
    customValues = Array.from(custom.array);
  assert.equal(effects.record(front), true);
  const damaged = body.geometry;
  assert.ok(damaged.index);
  assert.equal(damaged.groups.length, groups.length);
  assert.deepEqual(
    damaged.groups.map((group) => group.materialIndex),
    groups.map((group) => group.materialIndex),
  );
  assert.equal(damaged.drawRange.start, 24);
  assert.ok(damaged.drawRange.count > 6);
  assert.equal(damaged.drawRange.count, damaged.groups[4].count);
  for (const [name, attribute] of Object.entries(damaged.attributes)) {
    assert.equal(attribute.count, damaged.getAttribute('position').count, name);
    assert.ok(Array.from(attribute.array).every(Number.isFinite), name);
  }
  assert.equal(damaged.getAttribute('color').normalized, true);
  assert.ok(damaged.getAttribute('color').array instanceof Uint8Array);
  assert.deepEqual(
    Array.from(damaged.getAttribute('customImpactUv').array).slice(0, count),
    customValues,
  );
  for (let i = 0; i < 30; i++)
    effects.record({ ...front, localPoint: [((i % 3) - 1) * 0.2, 0.75, 2] });
  const stats = effects.stats();
  assert.ok(stats.refinedVertices <= stats.maximumRefinedMeshVertices);
  assert.ok(stats.refinedTriangles <= stats.maximumRefinedMeshTriangles);
  assert.ok(stats.refinedVertices <= stats.maximumRefinedVertices);
  assert.ok(stats.refinedTriangles <= stats.maximumRefinedTriangles);
  assert.ok(
    stats.refinementHistoryEntries <= stats.ownedMeshes * stats.capacity,
  );
  effects.reset();
  assert.equal(body.geometry, original);
  assert.deepEqual(original.groups, groups);
  assert.deepEqual(Array.from(original.index.array), index);
  assert.deepEqual(
    Array.from(original.getAttribute('customImpactUv').array),
    customValues,
  );
  assert.deepEqual(original.drawRange, { start: 24, count: 6 });
  effects.dispose();
});

test('interior-only impact refinement preserves a closed box edge union without T-junction cracks', () => {
  const { body, effects, front } = fixture();
  assert.equal(effects.record({ ...front, severity: 1 }), true);
  const p = body.geometry.getAttribute('position'),
    index = body.geometry.index,
    edges = new Map(),
    key = (i) =>
      [p.getX(i), p.getY(i), p.getZ(i)]
        .map((value) => Math.round(value * 1e6))
        .join(',');
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const vertices = [0, 1, 2].map((j) =>
      key(index ? index.getX(i + j) : i + j),
    );
    for (let j = 0; j < 3; j++) {
      const pair = [vertices[j], vertices[(j + 1) % 3]].sort().join('|');
      edges.set(pair, (edges.get(pair) ?? 0) + 1);
    }
  }
  assert.ok(edges.size > 18);
  for (const [edge, count] of edges) assert.equal(count, 2, edge);
  effects.dispose();
});

test('adversarial dense impact patches exhaust but never exceed per-mesh or whole-car triangle/vertex budgets', () => {
  const root = new THREE.Group(),
    bodies = [],
    originals = [],
    material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 8; i++) {
    const geometry = new THREE.BufferGeometry(),
      positions = [];
    for (let j = 0; j < 200; j++) positions.push(-4, -4, 2, 4, -4, 2, 0, 4, 2);
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = i * 12;
    root.add(mesh);
    bodies.push(mesh);
    originals.push(geometry);
  }
  const effects = new VehicleDamageVisuals(root);
  for (let i = 0; i < bodies.length; i++)
    assert.equal(
      effects.record({
        localPoint: [i * 12, 0.75, 2],
        localNormal: [0, 0, 1],
        severity: 1,
        scrape: false,
      }),
      true,
    );
  const stats = effects.stats();
  assert.equal(stats.refinedTriangles, stats.maximumRefinedTriangles);
  assert.equal(stats.refinedVertices, stats.maximumRefinedVertices);
  for (let i = 0; i < bodies.length; i++) {
    const added =
      bodies[i].geometry.getAttribute('position').count -
      originals[i].getAttribute('position').count;
    assert.ok(added <= stats.maximumRefinedMeshVertices);
    assert.ok(added / 3 <= stats.maximumRefinedMeshTriangles);
    assert.equal(bodies[i].geometry.index, null);
  }
  effects.reset();
  for (let i = 0; i < bodies.length; i++)
    assert.equal(bodies[i].geometry, originals[i]);
  effects.dispose();
});

test('real Tesla Low/Medium/High bodies preserve localized damage through all cached quality switches', () => {
  const root = new THREE.Group();
  const model = createTeslaRoadster({ quality: 'low' });
  root.add(model.group);
  const effects = new VehicleDamageVisuals(root);
  assert.equal(
    effects.record({
      localPoint: [0.55, 0.48, 2.27],
      localNormal: [0, 0, 1],
      severity: 0.85,
      scrape: false,
    }),
    true,
  );
  for (const quality of ['medium', 'high', 'low', 'high']) {
    model.setQuality(quality);
    effects.refresh();
    assert.equal(effects.stats().marks, 1);
    assert.ok(effects.stats().dentedVertices > 0, quality);
    assert.ok(effects.stats().triangles > 0, quality);
    assert.equal(effects.stats().draws, 1);
  }
  effects.dispose();
  model.dispose();
});

test('history and resources are bounded, idle updates do no scans or uploads, and reset restores geometry identity', () => {
  const { root, body, effects, front } = fixture();
  const original = body.geometry;
  for (let i = 0; i < 30; i++)
    assert.equal(
      effects.record({
        ...front,
        localPoint: [((i % 3) - 1) * 0.1, 0.75, 2],
        seed: i,
      }),
      true,
    );
  assert.equal(effects.stats().marks, 20);
  assert.equal(effects.stats().draws, 1);
  assert.ok(effects.stats().ownedMeshes <= effects.stats().maximumOwnedMeshes);
  assert.ok(effects.stats().triangles <= effects.stats().maximumTriangles);
  const before = effects.stats();
  const version = body.geometry.getAttribute('position').version;
  root.traverseVisible = () => {
    throw new Error('idle scene traversal');
  };
  for (let i = 0; i < 120; i++) effects.update(1 / 60);
  assert.deepEqual(effects.stats(), before);
  assert.equal(body.geometry.getAttribute('position').version, version);
  effects.reset();
  assert.equal(body.geometry, original);
  assert.equal(effects.stats().draws, 0);
  effects.dispose();
});

test('missed, zero, non-finite, glass and wheel impacts do not invent body damage', () => {
  const { root, effects, front } = fixture();
  for (const event of [
    { ...front, severity: 0 },
    { ...front, severity: NaN },
    { ...front, localPoint: [NaN, 0, 0] },
    { ...front, localPoint: [100, 100, 100] },
    { ...front, localNormal: [0, 0, 0] },
    { ...front, localNormal: [Infinity, 0, 1] },
  ])
    assert.equal(effects.record(event), false);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ transparent: true }),
  );
  glass.position.set(5, 1, 0);
  root.add(glass);
  assert.equal(effects.record({ ...front, localPoint: [5, 1, 0.5] }), false);
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.3),
    new THREE.MeshStandardMaterial(),
  );
  wheel.position.set(-5, 1, 0);
  root.add(wheel);
  assert.equal(effects.record({ ...front, localPoint: [-5, 1, 0] }), false);
  assert.equal(effects.stats().marks, 0);
  effects.dispose();
});

test('dispose releases only owned resources once and does not dispose shared vehicle assets', () => {
  const { root, body, material, effects, front } = fixture();
  const original = body.geometry;
  let originalDisposals = 0,
    materialDisposals = 0,
    ownedDisposals = 0;
  original.addEventListener('dispose', () => originalDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  effects.record(front);
  body.geometry.addEventListener('dispose', () => ownedDisposals++);
  effects.dispose();
  effects.dispose();
  assert.equal(ownedDisposals, 1);
  assert.equal(originalDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(body.geometry, original);
  assert.equal(root.children.includes(effects.group), false);
  assert.equal(effects.record(front), false);
});
