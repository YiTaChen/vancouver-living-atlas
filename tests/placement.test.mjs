import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';
import * as THREE from 'three';
const compile = (name, imports = {}) => {
  let code = ts.transpileModule(
    readFileSync(new URL(`../lib/city/${name}.ts`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  code = code.replace(
    /from ['"]([^'"]+)['"]/g,
    (_, id) => `from '${imports[id] || id}'`,
  );
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
};
const geoUrl = compile('geo'),
  geometryUrl = compile('placement-geometry');
const geo = await import(geoUrl);
const { resolvePlacement, closestOnSegment } = await import(geometryUrl);
const { MapPlacement } = await import(
  compile('placement', {
    three: import.meta.resolve('three'),
    './geo': geoUrl,
    './placement-geometry': geometryUrl,
  })
);
const world = (extra = {}) => ({
  roads: [{ a: [0, 0], b: [10, 0], name: 'Short street' }],
  bridges: [],
  elevation: (x, z) => 40 + x * 0.2,
  contains: () => true,
  clear: () => true,
  ...extra,
});
const hit = (x, z, y = 0, surface = 'ground') => ({ x, y, z, surface });

test('precise road placement retains short segments and endpoints instead of using midpoints', () => {
  const r = resolvePlacement('drive', hit(9, 2), world(), 10, Math.PI / 2);
  assert.equal(r.valid, true);
  assert.equal(r.point.x, 9);
  assert.equal(r.point.z, 0);
  assert.equal(r.point.snappedDistance, 2);
  assert.equal(r.point.y, 43.05);
  assert.equal(closestOnSegment(14, 3, { a: [0, 0], b: [10, 0] }).x, 10);
  assert.equal(closestOnSegment(1, 1, { a: [0, 0], b: [0, 0] }), null);
});
test('walkers retain exact terrain coordinates, while invalid drops never become distant road jumps', () => {
  const r = resolvePlacement('walk', hit(7.123, 4.567), world(), 30, 0.3);
  assert.equal(r.valid, true);
  assert.equal(r.point.x, 7.123);
  assert.equal(r.point.z, 4.567);
  assert.equal(r.point.y, 40 + 7.123 * 0.2 + 1.25);
  assert.equal(
    resolvePlacement('drive', hit(7, 31), world(), 500, 0).valid,
    false,
  );
  assert.equal(
    resolvePlacement('walk', hit(1, 1), world({ clear: () => false }), 30, 0)
      .reason,
    'placementInvalid',
  );
  assert.equal(
    resolvePlacement('walk', hit(1, 1), world({ contains: () => false }), 30, 0)
      .reason,
    'placementOutside',
  );
});
test('road snapping tightens with zoom and checks the entire car footprint', () => {
  assert.equal(
    resolvePlacement('drive', hit(5, 8), world(), 20, 0).valid,
    true,
  );
  assert.equal(
    resolvePlacement('drive', hit(5, 8), world(), 4, 0).valid,
    false,
  );
  assert.equal(
    resolvePlacement(
      'drive',
      hit(5, 0),
      world({ clear: (x, z) => x < 7 }),
      20,
      0,
    ).valid,
    false,
  );
});
test('bridge placement retains deck or ramp height and does not jump to a different level', () => {
  const w = world({
    bridges: [
      { a: [0, 0], b: [100, 0], h0: 20, h1: 40, width: 20, name: 'Ramp' },
      {
        a: [0, 0],
        b: [100, 0],
        h0: 60,
        h1: 60,
        width: 20,
        name: 'Upper bridge',
      },
    ],
    contains: () => false,
    clear: () => false,
  });
  const r = resolvePlacement('drive', hit(50, 2, 30, 'bridge'), w, 20, 0);
  assert.equal(r.valid, true);
  assert.equal(r.point.y, 30);
  assert.equal(r.point.name, 'Ramp');
  assert.equal(
    resolvePlacement('drive', hit(50, 2, 48, 'bridge'), w, 20, 0).valid,
    false,
  );
  const walk = resolvePlacement('walk', hit(50, 2, 30, 'bridge'), w, 20, 0);
  assert.equal(walk.point.z, 2);
  assert.equal(walk.point.y, 30);
});
test('real lake and landmark polygons reject ground placement inside the city land boundary', () => {
  const read = (n) =>
    JSON.parse(readFileSync(new URL('../' + n, import.meta.url), 'utf8'));
  const lakes = read('public/data/context.geojson')
    .features.filter((f) => f.properties.class === 'water')
    .flatMap((f) => geo.rings(f).map((p) => p.map((r) => r.map(geo.project))));
  const landmarks = read('lib/city/landmark-footprints.json').features.flatMap(
    (f) => geo.rings(f).map((p) => p.map((r) => r.map(geo.project))),
  );
  const lakePoint = geo.project([-123.14052, 49.29584]);
  assert(
    lakes.some((p) => geo.inPolygon(lakePoint, p)),
    'Lost Lagoon is identified as inland water',
  );
  const sciencePoint = geo.project([-123.1032, 49.2734]);
  assert(
    landmarks.some((p) => geo.inPolygon(sciencePoint, p)),
    'Science World has a collision footprint',
  );
  const clear = (x, z) =>
    ![...lakes, ...landmarks].some((p) => geo.inPolygon([x, z], p));
  for (const [x, z] of [lakePoint, sciencePoint])
    assert.equal(
      resolvePlacement('walk', hit(x, z), world({ clear }), 10, 0).valid,
      false,
    );
});

// Actual controller and Three.js ray math, with an in-memory event surface. No WebGL/browser is needed.
function fixture({ bridge = false } = {}) {
  const listeners = new EventTarget();
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      width: 1000,
      height: 800,
    }),
    focus: () => {},
  });
  globalThis.window = listeners;
  globalThis.document = {
    elementFromPoint: (x, y) =>
      x >= 100 && x <= 1100 && y >= 50 && y <= 850 ? canvas : null,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const camera = new THREE.PerspectiveCamera(42, 1.25, 0.25, 45000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 200, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const controls = Object.assign(new THREE.EventDispatcher(), {
    target: new THREE.Vector3(),
    autoRotate: false,
    enableDamping: true,
    enabled: true,
    update: () => {
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
    },
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.updateMatrixWorld(true);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(80000, 80000),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -2;
  water.updateMatrixWorld(true);
  const terrain = new THREE.Group();
  terrain.add(ground);
  let started = null;
  const e = {
    camera,
    controls,
    renderer: { domElement: canvas },
    terrain,
    water,
    scene: new THREE.Scene(),
    buildings: new THREE.Group(),
    landmarks: new THREE.Group(),
    settings: { mode: 'orbit' },
    transition: null,
    data: {
      roads: {
        features: [
          {
            properties: { name: 'Test Road', class: 'local' },
            geometry: {
              type: 'LineString',
              coordinates: [geo.unproject(-100, 0), geo.unproject(100, 0)],
            },
          },
        ],
      },
      bridgeSurfaces: bridge
        ? [
            {
              a: [-100, 0],
              b: [100, 0],
              h0: 30,
              h1: 30,
              width: 20,
              name: 'Test Bridge',
            },
          ]
        : [],
    },
    geometry: (p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      return g;
    },
    onLand: (x, z) => Math.abs(x) <= 200 && Math.abs(z) <= 200,
    elevation: () => 0,
    navigation: {
      mode: 'orbit',
      position: new THREE.Vector3(),
      clearGround: () => true,
      setMode(mode) {
        this.mode = mode;
        controls.enabled = mode === 'orbit';
      },
      startAt(mode, point) {
        started = { mode, point };
        this.mode = mode;
        controls.enabled = false;
      },
    },
  };
  const placement = new MapPlacement(e);
  const screen = (x, y, z) => {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return [100 + (p.x + 1) * 500, 50 + (1 - p.y) * 400];
  };
  const event = (x, y, id = 1) => ({
    clientX: x,
    clientY: y,
    pointerId: id,
    button: 0,
  });
  return { placement, e, canvas, screen, event, started: () => started };
}
test('picking uses CSS viewport offsets, camera zoom and the actual bridge deck', () => {
  const f = fixture({ bridge: true });
  f.placement.begin('walk');
  assert.equal(f.placement.preview.result.valid, true);
  assert.equal(f.placement.preview.result.point.surface, 'bridge');
  assert.equal(f.placement.preview.result.point.y, 30);
  for (const distance of [200, 80]) {
    f.e.camera.position.y = distance;
    f.e.controls.update();
    f.placement.pointer = f.screen(15, 0, 30);
    f.placement.pick(true);
    const p = f.placement.preview.result.point;
    assert(Math.abs(p.x - 15) < 1e-6);
    assert(Math.abs(p.z - 30) < 1e-6);
  }
  f.placement.destroy();
});
test('a map drag and multi-touch gesture do not commit; a tap does and synchronizes mode', () => {
  const f = fixture();
  f.placement.begin('walk');
  f.placement.pointerDown(f.event(600, 450));
  f.placement.pointerMove(f.event(650, 450));
  f.placement.pointerUp(f.event(650, 450));
  assert.equal(f.started(), null);
  assert.equal(f.placement.mode, 'walk');
  f.placement.pointerDown(f.event(600, 450, 1));
  f.placement.pointerDown(f.event(620, 450, 2));
  f.placement.pointerUp(f.event(620, 450, 2));
  f.placement.pointerUp(f.event(600, 450, 1));
  assert.equal(f.started(), null);
  f.placement.pointerDown(f.event(600, 450));
  f.placement.pointerUp(f.event(600, 450));
  assert.equal(f.started().mode, 'walk');
  assert.equal(f.e.settings.mode, 'walk');
  assert.equal(f.placement.mode, null);
  f.placement.destroy();
});
test('dragging a figure commits on release over the map, but not outside or after pointer cancellation', () => {
  const f = fixture();
  f.placement.begin('drive');
  f.placement.startDrag(f.event(10, 10));
  f.placement.pointerMove(f.event(30, 30));
  f.placement.pointerUp(f.event(30, 30));
  assert.equal(f.started(), null);
  f.placement.startDrag(f.event(10, 10));
  f.placement.pointerMove(f.event(600, 450));
  f.placement.pointerCancel();
  f.placement.pointerUp(f.event(600, 450));
  assert.equal(f.started(), null);
  f.placement.startDrag(f.event(10, 10));
  f.placement.pointerMove(f.event(600, 450));
  f.placement.pointerUp(f.event(600, 450));
  assert.equal(f.started().mode, 'drive');
  f.placement.destroy();
});
test('cancel and invalid water drops retain the current start and restore orbit controls', () => {
  const f = fixture();
  f.placement.begin('walk');
  f.placement.pointer = [1050, 450];
  f.e.camera.position.y = 900;
  f.e.controls.update();
  f.placement.pick(true);
  assert.equal(f.placement.preview.result.valid, false);
  assert.equal(f.placement.commit(), false);
  assert.equal(f.started(), null);
  f.placement.cancel();
  assert.equal(f.e.controls.enableDamping, true);
  assert.equal(f.placement.mode, null);
  assert.equal(f.e.settings.mode, 'orbit');
  f.placement.destroy();
});

test('a second finger during figure dragging cannot accidentally place either pointer', () => {
  for (const releaseOrder of [
    [1, 2],
    [2, 1],
  ]) {
    const f = fixture();
    f.placement.begin('walk');
    f.placement.startDrag(f.event(10, 10, 1));
    f.placement.pointerMove(f.event(600, 450, 1));
    f.placement.pointerDown(f.event(620, 450, 2));
    for (const id of releaseOrder) f.placement.pointerUp(f.event(600, 450, id));
    assert.equal(f.started(), null);
    // A subsequent ordinary tap must still work.
    f.placement.pointerDown(f.event(600, 450));
    f.placement.pointerUp(f.event(600, 450));
    assert.equal(f.started().mode, 'walk');
    f.placement.destroy();
  }
});

const bridgeUrl = compile('bridges', {
  three: import.meta.resolve('three'),
  './geo': geoUrl,
  'three/addons/utils/BufferGeometryUtils.js': import.meta
    .resolve('three/addons/utils/BufferGeometryUtils.js'),
});
const landmarkUrl =
  'data:text/javascript;base64,' +
  Buffer.from(
    'export default ' +
      readFileSync(
        new URL('../lib/city/landmark-footprints.json', import.meta.url),
        'utf8',
      ),
  ).toString('base64');
const { StreetNavigation } = await import(
  compile('navigation', {
    three: import.meta.resolve('three'),
    './geo': geoUrl,
    './bridges': bridgeUrl,
    './placement-geometry': geometryUrl,
    './boat-controller': cityModule('boat-controller'),
    './landmark-footprints.json': landmarkUrl,
  })
);
function navigationFixture() {
  const { e } = fixture();
  e.data.buildings = { features: [] };
  e.data.waterPolys = [];
  e.data.bridgeSurfaces = [
    { a: [-100, 0], b: [100, 0], h0: 5, h1: 5, width: 20 },
  ];
  e.elevation = () => 1.2;
  const nav = new StreetNavigation(e);
  e.navigation = nav;
  return { e, nav };
}
test('committing under a low bridge keeps the chosen ground layer, including idle frames and motion', () => {
  const { nav } = navigationFixture();
  nav.startAt('walk', {
    x: 0,
    y: 2.45,
    z: 0,
    yaw: 0,
    surface: 'ground',
    name: '',
    snappedDistance: 0,
  });
  assert.equal(nav.position.y, 2.45);
  assert.equal(nav.surface, 'ground');
  nav.update(0.016);
  assert.equal(nav.position.y, 2.45);
  nav.move(1, 0);
  assert.equal(nav.position.y, 2.45);
  assert.equal(nav.surface, 'ground');
  nav.startAt('drive', {
    x: 0,
    y: 5,
    z: 0,
    yaw: 0,
    surface: 'bridge',
    name: '',
    snappedDistance: 0,
  });
  nav.update(0.016);
  assert.equal(nav.position.y, 5);
  assert.equal(nav.surface, 'bridge');
  nav.destroy();
});
test('quick-start road selection works after leaving a high bridge', () => {
  const { e, nav } = navigationFixture();
  e.data.roads.features[0].properties.name = 'ROBSON ST';
  e.data.bridgeSurfaces[0].h0 = 60;
  e.data.bridgeSurfaces[0].h1 = 60;
  nav.startAt('walk', {
    x: 0,
    y: 60,
    z: 0,
    yaw: 0,
    surface: 'bridge',
    name: '',
    snappedDistance: 0,
  });
  nav.setMode('walk', 'ROBSON ST');
  assert.equal(nav.mode, 'walk');
  assert.equal(nav.surface, 'ground');
  assert.equal(nav.position.y, 2.45);
  nav.destroy();
});

test('keyboard activation of a street control does not steer or brake the vehicle', () => {
  const { nav } = navigationFixture();
  nav.mode = 'drive';
  const previous = {
    Element: globalThis.Element,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };
  globalThis.Element = class {
    closest(selector) {
      return selector.includes('button') ? this : null;
    }
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};
  let prevented = false;
  nav.keyDown({
    key: ' ',
    target: new globalThis.Element(),
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(nav.keys.size, 0);
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
  nav.destroy();
});

function withInputTargets(run) {
  const previous = {
    Element: globalThis.Element,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };
  globalThis.Element = class {
    constructor(selector = 'canvas') {
      this.selector = selector;
    }
    closest(selectors) {
      return selectors.split(',').some((s) => s.trim() === this.selector)
        ? this
        : null;
    }
  };
  globalThis.HTMLInputElement = class extends globalThis.Element {};
  globalThis.HTMLTextAreaElement = class extends globalThis.Element {};
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

test('walking and driving still respond to WASD after clicking a HUD button', () =>
  withInputTargets(() => {
    for (const mode of ['walk', 'drive']) {
      const { nav } = navigationFixture();
      nav.startAt(mode, {
        x: 0,
        y: 2.45,
        z: 0,
        yaw: 0,
        surface: 'ground',
        name: '',
        snappedDistance: 0,
      });
      const before = nav.position.clone();
      nav.keyDown({
        key: 'w',
        code: 'KeyW',
        target: new globalThis.Element('button'),
        preventDefault() {},
      });
      for (let i = 0; i < 30; i++) nav.update(1 / 30);
      assert(
        nav.position.distanceTo(before) > 3,
        `${mode} must advance after a HUD click`,
      );
      nav.keyUp({ key: 'w', code: 'KeyW' });
      assert.equal(nav.keys.size, 0);
      nav.destroy();
    }
  }));

test('WASD physical keys work with an active input method and key-up releases them', () =>
  withInputTargets(() => {
    const { nav } = navigationFixture();
    nav.startAt('walk', {
      x: 0,
      y: 2.45,
      z: 0,
      yaw: 0,
      surface: 'ground',
      name: '',
      snappedDistance: 0,
    });
    nav.keyDown({
      key: 'Process',
      code: 'KeyW',
      target: new globalThis.Element(),
      preventDefault() {},
    });
    nav.update(0.05);
    assert(nav.position.z > 0);
    nav.keyUp({ key: 'Process', code: 'KeyW' });
    const stopped = nav.position.clone();
    nav.update(0.05);
    assert.equal(nav.position.distanceTo(stopped), 0);
    nav.destroy();
  }));

test('text fields, dialogs and selector arrows retain their keyboard input', () =>
  withInputTargets(() => {
    const { nav } = navigationFixture();
    nav.mode = 'drive';
    const targets = [
      new globalThis.HTMLInputElement(),
      new globalThis.HTMLTextAreaElement(),
      ...[
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="dialog"]',
      ].map((s) => new globalThis.Element(s)),
    ];
    for (const target of targets) {
      nav.keyDown({
        key: 'w',
        code: 'KeyW',
        target,
        preventDefault() {
          throw new Error('Editing input was captured');
        },
      });
      assert.equal(nav.keys.size, 0);
    }
    for (const role of ['[role="radio"]', '[role="slider"]']) {
      nav.keyDown({
        key: 'ArrowUp',
        code: 'ArrowUp',
        target: new globalThis.Element(role),
        preventDefault() {
          throw new Error('Selector input was captured');
        },
      });
      assert.equal(nav.keys.size, 0);
    }
    nav.destroy();
  }));

test('on-screen movement restores canvas focus and can be followed by keyboard movement', () =>
  withInputTargets(() => {
    for (const mode of ['walk', 'drive']) {
      const { nav, e } = navigationFixture();
      let focused = 0;
      e.renderer.domElement.focus = () => focused++;
      nav.startAt(mode, {
        x: 0,
        y: 2.45,
        z: 0,
        yaw: 0,
        surface: 'ground',
        name: '',
        snappedDistance: 0,
      });
      const before = nav.position.clone();
      const initialFocus = focused;
      nav.step('forward');
      assert(Math.abs(nav.position.distanceTo(before) - 8) < 1e-8);
      assert(focused > initialFocus);
      nav.keyDown({
        key: 'w',
        code: 'KeyW',
        target: new globalThis.Element(),
        preventDefault() {},
      });
      for (let i = 0; i < 30; i++) nav.update(1 / 30);
      assert(nav.position.distanceTo(before) > 11);
      const oldYaw = nav.yaw;
      nav.step('left');
      assert(nav.yaw > oldYaw);
      nav.destroy();
    }
  }));

test('boat placement picks the elevated lake surface and retains the precise drop coordinates', () => {
  const f = fixture(),
    { e, placement } = f;
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = 4;
  lake.userData.waterId = 'lake-test';
  lake.updateMatrixWorld(true);
  e.data.waterMeshes = [lake];
  e.waterWorld = {
    at: () => ({ id: 'lake-test', kind: 'lake', level: 4, name: 'Lake' }),
    canOccupy: () => true,
  };
  placement.begin('boat');
  placement.pointer = f.screen(7.123, 4, 9.234);
  placement.pick(true);
  assert.equal(placement.preview.result.valid, true);
  assert.equal(placement.preview.result.point.surface, 'water');
  assert.equal(placement.preview.result.point.waterId, 'lake-test');
  assert(Math.abs(placement.preview.result.point.x - 7.123) < 1e-6);
  assert.equal(placement.preview.result.point.y, 4);
  assert(placement.commit());
  assert.equal(f.started().mode, 'boat');
  placement.destroy();
});
test('boat placement rejects land, docks and water hidden behind a foreground building', () => {
  const f = fixture(),
    { e, placement } = f;
  e.waterWorld = {
    at: () => ({ id: 'sea', kind: 'sea', level: -2, name: 'Sea' }),
    canOccupy: () => true,
  };
  placement.begin('boat');
  placement.pointer = f.screen(0, 0, 0);
  placement.pick(true);
  assert.equal(placement.preview.result.valid, false);
  e.terrain.children[0].position.y = -10;
  e.terrain.children[0].updateMatrixWorld(true);
  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(100, 30, 100),
    new THREE.MeshBasicMaterial(),
  );
  obstacle.position.set(0, 13, 0);
  e.buildings.add(obstacle);
  e.buildings.updateMatrixWorld(true);
  placement.pointer = f.screen(0, -2, 0);
  placement.pick(true);
  assert.equal(placement.preview.result.valid, false);
  assert.equal(placement.commit(), false);
  placement.destroy();
});
test('boat helm uses continuous thrust on screen, physical keys and free look without car steps or bridge snapping', () => {
  const { e, nav } = navigationFixture();
  e.waterWorld = {
    canOccupy: () => true,
    at: () => ({ id: 'sea', kind: 'sea', level: 0.1 }),
  };
  nav.startAt('boat', {
    x: 0,
    y: 0.1,
    z: 0,
    yaw: 0,
    surface: 'water',
    waterId: 'sea',
  });
  nav.hold('forward', true);
  for (let i = 0; i < 180; i++) nav.update(1 / 60);
  nav.hold('forward', false);
  const z = nav.position.z,
    speed = nav.speed;
  assert(z > 1 && speed > 1);
  nav.update(1 / 60);
  assert(nav.position.z > z, 'boat coasts after button release');
  const before = nav.position.clone();
  nav.step('forward');
  assert.deepEqual(
    nav.position.toArray(),
    before.toArray(),
    'button does not teleport eight metres',
  );
  nav.dragging = true;
  nav.last = [0, 0];
  const yaw = nav.yaw;
  nav.pointerMove({ clientX: 60, clientY: 0 });
  assert.equal(nav.yaw, yaw);
  assert.notEqual(nav.boat.lookYaw, 0);
  nav.startBridge('burrard');
  assert.equal(nav.surface, 'water');
  nav.setMode('orbit');
  assert(!nav.boat.model.visible && !nav.boat.wake.visible);
  nav.destroy();
});

test('Walk and Drive switch in place on ground and bridges without selecting another road', () => {
  for (const surface of ['ground', 'bridge']) {
    const { e, nav } = navigationFixture();
    const point = {
      x: 7.13,
      z: 6.91,
      y: surface === 'bridge' ? 60 : 2.45,
      yaw: 0.63,
      surface,
      name: '',
      snappedDistance: 0,
    };
    nav.startAt('walk', point);
    nav.pitch = 0.27;
    e.data.roads.features = []; // No road lookup or road snap is needed.
    for (const mode of ['drive', 'walk', 'drive']) {
      nav.keys.add('w');
      nav.speed = 12;
      nav.setMode(mode);
      assert.equal(nav.mode, mode);
      assert.deepEqual(nav.position.toArray(), [point.x, point.y, point.z]);
      assert.equal(nav.yaw, point.yaw);
      assert.equal(nav.pitch, 0.27);
      assert.equal(nav.surface, surface);
      assert.equal(nav.speed, 0);
      assert.equal(nav.keys.size, 0);
      assert.equal(nav.car.visible, mode === 'drive');
      assert.equal(e.controls.enabled, false);
      assert.equal(e.transition, null);
      assert(
        e.camera.position.distanceTo(nav.position) < 25,
        'camera stays at street distance',
      );
    }
    nav.destroy();
  }
});
test('direct street switching never takes over Boat, orbit, or a requested water mode', () => {
  const { e, nav } = navigationFixture();
  e.waterWorld = {
    canOccupy: () => true,
    at: () => ({ id: 'sea', kind: 'sea', level: 0.1 }),
  };
  assert.equal(nav.switchStreetMode('walk'), false);
  nav.startAt('boat', {
    x: 20,
    y: 0.1,
    z: 30,
    yaw: 0.4,
    surface: 'water',
    waterId: 'sea',
  });
  const before = nav.position.toArray();
  for (const mode of ['walk', 'drive'])
    assert.equal(nav.switchStreetMode(mode), false);
  assert.equal(nav.mode, 'boat');
  assert.deepEqual(nav.position.toArray(), before);
  assert(nav.boat.model.visible);
  nav.startAt('walk', { x: 0, y: 2.45, z: 0, yaw: 0, surface: 'ground' });
  assert.equal(nav.switchStreetMode('boat'), false);
  assert.equal(nav.switchStreetMode('orbit'), false);
  assert.equal(nav.mode, 'walk');
  nav.destroy();
});

test('pointer and keyboard mode selection share in-place switching while Boat and active placement still select a location', () => {
  const source = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const ast = ts.createSourceFile(
    'page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const home = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'Home',
  );
  const names = ['switchInScene', 'switchMode', 'dragFigure'];
  const actions = home.body.statements
    .filter(
      (n) =>
        ts.isVariableStatement(n) &&
        n.declarationList.declarations.some((d) =>
          names.includes(d.name.getText(ast)),
        ),
    )
    .map((n) => n.getText(ast))
    .join('\n');
  const code = ts.transpileModule(actions, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  for (const entry of ['pointer', 'keyboard'])
    for (const [from, to, placing, expected] of [
      ['walk', 'drive', null, 'switch'],
      ['drive', 'walk', null, 'switch'],
      ['drive', 'drive', null, 'switch'],
      ['boat', 'walk', null, 'place'],
      ['boat', 'drive', null, 'place'],
      ['orbit', 'walk', null, 'place'],
      ['walk', 'boat', null, 'place'],
      ['walk', 'drive', 'walk', 'place'],
    ]) {
      const calls = [],
        nav = {
          mode: from,
          switchStreetMode(mode) {
            if (
              !['walk', 'drive'].includes(this.mode) ||
              !['walk', 'drive'].includes(mode)
            )
              return false;
            this.mode = mode;
            calls.push('switch');
            return true;
          },
        };
      const bindings = {
        ready: true,
        engine: {
          current: {
            navigation: nav,
            renderer: { domElement: { focus: () => calls.push('focus') } },
            placement: {
              mode: placing,
              startDrag: () => calls.push('drag'),
              cancel() {},
            },
          },
        },
        setTour() {},
        setPanel() {},
        setNotice() {},
        change: (patch) => calls.push(patch.mode),
        go() {},
        view: 'canada',
        beginPlacement: () => calls.push('place'),
      };
      const handlers = new Function(
        ...Object.keys(bindings),
        code + '\nreturn {switchMode,dragFigure};',
      )(...Object.values(bindings));
      if (entry === 'keyboard') handlers.switchMode(to);
      else
        handlers.dragFigure(
          {
            button: 0,
            preventDefault() {},
            stopPropagation() {},
            currentTarget: { setPointerCapture: () => calls.push('capture') },
            pointerId: 1,
            nativeEvent: {},
          },
          to,
        );
      assert.equal(
        calls[0],
        expected,
        `${entry} ${from} to ${to} with placement ${placing}`,
      );
      if (expected === 'switch') {
        assert.equal(nav.mode, to);
        assert(!calls.includes('capture'));
        assert(!calls.includes('drag'));
        assert(!calls.includes('place'));
        assert.equal(
          calls.includes('focus'),
          entry === 'pointer',
          'keyboard selection retains radio focus',
        );
      } else if (entry === 'pointer')
        assert.deepEqual(calls, ['place', 'capture', 'drag']);
    }
});
