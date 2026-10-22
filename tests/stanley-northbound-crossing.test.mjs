import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFixture, load, THREE, geo } from '../tools/causeway-cpu.mjs';
const { conformStanleyNorthboundCrossing } = load(
  'lib/city/stanley-northbound-crossing.ts',
);
const { buildCausewayGeometry, createCausewayTriangleLookup } = load(
  'lib/city/causeway-geometry.ts',
);
const source = JSON.parse(
    fs.readFileSync(
      new URL(
        '../lib/city/stanley-northbound-crossing-source.json',
        import.meta.url,
      ),
    ),
  ),
  feature = {
    geometry: source.bundledSourceGeometry,
    properties: { id: source.way.id },
  };
const sample = (geometry, x, z) => {
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)],
      b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
      c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)],
      d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / d,
      v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / d;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001)
      return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
  }
};
function originalSquare() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-4, 2.6, -2, -4, 3.4, 2, 4, 3.4, 2, -4, 2.6, -2, 4, 3.4, 2, 4, 2.6, -2],
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
}
test('only918813454 actual road intersection changes; outer original path planes and other source buffers stay exact', () => {
  const motor = buildCausewayGeometry(
      [
        {
          a: [-1, 0],
          b: [1, 0],
          h0: 1,
          h1: 1,
          width: 2,
          s0: 0,
          s1: 2,
          sourceId: 604336388,
          routeId: 'test',
          surfaceId: 'ground',
          layer: 0,
        },
      ],
      {
        rails: false,
        paint: false,
        shoulderWidthM: 0.01,
        shoulderRiseM: 0,
        bridgeSourceIds: new Set(),
      },
    ),
    e = { data: { stanleyNorthboundExit: { geometry: motor } } },
    g = originalSquare(),
    before = Buffer.from(g.getAttribute('position').array.buffer).toString(
      'hex',
    ),
    motorBefore = JSON.stringify(motor.buffers),
    out = conformStanleyNorthboundCrossing(e, feature, g);
  assert.notEqual(out, g);
  assert.equal(sample(out, 0, 0.2), 1);
  for (const p of [
    [-3, 0.2],
    [3, -0.2],
    [0.1, 1.8],
    [0.1, -1.8],
  ])
    assert(Math.abs(sample(out, ...p) - sample(g, ...p)) < 1e-6);
  assert.equal(
    Buffer.from(g.getAttribute('position').array.buffer).toString('hex'),
    before,
  );
  assert.equal(JSON.stringify(motor.buffers), motorBefore);
  assert.equal(
    conformStanleyNorthboundCrossing(
      {},
      { ...feature, properties: { id: 918813455 } },
      g,
    ),
    g,
  );
  assert.equal(
    Buffer.from(g.getAttribute('position').array.buffer).toString('hex'),
    before,
  );
  assert.throws(
    () =>
      conformStanleyNorthboundCrossing(
        e,
        { ...feature, geometry: { type: 'LineString', coordinates: [] } },
        g,
      ),
    /bundled source changed/,
  );
  assert.throws(
    () => conformStanleyNorthboundCrossing({ data: {} }, feature, g),
    /actual exit asphalt/,
  );
  const approachFeature = {
      properties: { id: source.groundApproach.id },
      geometry: source.groundApproach.bundledSourceGeometry,
    },
    approach = conformStanleyNorthboundCrossing(e, approachFeature, g);
  assert.equal(sample(approach, 0, 0.2), 1);
  assert(Math.abs(sample(approach, 3, 0.2) - sample(g, 3, 0.2)) < 1e-6);
  assert.throws(
    () =>
      conformStanleyNorthboundCrossing(
        e,
        {
          ...approachFeature,
          geometry: { type: 'LineString', coordinates: [] },
        },
        g,
      ),
    /bundled source changed/,
  );
  approach.dispose();
  const uv = [];
  const position = g.getAttribute('position');
  for (let i = 0; i < position.count; i++)
    uv.push(position.getX(i) / 3, position.getZ(i) / 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const textured = conformStanleyNorthboundCrossing(e, feature, g),
    merged = mergeGeometries([textured, g]);
  assert(
    merged,
    'production merger accepts the replacement attribute contract',
  );
  assert.deepEqual(
    Object.keys(textured.attributes).sort(),
    Object.keys(g.attributes).sort(),
  );
  for (let i = 0; i < textured.getAttribute('position').count; i++) {
    assert(
      Math.abs(
        textured.getAttribute('uv').getX(i) -
          textured.getAttribute('position').getX(i) / 3,
      ) < 1e-6,
    );
    assert(
      Math.abs(
        textured.getAttribute('uv').getY(i) -
          textured.getAttribute('position').getZ(i) / 3,
      ) < 1e-6,
    );
  }
  merged.dispose();
  textured.dispose();
  out.dispose();
  g.dispose();
});

test('actual raw zebra/shared motor node remains at grade on rendered NB asphalt and every unrelated path is untouched', () => {
  const f = createFixture(),
    e = f.e,
    raw = JSON.parse(
      fs.readFileSync(new URL('../public/data/paths.geojson', import.meta.url)),
    ),
    original = raw.features.find((p) => p.properties.id === source.way.id),
    current = e.data.paths.features.find(
      (p) => p.properties.id === source.way.id,
    ),
    mesh = f.groundPathMeshes.find(
      (m) => m.userData.auditPathId === source.way.id,
    ),
    roads = createCausewayTriangleLookup(e.data.stanleyNorthboundExit.geometry);
  assert.deepEqual(current, original);
  assert.deepEqual(original.geometry, source.bundledSourceGeometry);
  assert.equal(mesh.userData.walkSurface, true);
  assert.equal(mesh.userData.groundPath, true);
  assert.equal(mesh.userData.protectedSurface, undefined);
  assert(source.way.nodeIds.includes(source.sharedMotorNodeId));
  assert(
    source.motorWayIds.every((id) =>
      e.data.stanleyNorthboundExit.sourceIds.includes(id),
    ),
  );
  let samples = 0,
    maxGap = 0;
  const center = geo.project([-123.136053, 49.2964582]);
  for (let x = center[0] - 3; x < center[0] + 3; x += 0.2)
    for (let z = center[1] - 2; z < center[1] + 2; z += 0.2) {
      const y = sample(mesh.geometry, x, z),
        road = roads.heightAt(x, z, { surfaceId: 'ground', layer: 0 }, 'road');
      if (y === undefined || !road) continue;
      samples++;
      maxGap = Math.max(maxGap, Math.abs(y - road.y));
    }
  const merged = mergeGeometries(f.groundPathMeshes.map((m) => m.geometry));
  assert(
    merged,
    'actual production path batch merges with the corrected crossing',
  );
  assert.equal(
    merged.getAttribute('position').count,
    f.groundPathMeshes.reduce(
      (n, m) => n + m.geometry.getAttribute('position').count,
      0,
    ),
  );
  merged.dispose();
  assert(samples > 100);
  assert(maxGap < 0.001, `actual crossing gap ${maxGap}m`);
  const protectedWalk = createCausewayTriangleLookup(f.paths.result),
    identity = source.adjacentProtectedWalk.runtimeScope;
  let walkSamples = 0;
  for (let x = -590; x <= -582; x += 0.15)
    for (let z = -1165; z <= -1157; z += 0.15) {
      const road = roads.heightAt(
          x,
          z,
          { surfaceId: 'ground', layer: 0 },
          'road',
        ),
        walk = protectedWalk.heightAt(x, z, identity, 'road');
      if (!road || !walk) continue;
      walkSamples++;
      assert(
        Math.abs(road.y - walk.y) < 0.001,
        'actual protected walk core matches the motor plane only inside their overlap',
      );
    }
  assert(walkSamples > 50);
  const oldShoulder = [-585.9500732421875, -1161.3408203125];
  assert(
    roads.heightAt(...oldShoulder, { surfaceId: 'ground', layer: 0 }, 'road'),
  );
  assert.equal(
    protectedWalk.heightAt(...oldShoulder, identity, 'shoulder'),
    undefined,
  );
  const retained = f.paths.result.surfaces.filter(
    (s) => s.sourceId === 363686510,
  );
  assert(
    retained.length &&
      retained.every(
        (s) => s.allowedModes.length === 1 && s.allowedModes[0] === 'walk',
      ),
  );
  assert(
    retained.some((s) => s.kind === 'shoulder' && s.triangles.length),
    'shoulders outside the finite motor ribbon remain physical',
  );
  const oldMotorBytes = JSON.stringify(
      e.data.stanleyNorthboundExit.geometry.buffers,
    ),
    baselinePaths = buildCausewayGeometry(f.paths.input, {
      ...f.paths.options,
      shoulderOpenings: () => [],
    });
  e.data.stanleyNorthboundRamp.conformPathGeometry(baselinePaths);
  for (const originalSegment of baselinePaths.perSegment) {
    if (originalSegment.segment.sourceId === 363686510) continue;
    const currentSegment =
      f.paths.result.perSegment[originalSegment.inputIndex];
    assert.deepEqual(
      currentSegment.asphalt,
      originalSegment.asphalt,
      'every other protected source road stays byte exact',
    );
    assert.deepEqual(
      currentSegment.shoulder,
      originalSegment.shoulder,
      'every other protected source shoulder stays byte exact',
    );
  }
  load('lib/city/stanley-northbound-crossing.ts').conformStanleyNorthboundWalk(
    e,
    baselinePaths,
  );
  assert.equal(
    JSON.stringify(e.data.stanleyNorthboundExit.geometry.buffers),
    oldMotorBytes,
    'all existing NB asphalt buffers remain untouched by both source-owned consumers',
  );
  const approachMesh = f.groundPathMeshes.find(
    (m) => m.userData.auditPathId === source.groundApproach.id,
  );
  assert(approachMesh);
  let approachSamples = 0;
  for (let x = -588; x < -582; x += 0.2)
    for (let z = -1160; z < -1147; z += 0.2) {
      const y = sample(approachMesh.geometry, x, z),
        road = roads.heightAt(x, z, { surfaceId: 'ground', layer: 0 }, 'road');
      if (y === undefined || !road) continue;
      approachSamples++;
      assert(
        Math.abs(y - road.y) < 0.001,
        'actual116 connector no longer floats above the motor continuation',
      );
    }
  assert(approachSamples > 100);
  for (const other of f.groundPathMeshes.filter(
    (m) => m !== mesh && m !== approachMesh,
  )) {
    const rawFeature = e.data.paths.features.find(
      (p) => p.properties.id === other.userData.auditPathId,
    );
    if (!rawFeature) continue;
    const p = other.geometry.getAttribute('position'),
      before = Buffer.from(
        p.array.buffer,
        p.array.byteOffset,
        p.array.byteLength,
      ).toString('hex');
    assert.equal(
      conformStanleyNorthboundCrossing(e, rawFeature, other.geometry),
      other.geometry,
    );
    assert.equal(
      Buffer.from(
        p.array.buffer,
        p.array.byteOffset,
        p.array.byteLength,
      ).toString('hex'),
      before,
    );
  }
});

test('protected363686510 keeps walk permissions and outside planes; its physical shoulder opening leaves every other identity alone', () => {
  const { conformStanleyNorthboundWalk, northboundWalkShoulderOpenings } = load(
      'lib/city/stanley-northbound-crossing.ts',
    ),
    scope = source.adjacentProtectedWalk.runtimeScope,
    segment = {
      a: [-4, 0],
      b: [4, 0],
      h0: 3,
      h1: 3,
      width: 4,
      s0: 0,
      s1: 8,
      sourceId: 363686510,
      ...scope,
    },
    paths = buildCausewayGeometry(
      [
        segment,
        {
          ...segment,
          a: [-4, 7],
          b: [4, 7],
          sourceId: 363686511,
          routeId: 'other-walk',
        },
      ],
      {
        rails: false,
        paint: false,
        bridgeSourceIds: new Set(),
        allowedModes: () => ['walk'],
      },
    ),
    main = buildCausewayGeometry(
      [
        {
          ...segment,
          a: [0, -3],
          b: [0, 3],
          h0: 1,
          h1: 1,
          width: 2,
          sourceId: 604336388,
          surfaceId: 'ground',
          layer: 0,
        },
      ],
      {
        rails: false,
        paint: false,
        shoulderWidthM: 0.01,
        shoulderRiseM: 0,
        bridgeSourceIds: new Set(),
      },
    ),
    engine = {
      data: {
        paths: {
          features: [
            {
              properties: { id: 363686510 },
              geometry: source.adjacentProtectedWalk.bundledSourceGeometry,
            },
          ],
        },
        stanleyNorthboundExit: {
          geometry: main,
          segments: [
            { ...segment, a: [0, -3], b: [0, 3], width: 2, s0: 0, s1: 8 },
          ],
        },
      },
    },
    unrelated = paths.perSegment[1].asphalt.slice(),
    shoulder = paths.buffers.shoulder.slice(),
    original = createCausewayTriangleLookup(structuredClone(paths));
  conformStanleyNorthboundWalk(engine, paths);
  const lookup = createCausewayTriangleLookup(paths);
  assert(Math.abs(lookup.heightAt(0, 0, scope, 'road').y - 1) < 1e-6);
  assert.equal(
    lookup.heightAt(3, 0, scope, 'road').y,
    original.heightAt(3, 0, scope, 'road').y,
  );
  assert.deepEqual(paths.perSegment[1].asphalt, unrelated);
  assert.deepEqual(paths.buffers.shoulder, shoulder);
  assert(
    paths.surfaces.every(
      (s) => s.allowedModes.length === 1 && s.allowedModes[0] === 'walk',
    ),
  );
  const good = { ...scope, sourceId: 363686510 };
  assert(northboundWalkShoulderOpenings(engine, good).length);
  for (const bad of [
    { ...good, sourceId: 363686511 },
    { ...good, layer: 0 },
    { ...good, routeId: 'other' },
    { ...good, surfaceId: 'lions:road' },
  ])
    assert.deepEqual(northboundWalkShoulderOpenings(engine, bad), []);
});
