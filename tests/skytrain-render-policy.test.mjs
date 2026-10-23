import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  actualTrain,
  stationOwner,
  ridePath,
  routes,
} from './helpers/skytrain-geometry.mjs';

const { project } = await import(cityModule('geo'));

// Execute the actual engine render method and passenger underground getters.
// Only the GPU renderer/composer is recorded; no second visibility policy is
// implemented in this fixture, and these CPU checks make no visual/FPS claim.
function members(file, className, names, predicate) {
  const source = readFileSync(
    new URL(`../lib/city/${file}.ts`, import.meta.url),
    'utf8',
  );
  const ast = ts.createSourceFile(
    `${file}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const cls = ast.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === className,
  );
  assert(cls, `${className} exists in the production module`);
  const selected = cls.members.filter(
    (node) => predicate(node) && names.includes(node.name.getText(ast)),
  );
  assert.equal(selected.length, names.length);
  return selected.map((node) => node.getText(ast)).join('\n');
}
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  import { project } from '${cityModule('geo')}';
  export class RenderHarness {
    ${members('engine', 'CityEngine', ['renderScene', 'fly', 'navigateMinimap'], ts.isMethodDeclaration)}
  }
  export class PassengerHarness {
    ${members('skytrain-travel', 'SkyTrainTravel', ['active', 'aboard', 'underground'], ts.isGetAccessorDeclaration)}
  }
  export class WorldPassengerHarness extends PassengerHarness {
    ${members('skytrain-world-travel', 'SkyTrainWorldTravel', ['aboard'], ts.isGetAccessorDeclaration)}
    ${members('skytrain-travel', 'SkyTrainTravel', ['interactionOrigin', 'passengerSeated'], ts.isGetAccessorDeclaration)}
    ${members('skytrain-world-travel', 'SkyTrainWorldTravel', ['setOverview'], ts.isMethodDeclaration)}
    ${members('skytrain-travel', 'SkyTrainTravel', ['publish'], ts.isMethodDeclaration)}
    ${members('skytrain-travel', 'SkyTrainTravel', ['clearInput'], ts.isPropertyDeclaration)}
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { RenderHarness, PassengerHarness, WorldPassengerHarness } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

function fixture({
  underground,
  waterVisible = true,
  composer = false,
  failure = null,
}) {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  camera.position.set(12, underground ? -7.8 : 3, 24);
  const passenger = Object.assign(new PassengerHarness(), {
    phase: 'station',
    city: { camera, elevation: () => 1.1 },
  });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshBasicMaterial(),
  );
  water.position.y = 0.1;
  water.visible = waterVisible;
  const station = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.2, 40),
    new THREE.MeshStandardMaterial(),
  );
  station.position.set(12, -9.45, 24);
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.2, 50),
    new THREE.MeshStandardMaterial(),
  );
  rail.visible = false;
  scene.add(water, station, rail);
  const fixed = [station, rail].map((object) => ({
    object,
    visible: object.visible,
    parent: object.parent,
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    geometry: object.geometry,
    vertices: [...object.geometry.attributes.position.array],
    material: object.material,
  }));
  const assertStationAndRail = () => {
    for (const snapshot of fixed) {
      const object = snapshot.object;
      assert.equal(object.visible, snapshot.visible);
      assert.equal(object.parent, snapshot.parent);
      assert.deepEqual(object.position.toArray(), snapshot.position);
      assert.deepEqual(object.quaternion.toArray(), snapshot.quaternion);
      assert.equal(object.geometry, snapshot.geometry);
      assert.deepEqual(
        [...object.geometry.attributes.position.array],
        snapshot.vertices,
      );
      assert.equal(object.material, snapshot.material);
    }
  };
  const draws = [];
  const inspectDraw = (kind) => {
    draws.push(kind);
    assert.equal(water.visible, underground ? false : waterVisible);
    assertStationAndRail();
    if (failure) throw failure;
  };
  let preparations = 0;
  const engine = Object.assign(new RenderHarness(), {
    scene,
    camera,
    controls: { target: new THREE.Vector3(12, 1.1, 24) },
    settings: { quality: 'balanced', mode: 'walk' },
    compatibleGraphics: false,
    skyTrainTravel: passenger,
    water,
    landmarkDetails: [],
    updateShadowFrustum() {},
    renderer: {
      info: { reset() {} },
      shadowMap: { enabled: false, needsUpdate: false },
      render(renderedScene, renderedCamera) {
        assert.equal(renderedScene, scene);
        assert.equal(renderedCamera, camera);
        inspectDraw('renderer');
      },
    },
    composer: composer ? { render: () => inspectDraw('composer') } : null,
    sceneryPreparation: {
      pump() {
        preparations++;
        assert.equal(
          water.visible,
          waterVisible,
          'the temporary policy ends before scenery preparation',
        );
      },
    },
  });
  return {
    engine,
    water,
    station,
    rail,
    passenger,
    draws,
    prepared: () => preparations,
    assertStationAndRail,
    dispose() {
      for (const object of [water, station, rail]) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
  };
}

test('actual passenger underground policy follows active camera height against local terrain rather than sea level or station identity', () => {
  const camera = new THREE.PerspectiveCamera();
  const lookups = [];
  const passenger = Object.assign(new PassengerHarness(), {
    phase: 'station',
    city: {
      camera,
      elevation(x, z) {
        lookups.push([x, z]);
        return 40;
      },
    },
  });
  camera.position.set(123, 39, 456);
  assert.equal(
    passenger.underground,
    true,
    'a camera above the ocean can still be underground',
  );
  assert.deepEqual(lookups.at(-1), [123, 456]);
  camera.position.y = 39.65;
  assert.equal(passenger.underground, false, 'the terrain threshold is strict');
  camera.position.y = 39.64;
  for (const phase of ['loading', 'station', 'riding']) {
    passenger.phase = phase;
    assert.equal(passenger.underground, true);
  }
  camera.position.y = -20;
  for (const phase of ['idle', 'error']) {
    passenger.phase = phase;
    assert.equal(
      passenger.underground,
      false,
      'an inactive passenger cannot change ordinary city rendering',
    );
  }
});

for (const composer of [false, true]) {
  const path = composer ? 'composer' : 'renderer';
  test(`actual engine ${path} suppresses ocean only during underground drawing and restores the existing water setting`, () => {
    for (const underground of [false, true])
      for (const waterVisible of [false, true]) {
        const f = fixture({ underground, waterVisible, composer });
        try {
          f.engine.renderScene();
          assert.deepEqual(f.draws, [path]);
          assert.equal(f.water.visible, waterVisible);
          assert.equal(f.prepared(), 1);
          f.assertStationAndRail();
        } finally {
          f.dispose();
        }
      }
  });

  test(`actual engine ${path} restores true and false ocean visibility after a failed pass without mutating station or rail geometry`, () => {
    for (const underground of [false, true])
      for (const waterVisible of [false, true]) {
        const failure = new Error('recorded GPU draw failure');
        const f = fixture({ underground, waterVisible, composer, failure });
        try {
          assert.throws(
            () => f.engine.renderScene(),
            (error) => error === failure,
          );
          assert.deepEqual(f.draws, [path]);
          assert.equal(f.water.visible, waterVisible);
          assert.equal(f.prepared(), 0);
          f.assertStationAndRail();
        } finally {
          f.dispose();
        }
      }
  });
}

for (const method of ['navigateMinimap']) {
  test(`actual engine ${method} cannot move the camera or replace travel while a passenger is in a station or aboard`, () => {
    for (const phase of ['loading', 'station', 'riding']) {
      const f = fixture({ underground: true });
      try {
        const e = f.engine;
        f.passenger.phase = phase;
        f.passenger.journey = {
          snapshot: () => ({ aboard: phase === 'riding' }),
        };
        assert.equal(f.passenger.active, true);
        assert.equal(f.passenger.aboard, phase === 'riding');
        const transition = Object.freeze({
          start: 123,
          to: new THREE.Vector3(80, 20, 90),
        });
        e.transition = transition;
        const blocked = () => {
          assert.fail(
            'active passenger guard must run before any navigation side effect',
          );
        };
        e.closeBusVisit = blocked;
        e.completeLocalMapTransition = blocked;
        e.navigation = { mode: 'orbit', setMode: blocked };
        e.tesla = { deactivate: blocked };
        e.flight = { clear: blocked, detach: blocked };
        e.placement = { cancel: blocked };
        e.minimap = {
          canvas: { getBoundingClientRect: blocked },
          transform: {},
        };
        const before = {
          position: e.camera.position.toArray(),
          quaternion: e.camera.quaternion.toArray(),
          target: e.controls.target.toArray(),
          settings: { ...e.settings },
          camera: e.camera,
          navigation: e.navigation,
        };
        if (method === 'fly')
          e.fly(
            { coord: [-123.12, 49.28], distance: 1300, elevation: 0.8 },
            false,
          );
        else e.navigateMinimap({ clientX: 20, clientY: 30 });
        assert.equal(e.camera, before.camera);
        assert.deepEqual(e.camera.position.toArray(), before.position);
        assert.deepEqual(e.camera.quaternion.toArray(), before.quaternion);
        assert.deepEqual(e.controls.target.toArray(), before.target);
        assert.deepEqual(e.settings, before.settings);
        assert.equal(e.transition, transition);
        assert.equal(e.navigation, before.navigation);
        assert.equal(e.navigation.mode, 'orbit');
        f.assertStationAndRail();
      } finally {
        f.dispose();
      }
    }
  });
}

test('actual engine fly opens an observer view while preserving the actual station, seat and selected-car passenger pose', async () => {
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo'),
    path = ridePath(
      routes.segments.find((segment) => segment.lineId === 'expo'),
    );
  train.setPathPose(path, 0.43);
  assert(train.selectPassengerCar(2));
  try {
    for (const aboard of [false, true])
      for (const seated of [false, true])
        for (const animate of [false, true]) {
          const f = fixture({ underground: true });
          try {
            const e = f.engine,
              bench = owner.benchSeats()[0],
              seat = train.passengerSpace.seats[0],
              calls = [];
            const passenger = Object.assign(new WorldPassengerHarness(), {
              city: e,
              phase: aboard ? 'riding' : 'station',
              station: 'waterfront',
              owner,
              foot: bench.stand,
              stationSeat: !aboard && seated ? bench : null,
              cabinFoot: train.passengerSpace.doorSpawn('left'),
              cabinSeat: aboard && seated ? seat : null,
              train,
              occupied: aboard ? { id: 'same-autonomous-service' } : null,
              busy: false,
              disposed: false,
              keys: new Set(['KeyW']),
              axes: { x: 0.2, y: -1 },
              drag: { pointerId: 1 },
              onChange: () => calls.push('publish'),
              updateCamera: () =>
                assert.fail('overview must not reposition the passenger'),
            });
            train.setPassengerLocal(
              passenger.cabinSeat?.position ?? passenger.cabinFoot,
              passenger.cabinSeat?.eyeHeight ?? 1.65,
              passenger.cabinSeat?.eyeOffsetXZ,
            );
            e.skyTrainTravel = passenger;
            e.elevation = () => 1.1;
            e.onLocalOrbit = () => calls.push('overview');
            e.onTravelResume = () => assert.fail('fly must remain an observer');
            e.completeLocalMapTransition = () => calls.push('finish-map');
            e.travelReturn = {
              invalidate: (remember) => calls.push(['invalidate', remember]),
            };
            e.controls.update = () => calls.push('controls');
            e.navigation = {
              mode: 'walk',
              position: new THREE.Vector3(...passenger.interactionOrigin),
              setMode: () =>
                assert.fail('fly must not replace the passenger controller'),
            };
            const before = {
              origin: passenger.interactionOrigin,
              foot: structuredClone(passenger.foot),
              cabinFoot: [...passenger.cabinFoot],
              station: passenger.station,
              stationSeat: passenger.stationSeat,
              cabinSeat: passenger.cabinSeat,
              occupied: passenger.occupied,
              navigationPosition: e.navigation.position.toArray(),
              trainPosition: train.group.position.toArray(),
              trainQuaternion: train.group.quaternion.toArray(),
              passengerPosition: train.passenger.getWorldPosition(
                new THREE.Vector3(),
              ),
              passengerParent: train.passenger.parent,
              frame: train.passengerFrame,
              camera: e.camera,
            };
            const view = {
              coord: [-123.12, 49.28],
              distance: 1300,
              azimuth: 0.3,
              elevation: 0.8,
            };
            e.fly(view, animate);
            assert.equal(e.camera, before.camera);
            assert.equal(e.settings.mode, 'orbit');
            assert.equal(e.settings.autoRotate, false);
            assert.equal(e.controls.enabled, true);
            assert.equal(e.camera.near, 2);
            assert.equal(e.camera.fov, 48);
            assert.equal(e.skyTrainTravel, passenger);
            assert.equal(passenger.active, true);
            assert.equal(passenger.aboard, aboard);
            assert.equal(passenger.passengerSeated, seated);
            assert.equal(passenger.station, before.station);
            assert.equal(passenger.stationSeat, before.stationSeat);
            assert.equal(passenger.cabinSeat, before.cabinSeat);
            assert.equal(passenger.occupied, before.occupied);
            assert.deepEqual(passenger.foot, before.foot);
            assert.deepEqual(passenger.cabinFoot, before.cabinFoot);
            assert.deepEqual(passenger.interactionOrigin, before.origin);
            assert.deepEqual(
              e.navigation.position.toArray(),
              before.navigationPosition,
            );
            assert.deepEqual(
              train.group.position.toArray(),
              before.trainPosition,
            );
            assert.deepEqual(
              train.group.quaternion.toArray(),
              before.trainQuaternion,
            );
            assert.equal(train.passengerFrame, before.frame);
            assert.equal(train.passengerCarIndex, 2);
            assert.equal(train.passenger.parent, before.passengerParent);
            assert(
              train.passenger
                .getWorldPosition(new THREE.Vector3())
                .distanceTo(before.passengerPosition) < 1e-8,
            );
            assert.equal(passenger.keys.size, 0);
            assert.deepEqual(passenger.axes, { x: 0, y: 0 });
            assert.equal(passenger.drag, null);
            assert.equal(calls.filter((call) => call === 'overview').length, 1);
            assert.equal(calls.filter((call) => call === 'publish').length, 1);
            const [x, z] = project(view.coord),
              expectedTarget = new THREE.Vector3(x, 1.1, z);
            if (animate) {
              assert.equal(e.transition.duration, 1800);
              assert(e.transition.toTarget.distanceTo(expectedTarget) < 1e-8);
              assert(e.transition.from.distanceTo(e.camera.position) < 1e-8);
            } else {
              assert(e.controls.target.distanceTo(expectedTarget) < 1e-8);
              assert(e.camera.position.distanceTo(expectedTarget) > 1299);
            }
            f.assertStationAndRail();
          } finally {
            f.dispose();
          }
        }
  } finally {
    train.dispose();
    owner.dispose();
  }
});
