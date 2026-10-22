import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const i18n = await import(cityModule('../i18n/index'));
const touch = await import(cityModule('touch-input'));
const catalogs = JSON.parse(
  fs.readFileSync(
    new URL('../lib/i18n/bus-passenger.json', import.meta.url),
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
// React scheduling and browser events. Text uses the production i18n module.
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
      if (id === '@/lib/i18n') return i18n;
      if (id === '@/lib/city/touch-input') return touch;
      if (id === '@/lib/i18n/bus-passenger.json') return catalogs;
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
    phase: 'aboard',
    aboard: true,
    seated: false,
    canWalkCabin: true,
    canBoard: false,
    canAlight: false,
    canRide: true,
    ridePhase: 'parked',
    speedMps: 0,
    accessibility: null,
    profile: 'budget',
    ...patch,
  };
}
function panel(h, snapshot = state(), extra = {}) {
  const calls = [];
  const props = {
    city: {
      busVisit: Object.fromEntries(
        ['board', 'alight', 'startRide', 'deployRamp', 'stowRamp'].map(
          (name) => [name, (...args) => calls.push([name, ...args])],
        ),
      ),
      publishBusVisit: () => calls.push(['publish']),
      setBusVisitDetail: (detail) => calls.push(['detail', detail]),
      closeBusVisit: () => calls.push(['close']),
    },
    snapshot,
    locale: 'en',
    visible: true,
    touch: false,
    controlsEnabled: true,
    onPrepare: async () => calls.push(['prepare']),
    onMove: (x, y) => calls.push(['move', x, y]),
    ...extra,
  };
  const component = h.load('bus-visit-panel').BusVisitPanel;
  return { host: h.mount(component, props), props, calls };
}

test('all ten locales translate bus walking, ride states and the shared sit/stand prompts', () => {
  const h = setup(),
    keys = Object.keys(catalogs.en).sort();
  const p = panel(h);
  for (const locale of i18n.LANGUAGES.map((l) => l.id)) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys);
    for (const value of Object.values(catalogs[locale]))
      assert.ok(value.trim());
    p.host.render({ ...p.props, locale, touch: true });
    assert.ok(button(p.host, catalogs[locale].ride));
    const stick = all(
      p.host.tree,
      (n) => n.props?.label === catalogs[locale].walkCabin,
    )[0];
    assert.ok(stick);
    p.host.render({ ...p.props, locale, snapshot: state({ seated: true }) });
    assert.ok(text(p.host.tree).includes(interactions[locale].stand));
    assert.ok(text(p.host.tree).includes('F'));
    p.host.render({
      ...p.props,
      locale,
      touch: true,
      snapshot: state({ seated: true }),
    });
    const hint = all(
      p.host.tree,
      (n) => n.props?.className === 'bus-visit-movement-hint',
    )[0];
    assert.equal(text(hint), interactions[locale].stand);
  }
  p.host.unmount();
});

test('boarding enters the aisle without a seat picker or teleport argument', () => {
  const h = setup(),
    p = panel(h, state({ phase: 'ready', aboard: false, canBoard: true }));
  assert.equal(
    all(p.host.tree, (n) => n.type === 'select').length,
    1,
    'only the detail selector remains',
  );
  button(p.host, i18n.translate('en', 'busVisitBoard')).props.onClick();
  assert.deepEqual(
    p.calls.filter((c) => c[0] === 'board'),
    [['board']],
  );
  p.host.render({
    ...p.props,
    snapshot: state({ phase: 'ready', aboard: false, canBoard: false }),
  });
  button(p.host, i18n.translate('en', 'busVisitBoard')).props.onClick();
  assert.equal(p.calls.filter((c) => c[0] === 'board').length, 1);
  p.host.unmount();
});

test('ride and exit handlers reject motion, modal input and ramp conflicts even with stale permissive flags', () => {
  const h = setup(),
    p = panel(h, state({ canAlight: true }));
  button(p.host, catalogs.en.ride).props.onClick();
  assert.equal(p.calls.filter((c) => c[0] === 'startRide').length, 1);
  const disabledCases = [
    { ridePhase: 'closing' },
    { ridePhase: 'moving', speedMps: 6 },
    { ridePhase: 'opening' },
    { speedMps: NaN },
    { speedMps: 0.2 },
    { accessibility: { phase: 'deployed', moving: false } },
  ];
  for (const patch of disabledCases) {
    p.host.render({
      ...p.props,
      snapshot: state({ canAlight: true, ...patch }),
    });
    for (const name of [
      catalogs.en.ride,
      i18n.translate('en', 'busVisitAlight'),
    ]) {
      const b = button(p.host, name);
      assert.equal(b.props.disabled, true);
      b.props.onClick();
    }
  }
  p.host.render({
    ...p.props,
    controlsEnabled: false,
    snapshot: state({ canAlight: true }),
  });
  button(p.host, catalogs.en.ride).props.onClick();
  button(p.host, i18n.translate('en', 'busVisitAlight')).props.onClick();
  assert.equal(p.calls.filter((c) => c[0] === 'startRide').length, 1);
  assert.equal(p.calls.filter((c) => c[0] === 'alight').length, 0);
  p.host.render({
    ...p.props,
    snapshot: state({ seated: true, canAlight: true }),
  });
  assert.equal(
    button(p.host, i18n.translate('en', 'busVisitAlight')).props.disabled,
    true,
  );
  button(p.host, i18n.translate('en', 'busVisitAlight')).props.onClick();
  p.host.render({
    ...p.props,
    snapshot: state({ ridePhase: 'complete', canAlight: true }),
  });
  button(p.host, i18n.translate('en', 'busVisitAlight')).props.onClick();
  assert.equal(p.calls.filter((c) => c[0] === 'alight').length, 1);
  p.host.unmount();
});

test('real mobile stick clears held movement on sit, modal, hidden panel, blur and unmount', () => {
  const h = setup(),
    p = panel(h, state({ ridePhase: 'moving', speedMps: 4 }), { touch: true });
  const pick = () =>
    all(
      p.host.tree,
      (n) => typeof n.type === 'function' && n.props?.mode === 'walk',
    )[0];
  assert.ok(pick(), 'walking inside a moving bus remains available');
  const child = h.mount(pick().type, pick().props);
  const stick = all(
    child.tree,
    (n) => n.type === 'button' && n.props.className === 'travel-joystick',
  )[0];
  const press = () => stick.props.onPointerDown(event());
  press();
  assert.ok(p.calls.at(-1)[2] > 0);
  h.win.dispatchEvent(new Event('blur'));
  assert.deepEqual(p.calls.at(-1), ['move', 0, 0]);
  for (const extra of [
    { snapshot: state({ seated: true }) },
    { controlsEnabled: false },
    { visible: false },
  ]) {
    p.host.render(p.props);
    press();
    p.host.render({ ...p.props, ...extra });
    assert.equal(pick(), undefined);
    assert.deepEqual(p.calls.at(-1), ['move', 0, 0]);
  }
  press();
  child.unmount();
  assert.deepEqual(p.calls.at(-1), ['move', 0, 0]);
  p.host.unmount();
});
