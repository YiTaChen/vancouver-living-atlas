import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const { project, rings, unproject } = await import(cityModule('geo'));
const { WaterWorld, lakeSurfaces, waveHeight } = await import(
  cityModule('water-world')
);
const { advanceBoat, initialBoatState } = await import(
  cityModule('boat-physics')
);
const { HarbourPath, harbourVisible } = await import(
  cityModule('harbour-path')
);
const { createHarbour, updateHarbour } = await import(cityModule('harbour'));
const { createLandmarks } = await import(cityModule('landmarks'));
const { finishLocalMapTransition } = await import(
  cityModule('local-map-camera')
);
const { BoatController } = await import(cityModule('boat-controller'));
const { addSailingWaves } = await import(cityModule('water-waves'));
const source = read('lib/city/engine.ts'),
  ast = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CityEngine',
);
const methods = cls.members
  .filter(
    (n) =>
      ts.isMethodDeclaration(n) &&
      ['elevation', 'rawElevation', 'focusHarbour', 'completeLocalMapTransition'].includes(
        n.name.getText(ast),
      ),
  )
  .map((n) => n.getText(ast));
const methodCode = ts.transpileModule(
  `export class Methods {${methods.join('\n')}}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const Methods = new Function(
  'THREE',
  'unproject',
  'updateHarbour',
  'finishLocalMapTransition',
  methodCode.replace('export class Methods', 'return class Methods'),
)(THREE, unproject, updateHarbour, finishLocalMapTransition);
const data = Object.fromEntries(
  ['land', 'context-land', 'context', 'buildings'].map((n) => [
    n,
    json('public/data/' + n + '.geojson'),
  ]),
);
data.elevation = json('public/data/terrain.json');
data.bridges = json('public/data/bridges.json');
for (const n of ['harbour-sites', 'harbour-piers', 'harbour-routes'])
  data[n] = json('public/data/' + n + '.json');
const land = data.land.features.flatMap((f) =>
  rings(f).map((p) => p.map((r) => r.map(project))),
);
const e = Object.assign(new Methods(), {
  data,
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(45, 1.4, 0.1, 40000),
  renderer: { domElement: { clientHeight: 900 } },
  controls: { target: new THREE.Vector3(), enabled: true },
  settings: { harbour: true, mode: 'orbit' },
  uniforms: { time: { value: 0 }, night: { value: 0 } },
  landmarkDetails: [],
});
e.camera.position.set(600, 650, 1500);
e.landmarks = new THREE.Group();
createLandmarks(e);
e.waterWorld = new WaterWorld(
  land,
  data['context-land'],
  lakeSurfaces(data.context, (x, z) => e.elevation(x, z)),
  data.buildings,
  json('lib/city/landmark-footprints.json'),
);
for (const poly of data.solidWaterFootprints || [])
  e.waterWorld.addObstacle(poly);
e.onLand = (x, z) => !e.waterWorld.at(x, z);
e.harbour = createHarbour(e);
const empty = { features: [] };
const square = (x0, z0, x1, z1) => [
  [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
    [x0, z0],
  ],
];
const artificial = new WaterWorld(
  [square(-100, -100, 100, 100)],
  empty,
  [],
  empty,
  empty,
);
const input = { thrust: 1, turn: 0, neutral: false };
const simulate = (state, seconds, input, world, dt = 1 / 60) => {
  for (let t = 0; t < seconds - dt / 2; t += dt)
    advanceBoat(state, input, dt, world);
  return state;
};
const freeWorld = {
  at: () => ({ kind: 'sea', id: 'sea', level: 0.1 }),
  canOccupy: () => true,
};

test('water registry preserves real lake levels, rejects city land and aquarium pools, and supplies clear presets', () => {
  for (const id of ['coal-harbour', 'false-creek', 'lost-lagoon', 'beaver']) {
    const p = e.waterWorld.start(id);
    assert(p, id);
    assert(e.waterWorld.canOccupy(p.x, p.z, 0, p.surface.id));
    assert(p.surface.level > 0);
    if (id === 'lost-lagoon') assert(Math.abs(p.surface.level - 3.2) < 0.05);
    if (id === 'beaver') assert(Math.abs(p.surface.level - 11.2) < 0.1);
  }
  assert.equal(e.waterWorld.at(...project([-123.12, 49.282])), null);
  assert.equal(e.waterWorld.at(...project([-123.5, 49.28])), null);
  const pools = e.waterWorld.surfaces.filter((s) => !s.navigable);
  assert(pools.length > 5);
  assert(
    !e.waterWorld.canOccupy(...project([-123.095012, 49.31317]), 0, 'sea'),
    'hull cannot cross regional land at study seam',
  );
  assert(
    e.waterWorld.canOccupy(...project([-123.148, 49.318]), 0, 'sea'),
    'regional open water remains navigable',
  );
});
test('whole-hull shore clearance blocks bow, sides, rotation and thin pier edges while keeping a safe pose', () => {
  assert(artificial.canOccupy(0, -104.2, 0, 'sea'));
  assert(!artificial.canOccupy(0, -103, 0, 'sea'));
  assert(artificial.canOccupy(0, -103, Math.PI / 2, 'sea'));
  const state = { ...initialBoatState(), x: 0, z: -110, yaw: 0 };
  simulate(state, 20, input, artificial);
  assert(state.z < -103.7);
  assert(artificial.canOccupy(state.x, state.z, state.yaw, 'sea'));
  assert.equal(state.speed, 0);
  const stopped = state.z;
  simulate(state, 6, { ...input, thrust: -1 }, artificial);
  assert(state.z < stopped - 2, 'reverse must leave shore');
  const world = new WaterWorld([], empty, [], empty, empty);
  world.addObstacle(square(-0.05, -10, 0.05, 10));
  assert(!world.canOccupy(0, 0, 0, 'sea'));
  assert(!world.canOccupy(2, 0, Math.PI / 2, 'sea'));
});
test('boat propulsion coasts, has delayed steering, no pivoting at rest and stable frame-rate behaviour', () => {
  const states = [30, 60, 120].map((fps) =>
    simulate(
      initialBoatState(),
      25,
      { ...input, turn: 0.25 },
      freeWorld,
      1 / fps,
    ),
  );
  for (const state of states.slice(1)) {
    assert(Math.hypot(state.x - states[0].x, state.z - states[0].z) < 0.08);
    assert(Math.abs(state.yaw - states[0].yaw) < 0.002);
  }
  const s = simulate(initialBoatState(), 10, input, freeWorld),
    speed = s.speed,
    z = s.z;
  simulate(s, 1, { thrust: 0, turn: 0, neutral: true }, freeWorld);
  assert(s.speed > speed * 0.65);
  assert(s.z > z + 2);
  const still = simulate(
    initialBoatState(),
    5,
    { thrust: 0, turn: 1, neutral: false },
    freeWorld,
  );
  assert.equal(still.yaw, 0);
  assert(states[0].yaw > 0);
  assert(states[0].speed < 9);
});
test('collision substeps cannot tunnel through land at speed or switch between a lake and sea', () => {
  const state = { ...initialBoatState(), x: 0, z: -105, yaw: 0, vz: 100 };
  advanceBoat(state, input, 0.1, artificial);
  assert(artificial.canOccupy(state.x, state.z, state.yaw, 'sea'));
  assert.equal(state.speed, 0);
  const lake = e.waterWorld.start('lost-lagoon');
  assert(!e.waterWorld.canOccupy(lake.x, lake.z, 0, 'sea'));
  const lakeState = {
    ...initialBoatState(),
    x: lake.x,
    z: lake.z,
    surfaceId: lake.surface.id,
  };
  simulate(lakeState, 150, input, e.waterWorld);
  assert.equal(e.waterWorld.at(lakeState.x, lakeState.z)?.id, lake.surface.id);
  assert(
    e.waterWorld.canOccupy(
      lakeState.x,
      lakeState.z,
      lakeState.yaw,
      lakeState.surfaceId,
    ),
  );
});
test('sea swell is visibly stronger than calm lake ripples', () => {
  const rms = (kind) =>
    Math.sqrt(
      Array.from(
        { length: 1000 },
        (_, i) => waveHeight(kind, i * 0.27, i * 0.18, i * 0.1) ** 2,
      ).reduce((a, b) => a + b) / 1000,
    );
  assert(rms('sea') > rms('lake') * 10);
  assert(rms('lake') < 0.025);
});
test('harbour assets build finite original meshes, retain 48 moorings and moving launches, and suppress cached dynamic shadows', () => {
  assert.equal(e.harbour.actors.length, 3);
  assert.equal(e.harbour.moored.length, 48);
  assert(
    e.harbour.launches.length >= 2,
    `only ${e.harbour.launches.length} clear launch routes`,
  );
  for (const actor of e.harbour.actors) {
    assert(actor.model.userData.drawCalls <= 4);
    actor.model.traverse((o) => {
      if (o.isMesh) {
        assert(!o.castShadow);
        assert(
          [...o.geometry.attributes.position.array].every(Number.isFinite),
        );
      }
    });
  }
  const ship = e.harbour.actors.find((a) => a.kind === 'cruise');
  const size = new THREE.Box3()
    .setFromObject(ship.model)
    .getSize(new THREE.Vector3());
  assert(size.y > 49);
});
test('real waterborne routes and exact private-boat centres stay clear of land', () => {
  for (const actor of e.harbour.actors) {
    assert.equal(actor.path.source.displaySimplified, true);
    assert(actor.path.length > 8000);
    const path = actor.path;
    for (let t = 0; t <= path.duration; t += 0.5) {
      const p = path.sample(t);
      assert(Number.isFinite(p.x + p.y + p.z + p.yaw));
      if (actor.kind === 'cruise')
        assert(e.waterWorld.at(p.x, p.z)?.kind === 'sea', `${actor.kind} ${t}`);
    }
  }
  const starts = e.harbour.moored.map((m) => m.position.clone());
  for (let i = 0; i < 600; i++) updateHarbour(e, e.harbour, 1 / 60);
  e.harbour.moored.forEach((m, i) => {
    assert.equal(m.position.x, starts[i].x);
    assert.equal(m.position.z, starts[i].z);
  });
  assert(
    e.harbour.launches.some(
      (l) => l.model.position.distanceTo(l.points[0]) > 5,
    ),
  );
});
test('far overview hides harbour traffic, close views reveal it, and player boat stays independent', () => {
  assert(!harbourVisible(250, 9000, 900, 45, 9000));
  assert(!harbourVisible(7, 4000, 900, 45, 4000));
  assert(harbourVisible(7, 150, 900, 45, 150));
  const boat = new BoatController(e),
    p = e.waterWorld.start('coal-harbour');
  assert(boat.start({ x: p.x, z: p.z, yaw: 0, waterId: p.surface.id }));
  e.settings.harbour = false;
  updateHarbour(e, e.harbour, 0);
  assert(!e.harbour.group.visible);
  assert(boat.model.visible);
  const x = boat.state.x,
    z = boat.state.z;
  boat.lookYaw = 1.5;
  boat.update(0.05, { thrust: 0, turn: 0, neutral: false }, 0, true);
  assert.equal(boat.state.yaw, 0);
  assert.equal(boat.state.x, x);
  assert.equal(boat.state.z, z);
  boat.stop();
  assert(!boat.model.visible && !boat.wake.visible);
  e.settings.harbour = true;
});
test('sailing wave shaders attach all uniforms, preserve shader chunks and share the boat clock', () => {
  e.water = new THREE.Mesh(
    new THREE.PlaneGeometry(80000, 80000),
    new THREE.MeshStandardMaterial(),
  );
  e.scene.add(e.water);
  const waves = addSailingWaves(e),
    boat = new BoatController(e);
  e.navigation = { mode: 'boat', boat };
  boat.state.surfaceId = 'sea';
  boat.state.x = 30;
  boat.time = 12;
  waves.update();
  for (const mesh of [e.water, e.scene.children.at(-1)]) {
    // The patch was added before the subsequent player model/wake; inspect by geometry below instead.
    if (mesh !== e.water) continue;
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uWaveActive.value, 1);
    assert.equal(shader.uniforms.uWaveTime.value, 12);
    assert(shader.fragmentShader.includes('seaWave'));
  }
  const patch = e.scene.children.find(
    (o) => o.geometry?.parameters?.widthSegments === 120,
  );
  assert(patch.visible);
  assert.equal(patch.position.x, 30);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  patch.material.onBeforeCompile(shader);
  assert(shader.vertexShader.includes('transformed.y+=seaWave'));
  e.navigation.mode = 'orbit';
  waves.update();
  assert(!patch.visible);
});

test('regional bank camera stays over water instead of entering terrain', () => {
  const p = project([-123.16742803, 49.32723941]),
    boat = new BoatController(e);
  assert(boat.start({ x: p[0], z: p[1], yaw: -0.01728246, waterId: 'sea' }));
  for (const distance of [0, 18, 90]) {
    for (const lookYaw of [0, Math.PI / 2, -Math.PI / 2]) {
      boat.lookYaw = lookYaw;
      boat.update(0, { thrust: 0, turn: 0, neutral: false }, 0, true, distance);
      assert.equal(
        e.waterWorld.at(e.camera.position.x, e.camera.position.z)?.id,
        'sea',
      );
    }
  }
});

test('full cruise envelope clears rendered pier and grounded landmark footprints along the interpolated route', () => {
  const actor = e.harbour.actors.find((a) => a.kind === 'cruise');
  for (let t = 0; t <= actor.path.duration; t += 0.8) {
    const p = actor.path.sample(t);
    assert(
      e.waterWorld.canOccupy(p.x, p.z, p.yaw, 'sea', 130, 21),
      `cruise envelope blocked at ${t.toFixed(1)} s / ${unproject(p.x, p.z)}`,
    );
  }
});
test('find-harbour resets an off-route service and preserves the simulation clock', () => {
  const actor = e.harbour.actors.find((a) => a.kind === 'seaplane');
  actor.offRoute = true;
  let cancel = 0;
  e.placement = { cancel: () => cancel++ };
  e.navigation = {
    setMode: (mode) => {
      e.settings.mode = mode;
    },
  };
  e.clock = { hour: 19.5 };
  e.focusHarbour('seaplane');
  assert.equal(cancel, 1);
  assert.equal(e.settings.mode, 'orbit');
  assert.equal(e.clock.hour, 19.5);
  assert(e.transition);
  assert(!actor.offRoute);
});
