import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile(
  'page.tsx',
  readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const home = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Home',
);
const declarations = home.body.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations]);
const compile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const evaluate = (name, bindings) => {
  const declaration = declarations.find(
    (node) => node.name.getText(source) === name,
  );
  assert.ok(declaration?.initializer, `${name} remains a page input gate`);
  return runInNewContext(
    compile(`const value = ${declaration.initializer.getText(source)};`) +
      '\nvalue;',
    { ...bindings },
  );
};

test('merged page keeps standing bus interactions and gates transit input during every rocket entry state', () => {
  const input = {
    ready: true,
    settings: { mode: 'walk' },
    clean: false,
    placing: null,
    flight: { placing: false },
    rocket: { active: false, placing: false },
    rocketChoosing: false,
    about: false,
    panel: null,
    discoveryModal: false,
    stats: { busVisit: { aboard: true, seated: false } },
    mobilePanel: null,
    touchUI: true,
    hudHidden: false,
    skyTrainActive: false,
  };
  assert.equal(evaluate('interactionInput', input), true);
  assert.equal(evaluate('busInput', input), true);
  assert.equal(evaluate('skyTrainInput', input), false);
  const station = {
    ...input,
    skyTrainActive: true,
    stats: { busVisit: { aboard: false } },
  };
  assert.equal(evaluate('skyTrainInput', station), true);
  assert.equal(evaluate('busInput', station), false);
  assert.equal(
    evaluate('skyTrainInput', { ...station, settings: { mode: 'orbit' } }),
    false,
    'station overview does not enable first-person train input',
  );
  for (const state of [
    { rocketChoosing: true },
    { rocket: { active: false, placing: true } },
    { rocket: { active: true, placing: false } },
  ])
    for (const gate of ['interactionInput', 'busInput', 'skyTrainInput'])
      assert.equal(evaluate(gate, { ...input, ...state }), false, gate);
});

test('hiding the HUD preserves walking, drift and passenger inputs on desktop and touch', () => {
  const base = {
    ready: true,
    settings: { mode: 'walk' },
    clean: false,
    placing: null,
    flight: { placing: false },
    rocket: { active: false, placing: false },
    rocketChoosing: false,
    about: false,
    panel: null,
    discoveryModal: false,
    stats: { busVisit: { aboard: false } },
    mobilePanel: null,
    skyTrainActive: false,
  };
  for (const touchUI of [false, true]) {
    for (const hudHidden of [false, true]) {
      const context = { ...base, touchUI, hudHidden };
      assert.equal(evaluate('interactionInput', context), true);
      assert.equal(evaluate('busInput', context), true);
      assert.equal(
        evaluate('skyTrainInput', { ...context, skyTrainActive: true }),
        true,
      );
      assert.equal(
        evaluate('driveDriftEnabled', {
          ...context,
          settings: { mode: 'drive' },
        }),
        true,
      );
      for (const modal of [
        { about: true },
        { panel: 'time' },
        { discoveryModal: true },
      ]) {
        assert.equal(
          evaluate('interactionInput', { ...context, ...modal }),
          false,
        );
        assert.equal(evaluate('busInput', { ...context, ...modal }), false);
      }
    }
  }
});

const actionNames = [
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
];
const actionCode = compile(
  declarations
    .filter((node) => actionNames.includes(node.name.getText(source)))
    .map((node) => `const ${node.getText(source)};`)
    .join('\n'),
);
const engineSource = ts.createSourceFile(
  'engine.ts',
  readFileSync(new URL('../lib/city/engine.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const engineClass = engineSource.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CityEngine',
);
const prepareMethod = engineClass.members.find(
  (node) => node.name?.getText(engineSource) === 'prepareTravelPlacement',
);
assert.ok(prepareMethod, 'entry uses the actual engine ownership handoff');
const EnginePlacementHarness = runInNewContext(
  compile(
    `class EnginePlacementHarness { ${prepareMethod.getText(engineSource)} }`,
  ) + '\nEnginePlacementHarness;',
);
function harness({
  exitAllowed = true,
  trainActive = false,
  overviewMoved = false,
} = {}) {
  const calls = [];
  let settings = { mode: trainActive ? 'orbit' : 'rocket' };
  const rocket = {
    active: !trainActive,
    returnToCity() {
      calls.push('rocket:return');
      this.active = false;
    },
    beginPlacement(kind) {
      assert.equal(
        city.skyTrainTravel.active,
        false,
        'a rocket cannot retain passenger ownership',
      );
      calls.push(`rocket:place:${kind}`);
    },
  };
  const start = (name) => {
    assert.equal(rocket.active, false, `${name} starts after rocket cleanup`);
    assert.equal(
      city.skyTrainTravel.active,
      false,
      `${name} starts after passenger release`,
    );
    calls.push(name);
    return true;
  };
  const city = Object.assign(new EnginePlacementHarness(), {
    settings,
    rocket,
    closeBusVisit: () => exitAllowed,
    skyTrainTravel: {
      active: trainActive,
      get canResumeOverview() {
        return this.active && settings.mode === 'orbit' && !overviewMoved;
      },
      setOverview(overview) {
        calls.push(`train:overview:${overview}`);
        settings.mode = overview ? 'orbit' : 'walk';
      },
      releaseForPlacement() {
        calls.push('train:release-placement');
        this.active = false;
        city.navigation.mode = settings.mode = 'orbit';
        return true;
      },
    },
    placement: {
      mode: null,
      cancel: () => calls.push('placement:cancel'),
      begin: (mode) => start(`placement:${mode}`),
    },
    flight: {
      clear: () => calls.push('flight:clear'),
      beginPlacement: () => start('flight:place'),
      startDrag: () => start('flight:drag'),
      cancelPlacement() {},
    },
    tesla: { active: false, enter: () => start('tesla:enter') },
    navigation: {
      mode: 'orbit',
      switchStreetMode(mode) {
        if (!['walk', 'drive'].includes(this.mode)) return false;
        this.mode = mode;
        return start(`street:${mode}`);
      },
    },
    leaveTravelAtLocation: () => start('city:orbit'),
  });
  const bindings = {
    ready: true,
    engine: { current: city },
    teslaEntering: { current: false },
    setSettings: (update) => {
      settings = update(settings);
      city.settings = settings;
      calls.push(`mode:${settings.mode}`);
    },
    setRocketChoosing: (choosing) => calls.push(`chooser:${choosing}`),
    setTour() {},
    setPanel() {},
    setNotice: (notice) => calls.push(`notice:${notice}`),
    setClean() {},
    setPlacing() {},
    setMobilePanel() {},
    setHudHidden() {},
    setLocalOrbit() {},
    setTeslaPreparing() {},
    requestAnimationFrame: (callback) => callback(),
  };
  const actions = runInNewContext(
    actionCode + `\n({${actionNames.join(',')}});`,
    bindings,
  );
  return { actions, calls, city };
}
const pointer = () => ({
  button: 0,
  pointerId: 1,
  nativeEvent: {},
  preventDefault() {},
  stopPropagation() {},
  currentTarget: { setPointerCapture() {} },
});

test('merged page hands active rocket ownership to pointer and keyboard vehicle entry synchronously', async () => {
  for (const [name, invoke, expected] of [
    ['placement', (a) => a.beginPlacement('drive'), 'placement:drive'],
    ['aircraft button', (a) => a.beginFlight(), 'flight:place'],
    ['aircraft drag', (a) => a.dragAircraft(pointer()), 'flight:drag'],
    ['Tesla', (a) => a.beginTesla(), 'tesla:enter'],
    ['street mode', (a) => a.switchMode('walk'), 'placement:walk'],
    ['orbit mode', (a) => a.switchMode('orbit'), 'city:orbit'],
  ]) {
    const { actions, calls } = harness();
    await invoke(actions);
    assert.ok(calls.includes(expected), name);
    assert.ok(calls.indexOf('rocket:return') < calls.indexOf(expected), name);
  }
});

test('merged page preserves blocked bus exits before any vehicle or rocket entry', async () => {
  for (const invoke of [
    (a) => a.beginPlacement('drive'),
    (a) => a.beginFlight(),
    (a) => a.beginTesla(),
    (a) => a.dragAircraft(pointer()),
    (a) => a.chooseRocket(),
    (a) => a.beginRocket('super-heavy'),
    (a) => a.switchMode('drive'),
  ]) {
    const { actions, calls, city } = harness({ exitAllowed: false });
    await invoke(actions);
    assert.equal(
      city.rocket.active,
      true,
      'a blocked bus exit keeps the current owner',
    );
    assert.equal(calls.includes('rocket:return'), false);
    assert.equal(
      calls.some((call) => call.startsWith('rocket:place:')),
      false,
    );
    assert.equal(
      calls.some((call) => call.startsWith('chooser:')),
      false,
    );
    assert.equal(calls.includes('notice:busVisitExitBlocked'), true);
  }
});

test('merged page releases station ownership for explicit new vehicle or rocket placement while unmoved Walk resumes', async () => {
  for (const [invoke, expected] of [
    [(a) => a.beginPlacement('drive'), 'placement:drive'],
    [(a) => a.beginFlight(), 'flight:place'],
    [(a) => a.beginTesla(), 'tesla:enter'],
    [(a) => a.dragAircraft(pointer()), 'flight:drag'],
    [(a) => a.chooseRocket(), 'chooser:true'],
    [(a) => a.beginRocket('super-heavy'), 'rocket:place:super-heavy'],
    [(a) => a.switchMode('drive'), 'placement:drive'],
  ]) {
    const { actions, calls, city } = harness({ trainActive: true });
    await invoke(actions);
    assert.equal(city.skyTrainTravel.active, false);
    assert(calls.includes(expected), expected);
    assert(calls.indexOf('train:release-placement') < calls.indexOf(expected));
    assert.equal(
      calls.some((call) => call.startsWith('street:')),
      false,
      'a source station foot cannot become an in-scene street vehicle',
    );
  }
  const { actions, calls } = harness({ trainActive: true });
  actions.switchMode('orbit');
  actions.switchMode('walk');
  actions.change({ mode: 'drive' });
  assert.deepEqual(calls, ['train:overview:true', 'train:overview:false']);
  actions.change({ mode: 'orbit' });
  assert.equal(calls.at(-1), 'mode:orbit');
  const moved = harness({ trainActive: true, overviewMoved: true });
  moved.actions.switchMode('walk');
  assert.equal(moved.city.skyTrainTravel.active, false);
  assert(moved.calls.includes('placement:walk'));
  assert.equal(moved.calls.includes('train:overview:false'), false);
});

test('merged rocket chooser cancels pending city placement and aircraft before selecting all three rocket kinds', () => {
  for (const kind of ['small', 'large', 'super-heavy']) {
    const { actions, calls } = harness();
    actions.chooseRocket();
    assert.ok(calls.includes('placement:cancel'));
    assert.ok(calls.includes('flight:clear'));
    assert.ok(calls.includes('rocket:return'));
    assert.equal(calls.at(-1), 'chooser:true');
    actions.beginRocket(kind);
    assert.equal(calls.at(-1), `rocket:place:${kind}`);
    assert.equal(calls.at(-2), 'chooser:false');
  }
});
