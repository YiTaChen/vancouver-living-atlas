import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const network = await import(cityModule('skytrain-network'));
const touch = await import(cityModule('touch-input'));
const catalogs = JSON.parse(
  fs.readFileSync(
    new URL('../lib/i18n/skytrain-travel.json', import.meta.url),
    'utf8',
  ),
);
const interactions = JSON.parse(
  fs.readFileSync(
    new URL('../lib/i18n/interactions.json', import.meta.url),
    'utf8',
  ),
);

// Run the actual component and its actual joystick handlers, substituting only
// React scheduling and browser events. Network plans use the production module.
function setup() {
  const win = new EventTarget(),
    doc = new EventTarget();
  doc.hidden = false;
  let active;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) {
      const i = active.cursor++;
      active.slots[i] ??= { value: { current: value } };
      return active.slots[i].value;
    },
    useState(value) {
      const host = active,
        i = host.cursor++;
      host.slots[i] ??= { value };
      return [
        host.slots[i].value,
        (next) => {
          host.slots[i].value =
            typeof next === 'function' ? next(host.slots[i].value) : next;
        },
      ];
    },
    useCallback(callback, deps) {
      const host = active,
        i = host.cursor++,
        previous = host.slots[i];
      if (!previous || !same(previous.deps, deps))
        host.slots[i] = { value: callback, deps };
      return host.slots[i].value;
    },
    useEffect(callback, deps) {
      const host = active,
        i = host.cursor++,
        previous = host.slots[i];
      if (!previous || !same(previous.deps, deps)) {
        host.slots[i] = { deps };
        host.pending.push(() => {
          previous?.cleanup?.();
          host.slots[i].cleanup = callback();
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const modules = new Map();
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(
      new URL(`../components/${name}.tsx`, import.meta.url),
      'utf8',
    );
    const code = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const cjs = { exports: {} };
    const require = (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime')
        return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (id === '@/lib/city/skytrain-network') return network;
      if (id === '@/lib/city/touch-input') return touch;
      if (id === '@/lib/i18n/skytrain-travel.json') return catalogs;
      if (id === '@/lib/i18n/interactions.json') return interactions;
      if (id === './travel-joystick') return load('travel-joystick');
      if (id.endsWith('.css')) return {};
      if (id === 'lucide-react')
        return new Proxy({}, { get: () => () => null });
      throw new Error(`Unexpected component import ${id}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
      window: win,
      document: doc,
      setTimeout,
      clearTimeout,
    })(require, cjs, cjs.exports);
    modules.set(name, cjs.exports);
    return cjs.exports;
  };
  const mount = (component, props) => {
    const host = { slots: [], cursor: 0, pending: [], props, tree: null };
    host.render = (next = host.props) => {
      host.props = next;
      host.cursor = 0;
      active = host;
      host.tree = component(next);
      active = null;
      host.pending.splice(0).forEach((effect) => effect());
      return host.tree;
    };
    host.unmount = () => host.slots.forEach((slot) => slot.cleanup?.());
    host.render();
    return host;
  };
  return { win, doc, load, mount };
}
function all(tree, predicate) {
  if (!tree) return [];
  if (Array.isArray(tree))
    return Array.from(tree).flatMap((child) => all(child, predicate));
  if (typeof tree !== 'object') return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...all(tree.props?.children, predicate),
  ];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const button = (host, name) =>
  all(
    host.tree,
    (node) =>
      node.type === 'button' && text(node.props.children).trim() === name,
  )[0];
const event = (pointerId = 1, patch = {}) => ({
  pointerId,
  button: 0,
  clientX: 61,
  clientY: 0,
  currentTarget: {
    dataset: {},
    style: {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 122, height: 122 }),
  },
  preventDefault() {},
  stopPropagation() {},
  ...patch,
});
function state(patch = {}) {
  return {
    phase: 'idle',
    stationId: null,
    lineId: null,
    plannedLineId: 'expo',
    destinationId: 'granville',
    nextStationId: null,
    level: 'concourse',
    doorsOpen: false,
    canBoard: false,
    canAlight: false,
    canExit: false,
    canChangeLevel: false,
    speedMps: 0,
    travelProgress: 0,
    error: null,
    ...patch,
  };
}
function panel(h, snapshot = state(), extra = {}) {
  const calls = [];
  const props = {
    locale: 'en',
    snapshot,
    visible: true,
    touch: false,
    onEnter: (...args) => calls.push(['enter', ...args]),
    onDestination: (...args) => calls.push(['destination', ...args]),
    onGoPlatform: () => calls.push(['platform']),
    onGoConcourse: () => calls.push(['concourse']),
    onBoard: () => calls.push(['board']),
    onAlight: () => calls.push(['alight']),
    onLeave: () => calls.push(['exit']),
    onMove: (...args) => calls.push(['move', ...args]),
    ...extra,
  };
  const host = h.mount(
    h.load('skytrain-travel-panel').SkyTrainTravelPanel,
    props,
  );
  return { host, calls, props };
}

test('the public entrance and destination selectors expose all seven real stations with Waterfront transfers', () => {
  const h = setup(),
    { host, calls } = panel(h);
  button(host, 'Ride SkyTrain').props.onClick();
  host.render();
  const selects = all(host.tree, (node) => node.type === 'select');
  assert.deepEqual(
    all(selects[0], (node) => node.type === 'option').map(
      (node) => node.props.value,
    ),
    network.SKYTRAIN_STATIONS.map((station) => station.id),
  );
  assert.equal(all(selects[1], (node) => node.type === 'option').length, 8);
  selects[0].props.onChange({ target: { value: 'yaletown-roundhouse' } });
  host.render();
  assert.match(text(host.tree), /Canada Line/);
  assert.match(text(host.tree), /Expo Line/);
  assert.match(text(host.tree), /Vancouver City Centre/);
  assert.match(text(host.tree), /Change trains at\s+Waterfront/);
  button(host, 'Start at this entrance').props.onClick();
  assert.deepEqual(calls.at(-1), ['enter', 'yaletown-roundhouse']);
  const destination = all(host.tree, (node) => node.type === 'select')[1];
  destination.props.onChange({
    target: { value: 'main-street-science-world' },
  });
  assert.deepEqual(calls.at(-1), ['destination', 'main-street-science-world']);
  const count = calls.length;
  destination.props.onChange({ target: { value: 'not-a-station' } });
  destination.props.onChange({ target: { value: 'yaletown-roundhouse' } });
  assert.equal(
    calls.length,
    count,
    'invalid or current destination cannot dispatch',
  );
  host.unmount();
});

test('idle trip planning opens on demand and mobile riding stays compact with the current arrival station', () => {
  for (const touch of [false, true]) {
    const h = setup(),
      { host, props } = panel(h, state(), { touch });
    assert.equal(all(host.tree, (node) => node.type === 'button').length, 1);
    assert.equal(all(host.tree, (node) => node.type === 'select').length, 0);
    const launcher = button(host, 'Ride SkyTrain');
    assert.equal(launcher.props['aria-expanded'], false);
    launcher.props.onClick();
    host.render();
    assert.equal(all(host.tree, (node) => node.type === 'select').length, 2);
    button(host, 'Start at this entrance').props.onClick();
    host.render({
      ...props,
      snapshot: state({
        phase: 'riding',
        stationId: 'burrard',
        nextStationId: 'granville',
        lineId: 'expo',
        doorsOpen: true,
        canAlight: true,
      }),
    });
    const body = all(
      host.tree,
      (node) => node.props.id === 'skytrain-travel-body',
    )[0];
    assert.equal(body.props.hidden, touch);
    const status = all(host.tree, (node) => node.type === 'output')[0];
    assert.match(text(status), /Burrard/);
    assert.match(text(status), /Expo Line/);
    assert.doesNotMatch(text(status), /Granville/);
    host.render({
      ...props,
      snapshot: state({
        phase: 'riding',
        stationId: 'burrard',
        nextStationId: 'granville',
        lineId: 'expo',
      }),
    });
    assert.match(
      text(all(host.tree, (node) => node.type === 'output')[0]),
      /Next stop.*Granville/,
    );
    host.render(props);
    assert.equal(all(host.tree, (node) => node.type === 'button').length, 1);
    host.unmount();
  }
});

test('boarding requires a platform, open stopped train, correct line and world boarding permission', () => {
  const h = setup();
  const base = state({
    phase: 'station',
    stationId: 'waterfront',
    lineId: 'expo',
    level: 'platform',
    doorsOpen: true,
    canBoard: true,
  });
  const { host, calls, props } = panel(h, base);
  assert.equal(button(host, 'Board train').props.disabled, false);
  button(host, 'Board train').props.onClick();
  assert.deepEqual(calls.at(-1), ['board']);
  for (const patch of [
    { doorsOpen: false },
    { canBoard: false },
    { level: 'concourse' },
    { lineId: 'canada' },
    { busy: true },
    { speedMps: 2 },
    { speedMps: NaN },
  ]) {
    host.render({ ...props, snapshot: { ...base, ...patch } });
    const node = button(host, 'Board train');
    assert.equal(node.props.disabled, true);
    const count = calls.length;
    node.props.onClick();
    assert.equal(
      calls.length,
      count,
      'even a directly invoked disabled handler cannot board',
    );
  }
  host.unmount();
});

test('alighting and street exit remain blocked during movement, at closed doors and on a platform', () => {
  const h = setup();
  const base = state({
    phase: 'riding',
    stationId: 'burrard',
    lineId: 'expo',
    level: 'platform',
    canAlight: true,
    canExit: true,
    doorsOpen: false,
    speedMps: 15,
    nextStationId: 'granville',
  });
  const { host, calls, props } = panel(h, base);
  assert.equal(button(host, 'Leave train').props.disabled, true);
  assert.equal(button(host, 'Exit to the street').props.disabled, true);
  button(host, 'Leave train').props.onClick();
  button(host, 'Exit to the street').props.onClick();
  assert(!calls.some((call) => call[0] === 'alight' || call[0] === 'exit'));
  for (const speedMps of [NaN, Infinity, 0.051]) {
    host.render({ ...props, snapshot: { ...base, doorsOpen: true, speedMps } });
    assert.equal(button(host, 'Leave train').props.disabled, true);
  }
  host.render({
    ...props,
    snapshot: { ...base, doorsOpen: true, speedMps: 0 },
  });
  button(host, 'Leave train').props.onClick();
  assert.deepEqual(calls.at(-1), ['alight']);
  host.render({
    ...props,
    snapshot: { ...base, phase: 'station', level: 'concourse', speedMps: 0 },
  });
  button(host, 'Exit to the street').props.onClick();
  assert.deepEqual(calls.at(-1), ['exit']);
  host.unmount();
});

test('level changes require the actual access zone and destination selection cannot reroute a moving train', () => {
  const h = setup();
  const base = state({
    phase: 'station',
    stationId: 'granville',
    lineId: 'expo',
  });
  const { host, calls, props } = panel(h, base);
  button(host, 'Go to platform').props.onClick();
  assert(!calls.some((call) => call[0] === 'platform'));
  host.render({ ...props, snapshot: { ...base, canChangeLevel: true } });
  button(host, 'Go to platform').props.onClick();
  assert.deepEqual(calls.at(-1), ['platform']);
  host.render({ ...props, snapshot: { ...base, phase: 'riding' } });
  const destination = all(host.tree, (node) => node.type === 'select')[0];
  assert.equal(destination.props.disabled, true);
  destination.props.onChange({ target: { value: 'yaletown-roundhouse' } });
  assert(!calls.some((call) => call[0] === 'destination'));
  host.unmount();
});

test('mobile controls use the real captured joystick and a separate gated action without stealing another pointer', () => {
  const h = setup();
  const base = state({
    phase: 'station',
    stationId: 'waterfront',
    lineId: 'expo',
    canChangeLevel: true,
  });
  const { host, calls, props } = panel(h, base, { touch: true });
  const child = all(
    host.tree,
    (node) => typeof node.type === 'function' && node.props.mode === 'walk',
  )[0];
  assert(child);
  const stickHost = h.mount(child.type, child.props);
  const stick = all(
    stickHost.tree,
    (node) => node.props.className === 'travel-joystick',
  )[0];
  let prevented = 0;
  stick.props.onPointerDown(event(11, { preventDefault: () => prevented++ }));
  assert(calls.at(-1)[2] > 0.9);
  const action = all(
    host.tree,
    (node) => node.props.className === 'skytrain-travel-touch-action',
  )[0];
  const actionButton = all(action, (node) => node.type === 'button')[0];
  actionButton.props.onClick();
  assert.deepEqual(calls.at(-1), ['platform']);
  stick.props.onPointerUp(event(22));
  assert(
    !calls.slice(-2).some((call) => call[0] === 'move' && call[2] === 0),
    'the second finger cannot release the captured walking pointer',
  );
  stick.props.onPointerCancel(event(11));
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  assert.equal(prevented, 1);
  stickHost.unmount();
  host.render({ ...props, snapshot: { ...base, phase: 'loading' } });
  assert(
    !all(
      host.tree,
      (node) => typeof node.type === 'function' && node.props.mode === 'walk',
    ).length,
  );
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  host.unmount();
});

test('visibility, blur, lost capture and disabling the panel clear mobile walking intent', () => {
  const h = setup(),
    { host, calls, props } = panel(
      h,
      state({ phase: 'station', stationId: 'burrard', lineId: 'expo' }),
      { touch: true },
    );
  const child = all(
    host.tree,
    (node) => typeof node.type === 'function' && node.props.mode === 'walk',
  )[0];
  const stickHost = h.mount(child.type, child.props);
  const stick = all(
    stickHost.tree,
    (node) => node.props.className === 'travel-joystick',
  )[0];
  stick.props.onPointerDown(event(1));
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  h.doc.hidden = false;
  stick.props.onPointerDown(event(2));
  h.win.dispatchEvent(new Event('blur'));
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  stick.props.onPointerDown(event(3));
  stick.props.onLostPointerCapture(event(3));
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  host.render({ ...props, visible: false });
  assert.equal(host.tree, null);
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  host.render({ ...props, controlsEnabled: false });
  assert(
    !all(
      host.tree,
      (node) => typeof node.type === 'function' && node.props.mode === 'walk',
    ).length,
  );
  stickHost.unmount();
  host.unmount();
});

test('standing passengers can walk aboard on mobile and sitting releases the captured movement', () => {
  const h = setup();
  const aboard = state({
    phase: 'riding',
    stationId: 'waterfront',
    nextStationId: 'burrard',
    lineId: 'expo',
    speedMps: 15,
    canWalkCabin: true,
    seated: false,
  });
  const { host, calls, props } = panel(h, aboard, { touch: true });
  const joystick = () =>
    all(
      host.tree,
      (node) => typeof node.type === 'function' && node.props.mode === 'walk',
    )[0];
  assert.ok(joystick(), 'walking is available inside a moving train');
  assert.equal(joystick().props.label, interactions.en.walkCabin);
  const stickHost = h.mount(joystick().type, joystick().props);
  const stick = all(
    stickHost.tree,
    (node) => node.props.className === 'travel-joystick',
  )[0];
  stick.props.onPointerDown(event(12));
  assert.ok(calls.at(-1)[2] > 0.9);
  host.render({ ...props, snapshot: { ...aboard, seated: true } });
  assert.equal(joystick(), undefined);
  assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  stickHost.unmount();
  host.render(props);
  assert.ok(joystick(), 'standing again restores the mobile aisle control');
  const resumed = h.mount(joystick().type, joystick().props);
  const resumedStick = all(
    resumed.tree,
    (node) => node.props.className === 'travel-joystick',
  )[0];
  resumedStick.props.onPointerMove(event(12));
  assert.deepEqual(
    calls.at(-1),
    ['move', 0, 0],
    'old pointer cannot resume walking',
  );
  resumed.unmount();
  host.unmount();
});

test('cabin movement is hidden while seated, busy, disabled or unavailable without changing station walking', () => {
  const h = setup();
  const base = state({
    phase: 'riding',
    stationId: 'granville',
    canWalkCabin: true,
  });
  const { host, calls, props } = panel(h, base, { touch: true });
  const sticks = () =>
    all(
      host.tree,
      (node) => typeof node.type === 'function' && node.props.mode === 'walk',
    );
  for (const patch of [
    { snapshot: { ...base, seated: true } },
    { snapshot: { ...base, busy: true } },
    { snapshot: { ...base, canWalkCabin: false } },
    { controlsEnabled: false },
    { visible: false },
  ]) {
    host.render(props);
    assert.equal(sticks().length, 1);
    host.render({ ...props, ...patch });
    assert.equal(sticks().length, 0);
    assert.deepEqual(calls.at(-1), ['move', 0, 0]);
  }
  host.render({
    ...props,
    snapshot: { ...base, phase: 'station', canWalkCabin: false },
  });
  assert.equal(
    sticks().length,
    1,
    'station walking does not depend on cabin availability',
  );
  host.render({
    ...props,
    snapshot: { ...base, phase: 'station', seated: true },
  });
  assert.equal(sticks().length, 0, 'station benches also suspend walking');
  host.unmount();
});

test('onboard movement and stand-up guidance use the active language without desktop keys on mobile', () => {
  for (const locale of Object.keys(interactions)) {
    const h = setup();
    const aboard = state({ phase: 'riding', canWalkCabin: true });
    const { host, props } = panel(h, aboard, { locale });
    assert.ok(text(host.tree).includes(interactions[locale].cabinHint));
    assert.ok(!text(host.tree).includes(catalogs[locale].desktopHint));
    host.render({ ...props, snapshot: { ...aboard, seated: true } });
    const standShortcut = interactions[locale].shortcut.replace(
      '{action}',
      interactions[locale].stand,
    );
    assert.ok(text(host.tree).includes(standShortcut));
    host.render({
      ...props,
      touch: true,
      snapshot: { ...aboard, seated: true },
    });
    const hint = all(
      host.tree,
      (node) => node.type === 'p' && text(node) === interactions[locale].stand,
    );
    assert.equal(hint.length, 1);
    assert.ok(!text(host.tree).includes(standShortcut));
    host.unmount();
  }
});

test('all ten locales provide complete trip labels and explain desktop interaction and mobile movement', () => {
  const expected = [
    'en',
    'fr',
    'es',
    'zh-Hant',
    'zh-Hans',
    'de',
    'ja',
    'ko',
    'uk',
    'ru',
  ].sort();
  assert.deepEqual(Object.keys(catalogs).sort(), expected);
  const keys = Object.keys(catalogs.en).sort();
  for (const locale of expected) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys);
    for (const key of keys)
      assert(catalogs[locale][key].trim(), `${locale}/${key}`);
    assert.match(catalogs[locale].desktopHint, /WASD/);
    assert.match(catalogs[locale].desktopHint, /E/);
    assert.notEqual(catalogs[locale].board, catalogs[locale].alight);
    const h = setup(),
      { host } = panel(h, state(), { locale });
    assert.match(
      text(host.tree),
      new RegExp(catalogs[locale].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    host.unmount();
  }
});
