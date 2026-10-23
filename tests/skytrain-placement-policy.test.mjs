import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { actualTrain, stationOwner } from './helpers/skytrain-geometry.mjs';

const { TravelReturn } = await import(cityModule('travel-return'));
const { WorldSkyTrainRun } = await import(cityModule('skytrain-world-service'));
const service = JSON.parse(
  readFileSync('public/data/transit/skytrain-world-routes.json'),
);
function members(file, className, names, predicate) {
  const source = readFileSync(`lib/city/${file}.ts`, 'utf8'),
    ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true),
    cls = ast.statements.find(
      (node) => ts.isClassDeclaration(node) && node.name?.text === className,
    ),
    selected = cls.members.filter(
      (node) => predicate(node) && names.includes(node.name?.getText(ast)),
    );
  assert.equal(selected.length, names.length);
  return selected.map((node) => node.getText(ast)).join('\n');
}
// Run the actual ownership and map policy; renderer/camera submission is outside
// this fixture and the real asset geometry remains available for pose checks.
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  import { zoomTravel } from '${cityModule('travel-camera')}';
  export class PassengerPolicy {
    ${members('skytrain-travel', 'SkyTrainTravel', ['active', 'passengerSeated', 'interactionOrigin'], ts.isGetAccessorDeclaration)}
    ${members('skytrain-world-travel', 'SkyTrainWorldTravel', ['aboard', 'canResumeOverview'], ts.isGetAccessorDeclaration)}
    ${members('skytrain-world-travel', 'SkyTrainWorldTravel', ['observeOverviewMoved', 'releaseForPlacement', 'setOverview', 'zoom'], ts.isMethodDeclaration)}
    ${members('skytrain-travel', 'SkyTrainTravel', ['resetSeat', 'clearTube', 'publish'], ts.isMethodDeclaration)}
    ${members('skytrain-travel', 'SkyTrainTravel', ['clearInput'], ts.isPropertyDeclaration)}
  }
  export class EnginePlacementPolicy {
    ${members('engine', 'CityEngine', ['prepareTravelPlacement'], ts.isMethodDeclaration)}
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { PassengerPolicy, EnginePlacementPolicy } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

const pageSource = readFileSync('app/page.tsx', 'utf8'),
  pageAst = ts.createSourceFile(
    'page.tsx',
    pageSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  pageNames = [
    'change',
    'finishBusVisit',
    'prepareTravelPlacement',
    'beginPlacement',
    'switchInScene',
    'beginFlight',
    'beginTesla',
    'chooseRocket',
    'beginRocket',
    'switchMode',
    'dragAircraft',
    'dragFigure',
  ],
  pageDeclarations = new Map();
function findPageActions(node) {
  if (
    ts.isVariableDeclaration(node) &&
    pageNames.includes(node.name.getText(pageAst))
  )
    pageDeclarations.set(
      node.name.getText(pageAst),
      `const ${node.getText(pageAst)};`,
    );
  ts.forEachChild(node, findPageActions);
}
findPageActions(pageAst);
assert.equal(pageDeclarations.size, pageNames.length);
const pageCode = ts.transpileModule(
  `
  export function pageActions(deps) {
    const {engine,teslaEntering,ready,setNotice,setSettings,setTour,setPanel,setClean,setPlacing,setMobilePanel,setTeslaPreparing,setRocketChoosing,setMobileHudHidden,setLocalOrbit} = deps;
    ${pageNames.map((name) => pageDeclarations.get(name)).join('\n')}
    return {switchMode,beginPlacement,switchInScene,beginFlight,beginTesla,chooseRocket,beginRocket,dragAircraft,dragFigure};
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { pageActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(pageCode).toString('base64')
);

// Exercise the rendered label/radio wiring too: a correct drag handler is not
// reachable if the JSX special-cases an active station Walk label to undefined.
const modeElements = new Map();
function findModeElements(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(pageAst),
      attrs = node.attributes.properties,
      className = attrs
        .find(
          (attr) =>
            ts.isJsxAttribute(attr) &&
            attr.name.getText(pageAst) === 'className',
        )
        ?.getText(pageAst);
    if (tag === 'label' && className?.includes('mode-pill'))
      modeElements.set('label', node);
    if (tag === 'RadioGroup' && className?.includes('mode-radio'))
      modeElements.set('radio', node);
    if (tag === 'RadioGroupItem' && className?.includes('mode-radio-dot'))
      modeElements.set('item', node);
    if (tag === 'button' && className?.includes('rocket-mode-button'))
      modeElements.set('rocket-button', node);
    if (tag === 'RocketControls') modeElements.set('rocket-controls', node);
  }
  ts.forEachChild(node, findModeElements);
}
findModeElements(pageAst);
function modeExpression(element, name) {
  const attr = modeElements
    .get(element)
    ?.attributes.properties.find(
      (node) => ts.isJsxAttribute(node) && node.name.getText(pageAst) === name,
    );
  assert(attr && ts.isJsxExpression(attr.initializer), `${element}.${name}`);
  return attr.initializer.expression.getText(pageAst);
}
const modeBindingCode = ts.transpileModule(
  `
  export function renderedModeBindings(m, actions, state) {
    const {dragFigure,dragAircraft,beginFlight,switchMode,chooseRocket,beginRocket,engine,setRocketChoosing} = actions;
    const {skyTrainActive,ready,teslaPreparing} = state;
    return {
      onPointerDownCapture: ${modeExpression('label', 'onPointerDownCapture')},
      onClickCapture: ${modeExpression('label', 'onClickCapture')},
      onValueChange: ${modeExpression('radio', 'onValueChange')},
      disabled: ${modeExpression('item', 'disabled')},
      rocket: {
        onClick: ${modeExpression('rocket-button', 'onClick')},
        disabled: ${modeExpression('rocket-button', 'disabled')},
        onChoose: ${modeExpression('rocket-controls', 'onChoose')},
        onCloseChoosing: ${modeExpression('rocket-controls', 'onCloseChoosing')},
      },
    };
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { renderedModeBindings } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(modeBindingCode).toString('base64')
);

// Normalize capture flags to browser semantics on Node's EventTarget fixture.
class BrowserEvents extends EventTarget {
  addEventListener(type, listener, options) {
    super.addEventListener(
      type,
      listener,
      typeof options === 'boolean' ? { capture: options } : options,
    );
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(
      type,
      listener,
      typeof options === 'boolean' ? { capture: options } : options,
    );
  }
}

function fixture(owner, train, { aboard = false, seated = false } = {}) {
  const events = [],
    canvas = new BrowserEvents(),
    camera = new THREE.PerspectiveCamera(65, 1.6, 0.05, 45000),
    controls = Object.assign(new THREE.EventDispatcher(), {
      target: new THREE.Vector3(),
      enabled: false,
      enablePan: true,
      update() {
        this.dispatchEvent({ type: 'change' });
      },
    }),
    lineRoutes = service.routes.filter((route) => route.lineId === 'expo'),
    run = new WorldSkyTrainRun(lineRoutes[0], lineRoutes[1], 70),
    vehicle = { id: 'unchanged-autonomous-train', run, detail: train },
    bench = owner.benchSeats()[0],
    preview = { group: new THREE.Group() },
    nav = {
      mode: 'orbit',
      position: new THREE.Vector3(),
      keys: new Set(['w']),
      touchX: 0.5,
      touchY: 1,
      walker: {
        group: new THREE.Group(),
        setSeated: (value) => events.push(['seated', value]),
      },
      blur() {
        this.keys.clear();
        this.touchX = this.touchY = 0;
      },
      restoreFromMap() {
        assert.fail('new placement must never restore a bookmark');
      },
    },
    city = Object.assign(new EnginePlacementPolicy(), {
      scene: new THREE.Scene(),
      camera,
      controls,
      navigation: nav,
      renderer: { domElement: canvas },
      settings: { mode: 'walk', autoRotate: false },
      elevation: () => 12,
      transition: null,
      interactions: { clear: () => events.push('clear-actions') },
      onLocalOrbit: () => events.push('overview'),
      onTravelResume: (mode) => events.push(['resume', mode]),
      onTravelReturnChange: (mode) => events.push(['bookmark', mode]),
      closeBusVisit: () => true,
    }),
    passenger = Object.assign(new PassengerPolicy(), {
      city,
      phase: aboard ? 'riding' : 'station',
      owner,
      station: owner.data.id,
      line: 'expo',
      direction: 'eastbound',
      level: 'platform',
      foot: structuredClone(bench.stand),
      cabinFoot: train.passengerSpace.doorSpawn('left'),
      stationSeat: !aboard && seated ? bench : null,
      cabinSeat: aboard && seated ? train.passengerSpace.seats[0] : null,
      cabinStand: train.passengerSpace.doorSpawn('left'),
      occupied: aboard ? vehicle : null,
      train,
      previewTrain: preview,
      fleet: [vehicle],
      keys: new Set(['KeyW']),
      axes: { x: 0.5, y: 1 },
      drag: {},
      distanceView: 4,
      overviewAnchor: null,
      overviewMoved: false,
      pathKey: 'retained-service-path',
      arrivalPreparation: null,
      disposed: false,
      busy: false,
      onChange: () => events.push('publish'),
      updateCamera: () => events.push('camera'),
    });
  canvas.focus = () => events.push('focus');
  city.skyTrainTravel = passenger;
  city.travelReturn = new TravelReturn(city);
  city.travelReturn.attach();
  return {
    city,
    passenger,
    vehicle,
    preview,
    events,
    close: () => city.travelReturn.destroy(),
  };
}

test('unmoved Overview preserves station/train ownership, while pan-away-and-back permanently requires new placement', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new BrowserEvents();
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const aboard of [false, true])
      for (const seated of [false, true]) {
        const f = fixture(owner, train, { aboard, seated });
        try {
          const { passenger, city, vehicle } = f,
            foot = passenger.interactionOrigin,
            seat = passenger.cabinSeat ?? passenger.stationSeat;
          assert.equal(passenger.setOverview(true), true);
          assert.equal(passenger.canResumeOverview, true);
          const anchor = city.controls.target.clone();
          city.camera.position
            .sub(anchor)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.8)
            .multiplyScalar(1.2)
            .add(anchor);
          city.controls.target.y += 20;
          city.controls.update();
          assert.equal(
            passenger.canResumeOverview,
            true,
            'rotation, dolly and vertical target changes retain resume',
          );
          if (aboard) vehicle.run.advance(20);
          assert.equal(passenger.setOverview(false), true);
          assert.deepEqual(passenger.interactionOrigin, foot);
          assert.equal(passenger.cabinSeat ?? passenger.stationSeat, seat);
          assert.equal(passenger.occupied, aboard ? vehicle : null);
          assert.equal(passenger.setOverview(true), true);
          const origin = city.controls.target.clone();
          city.controls.target.x += 2.1;
          city.controls.update();
          assert.equal(passenger.canResumeOverview, false);
          city.controls.target.copy(origin);
          city.controls.update();
          assert.equal(
            passenger.canResumeOverview,
            false,
            'returning the map cannot revive old ownership',
          );
          const camera = city.camera.position.toArray(),
            target = city.controls.target.toArray();
          assert.equal(passenger.setOverview(true), true);
          assert.deepEqual(city.camera.position.toArray(), camera);
          assert.deepEqual(city.controls.target.toArray(), target);
          assert.equal(passenger.setOverview(false), false);
          assert.equal(city.settings.mode, 'orbit');
          assert.deepEqual(passenger.interactionOrigin, foot);
        } finally {
          f.close();
        }
      }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('each explicit travel mode releases old passenger ownership without moving Overview or resetting any service', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new BrowserEvents();
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const mode of ['walk', 'drive', 'boat', 'flight', 'tesla'])
      for (const aboard of [false, true])
        for (const seated of [false, true]) {
          const f = fixture(owner, train, { aboard, seated });
          try {
            const { passenger, city, vehicle, preview } = f;
            passenger.setOverview(true);
            city.controls.target.x += 400;
            city.controls.target.z -= 250;
            city.camera.position.x += 400;
            city.camera.position.z -= 250;
            city.controls.update();
            city.travelReturn.remember({
              mode: 'walk',
              position: city.controls.target.clone(),
            });
            city.travelReturn.gesture = { kind: 'pinch' };
            const before = {
              camera: city.camera.position.toArray(),
              target: city.controls.target.toArray(),
              elapsed: vehicle.run.snapshot().elapsed,
              trainPosition: train.group.position.toArray(),
              trainFrame: train.passengerFrame,
              ownerParent: owner.group.parent,
            };
            assert.equal(city.prepareTravelPlacement(), true, mode);
            assert.equal(passenger.active, false);
            assert.equal(passenger.aboard, false);
            assert.equal(passenger.passengerSeated, false);
            assert.equal(passenger.owner, null);
            assert.equal(passenger.foot, null);
            assert.equal(passenger.cabinFoot, null);
            assert.equal(passenger.train, preview);
            assert.equal(passenger.fleet[0], vehicle);
            assert.equal(vehicle.detail, train);
            assert.equal(vehicle.run.snapshot().elapsed, before.elapsed);
            assert.equal(train.passengerFrame, before.trainFrame);
            assert.equal(owner.group.parent, before.ownerParent);
            assert.deepEqual(
              train.group.position.toArray(),
              before.trainPosition,
            );
            assert.equal(owner.stats().disposed, false);
            assert.equal(passenger.keys.size, 0);
            assert.deepEqual(passenger.axes, { x: 0, y: 0 });
            assert.equal(city.navigation.mode, 'orbit');
            assert.equal(city.navigation.walker.group.visible, false);
            assert.equal(city.travelReturn.bookmark, null);
            assert.equal(city.travelReturn.gesture.kind, 'consumed');
            assert.deepEqual(city.camera.position.toArray(), before.camera);
            assert.deepEqual(city.controls.target.toArray(), before.target);
            // A cancelled/invalid preview owns no bookmark and leaves the map.
            city.placement = { mode };
            city.travelReturn.update();
            city.placement = null;
            city.travelReturn.update();
            assert.equal(passenger.setOverview(false), false);
            assert.deepEqual(city.camera.position.toArray(), before.camera);
            assert.deepEqual(city.controls.target.toArray(), before.target);
            assert.equal(vehicle.run.advance(8).elapsed, before.elapsed + 8);
            assert.equal(
              passenger.releaseForPlacement(),
              true,
              'release is idempotent',
            );
          } finally {
            f.close();
          }
        }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('station zoom naturally reaches Overview and a direct new-placement intent first opens a usable map', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new BrowserEvents();
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const aboard of [false, true]) {
      const f = fixture(owner, train, { aboard });
      try {
        f.passenger.zoom(3);
        assert.equal(f.city.settings.mode, 'walk');
        assert(
          f.passenger.distanceView > 14,
          'logical zoom retains its normal map threshold',
        );
        f.passenger.zoom(20);
        assert.equal(f.city.settings.mode, 'orbit');
        assert.equal(f.passenger.canResumeOverview, true);
        f.passenger.setOverview(false);
        assert.equal(f.city.settings.mode, 'walk');
        assert.equal(f.passenger.releaseForPlacement(), true);
        assert.equal(f.city.settings.mode, 'orbit');
        assert.equal(f.passenger.active, false);
        assert(f.city.camera.position.distanceTo(f.city.controls.target) > 100);
      } finally {
        f.close();
      }
    }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('mobile observer pinch retains resume while two-finger translation permanently chooses a new map location', async () => {
  const originalWindow = globalThis.window,
    originalRAF = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame;
  globalThis.window = new BrowserEvents();
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  const touch = (id, x) => ({
    pointerType: 'touch',
    pointerId: id,
    clientX: x,
    clientY: 100,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  try {
    for (const kind of ['pinch', 'pan']) {
      const f = fixture(owner, train);
      try {
        f.passenger.setOverview(true);
        const anchor = f.city.controls.target.clone();
        f.city.completeLocalMapTransition = () => {};
        f.city.controls.rotateSpeed = 0.65;
        f.city.renderer.domElement.clientHeight = 800;
        f.city.zoom = (factor) => {
          f.city.camera.position
            .sub(f.city.controls.target)
            .multiplyScalar(factor)
            .add(f.city.controls.target);
          f.city.controls.update();
        };
        const mapReturn = f.city.travelReturn;
        assert.equal(
          mapReturn.bookmark,
          null,
          'world observers have no normal street bookmark',
        );
        mapReturn.down(touch(1, 100));
        mapReturn.down(touch(2, 200));
        assert.equal(mapReturn.gesture.kind, 'pending');
        mapReturn.move(touch(1, kind === 'pinch' ? 40 : 140));
        mapReturn.move(touch(2, kind === 'pinch' ? 260 : 240));
        mapReturn.flushGesture();
        assert.equal(mapReturn.gesture.kind, kind);
        if (kind === 'pinch') {
          assert(f.city.controls.target.distanceTo(anchor) < 1e-8);
          assert.equal(f.passenger.canResumeOverview, true);
        } else {
          assert(f.city.controls.target.distanceTo(anchor) > 2);
          assert.equal(f.passenger.canResumeOverview, false);
          f.city.controls.target.copy(anchor);
          f.city.controls.update();
          assert.equal(f.passenger.canResumeOverview, false);
        }
        mapReturn.up(touch(1, 40));
        mapReturn.up(touch(2, 260));
        assert.equal(f.city.controls.enablePan, true);
      } finally {
        f.close();
      }
    }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalRAF === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRAF;
    if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancel;
  }
});

function actionsFor(f) {
  const { city, events } = f;
  city.placement = {
    mode: null,
    begin(mode) {
      this.mode = mode;
      events.push(['placement', mode]);
    },
    cancel() {
      this.mode = null;
    },
    startDrag() {
      events.push('figure-drag');
    },
  };
  city.flight = {
    clear() {},
    cancelPlacement() {},
    beginPlacement() {
      events.push(['placement', 'flight']);
    },
    startDrag() {
      events.push(['placement', 'flight-drag']);
    },
  };
  city.tesla = {
    enter(options) {
      assert.deepEqual(options, { localOnly: true });
      events.push(['placement', 'tesla']);
      return true;
    },
  };
  city.rocket = {
    active: false,
    placing: false,
    returnToCity() {
      this.active = this.placing = false;
    },
    cancelPlacement() {
      this.placing = false;
      events.push('rocket-cancel');
    },
    beginPlacement(kind) {
      this.placing = true;
      events.push(['placement', 'rocket', kind]);
    },
  };
  city.leaveTravelAtLocation = () => {
    assert.equal(city.navigation.mode, 'orbit');
  };
  city.navigation.switchStreetMode = () => {
    assert.equal(
      city.navigation.mode,
      'orbit',
      'an old station pose cannot be reused by an in-scene switch',
    );
    return false;
  };
  city.navigation.setMode = () =>
    assert.fail(
      'a new placement cannot commit an unvalidated navigation point',
    );
  const deps = {
    engine: { current: city },
    teslaEntering: { current: false },
    ready: true,
    setNotice: (value) => events.push(['notice', value]),
    setSettings: (value) => {
      city.settings =
        typeof value === 'function' ? value(city.settings) : value;
    },
    setTour() {},
    setPanel() {},
    setClean() {},
    setPlacing() {},
    setMobilePanel() {},
    setTeslaPreparing() {},
    setRocketChoosing(value) {
      city.rocketChoosing = value;
    },
    setMobileHudHidden() {},
    setLocalOrbit() {},
  };
  return Object.assign(pageActions(deps), {
    engine: deps.engine,
    setRocketChoosing: (value) => deps.setRocketChoosing(value),
  });
}

test('actual page desktop/mobile entry actions dispatch every new placement after a moved station/train Overview', async () => {
  const originalWindow = globalThis.window,
    originalRAF = globalThis.requestAnimationFrame;
  globalThis.window = new BrowserEvents();
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const aboard of [false, true])
      for (const action of [
        'walk',
        'drive',
        'boat',
        'flight',
        'tesla',
        'drag-walk',
        'drag-drive',
        'drag-boat',
        'drag-flight',
      ]) {
        const f = fixture(owner, train, { aboard, seated: true });
        try {
          f.passenger.setOverview(true);
          f.city.controls.target.x += 100;
          f.city.camera.position.x += 100;
          f.city.controls.update();
          const camera = f.city.camera.position.toArray(),
            target = f.city.controls.target.toArray(),
            actions = actionsFor(f),
            event = {
              button: 0,
              pointerId: 2,
              nativeEvent: {},
              currentTarget: { setPointerCapture() {} },
              preventDefault() {},
              stopPropagation() {},
            };
          if (action === 'drag-flight') actions.dragAircraft(event);
          else if (action.startsWith('drag-'))
            actions.dragFigure(event, action.slice(5));
          else actions.switchMode(action);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const expected =
            action === 'drag-flight'
              ? 'flight-drag'
              : action.replace('drag-', '');
          assert(
            f.events.some(
              (row) =>
                Array.isArray(row) &&
                row[0] === 'placement' &&
                row[1] === expected,
            ),
            `${aboard ? 'train' : 'station'}: ${action}`,
          );
          assert.equal(f.passenger.active, false);
          assert.equal(f.city.navigation.mode, 'orbit');
          assert.equal(f.city.settings.mode, 'orbit');
          assert.deepEqual(f.city.camera.position.toArray(), camera);
          assert.deepEqual(f.city.controls.target.toArray(), target);
          actions.switchMode('orbit');
          f.city.travelReturn.update();
          assert.equal(
            f.city.settings.mode,
            'orbit',
            'cancelled placement remains at the new map location',
          );
        } finally {
          f.close();
        }
      }
    for (const aboard of [false, true]) {
      const f = fixture(owner, train, { aboard });
      try {
        f.passenger.setOverview(true);
        actionsFor(f).switchMode('walk');
        assert.equal(f.city.settings.mode, 'walk');
        assert.equal(f.passenger.active, true);
        assert.equal(
          f.events.some((row) => Array.isArray(row) && row[0] === 'placement'),
          false,
        );
      } finally {
        f.close();
      }
    }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalRAF === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRAF;
  }
});

test('rendered Walk label supports new mouse/touch drag placement after map movement and preserves unmoved resume', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new BrowserEvents();
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const aboard of [false, true])
      for (const state of ['walking', 'unmoved-overview', 'moved-overview'])
        for (const pointerType of ['mouse', 'touch', 'keyboard']) {
          const f = fixture(owner, train, { aboard, seated: true });
          try {
            f.city.navigation.mode = 'walk';
            if (state !== 'walking') f.passenger.setOverview(true);
            if (state === 'moved-overview') {
              f.city.controls.target.x += 100;
              f.city.camera.position.x += 100;
              f.city.controls.update();
            }
            const actions = actionsFor(f),
              rendered = renderedModeBindings({ id: 'walk' }, actions, {
                skyTrainActive: true,
                ready: true,
                teslaPreparing: false,
              }),
              camera = f.city.camera.position.toArray(),
              target = f.city.controls.target.toArray(),
              calls = [],
              event = {
                button: 0,
                pointerType,
                pointerId: 4,
                detail: pointerType === 'keyboard' ? 0 : 1,
                nativeEvent: { pointerType },
                currentTarget: {
                  setPointerCapture: (id) => calls.push(['capture', id]),
                },
                preventDefault: () => calls.push('prevent'),
                stopPropagation: () => calls.push('stop'),
              };
            assert.equal(rendered.disabled, false);
            assert.equal(
              typeof rendered.onPointerDownCapture,
              'function',
              'the rendered active Walk label must expose its drag handler',
            );
            if (pointerType === 'keyboard') {
              rendered.onClickCapture(event);
              assert.deepEqual(calls, [], 'keyboard click reaches the radio');
              // A selected radio does not emit a new value, so current Walk has
              // no keyboard mode change. Overview does select Walk anew.
              if (state !== 'walking') rendered.onValueChange('walk');
            } else {
              rendered.onPointerDownCapture(event);
              assert(calls.includes('prevent'));
              assert(calls.includes('stop'));
              const beforeClick = f.events.length;
              rendered.onClickCapture(event);
              assert.equal(
                f.events.length,
                beforeClick,
                'the synthetic pointer click must not dispatch another action',
              );
            }
            const placements = f.events.filter(
              (row) => Array.isArray(row) && row[0] === 'placement',
            );
            if (state === 'moved-overview') {
              assert.deepEqual(placements, [['placement', 'walk']]);
              assert.equal(f.passenger.active, false);
              assert.equal(f.city.navigation.mode, 'orbit');
              assert.equal(f.city.settings.mode, 'orbit');
              assert.deepEqual(f.city.camera.position.toArray(), camera);
              assert.deepEqual(f.city.controls.target.toArray(), target);
              assert.equal(
                calls.some((row) => Array.isArray(row) && row[0] === 'capture'),
                pointerType !== 'keyboard',
              );
              assert.equal(
                f.events.includes('figure-drag'),
                pointerType !== 'keyboard',
              );
            } else {
              assert.deepEqual(placements, []);
              assert.equal(f.passenger.active, true);
              assert.equal(f.city.settings.mode, 'walk');
              assert.equal(f.passenger.passengerSeated, true);
              assert.equal(calls.some(Array.isArray), false);
              assert.equal(f.events.includes('figure-drag'), false);
              if (pointerType !== 'keyboard')
                assert(f.events.includes('focus'));
            }
          } finally {
            f.close();
          }
        }
    const actions = {};
    for (const id of ['orbit', 'walk', 'drive', 'boat', 'flight', 'tesla']) {
      const bindings = renderedModeBindings({ id }, actions, {
        skyTrainActive: true,
        ready: true,
        teslaPreparing: false,
      });
      assert.equal(
        bindings.disabled,
        false,
        `${id} stays available on a train`,
      );
      assert.equal(
        renderedModeBindings({ id }, actions, {
          skyTrainActive: true,
          ready: true,
          teslaPreparing: true,
        }).disabled,
        true,
        `${id} still respects an in-progress Tesla entry`,
      );
    }
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('rendered Rocket button and chooser release transit ownership before all rocket placements and retain the map on cancel', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new BrowserEvents();
  const owner = stationOwner('waterfront'),
    train = await actualTrain('expo');
  try {
    for (const aboard of [false, true])
      for (const moved of [false, true])
        for (const pointerType of ['mouse', 'touch', 'keyboard'])
          for (const choice of ['cancel', 'small', 'large', 'super-heavy']) {
            const f = fixture(owner, train, { aboard, seated: true });
            try {
              f.passenger.setOverview(true);
              if (moved) {
                f.city.controls.target.z += 130;
                f.city.camera.position.z += 130;
                f.city.controls.update();
              }
              const actions = actionsFor(f),
                bindings = renderedModeBindings({ id: 'walk' }, actions, {
                  skyTrainActive: true,
                  ready: true,
                  teslaPreparing: false,
                }).rocket,
                camera = f.city.camera.position.toArray(),
                target = f.city.controls.target.toArray(),
                elapsed = f.vehicle.run.snapshot().elapsed;
              assert.equal(bindings.disabled, false);
              bindings.onClick({
                pointerType,
                detail: pointerType === 'keyboard' ? 0 : 1,
              });
              assert.equal(f.city.rocketChoosing, true);
              assert.equal(f.passenger.active, false);
              assert.equal(f.passenger.occupied, null);
              assert.equal(f.passenger.passengerSeated, false);
              assert.equal(f.city.navigation.mode, 'orbit');
              assert.equal(f.city.settings.mode, 'orbit');
              assert.equal(f.vehicle.run.snapshot().elapsed, elapsed);
              assert.equal(owner.stats().disposed, false);
              assert.equal(f.city.rocket.placing, false);
              assert.equal(
                f.events.some(
                  (row) => Array.isArray(row) && row[0] === 'placement',
                ),
                false,
                'opening the chooser must not select or commit a launch site',
              );
              if (choice === 'cancel') {
                bindings.onCloseChoosing();
                assert.equal(f.city.rocketChoosing, false);
                assert.equal(f.city.rocket.placing, false);
                f.city.travelReturn.update();
                assert.equal(f.passenger.setOverview(false), false);
              } else {
                bindings.onChoose(choice);
                assert.equal(f.city.rocketChoosing, false);
                assert.equal(f.city.rocket.placing, true);
                assert.deepEqual(
                  f.events.filter(
                    (row) => Array.isArray(row) && row[0] === 'placement',
                  ),
                  [['placement', 'rocket', choice]],
                );
              }
              assert.deepEqual(f.city.camera.position.toArray(), camera);
              assert.deepEqual(f.city.controls.target.toArray(), target);
              assert.equal(f.city.settings.mode, 'orbit');
              assert.equal(f.vehicle.run.advance(5).elapsed, elapsed + 5);
            } finally {
              f.close();
            }
          }
    assert.equal(
      renderedModeBindings(
        { id: 'walk' },
        {},
        {
          skyTrainActive: true,
          ready: true,
          teslaPreparing: true,
        },
      ).rocket.disabled,
      true,
    );
  } finally {
    owner.dispose();
    train.dispose();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
