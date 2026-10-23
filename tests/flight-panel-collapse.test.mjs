import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const catalog = (name) =>
  JSON.parse(
    readFileSync(new URL(`../lib/i18n/${name}.json`, import.meta.url), 'utf8'),
  );
const flightMessages = catalog('flight'),
  panelMessages = catalog('panels');

// Execute the production disclosure and flight callbacks; replace only hook
// scheduling, icon drawing, and UI children unrelated to this disclosure.
function setup() {
  let active;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const owner = active,
        slot = owner.cursor++;
      owner.slots[slot] ??= { value: initial };
      return [
        owner.slots[slot].value,
        (next) => {
          owner.slots[slot].value =
            typeof next === 'function' ? next(owner.slots[slot].value) : next;
        },
      ];
    },
    useCallback(callback, deps) {
      const slot = active.cursor++,
        previous = active.slots[slot];
      if (!previous || !same(previous.deps, deps))
        active.slots[slot] = { value: callback, deps };
      return active.slots[slot].value;
    },
    useEffect(callback, deps) {
      const owner = active,
        slot = owner.cursor++,
        previous = owner.slots[slot];
      if (!previous || !same(previous.deps, deps)) {
        owner.slots[slot] = { deps };
        owner.pending.push(() => {
          previous?.cleanup?.();
          owner.slots[slot].cleanup = callback();
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const modules = new Map();
  const load = (name) => {
    if (modules.has(name)) return modules.get(name);
    const source = readFileSync(
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
    const target = { exports: {} };
    const require = (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime')
        return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (id === 'lucide-react')
        return new Proxy({}, { get: () => () => null });
      if (id === '@/lib/i18n')
        return { translate: (locale, key) => `${locale}:${key}` };
      if (id === '@/lib/i18n/flight.json') return flightMessages;
      if (id === '@/lib/i18n/panels.json') return panelMessages;
      if (id === './panel-toggle') return load('panel-toggle');
      if (id === './ui/slider') return { Slider: () => null };
      if (id === './travel-joystick') return { TravelJoystick: () => null };
      if (id.endsWith('.css')) return {};
      throw new Error(`Unexpected flight UI import ${id}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`)(
      require,
      target,
      target.exports,
    );
    modules.set(name, target.exports);
    return target.exports;
  };
  const mount = (component, props) => {
    const owner = { cursor: 0, slots: [], pending: [], props, tree: null };
    owner.render = (next = owner.props) => {
      owner.props = next;
      owner.cursor = 0;
      active = owner;
      owner.tree = component(next);
      active = null;
      owner.pending.splice(0).forEach((run) => run());
    };
    owner.unmount = () => owner.slots.forEach((slot) => slot.cleanup?.());
    owner.render();
    return owner;
  };
  return { load, mount };
}
function find(tree, check) {
  if (!tree) return null;
  if (Array.isArray(tree))
    return tree.map((child) => find(child, check)).find(Boolean);
  if (typeof tree !== 'object') return null;
  return check(tree) ? tree : find(tree.props?.children, check);
}
const state = {
  exists: true,
  attached: true,
  placing: false,
  kind: 'seaplane',
  phase: 'flying',
  power: 0.65,
  altitude: 90,
  speed: 52,
  cruise: false,
  hover: false,
  join: false,
  view: 'chase',
  stalled: false,
  crashSeconds: 0,
  warning: '',
  preview: null,
};
function flight(h, extra = {}) {
  const calls = [];
  const controller = Object.fromEntries(
    [
      'setInputEnabled',
      'setPower',
      'setStick',
      'setHold',
      'cruise',
      'cancelPlacement',
    ].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  controller.snapshot = state;
  const props = {
    controller,
    state,
    locale: 'en',
    touch: false,
    controlsEnabled: true,
    panelVisible: true,
    optionsOpen: false,
    ...extra,
  };
  return {
    owner: h.mount(h.load('flight-controls').FlightControls, props),
    calls,
  };
}

test('helm disclosure leaves power, cruise and input ownership unchanged and stays collapsed through telemetry updates', () => {
  const h = setup(),
    { owner, calls } = flight(h),
    { PanelToggle } = h.load('panel-toggle');
  const helm = () =>
    find(owner.tree, (node) => node.props.className?.includes('flight-helm'));
  const toggle = () => find(owner.tree, (node) => node.type === PanelToggle);
  assert.equal(helm().props['data-panel-collapsed'], false);
  find(
    owner.tree,
    (node) => node.props.className === 'flight-cruise glass',
  ).props.onClick();
  find(
    owner.tree,
    (node) => node.props.orientation === 'vertical',
  ).props.onValueChange([73]);
  assert.deepEqual(calls, [
    ['setInputEnabled', true],
    ['cruise'],
    ['setPower', 0.73],
  ]);
  toggle().props.onToggle();
  owner.render();
  assert.equal(helm().props['data-panel-collapsed'], true);
  owner.render({
    ...owner.props,
    state: { ...state, power: 0.82, cruise: true, speed: 67 },
  });
  assert.equal(helm().props['data-panel-collapsed'], true);
  assert.deepEqual(calls, [
    ['setInputEnabled', true],
    ['cruise'],
    ['setPower', 0.73],
  ]);
  assert.equal(
    find(owner.tree, (node) => node.props.className === 'flight-cruise glass')
      .props['aria-pressed'],
    true,
  );
  toggle().props.onToggle();
  owner.render();
  assert.equal(helm().props['data-panel-collapsed'], false);
  owner.unmount();
});

test('touch and aircraft type changes preserve disclosure preference while disabled input still follows the existing gate', () => {
  const h = setup(),
    { owner, calls } = flight(h, { touch: true }),
    { PanelToggle } = h.load('panel-toggle');
  find(owner.tree, (node) => node.type === PanelToggle).props.onToggle();
  owner.render({ ...owner.props, state: { ...state, kind: 'helicopter' } });
  assert.equal(
    find(owner.tree, (node) => node.props.className?.includes('flight-helm'))
      .props['data-panel-collapsed'],
    true,
  );
  assert.deepEqual(calls, [['setInputEnabled', true]]);
  owner.render({ ...owner.props, controlsEnabled: false });
  assert.equal(
    find(owner.tree, (node) => node.props.className?.includes('flight-helm')),
    undefined,
  );
  assert.equal(calls.at(-1)[1], false);
  owner.render({ ...owner.props, controlsEnabled: true });
  assert.equal(
    find(owner.tree, (node) => node.props.className?.includes('flight-helm'))
      .props['data-panel-collapsed'],
    true,
  );
  owner.unmount();
});

test('all ten locales expose a named, keyboard-safe helm restore control', () => {
  assert.deepEqual(
    Object.keys(panelMessages).sort(),
    Object.keys(flightMessages).sort(),
  );
  for (const locale of Object.keys(flightMessages)) {
    const h = setup(),
      { owner } = flight(h, { locale }),
      { PanelToggle } = h.load('panel-toggle');
    let stopped = 0;
    const node = find(owner.tree, (child) => child.type === PanelToggle),
      button = h.mount(PanelToggle, node.props);
    assert.equal(button.tree.props.type, 'button');
    assert.equal(button.tree.props['aria-expanded'], true);
    assert.equal(
      button.tree.props['aria-label'],
      `${panelMessages[locale].collapse} ${flightMessages[locale].help}`,
    );
    button.tree.props.onKeyDown({ key: ' ', stopPropagation: () => stopped++ });
    button.tree.props.onKeyDown({
      key: 'Enter',
      stopPropagation: () => stopped++,
    });
    button.tree.props.onClick({ stopPropagation: () => stopped++ });
    assert.equal(stopped, 3);
    owner.render();
    const collapsed = find(owner.tree, (child) => child.type === PanelToggle);
    button.render(collapsed.props);
    assert.equal(button.tree.props['aria-expanded'], false);
    assert.equal(
      button.tree.props['aria-label'],
      `${panelMessages[locale].expand} ${flightMessages[locale].help}`,
    );
    owner.unmount();
  }
});
