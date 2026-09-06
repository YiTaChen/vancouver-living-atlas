import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const encode = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function compile(source, replacements = {}) {
  for (const [from, to] of Object.entries(replacements))
    source = source.replaceAll(`'${from}'`, `'${to}'`);
  return encode(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  );
}
const geoUrl = compile(read('../lib/city/geo.ts'));
const pathUrl = compile(read('../lib/city/rail-path.ts'), {
  three: import.meta.resolve('three'),
  './geo': geoUrl,
});
const railUrl = compile(read('../lib/city/railway.ts'), {
  three: import.meta.resolve('three'),
  'three/addons/utils/BufferGeometryUtils.js': import.meta
    .resolve('three/addons/utils/BufferGeometryUtils.js'),
  './rail-path': pathUrl,
});
const { RailPath, makeRailPath, carriageOpacity, trainHeadDistance } =
  await import(pathUrl);
const { createRailway, updateRailway, SteamPlume } = await import(railUrl);
const data = JSON.parse(read('../public/data/railways.json'));
const terrain = JSON.parse(read('../public/data/terrain.json'));
const engineSource = read('../lib/city/engine.ts'),
  ast = ts.createSourceFile(
    'engine.ts',
    engineSource,
    ts.ScriptTarget.Latest,
    true,
  );
const engineClass = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CityEngine',
);
const methods = engineClass.members
  .filter(
    (n) =>
      ts.isMethodDeclaration(n) &&
      ['elevation', 'focusTrain', 'completeLocalMapTransition'].includes(
        n.name.getText(ast),
      ),
  )
  .map((n) => n.getText(ast));
const { EngineMethods } = await import(
  compile(
    `import * as THREE from 'three';import {unproject} from './geo';import {updateRailway} from './railway';import {finishLocalMapTransition} from './local-map-camera';export class EngineMethods {${methods.join('\n')}}`,
    {
      three: import.meta.resolve('three'),
      './geo': geoUrl,
      './railway': railUrl,
      './local-map-camera': cityModule('local-map-camera'),
    },
  )
);
const engine = Object.assign(new EngineMethods(), {
  data: { elevation: terrain, railways: data },
  scene: new THREE.Scene(),
  settings: { quality: 'high', trains: true, mode: 'orbit' },
});
const railway = createRailway(engine);
engine.railway = railway;
const near = (a, b, epsilon = 1e-6) =>
  assert(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('mapped rail corridors preserve attribution, open-air topology and both SkyTrain directions', () => {
  assert.equal(data.routes.length, 3);
  assert.equal(data.license, 'ODbL-1.0');
  assert.equal(data.routes.filter((r) => r.kind === 'steam').length, 1);
  assert.equal(data.routes.filter((r) => r.kind === 'skytrain').length, 2);
  for (const route of data.routes) {
    assert(route.sourceIds.length > 0);
    assert(route.coordinates.length > 20);
    assert(route.lengthM > 800);
    assert.equal(route.maxJoinGapM, 0);
    assert.equal(route.loop, false);
    for (const s of route.segments) {
      assert(!s.tunnel && !s.covered);
      if (route.kind === 'skytrain') assert(s.bridge);
    }
    assert.equal(route.smokeAllowed, route.kind === 'steam');
  }
});
test('rail profile stays above terrain with gentle grades and finite alignment samples', () => {
  for (const route of data.routes) {
    const path = makeRailPath(route, (x, z) => engine.elevation(x, z));
    assert(Math.abs(path.length - route.lengthM) < route.lengthM * 0.02);
    for (let i = 0; i < path.points.length; i++) {
      const p = path.points[i];
      assert(Number.isFinite(p.x + p.y + p.z));
      assert(p.y >= engine.elevation(p.x, p.z) + route.clearance + 0.64);
      if (i) {
        const prev = path.points[i - 1];
        assert(
          Math.abs(p.y - prev.y) / Math.hypot(p.x - prev.x, p.z - prev.z) <
            (route.kind === 'steam' ? 0.0251 : 0.0551),
        );
      }
    }
  }
});
test('arc-length sampling preserves car spacing through corners and slopes', () => {
  const path = new RailPath([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 3, 100),
    new THREE.Vector3(100, 6, 100),
  ]);
  near(path.sample(0).length(), 0);
  near(path.sample(path.length).distanceTo(new THREE.Vector3(100, 6, 100)), 0);
  for (let d = 30; d < path.length; d += 5)
    assert(path.sample(d).distanceTo(path.sample(d - 20)) <= 20.0001);
  const train = railway.trains[0];
  for (let i = 1; i < train.cars.length; i++)
    near(
      train.cars[i].offset - train.cars[i - 1].offset,
      (train.cars[i].length + train.cars[i - 1].length) / 2 + 0.8,
    );
});
test('the whole consist clears an open endpoint before the next pass; no individual car wrapping', () => {
  const length = 1100,
    consist = 108,
    speed = 11,
    phase = 0;
  const span = length + consist + 100,
    endTime = span / speed;
  const before = trainHeadDistance(
      endTime - 0.0001,
      speed,
      length,
      consist,
      phase,
    ),
    after = trainHeadDistance(endTime + 0.0001, speed, length, consist, phase);
  for (const offset of [0, 12, 28, 49, 70, 91]) {
    near(carriageOpacity(before - offset, length, 10), 0);
    near(carriageOpacity(after - offset, length, 10), 0);
  }
  near(carriageOpacity(500, length, 10), 1);
  near(carriageOpacity(-20, length, 10), 0);
});
test('real rolling stock moves with stable spacing at 30 and 60 FPS, independent of scene time', () => {
  function run(fps) {
    railway.elapsed = 0;
    for (let i = 0; i < fps * 2; i++) updateRailway(engine, railway, 1 / fps);
    return railway.trains.map((t) => t.cars[0].group.position.clone());
  }
  const a = run(30),
    b = run(60);
  a.forEach((p, i) => near(p.distanceTo(b[i]), 0));
  const before = railway.trains[0].head;
  engine.clock = { hour: 23, rate: 300, running: false };
  updateRailway(engine, railway, 1 / 60);
  near(railway.trains[0].head - before, 11 / 60);
  const time = railway.elapsed;
  updateRailway(engine, railway, 3600);
  near(railway.elapsed - time, 0.1);
});
test('smoke is emitted in world space, rises and fades, stays bounded and stops emitting at rest', () => {
  const smoke = new SteamPlume(),
    emitter = new THREE.Vector3(10, 5, 20),
    forward = new THREE.Vector3(0, 0, 1);
  smoke.update(0.05, emitter, forward, true);
  const first = smoke.emitted;
  assert.equal(first, 1);
  assert(smoke.positions[1] > 5);
  emitter.set(1000, 1000, 1000);
  smoke.update(0.02, null, forward, true);
  assert.equal(smoke.emitted, first);
  assert(smoke.positions[0] < 11);
  assert(smoke.positions[1] < 6);
  for (let i = 0; i < 400; i++) smoke.update(1 / 60, null, forward, true);
  assert(smoke.alphas.every((a) => a === 0));
  for (let i = 0; i < 1200; i++) smoke.update(1 / 60, emitter, forward, true);
  assert.equal(smoke.mesh.geometry.instanceCount, 96);
  assert.equal(smoke.positions.length, 288);
  assert.equal(smoke.mesh.material.depthWrite, false);
  assert.equal(smoke.mesh.material.depthTest, true);
  assert.equal(smoke.mesh.castShadow, false);
});
test('animation reuses geometry and material resources, with no cached moving shadows', () => {
  const inventory = () => {
    const g = new Set(),
      m = new Set();
    railway.group.traverse((o) => {
      if (o.geometry) g.add(o.geometry);
      if (o.material) m.add(o.material);
    });
    return { g, m };
  };
  const before = inventory();
  for (let i = 0; i < 300; i++) updateRailway(engine, railway, 1 / 60);
  const after = inventory();
  assert.deepEqual(after, before);
  for (const train of railway.trains)
    for (const car of train.cars) {
      assert.equal(car.body.castShadow, false);
      assert.equal(car.wheels.count, 8);
      assert(car.body.geometry.attributes.position.count > 0);
      assert(
        car.body.geometry.attributes.position.array.every(Number.isFinite),
      );
      assert(Number.isFinite(car.group.position.length()));
    }
});
test('find-train action exits street placement and exposes the current train without resetting time', () => {
  const calls = [];
  engine.placement = { cancel: () => calls.push('cancel') };
  engine.navigation = { setMode: (m) => calls.push(m) };
  engine.camera = new THREE.PerspectiveCamera();
  engine.camera.position.set(0, 100, 200);
  engine.controls = { target: new THREE.Vector3() };
  const elapsed = railway.elapsed;
  engine.settings.trains = false;
  railway.group.visible = false;
  engine.focusTrain('steam');
  assert.deepEqual(calls, ['cancel', 'orbit']);
  assert.equal(engine.settings.trains, true);
  assert.equal(railway.group.visible, true);
  near(railway.elapsed, elapsed);
  assert(
    engine.transition.to.distanceTo(railway.trains[0].cars[0].group.position) <
      180,
  );
  const train = railway.trains[0];
  train.phase =
    (train.path.length + train.length + 50 - railway.elapsed * train.speed) /
    (train.path.length + train.length + 100);
  updateRailway(engine, railway, 0);
  train.cars.forEach((c) => {
    c.group.visible = false;
  });
  engine.focusTrain('steam');
  assert(train.cars[0].group.visible);
  near(railway.elapsed, elapsed);
});

if (process.env.EXPORT_RAIL_PATHS) {
  const routes = data.routes.map((r, i) => ({
    id: r.id,
    kind: r.kind,
    coordinates: railway.trains[i].path.points.map((p) => [p.x, p.y, p.z]),
  }));
  writeFileSync(process.env.EXPORT_RAIL_PATHS, JSON.stringify({ routes }));
}

test('wheel pairs stay centred on the rail gauge through actual bends and grades', () => {
  const left = new THREE.Vector3(),
    right = new THREE.Vector3(),
    matrix = new THREE.Matrix4();
  for (const elapsed of [0, 8, 16, 24, 32]) {
    railway.elapsed = elapsed;
    updateRailway(engine, railway, 0);
    for (const train of railway.trains)
      for (const car of train.cars) {
        if (!car.group.visible) continue;
        car.group.updateMatrixWorld(true);
        for (let i = 0; i < car.wheelPositions.length; i += 2) {
          car.wheels.getMatrixAt(i, matrix);
          matrix.premultiply(car.wheels.matrixWorld);
          left.setFromMatrixPosition(matrix);
          car.wheels.getMatrixAt(i + 1, matrix);
          matrix.premultiply(car.wheels.matrixWorld);
          right.setFromMatrixPosition(matrix);
          near(left.distanceTo(right), 1.64, 1e-4);
          const midpoint = left.add(right).multiplyScalar(0.5);
          const railPoint = train.path.sample(
            train.head - car.offset + car.wheelPositions[i].z,
          );
          near(midpoint.distanceTo(railPoint), car.wheelRadius + 0.02, 1e-4);
        }
      }
  }
});
test('endpoint fading drops depth writing and marks vehicle meshes for dynamic AO exclusion', () => {
  const train = railway.trains[0],
    span = train.path.length + train.length + 100;
  train.phase =
    (train.cars[0].length / 2 + 12 + 40 - railway.elapsed * train.speed) / span;
  updateRailway(engine, railway, 0);
  const car = train.cars[0];
  for (const material of car.materials) {
    assert(material.opacity > 0 && material.opacity < 1);
    assert(material.transparent);
    assert(!material.depthWrite);
  }
  for (const mesh of [car.body, car.windows, car.wheels])
    assert(mesh.userData.railVehicle);
  train.phase =
    (train.path.length * 0.4 + 40 - railway.elapsed * train.speed) / span;
  updateRailway(engine, railway, 0);
  for (const material of car.materials) {
    near(material.opacity, 1);
    assert(!material.transparent);
    assert(material.depthWrite);
  }
});
