import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
    './ground-surface': cityModule('ground-surface'),
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
  ground.userData.walkSurface = true;
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
      roadGraph: {
        nodes: [{ point: [-100, 0] }, { point: [100, 0] }],
        edges: [{ a: 0, b: 1, classes: ['local'], names: ['Test Road'] }],
      },
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
  e.scene.add(terrain);
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

const bridgeUrl = cityModule('bridges');
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
    './road-trim': cityModule('road-trim'),
    './surface-reachability': cityModule('surface-reachability'),
    './placement-geometry': geometryUrl,
    './boat-controller': cityModule('boat-controller'),
    './travel-camera': cityModule('travel-camera'),
    './assets/walker': cityModule('assets/walker'),
    './ground-surface': cityModule('ground-surface'),
    './driver-camera': cityModule('driver-camera'),
    './assets/cockpits': cityModule('assets/cockpits'),
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

const { enterLocalMap, finishLocalMapTransition } = await import(
  cityModule('local-map-camera')
);
const cameraPoint = (surface = 'ground') => ({
  x: 7.13,
  y: surface === 'bridge' ? 60 : surface === 'water' ? 45 : 2.45,
  z: 6.91,
  yaw: 0.63,
  surface,
  waterId: 'lake',
});
function settleCamera(nav) {
  for (let i = 0; i < 100; i++) nav.update(1 / 60);
}

test('walking zoom reveals an animated person without changing position, and each street mode remembers its camera', () => {
  const { nav, e } = navigationFixture();
  nav.startAt('walk', cameraPoint());
  assert.equal(nav.walker.group.visible, false);
  const pose = nav.position.toArray(),
    yaw = nav.yaw;
  nav.zoom(4);
  settleCamera(nav);
  assert(nav.walker.group.visible);
  assert.equal(nav.walker.group.position.x, pose[0]);
  assert.equal(nav.walker.group.position.z, pose[2]);
  // The fixture includes its actual y=0 terrain in the scene, as production does.
  assert(Math.abs(nav.walker.group.position.y - 0.02) < 1e-10);
  assert.deepEqual(nav.position.toArray(), pose);
  assert.equal(nav.yaw, yaw);
  nav.hold('forward', true);
  const moved = nav.position.clone();
  nav.update(0.05);
  assert(nav.position.distanceTo(moved) > 0);
  assert(nav.walkingDistance > 0);
  nav.hold('forward', false);
  nav.switchStreetMode('drive');
  assert.equal(nav.cameraDistance, 14);
  nav.zoom(0.2);
  settleCamera(nav);
  assert.equal(nav.car.visible, false);
  assert(nav.cockpits.drive.visible);
  nav.setInterior('clear');
  assert.equal(nav.cockpits.drive.visible, false);
  assert.equal(e.controls.enabled, false);
  nav.switchStreetMode('walk');
  assert.equal(nav.cameraDistance, 6);
  assert(nav.walker.group.visible);
  nav.destroy();
});

test('zoom and interior toggles retain active input, speed, yaw and the boat helm', () => {
  for (const mode of ['drive', 'boat']) {
    const { nav, e } = navigationFixture();
    e.waterWorld = {
      canOccupy: () => true,
      at: () => ({ id: 'lake', kind: 'lake', level: 45 }),
    };
    nav.startAt(mode, cameraPoint(mode === 'boat' ? 'water' : 'ground'));
    nav.hold('forward', true);
    nav.speed = 4;
    nav.boat.state.speed = 4;
    nav.boat.state.throttle = 0.6;
    const position = nav.position.toArray(),
      yaw = nav.yaw;
    nav.zoom(0.15);
    nav.setInterior('clear');
    assert.deepEqual(nav.position.toArray(), position);
    assert.equal(nav.yaw, yaw);
    assert.equal(nav.speed, 4);
    assert.equal(nav.boat.state.speed, 4);
    assert.equal(nav.boat.state.throttle, 0.6);
    assert(nav.keys.has('w'));
    nav.update(0.05);
    assert(nav.position.distanceTo(new THREE.Vector3(...position)) > 0);
    nav.hold('forward', false);
    settleCamera(nav);
    assert.equal(nav.cameraView.perspective, 'first');
    assert.equal((mode === 'boat' ? nav.boat.model : nav.car).visible, false);
    nav.setInterior('interior');
    assert(nav.cockpits[mode].visible);
    nav.destroy();
  }
});

test('far zoom exits once at the exact ground, bridge or elevated lake position without selecting a distant viewpoint', () => {
  for (const [mode, surface] of [
    ['walk', 'ground'],
    ['drive', 'bridge'],
    ['boat', 'water'],
  ]) {
    const { nav, e } = navigationFixture();
    e.waterWorld = {
      canOccupy: () => true,
      at: () => ({ id: 'lake', kind: 'lake', level: 45 }),
    };
    e.renderer.shadowMap = { needsUpdate: false };
    let exits = 0;
    e.leaveTravelAtLocation = () => {
      if (enterLocalMap(e)) exits++;
    };
    nav.startAt(mode, cameraPoint(surface));
    e.settings = { mode, quality: 'ultra', autoRotate: true };
    const position = nav.position.clone();
    nav.hold('forward', true);
    nav.zoom(100);
    assert.equal(exits, 1);
    assert.equal(nav.mode, 'orbit');
    assert.equal(e.settings.mode, 'orbit');
    assert.equal(e.settings.quality, 'ultra');
    assert.equal(e.controls.enabled, false);
    assert.equal(e.controls.autoRotate, false);
    assert.deepEqual(e.controls.target.toArray(), position.toArray());
    assert.deepEqual(e.transition.toTarget.toArray(), position.toArray());
    assert(Math.abs(e.transition.to.distanceTo(position) - 200) < 1e-8);
    assert.equal(e.camera.fov, 42);
    assert.equal(nav.keys.size, 0);
    assert(
      !nav.car.visible && !nav.walker.group.visible && !nav.boat.model.visible,
    );
    assert(!nav.cockpits.drive.visible && !nav.cockpits.boat.visible);
    const wheel = new Event('wheel', { cancelable: true });
    Object.defineProperty(wheel, 'deltaY', { value: 400 });
    nav.wheel(wheel);
    assert(wheel.defaultPrevented, 'remaining wheel inertia is consumed');
    assert.equal(exits, 1);
    nav.zoom(1.3);
    assert.equal(exits, 1);
    finishLocalMapTransition(e);
    assert.equal(e.controls.enabled, true);
    assert.equal(e.transition, null);
    assert(Math.abs(e.camera.position.distanceTo(position) - 200) < 1e-8);
    nav.destroy();
  }
});

test('two-finger zoom never turns or moves the player and consumes the remaining pointer after exit', () => {
  const { nav, e } = navigationFixture();
  e.renderer.shadowMap = { needsUpdate: false };
  e.leaveTravelAtLocation = () => enterLocalMap(e);
  nav.startAt('walk', cameraPoint());
  const touch = (id, x) => ({
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: 0,
    preventDefault() {},
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });
  const position = nav.position.toArray(),
    yaw = nav.yaw;
  nav.pointerDown(touch(1, 0));
  nav.pointerDown(touch(2, 100));
  nav.pointerMove(touch(2, 50));
  assert.equal(nav.cameraDistance, 2);
  assert.equal(nav.yaw, yaw);
  assert.deepEqual(nav.position.toArray(), position);
  nav.cameraDistances.walk = 90;
  nav.pointerMove(touch(2, 10));
  assert.equal(nav.mode, 'orbit');
  const remainder = touch(1, 30);
  nav.pointerMove(remainder);
  assert(remainder.stopped);
  nav.pointerUp(touch(1, 30));
  nav.pointerUp(touch(2, 10));
  assert.equal(nav.blockedPointers.size, 0);
  assert.equal(nav.touches.size, 0);
  assert.equal(nav.dragging, false);
  nav.destroy();
});

const { TravelReturn } = await import(cityModule('travel-return'));
function returnFixture(mode = 'drive', surface = 'ground') {
  const { nav, e } = navigationFixture();
  e.waterWorld = {
    canOccupy: () => true,
    at: () => ({ id: 'lake', kind: 'lake', level: 45 }),
  };
  e.renderer.shadowMap = { needsUpdate: false };
  e.camera.up.set(0, 1, 0);
  e.controls = new OrbitControls(e.camera, null);
  e.controls.minDistance = 28;
  e.controls.maxDistance = 18000;
  e.controls.maxPolarAngle = Math.PI * 0.485;
  e.controls.rotateSpeed = 0.65;
  e.controls.enableDamping = true;
  e.controls.enablePan = true;
  e.renderer.domElement.clientHeight = 800;
  e.travelReturn = new TravelReturn(e);
  e.travelReturn.attach();
  e.completeLocalMapTransition = () => finishLocalMapTransition(e);
  e.leaveTravelAtLocation = (remember) => enterLocalMap(e, remember);
  e.zoom = (factor) => {
    if (nav.mode !== 'orbit') {
      nav.zoom(factor);
      return;
    }
    finishLocalMapTransition(e);
    e.camera.position
      .sub(e.controls.target)
      .multiplyScalar(factor)
      .add(e.controls.target);
    e.controls.update();
    e.travelReturn.update();
  };
  nav.cameraDistances[mode] = 0;
  nav.startAt(mode, cameraPoint(surface));
  nav.pitch = 0.18;
  nav.driveLookYaw = 0.32;
  nav.boat.lookYaw = -0.24;
  if (mode !== 'walk') nav.setInterior('clear');
  nav.update(0);
  e.settings.mode = mode;
  const saved = nav.snapshotTravel();
  nav.zoom(100);
  return {
    nav,
    e,
    saved,
    close() {
      e.travelReturn.destroy();
      nav.destroy();
    },
  };
}

test('zoom return restores exact travel mode, location, deck/water layer, view and heading at rest', () => {
  for (const [mode, surface] of [
    ['walk', 'ground'],
    ['drive', 'bridge'],
    ['boat', 'water'],
  ]) {
    const { nav, e, saved, close } = returnFixture(mode, surface);
    try {
      assert.equal(nav.mode, 'orbit');
      assert(e.travelReturn.bookmark);
      e.travelReturn.update();
      assert.equal(
        nav.mode,
        'orbit',
        'Exit animation cannot instantly restore a close-up camera',
      );
      finishLocalMapTransition(e);
      e.travelReturn.update();
      assert.equal(nav.mode, 'orbit');
      // Orbit about the same center, including vertical camera changes.
      e.camera.position
        .sub(e.controls.target)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.2)
        .add(e.controls.target);
      e.controls.dispatchEvent({ type: 'change' });
      e.travelReturn.update();
      assert(e.travelReturn.bookmark, 'Rotation retains return');
      let resumed = null;
      e.onTravelResume = (m) => {
        resumed = m;
      };
      e.zoom(0.5);
      assert.equal(nav.mode, mode);
      assert.equal(resumed, mode);
      assert.equal(e.settings.mode, mode);
      assert.equal(e.travelReturn.bookmark, null);
      assert(nav.position.distanceTo(saved.position) < 1e-8);
      assert.equal(nav.yaw, saved.yaw);
      assert.equal(nav.pitch, saved.pitch);
      assert.equal(nav.surface, surface);
      assert.equal(nav.cameraDistance, saved.distance);
      assert.equal(nav.speed, 0);
      assert.equal(nav.keys.size, 0);
      assert.equal(e.controls.enabled, false);
      if (mode === 'drive') assert.equal(nav.driveLookYaw, saved.lookYaw);
      if (mode === 'boat') {
        assert.equal(nav.boat.lookYaw, saved.lookYaw);
        assert.equal(nav.boat.state.throttle, 0);
        assert.equal(nav.boat.state.vx, 0);
        assert.equal(nav.boat.state.vz, 0);
        assert.equal(nav.boat.state.yawRate, 0);
        assert.equal(nav.boat.state.surfaceId, 'lake');
      }
      assert(nav.returnBlend, 'Resume eases from the current local camera');
      const cameraStart = e.camera.position.clone();
      nav.update(0.016);
      assert(e.camera.position.distanceTo(cameraStart) < 2);
      settleCamera(nav);
      assert.equal(nav.returnBlend, null);
      assert(
        Math.hypot(
          nav.position.x - saved.position.x,
          nav.position.z - saved.position.z,
        ) < 1e-8,
      );
      if (mode !== 'boat') assert.equal(nav.position.y, saved.position.y);
      assert.equal(nav.cameraView.interior, saved.interior);
      assert(e.camera.position.toArray().every(Number.isFinite));
    } finally {
      close();
    }
  }
});

test('panning away then back permanently cancels return; explicit placement also cancels before movement', () => {
  for (const action of ['pan', 'placement']) {
    const { nav, e, saved, close } = returnFixture();
    try {
      finishLocalMapTransition(e);
      if (action === 'pan') {
        e.controls.target.x += 0.01;
        e.controls.dispatchEvent({ type: 'change' });
        e.controls.target.copy(saved.position);
        e.controls.dispatchEvent({ type: 'change' });
      } else {
        const placement = new MapPlacement(e);
        placement.begin('walk');
        placement.cancel();
        placement.destroy();
      }
      assert.equal(e.travelReturn.bookmark, null);
      e.zoom(0.4);
      assert.equal(nav.mode, 'orbit');
    } finally {
      close();
    }
  }
});

test('two-finger pinch returns without center drift; two-finger translation permanently invalidates return', () => {
  for (const kind of ['pinch', 'pan']) {
    const { nav, e, saved, close } = returnFixture();
    const touch = (id, x) => ({
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: 100,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
    try {
      finishLocalMapTransition(e);
      e.travelReturn.down(touch(1, 100));
      e.travelReturn.down(touch(2, 200));
      // Sequential OS finger events are processed together at the frame boundary.
      e.travelReturn.move(touch(1, kind === 'pinch' ? 40 : 140));
      e.travelReturn.move(touch(2, kind === 'pinch' ? 260 : 240));
      e.travelReturn.flushGesture();
      if (kind === 'pinch') {
        assert.equal(nav.mode, 'drive');
        assert(nav.position.distanceTo(saved.position) < 1e-8);
      } else {
        assert.equal(nav.mode, 'orbit');
        assert.equal(e.travelReturn.bookmark, null);
        assert(e.controls.target.distanceTo(saved.position) > 1);
      }
      e.travelReturn.up(touch(1, 40));
      e.travelReturn.up(touch(2, 260));
      assert.equal(e.controls.enablePan, true);
      assert.equal(e.travelReturn.touches.size, 0);
    } finally {
      close();
    }
  }
});

test('car and boat wheel rotate toward the actual left/right steering input, including screen-button pulses', () => {
  for (const mode of ['drive', 'boat'])
    for (const direction of ['left', 'right']) {
      const { nav, e } = navigationFixture();
      e.waterWorld = {
        canOccupy: () => true,
        at: () => ({ id: 'lake', kind: 'lake', level: 45 }),
      };
      nav.cameraDistances[mode] = 0;
      nav.startAt(mode, cameraPoint(mode === 'boat' ? 'water' : 'ground'));
      nav.hold('forward', true);
      for (let i = 0; i < 60; i++) nav.update(1 / 60);
      nav.hold(direction, true);
      const beforeYaw = nav.yaw;
      for (let i = 0; i < 12; i++) nav.update(1 / 60);
      const sign = direction === 'left' ? 1 : -1;
      assert((nav.yaw - beforeYaw) * sign > 0);
      const wheel = nav.cockpits[mode].userData.steeringWheel;
      assert(wheel.rotation.z * sign > 0);
      // Wheel-local positive Y spoke moves screen-left under positive rotation Z.
      assert(-Math.sin(wheel.rotation.z) * sign < 0);
      nav.blur();
      nav.steering = 0;
      nav.step(direction);
      nav.update(1 / 60);
      assert(
        wheel.rotation.z * sign > 0,
        `${mode} screen-button pulse animates its wheel`,
      );
      nav.destroy();
    }
});

test('driver eye is on vehicle left for every heading; looking around moves the cabin relative to the head without steering', () => {
  const { nav, e } = navigationFixture();
  nav.cameraDistances.drive = 0;
  nav.startAt('drive', cameraPoint());
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    nav.yaw = yaw;
    nav.pitch = 0;
    nav.driveLookYaw = 0;
    nav.update(0);
    const local = e.camera.position
      .clone()
      .sub(nav.position)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    assert(Math.abs(local.x - 0.45) < 1e-8);
    assert(Math.abs(local.z) < 1e-8);
    assert(Math.abs(local.y - 1.45) < 1e-8);
    const wheel = nav.cockpits.drive.userData.steeringWheel;
    e.scene.updateMatrixWorld(true);
    const wheelBefore = wheel.getWorldPosition(new THREE.Vector3());
    const oldYaw = nav.yaw;
    nav.pointerDown({ clientX: 100, clientY: 100 });
    nav.pointerMove({ clientX: 160, clientY: 100 });
    nav.update(0);
    assert.equal(nav.yaw, oldYaw);
    assert.notEqual(nav.driveLookYaw, 0);
    e.scene.updateMatrixWorld(true);
    assert(
      wheel.getWorldPosition(new THREE.Vector3()).distanceTo(wheelBefore) <
        1e-8,
      'The cabin stays attached to the car',
    );
  }
  nav.destroy();
});

test('an explicit new destination consumes the pending pinch instead of zooming the new trip', () => {
  const { nav, e, close } = returnFixture();
  const touch = (id, x) => ({
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: 100,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    finishLocalMapTransition(e);
    e.travelReturn.down(touch(1, 100));
    e.travelReturn.down(touch(2, 200));
    e.travelReturn.move(touch(2, 240));
    nav.startAt('walk', cameraPoint());
    const distance = nav.cameraDistance;
    e.travelReturn.flushGesture();
    assert.equal(nav.cameraDistance, distance);
    assert.equal(nav.mode, 'walk');
    assert.equal(e.travelReturn.bookmark, null);
    e.travelReturn.up(touch(1, 100));
    e.travelReturn.up(touch(2, 240));
    assert.equal(e.controls.enablePan, true);
  } finally {
    close();
  }
});
const { DriverCameraMotion } = await import(cityModule('driver-camera'));
test('head response is bounded, settles at rest and uses vehicle axes when looking sideways', () => {
  const m = new DriverCameraMotion();
  for (let i = 0; i < 60; i++) m.update(1 / 60, 20, 19, 0.05);
  assert(m.surge < 0 && m.surge >= -0.03);
  assert(m.sway < 0 && m.sway >= -0.03);
  assert(m.pitch > 0 && m.pitch <= 0.006);
  assert(m.roll < 0 && m.roll >= -0.009);
  const world = m.worldRotation(0.7);
  for (const look of [0, 0.7, -1.2]) {
    const camera = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.7 + Math.PI + look,
    );
    const moved = camera.clone().premultiply(world);
    assert(
      moved.clone().multiply(camera.clone().invert()).angleTo(world) < 1e-7,
    );
  }
  for (let i = 0; i < 180; i++) m.update(1 / 60, 0, 0, 0);
  assert(Math.abs(m.sway) < 1e-7 && Math.abs(m.surge) < 1e-7);
  m.reset();
  assert.equal(m.pitch, 0);
  assert.equal(m.roll, 0);
});

test('a pinch can continue as one-finger map rotation without panning or returning', () => {
  const { nav, e, saved, close } = returnFixture();
  const touch = (id, x) => ({
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: 100,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    finishLocalMapTransition(e);
    e.travelReturn.down(touch(1, 100));
    e.travelReturn.down(touch(2, 200));
    e.travelReturn.move(touch(1, 90));
    e.travelReturn.move(touch(2, 210));
    e.travelReturn.flushGesture();
    const radius = e.camera.position.distanceTo(e.controls.target);
    e.travelReturn.up(touch(2, 210));
    const before = e.camera.position.clone();
    e.travelReturn.move(touch(1, 160));
    e.travelReturn.flushGesture();
    e.travelReturn.update();
    assert(e.camera.position.distanceTo(before) > 1);
    assert(
      Math.abs(e.camera.position.distanceTo(e.controls.target) - radius) < 1e-7,
    );
    assert(e.controls.target.distanceTo(saved.position) < 1e-8);
    assert(e.travelReturn.bookmark);
    assert.equal(nav.mode, 'orbit');
    e.travelReturn.up(touch(1, 160));
    assert.equal(e.controls.enablePan, true);
  } finally {
    close();
  }
});

test('rejoining a second finger after a pan keeps gesture ownership without restoring return eligibility', () => {
  const { nav, e, close } = returnFixture();
  const touch = (id, x) => ({
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: 100,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    finishLocalMapTransition(e);
    e.travelReturn.down(touch(1, 100));
    e.travelReturn.down(touch(2, 200));
    e.travelReturn.move(touch(1, 140));
    e.travelReturn.move(touch(2, 240));
    e.travelReturn.flushGesture();
    assert.equal(e.travelReturn.bookmark, null);
    e.travelReturn.up(touch(2, 240));
    e.travelReturn.down(touch(3, 240));
    assert.equal(e.travelReturn.touches.size, 2);
    const target = e.controls.target.clone();
    e.travelReturn.move(touch(1, 50));
    e.travelReturn.move(touch(3, 330));
    e.travelReturn.flushGesture();
    assert.equal(nav.mode, 'orbit');
    assert(e.controls.target.distanceTo(target) < 1e-8);
    assert.equal(e.travelReturn.bookmark, null);
    e.travelReturn.up(touch(1, 50));
    e.travelReturn.up(touch(3, 330));
    assert.equal(e.controls.enablePan, true);
  } finally {
    close();
  }
});
