import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaController } = await import(cityModule('tesla-controller'));
const { CityTeslaWorld } = await import(cityModule('tesla-city-world'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { project } = await import(cityModule('geo'));
const { VIEWS } = await import(cityModule('types'));
const { FlightController } = await import(cityModule('flight-controller'));
const { MapPlacement } = await import(cityModule('placement'));
const { createFlight } = await import(cityModule('flight-state'));
const { createTesla } = await import(cityModule('tesla-state'));
const { TESLA_ROADSTER_DIMENSIONS } = await import(
  cityModule('assets/tesla-roadster-contract')
);
const FLOOR = {
  surfaceId: 'ground-floor',
  kind: 'ground',
  point: [0, 0, 0],
  normal: [0, 1, 0],
  adherable: true,
};
const HEIGHT = TESLA_ROADSTER_DIMENSIONS.halfExtents[1] + 0.06;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

// Execute the production methods without acquiring a browser renderer or
// loading GLBs. The asynchronous asset completion is the only substituted
// part of the bus handoff below.
const engineSource = ts.createSourceFile(
  'engine.ts',
  readFileSync(new URL('../lib/city/engine.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const engineClass = engineSource.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
);
const transitMethods = [
  'visitBusInterior',
  'publishBusVisit',
  'closeBusVisit',
  'applySettings',
];
const transitMembers = engineClass.members.filter(
  (node) =>
    ts.isMethodDeclaration(node) &&
    transitMethods.includes(node.name.getText(engineSource)),
);
assert.equal(transitMembers.length, transitMethods.length);
const elevationMember = engineClass.members.find(
  (node) =>
    ts.isMethodDeclaration(node) &&
    node.name.getText(engineSource) === 'rawElevation',
);
assert.ok(elevationMember);
const rawElevationCode = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}';
   import { unproject } from '${cityModule('geo')}';
   export const actualRawElevation = ({${elevationMember.getText(engineSource)}}).rawElevation;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { actualRawElevation } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(rawElevationCode).toString('base64')
);
const engineCode = ts.transpileModule(
  `export class TransitEngineHarness {${transitMembers.map((node) => node.getText(engineSource)).join('\n')}}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const { TransitEngineHarness } = await import(
  'data:text/javascript;base64,' + Buffer.from(engineCode).toString('base64')
);
const appSource = ts.createSourceFile(
  'page.tsx',
  readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let busAction;
const findBusAction = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(appSource) === 'visitBus'
  )
    busAction = node.initializer;
  ts.forEachChild(node, findBusAction);
};
findBusAction(appSource);
assert.ok(busAction && ts.isArrowFunction(busAction));
const busActionCode = ts.transpileModule(
  `export function actualBusAction({engine,ready,setSettings,setTour,setPanel,setPlacing,setMobilePanel,setLocalOrbit,setClean}) {
    return ${busAction.getText(appSource)};
  }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const { actualBusAction } = await import(
  'data:text/javascript;base64,' + Buffer.from(busActionCode).toString('base64')
);

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const records = this.listeners.get(type) ?? [];
    if (!records.some((r) => r.callback === callback && r.capture === capture))
      records.push({ callback, capture });
    this.listeners.set(type, records);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (r) => r.callback !== callback || r.capture !== capture,
      ),
    );
    super.removeEventListener(type, callback, options);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (n, records) => n + records.length,
      0,
    );
  }
}
class InputElement extends TrackedTarget {
  constructor(kind = 'canvas') {
    super();
    this.kind = kind;
    this.dataset = {};
    this.focusCalls = 0;
    this.captured = [];
  }
  closest(selector) {
    const needles = {
      input: 'input',
      textarea: 'textarea',
      dialog: '[role="dialog"]',
      slider: '[role="slider"]',
      combobox: '[role="combobox"]',
      radio: '[role="radio"]',
      button: 'button',
      link: 'a',
      editable: '[contenteditable="true"]',
    };
    return needles[this.kind] && selector.includes(needles[this.kind])
      ? this
      : null;
  }
  focus() {
    this.focusCalls++;
  }
  setPointerCapture(id) {
    this.captured.push(id);
  }
}
function key(code, extra = {}) {
  return {
    code,
    target: null,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  };
}
const pointer = (id, x, y) => ({
  pointerId: id,
  button: 0,
  clientX: x,
  clientY: y,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopImmediatePropagation() {},
});
function setup(t) {
  const globals = Object.fromEntries(
    ['window', 'document', 'Element', 'performance'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const win = new TrackedTarget(),
    doc = new TrackedTarget(),
    canvas = new InputElement();
  let clock = 1_000;
  doc.hidden = false;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: win },
    document: { configurable: true, writable: true, value: doc },
    Element: { configurable: true, writable: true, value: InputElement },
    performance: {
      configurable: true,
      writable: true,
      value: { now: () => clock },
    },
  });
  const calls = {
    spawn: [],
    legacyModes: [],
    aircraftClears: 0,
    placementCancels: 0,
    invalidations: 0,
    preparations: 0,
    worldDisposals: 0,
    orbits: 0,
    settings: [],
    launch: [],
  };
  const identities = new Map([
    [
      FLOOR.surfaceId,
      { surfaceId: 'ground', layer: 0, allowedModes: ['walk', 'drive'] },
    ],
  ]);
  const world = {
    groundPoseNear(
      position,
      shape,
      heading,
      radius,
      identity = { surfaceId: 'ground', layer: 0 },
      acceptsPlacement,
    ) {
      calls.spawn.push({ position, shape, heading, radius, identity });
      const ordinary = identity.surfaceId === 'ground' && identity.layer === 0;
      const surfaceId = ordinary
        ? FLOOR.surfaceId
        : `protected:${identity.surfaceId}:${identity.layer}:face:0`;
      const physicalIdentity = { ...identity, allowedModes: ['walk', 'drive'] };
      identities.set(surfaceId, physicalIdentity);
      const floorY = ordinary ? 0 : 8;
      const state = createTesla(
        [position[0], HEIGHT + floorY, position[2]],
        heading,
        FLOOR,
      );
      const candidate = {
        pose: { position: state.position, quaternion: state.quaternion },
        contact: {
          ...FLOOR,
          surfaceId,
          point: [position[0], floorY, position[2]],
        },
        identity: physicalIdentity,
      };
      return !acceptsPlacement || acceptsPlacement(candidate)
        ? candidate
        : null;
    },
    identity: (contact) => identities.get(contact.surfaceId) ?? null,
    hasLaunchClearance(candidate) {
      calls.launch.push(candidate);
      return true;
    },
    support(query) {
      const surfaceId = query.preferredSurfaceId ?? FLOOR.surfaceId,
        identity = identities.get(surfaceId),
        floorY =
          identity && (identity.surfaceId !== 'ground' || identity.layer !== 0)
            ? 8
            : 0;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
        new THREE.Quaternion(...query.pose.quaternion),
      );
      if (
        up.y < 0.98 ||
        query.pose.position[1] - floorY > query.maxDistance ||
        query.pose.position[1] < floorY
      )
        return null;
      return {
        ...FLOOR,
        surfaceId,
        point: [query.pose.position[0], floorY, query.pose.position[2]],
      };
    },
    sweep: () => null,
    cameraSweep: () => null,
    stats: () => ({ cachedTiles: 1 }),
    dispose: () => {
      calls.worldDisposals++;
    },
  };
  const e = {
    renderer: { domElement: canvas },
    camera: new THREE.PerspectiveCamera(42, 1.6, 2, 50_000),
    scene: new THREE.Scene(),
    controls: {
      target: new THREE.Vector3(),
      enabled: true,
      autoRotate: false,
      minDistance: 28,
      update() {},
    },
    settings: { mode: 'orbit', quality: 'high', autoRotate: false },
    navigation: {
      mode: 'orbit',
      position: new THREE.Vector3(0, HEIGHT, 0),
      yaw: 0,
      surfaceId: 'ground',
      surfaceLayer: 0,
      setMode(mode) {
        calls.legacyModes.push(mode);
        this.mode = mode;
      },
    },
    data: {},
    clock: { hour: 14 },
    compatibleGraphics: false,
    transition: null,
    elevation: () => 0,
    closeBusVisit: () => true,
    placement: {
      cancel: () => {
        calls.placementCancels++;
      },
    },
    flight: {
      clear: () => {
        calls.aircraftClears++;
      },
    },
    travelReturn: {
      invalidate: () => {
        calls.invalidations++;
      },
    },
    applySettings(settings) {
      calls.settings.push(settings);
      this.settings = settings;
    },
    prepareNightReceivers() {
      calls.preparations++;
    },
    onTeslaMode() {},
    onLocalOrbit() {
      calls.orbits++;
    },
  };
  e.camera.position.set(0, 30, -50);
  const c = new TeslaController(e);
  c.world = world;
  t.after(() => {
    c.destroy();
    for (const [name, descriptor] of Object.entries(globals))
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  const tick = (dt = 1 / 60) => {
    clock += dt * 1_000;
    c.update(dt);
  };
  return {
    c,
    e,
    world,
    calls,
    canvas,
    win,
    doc,
    tick,
    advanceClock: (ms) => {
      clock += ms;
    },
  };
}

test('entry requires a real spawn before taking legacy navigation, aircraft or camera ownership', (t) => {
  const { c, e, world, calls } = setup(t);
  e.navigation.mode = 'walk';
  world.groundPoseNear = () => null;
  assert.equal(c.enter(), false);
  assert.equal(c.warning, 'no-spawn');
  assert.equal(c.active, false);
  assert.equal(c.model, null);
  assert.equal(e.navigation.mode, 'walk');
  assert.equal(e.controls.enabled, true);
  assert.equal(calls.aircraftClears, 0);
  assert.equal(calls.placementCancels, 0);
  assert.equal(calls.invalidations, 0);
  assert.equal(calls.settings.length, 0);
  e.closeBusVisit = () => false;
  assert.equal(c.enter(), false);
});

test('overview entry uses the fallback road heading when no local road is verified', (t) => {
  const { c, e, world, calls } = setup(t);
  const [rx, rz] = project([-123.12416073213134, 49.2841737758357]);
  e.data.roadGraph = {
    nodes: [
      { level: 'ground', point: [0, -40] },
      { level: 'ground', point: [0, 40] },
      { level: 'ground', point: [rx - 40, rz] },
      { level: 'ground', point: [rx + 40, rz] },
    ],
    edges: [
      { a: 0, b: 1, width: 8, classes: [] },
      { a: 2, b: 3, width: 8, classes: [] },
    ],
  };
  const original = world.groundPoseNear.bind(world);
  let first = true;
  world.groundPoseNear = (...args) => {
    if (first) {
      first = false;
      calls.spawn.push({ identity: args[4], heading: args[2] });
      return null;
    }
    return original(...args);
  };
  assert.equal(c.enter(), true);
  assert.deepEqual(calls.spawn[0].identity, {
    surfaceId: 'ground',
    layer: 0,
  });
  close(calls.spawn[0].heading, 0);
  close(c.state.heading, Math.PI / 2);
  close(calls.spawn[1].heading, Math.PI / 2);
  assert.equal(e.settings.mode, 'tesla');
  assert.equal(e.navigation.mode, 'orbit');
});

function offerNearbyOpenCandidate(world) {
  const original = world.groundPoseNear.bind(world);
  world.groundPoseNear = (...args) => {
    const first = original(...args.slice(0, 5));
    if (!first) return null;
    const next = structuredClone(first);
    next.pose.position[0] += 8;
    next.contact.point[0] += 8;
    return (
      [first, next].find((candidate) => !args[5] || args[5](candidate)) ?? null
    );
  };
}

test('overview entry prefers the open Robson road before a locally verified but covered road', (t) => {
  const { c, e, world, calls } = setup(t),
    [rx, rz] = project([-123.12416073213134, 49.2841737758357]);
  e.data.roadGraph = {
    nodes: [
      { level: 'ground', point: [0, -40] },
      { level: 'ground', point: [0, 40] },
      { level: 'ground', point: [rx - 40, rz] },
      { level: 'ground', point: [rx + 40, rz] },
    ],
    edges: [
      { a: 0, b: 1, width: 8, classes: [] },
      { a: 2, b: 3, width: 8, classes: [] },
    ],
  };
  world.hasLaunchClearance = (candidate) =>
    Math.abs(candidate.pose.position[0] - rx) < 1e-8;
  assert.equal(c.enter(), true);
  close(c.state.position[0], rx);
  close(c.state.position[2], rz);
  close(c.state.heading, Math.PI / 2);
  assert.equal(calls.spawn.length, 2);
  assert.deepEqual(
    calls.spawn.map((call) => call.radius),
    [48, 64],
  );
});

test('the actual default overview enters a verified road with twenty metres of clearance instead of its covered first road', (t) => {
  const { c, e } = setup(t),
    saved = JSON.parse(
      readFileSync(
        new URL('./fixtures/tesla-default-entry-canopy.json', import.meta.url),
        'utf8',
      ),
    ),
    overview = project(VIEWS.find((view) => view.id === 'overview').coord),
    geometries = [],
    material = new THREE.MeshBasicMaterial();
  assert.deepEqual(overview, saved.provenance.center);
  const adaptedShape = structuredClone(saved.shape);
  adaptedShape.groundSupport.wheelRadius = 0.35;
  adaptedShape.groundSupport.bodySections[0].clearance = 0.085;
  assert.deepEqual(c.shape, adaptedShape);
  e.roads = new THREE.Group();
  e.terrain = new THREE.Group();
  for (const source of saved.groundMeshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(source.vertices, 3),
    );
    const mesh = new THREE.Mesh(geometry, material);
    Object.assign(mesh.userData, {
      asphaltSurface: source.asphaltSurface,
      walkSurface: true,
      surfaceId: 'ground',
      layer: 0,
      level: 'ground',
    });
    e.roads.add(mesh);
    geometries.push(geometry);
  }
  e.data = {
    flightBuildingVolumes: saved.flightBuildingVolumes,
    buildingRoofs: new Map(saved.buildingRoofs),
    streetLampPoints: saved.streetLampPoints,
    roadGraph: saved.provenance.headingInfo.graph,
    roadRelief: () => saved.provenance.input[1] - 1.05,
    elevation: JSON.parse(
      readFileSync(
        new URL('../public/data/terrain.json', import.meta.url),
        'utf8',
      ),
    ),
  };
  e.settings.buildings = true;
  e.landmarkDetails = [];
  e.detailedTrees = { trees: saved.trees };
  e.streetFurniture = null;
  // The fixture is inland, outside the beach replacements. Execute the real
  // engine DEM sampler for lamp bases and the controller's AGL status.
  e.elevation = (x, z) => actualRawElevation.call(e, x, z);
  saved.streetLampPoints.forEach(([x, z], i) =>
    close(e.elevation(x, z), saved.streetLampElevations[i]),
  );
  e.controls.target.set(overview[0], 0, overview[1]);
  c.world = new CityTeslaWorld(e);
  t.after(() => {
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
  });
  const original = c.world.groundPoseNear(
    saved.provenance.input,
    c.shape,
    saved.provenance.heading,
    48,
  );
  assert.ok(original, 'the old first road remains physically driveable');
  original.pose.position.forEach((value, i) =>
    close(value, saved.bad.pose.position[i]),
  );
  assert.equal(c.world.hasLaunchClearance(original, c.shape), false);
  const start = {
      ...original.pose,
      position: original.pose.position.map(
        (value, i) => value + (i === 1 ? 0.35 : 0),
      ),
    },
    top = {
      ...original.pose,
      position: original.pose.position.map(
        (value, i) => value + (i === 1 ? 20 : 0),
      ),
    };
  assert.match(
    c.world.sweep({ from: start, to: top, shape: c.shape })?.surfaceId ?? '',
    /^tree:\d+:crown/,
    'the old entry is blocked by real extracted canopy geometry',
  );
  assert.equal(c.enter(), true);
  c.state.position.forEach((value, i) =>
    close(value, saved.open.pose.position[i]),
  );
  c.state.quaternion.forEach((value, i) =>
    close(value, saved.open.pose.quaternion[i]),
  );
  close(c.state.heading, saved.provenance.heading);
  assert.deepEqual(c.world.identity(c.state.contact), {
    surfaceId: 'ground',
    layer: 0,
    allowedModes: ['walk', 'drive'],
  });
  assert.equal(
    c.world.hasLaunchClearance(
      { pose: c.state, contact: c.state.contact },
      c.shape,
    ),
    true,
    'actual Enter selects a newly proved twenty-metre upward vehicle corridor',
  );
});

test('a protected street entry prefers a nearby clear candidate on its original physical floor', (t) => {
  const { c, e, world, calls } = setup(t);
  e.navigation.mode = 'drive';
  e.navigation.surfaceId = 'bridge-road';
  e.navigation.surfaceLayer = 1;
  e.navigation.yaw = 0.25;
  offerNearbyOpenCandidate(world);
  world.hasLaunchClearance = (candidate) => candidate.pose.position[0] >= 8;
  assert.equal(c.enter(), true);
  close(c.state.position[0], 8);
  close(c.state.position[1], HEIGHT + 8);
  close(c.state.heading, 0.25);
  assert.equal(calls.spawn.length, 1);
  assert.deepEqual(calls.spawn[0].identity, {
    surfaceId: 'bridge-road',
    layer: 1,
  });
  assert.deepEqual(world.identity(c.state.contact), {
    surfaceId: 'bridge-road',
    layer: 1,
    allowedModes: ['walk', 'drive'],
  });
});

test('a covered protected street keeps its verified local pose and never falls through to ordinary ground', (t) => {
  const { c, e, world, calls } = setup(t);
  e.navigation.mode = 'walk';
  e.navigation.surfaceId = 'bridge-road';
  e.navigation.surfaceLayer = 1;
  world.hasLaunchClearance = () => false;
  assert.equal(c.enter(), true);
  close(c.state.position[0], 0);
  close(c.state.position[1], HEIGHT + 8);
  assert.equal(calls.spawn.length, 1);
  assert.deepEqual(calls.spawn[0].identity, {
    surfaceId: 'bridge-road',
    layer: 1,
  });
  c.recover();
  close(c.state.position[1], HEIGHT + 8);
  assert.equal(calls.spawn.length, 2);
  assert.deepEqual(calls.spawn[1].identity, {
    surfaceId: 'bridge-road',
    layer: 1,
  });
});

test('an unavailable protected street refuses entry instead of trying an unrelated ground floor', (t) => {
  const { c, e, world, calls } = setup(t),
    queries = [];
  e.navigation.mode = 'drive';
  e.navigation.surfaceId = 'bridge-road';
  e.navigation.surfaceLayer = 1;
  world.groundPoseNear = (...args) => {
    queries.push(args[4]);
    return null;
  };
  assert.equal(c.enter(), false);
  assert.deepEqual(queries, [{ surfaceId: 'bridge-road', layer: 1 }]);
  assert.equal(e.navigation.mode, 'drive');
  assert.equal(calls.aircraftClears, 0);
  assert.equal(calls.placementCancels, 0);
});

test('overview entry retains the original verified road if neither bounded area has launch clearance', (t) => {
  const { c, world, calls } = setup(t);
  world.hasLaunchClearance = () => false;
  assert.equal(c.enter(), true);
  assert.equal(calls.spawn.length, 2);
  close(c.state.position[0], 0);
  close(c.state.position[2], 0);
});

test('recovery prefers a nearby clear location while retaining a protected floor height and identity', (t) => {
  const { c, e, world, calls } = setup(t);
  e.navigation.mode = 'drive';
  e.navigation.surfaceId = 'bridge-road';
  e.navigation.surfaceLayer = 1;
  e.navigation.yaw = 0.25;
  assert.equal(c.enter(), true);
  const height = c.state.position[1];
  e.data.roadRelief = () => -50;
  offerNearbyOpenCandidate(world);
  world.hasLaunchClearance = (candidate) => candidate.pose.position[0] >= 8;
  c.recover();
  close(c.state.position[0], 8);
  close(c.state.position[1], height);
  close(c.state.heading, 0.25);
  assert.deepEqual(calls.spawn.at(-1).identity, {
    surfaceId: 'bridge-road',
    layer: 1,
  });
  close(calls.spawn.at(-1).position[1], height);
  assert.equal(c.warning, 'recovered');
});

test('recovery fallback retains the exact previously validated sloped spawn orientation', (t) => {
  const { c, e, world } = setup(t);
  const normal = new THREE.Vector3(0.2, 0.96, 0.2).normalize();
  const yaw = 0.8;
  e.navigation.mode = 'drive';
  e.navigation.yaw = yaw;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    .projectOnPlane(normal)
    .normalize();
  const right = normal.clone().cross(forward).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, normal, forward),
  );
  const pose = {
    position: normal.clone().multiplyScalar(HEIGHT).toArray(),
    quaternion: rotation.toArray(),
  };
  const contact = { ...FLOOR, normal: normal.toArray() };
  world.groundPoseNear = (...args) => {
    const candidate = { pose, contact, identity: world.identity(contact) };
    return !args[5] || args[5](candidate) ? candidate : null;
  };
  assert.equal(c.enter(), true);
  assert.deepEqual(c.state.quaternion, pose.quaternion);
  world.groundPoseNear = () => null;
  world.support = () => structuredClone(contact);
  c.state.position = [1_000, 100, 1_000];
  c.recover();
  assert.deepEqual(c.state.position, pose.position);
  assert.deepEqual(c.state.quaternion, pose.quaternion);
  assert.deepEqual(c.state.velocity, [0, 0, 0]);
});

test('recovery refuses an entry fallback whose current floor or body permission no longer exists', (t) => {
  const { c, world } = setup(t);
  assert.equal(c.enter(), true);
  c.state.position = [1_000, 100, 1_000];
  const current = c.state;
  world.groundPoseNear = () => null;
  world.support = () => null;
  c.recover();
  assert.equal(c.state, current);
  assert.deepEqual(c.state.position, [1_000, 100, 1_000]);
  assert.equal(c.warning, 'no-spawn');
});

test('desktop right turn and right joystick match the authored +X-left cockpit convention', (t) => {
  const { c, tick } = setup(t);
  c.enter();
  c.keyDown(key('KeyW'));
  c.keyDown(key('KeyD'));
  assert.equal(c.input().steer, -1);
  for (let i = 0; i < 45; i++) tick();
  assert.ok(
    c.state.position[0] < -0.1,
    'right turns toward model-local negative X',
  );
  c.clearInput();
  c.setAxes(1, 1);
  assert.equal(c.input().steer, -1);
  assert.equal(c.input().throttle, 1);
});

test('held physical aliases and touch sources release independently', (t) => {
  const { c } = setup(t);
  c.enter();
  c.keyDown(key('KeyW'));
  c.keyDown(key('ArrowUp'));
  c.keyUp(key('KeyW'));
  assert.equal(c.input().throttle, 1);
  c.setAxes(0, 1);
  c.keyUp(key('ArrowUp'));
  assert.equal(c.input().throttle, 1);
  c.setAxes(0, 0);
  assert.equal(c.input().throttle, 0);
  c.keyDown(key('ShiftLeft'));
  c.keyDown(key('ShiftRight'));
  c.keyUp(key('ShiftLeft'));
  assert.equal(c.input().boost, true);
  c.setButton('boost', true);
  c.keyUp(key('ShiftRight'));
  assert.equal(c.input().boost, true);
  c.setButton('boost', false);
  assert.equal(c.input().boost, false);
  c.keyDown(key('ControlLeft', { ctrlKey: true }));
  c.keyDown(key('ControlRight', { ctrlKey: true }));
  c.keyUp(key('ControlLeft'));
  assert.equal(c.input().lift, -1);
  c.keyUp(key('ControlRight'));
  assert.equal(c.input().lift, 0);
  c.keyDown(key('KeyQ'));
  assert.equal(c.input().lift, -1);
});

test('registered desktop listeners capture driving only while Tesla owns the active vehicle', (t) => {
  const { c, win, calls } = setup(t);
  const dispatch = (type, code) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      code,
      repeat: false,
    });
    win.dispatchEvent(event);
    return event;
  };
  assert.equal(dispatch('keydown', 'KeyW').defaultPrevented, false);
  c.enter();
  assert.equal(dispatch('keydown', 'KeyW').defaultPrevented, true);
  assert.equal(c.input().throttle, 1);
  dispatch('keyup', 'KeyW');
  assert.equal(c.input().throttle, 0);
  c.leaveToOrbit();
  const spawns = calls.spawn.length;
  assert.equal(dispatch('keydown', 'KeyR').defaultPrevented, false);
  assert.equal(calls.spawn.length, spawns);
  const event = pointer(1, 20, 20);
  c.pointerDown(event);
  assert.equal(event.defaultPrevented, false);
});

test('direct deactivation releases the engine mode so another public travel controller can take ownership', (t) => {
  const { c, e } = setup(t);
  c.enter();
  c.keyDown(key('KeyW'));
  c.deactivate();
  assert.equal(c.active, false);
  assert.equal(e.settings.mode, 'orbit');
  assert.equal(e.controls.enabled, true);
  assert.deepEqual(e.camera.up.toArray(), [0, 1, 0]);
  const event = key('KeyW');
  c.keyDown(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(c.input().throttle, 0);
  e.applySettings({ ...e.settings, mode: 'flight' });
  c.deactivate();
  assert.equal(
    e.settings.mode,
    'flight',
    'an inactive Tesla cannot reset the next controller mode',
  );
});

test('applying Tesla settings immediately releases a stale police stop without a navigation frame or changing Tesla motion', async (t) => {
  const { TrafficStop } = await import(cityModule('traffic-stop'));
  const { c, e } = setup(t);
  e.tesla = c;
  c.active = true;
  c.state = createTesla([0, HEIGHT, 0], 0, FLOOR);
  c.state.velocity = [54, 0, 0];
  const moving = structuredClone(c.state);
  const axes = [];
  Object.assign(e.navigation, {
    e,
    speed: 35,
    keys: new Set(['w']),
    setTouchAxes: (x, y) => axes.push([x, y]),
  });
  e.renderer.shadowMap = { enabled: false };
  e.buildings = new THREE.Group();
  e.vegetation = new THREE.Group();
  e.landmarks = new THREE.Group();
  e.trafficGroup = new THREE.Group();
  e.resizeQuality = () => {};
  e.updateLighting = () => {};
  const stop = new TrafficStop(e.navigation);
  e.navigation.trafficStop = stop;
  try {
    for (const previousMode of ['drive', 'tesla']) {
      e.settings = { ...e.settings, mode: previousMode };
      e.navigation.mode = 'drive';
      e.navigation.speed = 35;
      e.navigation.keys.add('w');
      stop.state.phase = 'talk';
      stop.state.nextTriggerSpeedKmh = 200;
      stop.group.visible = true;
      TransitEngineHarness.prototype.applySettings.call(e, {
        ...e.settings,
        mode: 'tesla',
      });
      assert.equal(stop.active, false);
      assert.equal(stop.group.visible, false);
      assert.equal(stop.caption, '');
      assert.equal(stop.state.nextTriggerSpeedKmh, 200);
      assert.equal(e.navigation.speed, 0);
      assert.equal(e.navigation.keys.size, 0);
      assert.deepEqual(axes.at(-1), [0, 0]);
      assert.deepEqual(c.state, moving);
      assert.equal(c.active, true);
      assert.equal(e.settings.mode, 'tesla');
    }
  } finally {
    stop.destroy();
  }
});

test('existing aircraft placement and attachment release Tesla through their actual public entry points', (t) => {
  const { c, e } = setup(t);
  e.tesla = c;
  e.completeLocalMapTransition = () => {};
  e.onFlightMode = () => {};
  const aircraft = new FlightController(e);
  e.flight = aircraft;
  aircraft.world = {};
  try {
    c.enter();
    aircraft.beginPlacement();
    assert.equal(c.active, false);
    assert.equal(c.vehicle.visible, false);
    assert.equal(e.settings.mode, 'orbit');
    assert.equal(aircraft.placing, true);
    c.enter();
    aircraft.state = createFlight('helicopter', 0, 40, 0);
    aircraft.state.phase = 'airborne';
    assert.equal(aircraft.attach(), true);
    assert.equal(c.active, false);
    assert.equal(aircraft.attached, true);
    assert.equal(e.settings.mode, 'flight');
  } finally {
    aircraft.destroy();
  }
});

test('legacy walk, drive and boat placement release Tesla before mutating the engine mode', (t) => {
  const { c, e, canvas } = setup(t);
  e.tesla = c;
  e.data.roadGraph = { nodes: [], edges: [] };
  e.data.bridgeSurfaces = [];
  e.geometry = (positions) =>
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
  e.water = new THREE.Mesh(new THREE.BufferGeometry());
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  });
  e.controls.addEventListener = () => {};
  e.controls.removeEventListener = () => {};
  e.controls.enableDamping = true;
  const placement = new MapPlacement(e);
  e.placement = placement;
  try {
    for (const mode of ['walk', 'drive', 'boat']) {
      assert.equal(c.enter(), true);
      c.keyDown(key('KeyW'));
      placement.begin(mode);
      // MapPlacement writes settings.mode synchronously, before React's
      // applySettings effect can compare old and new modes. It must release
      // the previous controller through this actual public entry point.
      assert.equal(c.active, false, `${mode} placement owns the camera`);
      assert.equal(c.vehicle.visible, false);
      assert.equal(e.settings.mode, 'orbit');
      assert.equal(e.controls.enabled, true);
      assert.equal(c.input().throttle, 0);
      assert.equal(placement.mode, mode);
      const camera = e.camera.position.clone();
      c.update(1 / 60);
      assert.deepEqual(e.camera.position.toArray(), camera.toArray());
      placement.cancel();
    }
  } finally {
    placement.destroy();
    e.water.geometry.dispose();
    e.water.material.dispose();
  }
});

for (const interrupt of [false, true])
  test(`actual app bus handoff synchronizes Tesla ownership while loading and ${interrupt ? 'permits an explicit mode cancellation' : 'retains loading across a preference update'}`, async (t) => {
    const { c, e } = setup(t);
    e.tesla = c;
    c.enter();
    e.settings = {
      ...e.settings,
      qualityMode: 'manual',
      traffic: true,
      buildings: true,
      trees: true,
      labels: true,
    };
    e.stats = {};
    e.onStats = () => {};
    e.renderer.shadowMap = { enabled: false };
    e.buildings = new THREE.Group();
    e.vegetation = new THREE.Group();
    e.landmarks = new THREE.Group();
    e.trafficGroup = new THREE.Group();
    e.resizeQuality = () => {};
    e.updateLighting = () => {};
    let preferences = { ...e.settings },
      phase = 'idle',
      cancelled = false,
      complete;
    const setSettings = (value) => {
      preferences = typeof value === 'function' ? value(preferences) : value;
    };
    e.onTravelResume = (mode) =>
      setSettings((settings) => ({ ...settings, mode, autoRotate: false }));
    e.busVisit = {
      close() {
        if (phase === 'loading') cancelled = true;
        phase = 'idle';
        return true;
      },
      snapshot: () => ({ phase, aboard: false }),
      prepare: () => {
        phase = 'loading';
        return new Promise((resolve) => {
          complete = () => {
            if (!cancelled) {
              e.navigation.mode = 'walk';
              phase = 'ready';
            }
            resolve(!cancelled);
          };
        });
      },
    };
    for (const name of transitMethods)
      e[name] = TransitEngineHarness.prototype[name];
    const action = actualBusAction({
      engine: { current: e },
      ready: true,
      setSettings,
      setTour() {},
      setPanel() {},
      setPlacing() {},
      setMobilePanel() {},
      setLocalOrbit() {},
      setClean() {},
    });
    const operation = action();
    try {
      assert.equal(phase, 'loading');
      assert.equal(c.active, false);
      assert.equal(preferences.mode, 'orbit');
      assert.equal(e.settings.mode, preferences.mode);
      // This is React's deferred settings effect after the synchronous action.
      e.applySettings(preferences);
      assert.equal(cancelled, false);
      preferences = { ...preferences, labels: false, quality: 'ultra' };
      e.applySettings(preferences);
      assert.equal(cancelled, false);
      assert.equal(phase, 'loading');
      if (interrupt) {
        preferences = { ...preferences, mode: 'drive' };
        e.applySettings(preferences);
        assert.equal(cancelled, true);
        assert.equal(e.settings.mode, 'drive');
      }
    } finally {
      complete();
      await operation;
    }
    assert.equal(e.settings.mode, interrupt ? 'drive' : 'walk');
    assert.equal(preferences.mode, e.settings.mode);
    assert.equal(e.navigation.mode, interrupt ? 'drive' : 'walk');
    assert.equal(c.active, false);
  });

test('command key repeats cannot toggle camera or adhesion repeatedly, and browser controls retain native keys', (t) => {
  const { c, tick } = setup(t);
  c.enter();
  c.keyDown(key('KeyC'));
  assert.equal(c.view, 'cockpit');
  c.keyDown(key('KeyC', { repeat: true }));
  assert.equal(c.view, 'cockpit');
  c.keyDown(key('KeyE'));
  tick();
  assert.equal(c.state.adhesionArmed, false);
  c.keyDown(key('KeyE', { repeat: true }));
  tick();
  assert.equal(c.state.adhesionArmed, false);
  c.clearInput();
  for (const event of [
    key('KeyW', { ctrlKey: true }),
    key('KeyW', { metaKey: true }),
    key('KeyW', { altKey: true }),
    key('KeyW', { target: new InputElement('dialog') }),
    key('KeyW', { target: new InputElement('input') }),
    key('ArrowUp', { target: new InputElement('radio') }),
    key('Space', { target: new InputElement('button') }),
  ]) {
    c.keyDown(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(c.input().throttle, 0);
  assert.equal(c.input().jump, false);
});

test('Wall Grip defaults on and the explicit Free Drive choice survives R and Orbit re-entry', (t) => {
  const { c, tick } = setup(t);
  assert.equal(c.snapshot.adhesion, true);
  assert.equal(c.enter(), true);
  assert.equal(c.state.adhesionArmed, true);
  c.command('adhesionToggle');
  tick();
  assert.equal(c.snapshot.adhesion, false);
  c.recover();
  assert.equal(c.state.adhesionArmed, false);
  assert.equal(c.snapshot.adhesion, false);
  c.leaveToOrbit();
  assert.equal(c.snapshot.active, false);
  assert.equal(c.snapshot.adhesion, false);
  assert.equal(c.enter(), true);
  assert.equal(c.state.adhesionArmed, false);
  c.command('adhesionToggle');
  tick();
  assert.equal(c.snapshot.adhesion, true);
  c.recover();
  assert.equal(c.snapshot.adhesion, true);
});

test('public keyboard release automatically holds the physical wall while snapshot distinguishes optional P parking', (t) => {
  const { c, tick } = setup(t);
  assert.equal(c.enter(), true);
  const contact = {
    surfaceId: 'controller-wall',
    kind: 'wall',
    point: [0, 20, 30],
    normal: [0, 0, -1],
    adherable: true,
  };
  c.world = new TeslaWorld({
    sources: [
      fixedFacesSource('controller-wall', [
        triangleFace(
          contact.surfaceId,
          'wall:0',
          'wall',
          [
            [-60, 0, 30],
            [60, 0, 30],
            [60, 100, 30],
          ],
          true,
          contact.surfaceId,
          contact.normal,
        ),
        triangleFace(
          contact.surfaceId,
          'wall:1',
          'wall',
          [
            [-60, 0, 30],
            [60, 100, 30],
            [-60, 100, 30],
          ],
          true,
          contact.surfaceId,
          contact.normal,
        ),
      ]),
    ],
  });
  c.state = createTesla([0, 20, 30 - HEIGHT], 0, contact);
  c.keyDown(key('KeyW'));
  for (let i = 0; i < 15; i++) tick();
  c.keyUp(key('KeyW'));
  for (let i = 0; i < 120 && !c.snapshot.wallHolding; i++) tick();
  assert.equal(c.snapshot.wallHolding, true);
  assert.equal(c.snapshot.parked, false);
  assert.equal(c.snapshot.mode, 'wall');
  const pose = {
    position: [...c.state.position],
    quaternion: [...c.state.quaternion],
  };
  for (let i = 0; i < 60; i++) tick();
  assert.deepEqual(
    { position: c.state.position, quaternion: c.state.quaternion },
    pose,
  );
  c.command('park');
  tick();
  assert.equal(c.snapshot.parked, true);
  assert.equal(c.snapshot.wallHolding, false);
  c.keyDown(key('KeyW'));
  tick();
  assert.equal(c.snapshot.parked, false);
  assert.equal(c.snapshot.wallHolding, false);
  assert(c.state.position[1] > pose.position[1]);
});

test('disabled input clears all sources and cannot queue joystick, pulses, commands, look or wheel input for re-enable', (t) => {
  const { c } = setup(t);
  c.enter();
  c.keyDown(key('KeyW'));
  c.setAxes(1, 1);
  c.setButton('boost', true);
  c.command('jump');
  c.setInputEnabled(false);
  const distance = c.distance,
    yaw = c.lookYaw;
  c.setAxes(-1, 1);
  c.setButton('boost', true);
  c.pulse('up');
  c.command('flightToggle');
  const event = {
    deltaY: 400,
    deltaMode: 0,
    preventDefault() {
      throw new Error('blocked wheel was captured');
    },
    stopImmediatePropagation() {},
  };
  c.wheel(event);
  c.pointerDown(pointer(1, 10, 10));
  c.pointerMove(pointer(1, 100, 100));
  assert.equal(c.distance, distance);
  assert.equal(c.lookYaw, yaw);
  assert.equal(c.input().brake, true);
  c.setInputEnabled(true);
  const input = c.input();
  for (const name of ['throttle', 'steer', 'lift'])
    assert.equal(input[name], 0);
  for (const name of [
    'jump',
    'boost',
    'flightToggle',
    'adhesionToggle',
    'park',
  ])
    assert.equal(input[name], false);
});

test('closing a modal requires a fresh key press before an OS repeat can resume acceleration or lift', (t) => {
  const { c } = setup(t);
  c.enter();
  c.keyDown(key('KeyW'));
  c.keyDown(key('Space'));
  c.setInputEnabled(false);
  c.setInputEnabled(true);
  c.keyDown(key('KeyW', { repeat: true }));
  c.keyDown(key('Space', { repeat: true }));
  assert.equal(c.input().throttle, 0);
  assert.equal(c.input().lift, 0);
  assert.equal(c.input().jump, false);
  c.keyUp(key('KeyW'));
  c.keyUp(key('Space'));
  c.keyDown(key('KeyW'));
  c.keyDown(key('ArrowUp'));
  c.keyDown(key('ArrowUp', { repeat: true }));
  c.keyUp(key('KeyW'));
  assert.equal(c.input().throttle, 1, 'a fresh alias remains held');
  c.keyDown(key('Space'));
  assert.equal(c.input().jump, true);
});

test('modal suspension freezes gravity and guided surface attachment without losing the pose or transition', (t) => {
  const { c, tick } = setup(t);
  c.enter();
  for (const transitioning of [false, true]) {
    c.state = createTesla([0, 40, 0]);
    c.state.flightAssist = false;
    c.state.velocity = [4, -15, 2];
    if (transitioning)
      c.state.attachment = {
        contact: FLOOR,
        waypoints: [{ position: [0, 50, 0], quaternion: [0, 0, 0, 1] }],
        ignoreSurfaceIds: [undefined],
        index: 0,
        resumeSpeed: 10,
        parkOnArrival: false,
      };
    c.setAxes(1, 1);
    c.setInputEnabled(false);
    const before = structuredClone(c.state);
    for (let index = 0; index < 60; index++) tick();
    assert.deepEqual(c.state, before);
    assert.equal(c.lastStep.simulatedS, 0);
    c.setInputEnabled(true);
    tick();
    assert.notDeepEqual(c.state.position, before.position);
    assert.equal(c.input().throttle, 0);
    assert.equal(c.input().steer, 0);
  }
});

test('blur and hidden-page events clear keyboard, held buttons, mobile pulses and gestures', (t) => {
  const { c, win, doc, advanceClock } = setup(t);
  c.enter();
  c.pulse('up');
  assert.equal(c.input().lift, 1);
  advanceClock(219);
  assert.equal(c.input().lift, 1);
  advanceClock(1);
  assert.equal(c.input().lift, 0);
  for (const eventTarget of [win, doc]) {
    c.keyDown(key('KeyW'));
    c.setAxes(1, 1);
    c.setButton('boost', true);
    c.pulse('up');
    c.pointerDown(pointer(1, 10, 10));
    if (eventTarget === doc) doc.hidden = true;
    eventTarget.dispatchEvent(
      new Event(eventTarget === win ? 'blur' : 'visibilitychange'),
    );
    const prior = c.lookYaw;
    c.pointerMove(pointer(1, 50, 50));
    assert.equal(c.lookYaw, prior);
    assert.equal(c.input().throttle, 0);
    assert.equal(c.input().lift, 0);
    assert.equal(c.input().boost, false);
  }
});

test('touch look and pinch zoom use the same bounded camera transitions as desktop zoom', (t) => {
  const { c } = setup(t);
  c.enter();
  c.pointerDown(pointer(1, 20, 20));
  c.pointerMove(pointer(1, 40, 30));
  assert.ok(c.lookYaw < 0 && c.lookPitch > 0);
  c.pointerDown(pointer(2, 80, 30));
  const distance = c.distance;
  c.pointerMove(pointer(2, 120, 30));
  assert.ok(c.distance < distance || c.view === 'cockpit');
  c.pointerUp(pointer(2, 120, 30));
  c.pointerUp(pointer(1, 40, 30));
  c.zoom(0.01);
  assert.equal(c.view, 'cockpit');
  c.zoom(2);
  assert.equal(c.view, 'chase');
  c.zoom(100);
  assert.equal(c.distance, 24);
});

test('actual Auto model swaps honor sustained speed, cockpit and compatible contexts while retaining the same simulation', (t) => {
  const { c, e, tick, advanceClock } = setup(t);
  c.enter();
  c.state = createTesla([0, 40, 0]);
  c.state.velocity = [0, 0, 50];
  const state = c.state,
    pose = structuredClone(c.state.position),
    model = c.model;
  tick(0);
  advanceClock(2_199);
  tick(0);
  assert.equal(c.effectiveQuality, 'medium');
  advanceClock(1);
  tick(0);
  assert.equal(c.effectiveQuality, 'low');
  c.setView('cockpit');
  tick(0);
  assert.equal(c.effectiveQuality, 'low');
  advanceClock(2_200);
  tick(0);
  assert.equal(c.effectiveQuality, 'high');
  e.compatibleGraphics = true;
  tick(0);
  advanceClock(2_200);
  tick(0);
  assert.equal(c.effectiveQuality, 'low');
  c.setQuality('high');
  tick(0);
  assert.equal(c.effectiveQuality, 'high', 'manual mesh choice is exact');
  assert.equal(c.state, state);
  assert.deepEqual(c.state.position, pose);
  assert.equal(c.model, model);
  assert.equal(model.stats().cachedLevels, 3);
  assert.equal(
    model.group.children.filter((child) => child.isGroup && child.visible)
      .length,
    1,
  );
});

test('camera and manual mesh changes preserve vehicle state and reuse cached model resources across exits', (t) => {
  const { c, e, tick, calls } = setup(t);
  c.enter();
  const model = c.model,
    body = c.state;
  c.state = createTesla([0, 40, 0]);
  const flight = c.state,
    pose = structuredClone({
      position: flight.position,
      quaternion: flight.quaternion,
    });
  for (const quality of ['low', 'medium', 'high']) {
    c.setQuality(quality);
    tick(0);
  }
  assert.equal(model.stats().cachedLevels, 3);
  const groups = [...model.group.children],
    geometries = new Set();
  model.group.traverse((object) => {
    if (object.isMesh) geometries.add(object.geometry);
  });
  for (let i = 0; i < 12; i++) {
    c.setView(i % 2 ? 'chase' : 'cockpit');
    c.setQuality(['high', 'low', 'medium'][i % 3]);
    tick(0);
    assert.equal(c.state, flight);
    assert.deepEqual(c.state.position, pose.position);
    assert.deepEqual(c.state.quaternion, pose.quaternion);
    assert.deepEqual(model.group.children, groups);
  }
  const later = new Set();
  model.group.traverse((object) => {
    if (object.isMesh) later.add(object.geometry);
  });
  assert.deepEqual(later, geometries);
  c.leaveToOrbit();
  assert.equal(c.active, false);
  assert.equal(e.settings.mode, 'orbit');
  assert.equal(e.controls.enabled, true);
  assert.deepEqual(e.camera.up.toArray(), [0, 1, 0]);
  assert.equal(e.controls.minDistance, 28);
  assert.equal(calls.orbits, 1);
  assert.equal(c.enter(), true);
  assert.equal(c.model, model);
  assert.notEqual(c.state, body);
  assert.equal(model.stats().cachedLevels, 3);
});

test('destroy removes every installed listener and disposes each cached geometry and material only once', (t) => {
  const { c, calls, canvas, win, doc } = setup(t);
  c.enter();
  c.setQuality('high');
  c.update(0);
  c.setQuality('low');
  c.update(0);
  assert.ok(canvas.listenerCount + win.listenerCount + doc.listenerCount > 0);
  const resources = new Set(),
    disposals = new Map();
  c.model.group.traverse((object) => {
    if (!object.isMesh) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      resources.add(material);
  });
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      disposals.set(resource, (disposals.get(resource) ?? 0) + 1),
    );
  c.destroy();
  c.destroy();
  assert.equal(canvas.listenerCount + win.listenerCount + doc.listenerCount, 0);
  assert.equal(calls.worldDisposals, 1);
  for (const resource of resources) assert.equal(disposals.get(resource), 1);
  assert.equal(c.vehicle.parent, null);
  assert.equal(c.enter(), false);
});
