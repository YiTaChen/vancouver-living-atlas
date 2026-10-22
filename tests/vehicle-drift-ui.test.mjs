import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const touch = await import(cityModule('touch-input'));
const catalogs = JSON.parse(
  fs.readFileSync(new URL('../lib/i18n/tesla.json', import.meta.url), 'utf8'),
);

// Execute the actual React components and event handlers. Only hook scheduling,
// browser events and the timer clock are substituted; no DOM or WebGL is needed.
function setup() {
  const win = new EventTarget(),
    doc = new EventTarget(),
    timers = new Map();
  doc.hidden = false;
  let active,
    nextTimer = 1;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
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
      const i = active.cursor++,
        previous = active.slots[i];
      if (!previous || !same(previous.deps, deps))
        active.slots[i] = { value: callback, deps };
      return active.slots[i].value;
    },
    useEffect(callback, deps) {
      const host = active,
        i = host.cursor++,
        previous = host.slots[i];
      if (!previous || !same(previous.deps, deps)) {
        host.slots[i] = { deps, effect: true };
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
    const cjsModule = { exports: {} };
    const require = (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime')
        return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (id === '@/lib/city/touch-input') return touch;
      if (id === '@/lib/i18n/tesla.json') return catalogs;
      if (id === './travel-joystick') return load('travel-joystick');
      if (id === 'lucide-react')
        return new Proxy({}, { get: () => () => null });
      throw new Error(`Unexpected component dependency ${id}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
      window: win,
      document: doc,
      setTimeout: (callback) => {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    })(require, cjsModule, cjsModule.exports);
    modules.set(name, cjsModule.exports);
    return cjsModule.exports;
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
  return {
    win,
    doc,
    timers,
    load,
    mount,
    flush: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
function find(tree, predicate) {
  if (!tree) return null;
  if (Array.isArray(tree))
    return tree.map((child) => find(child, predicate)).find(Boolean);
  if (typeof tree !== 'object') return null;
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
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
function drift(h, onHeld, extra = {}) {
  const { DriftHoldButton } = h.load('travel-joystick');
  const wrapper = h.mount(DriftHoldButton, {
    label: 'Drift',
    onHeld,
    ...extra,
  });
  const owner =
    typeof wrapper.tree.type === 'function'
      ? h.mount(wrapper.tree.type, wrapper.tree.props)
      : wrapper;
  return { wrapper, owner, node: () => owner.tree };
}

test('mobile steering/throttle stays held while an independent drift pointer is pressed and cancelled', () => {
  const h = setup(),
    moves = [],
    held = [];
  const { TravelJoystick } = h.load('travel-joystick');
  const joystick = h.mount(TravelJoystick, {
    mode: 'drive',
    label: 'Stick',
    brakeLabel: 'Brake',
    driftLabel: 'Drift',
    onMove: (x, y) => moves.push([x, y]),
    onBrake() {},
    onDrift: (value) => held.push(value),
  });
  const stick = find(
    joystick.tree,
    (node) => node.props.className === 'travel-joystick',
  );
  const button = find(joystick.tree, (node) => node.props.label === 'Drift');
  const wrapper = h.mount(button.type, button.props),
    owner = h.mount(wrapper.tree.type, wrapper.tree.props);
  stick.props.onPointerDown(event(11));
  assert(moves.at(-1)[1] > 0.9, 'first finger maintains full throttle');
  owner.tree.props.onPointerDown(event(22));
  let stopped = 0;
  owner.tree.props.onPointerMove(
    event(22, { stopPropagation: () => stopped++ }),
  );
  owner.tree.props.onPointerMove(
    event(99, { stopPropagation: () => stopped++ }),
  );
  assert.equal(
    stopped,
    1,
    'captured drift movement does not rotate the map or consume another finger',
  );
  owner.tree.props.onPointerUp(event(99));
  assert.equal(held.at(-1), true, 'an unrelated pointer cannot release drift');
  owner.tree.props.onPointerCancel(event(22));
  assert.equal(held.at(-1), false);
  assert(
    moves.at(-1)[1] > 0.9,
    'drift cancellation leaves the steering finger untouched',
  );
  stick.props.onPointerUp(event(11));
  assert.deepEqual(moves.at(-1), [0, 0]);
  owner.unmount();
  wrapper.unmount();
  joystick.unmount();
});

test('pointer and accessible keyboard holds aggregate, and blur/visibility/unmount always clear drift', () => {
  const h = setup(),
    held = [],
    button = drift(h, (value) => held.push(value));
  button.node().props.onPointerDown(event(1));
  button.node().props.onKeyDown(event(0, { key: ' ', repeat: false }));
  button.node().props.onPointerUp(event(1));
  assert.equal(held.at(-1), true, 'keyboard still holds after pointer release');
  button.node().props.onKeyUp(event(0, { key: ' ' }));
  assert.equal(held.at(-1), false);
  button.node().props.onPointerDown(event(2));
  h.win.dispatchEvent(new Event('blur'));
  assert.equal(held.at(-1), false);
  button.node().props.onPointerDown(event(3));
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(held.at(-1), false);
  h.doc.hidden = false;
  button.node().props.onPointerDown(event(4));
  button.owner.unmount();
  assert.equal(held.at(-1), false);
  button.wrapper.unmount();
});

test('assistive clicks are bounded pulses and cannot cancel a real held pointer', () => {
  const h = setup(),
    held = [],
    button = drift(h, (value) => held.push(value));
  button.node().props.onClick({ detail: 0 });
  assert.equal(held.at(-1), true);
  assert.equal(h.timers.size, 1);
  button.node().props.onPointerDown(event(7));
  h.flush();
  assert.equal(held.at(-1), true, 'pulse expiry preserves physical hold');
  button.node().props.onLostPointerCapture(event(7));
  assert.equal(held.at(-1), false);
  button.node().props.onClick({ detail: 0 });
  button.owner.unmount();
  button.wrapper.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(held.at(-1), false);
});

test('disabling the ordinary control removes its captured owner; boats and walking never expose drift', () => {
  const h = setup(),
    held = [],
    button = drift(h, (value) => held.push(value));
  button.node().props.onPointerDown(event(1));
  button.wrapper.render({ ...button.wrapper.props, disabled: true });
  button.owner.unmount();
  assert.equal(held.at(-1), false);
  assert.equal(button.wrapper.tree.props.disabled, true);
  assert.equal(button.wrapper.tree.props['aria-pressed'], false);
  button.wrapper.unmount();
  const { TravelJoystick } = h.load('travel-joystick');
  for (const mode of ['walk', 'boat']) {
    const control = h.mount(TravelJoystick, {
      mode,
      label: 'Stick',
      brakeLabel: 'Brake',
      driftLabel: 'Drift',
      onMove() {},
      onBrake() {},
      onDrift() {},
    });
    assert.equal(
      find(control.tree, (node) => node.props.label === 'Drift'),
      undefined,
    );
    control.unmount();
  }
});

test('Tesla drift uses the same pointer safeguards without requesting jump, recovery or vortex', () => {
  const h = setup(),
    held = [],
    commands = [],
    input = [],
    pulses = [];
  const controller = {
    setButton: (code, value) => held.push([code, value]),
    setInputEnabled: (value) => input.push(value),
    command: (code) => commands.push(code),
    pulse: (code) => pulses.push(code),
  };
  const { TeslaControls } = h.load('tesla-controls');
  const main = h.mount(TeslaControls, {
    controller,
    state: {
      active: true,
      mode: 'ground',
      quality: 'auto',
      effectiveQuality: 'medium',
      view: 'chase',
      adhesion: true,
    },
    locale: 'en',
    touch: false,
    controlsEnabled: true,
    panelVisible: true,
    optionsOpen: false,
    onCloseOptions() {},
  });
  const child = find(main.tree, (node) => node.props.code === 'drift');
  assert.equal(child.props.hotkey, 'X');
  const owner = h.mount(child.type, child.props);
  owner.tree.props.onPointerDown(event(2));
  owner.tree.props.onPointerUp(event(8));
  assert.deepEqual(held.at(-1), ['drift', true]);
  owner.tree.props.onKeyDown(event(0, { key: 'Enter', repeat: false }));
  owner.tree.props.onPointerUp(event(2));
  assert.deepEqual(held.at(-1), ['drift', true]);
  owner.tree.props.onKeyUp(event(0, { key: 'Enter' }));
  assert.deepEqual(held.at(-1), ['drift', false]);
  owner.tree.props.onClick({ detail: 0 });
  assert.deepEqual(pulses, ['drift']);
  assert.deepEqual(commands, []);
  owner.tree.props.onPointerDown(event(3));
  h.win.dispatchEvent(new Event('blur'));
  assert.deepEqual(held.at(-1), ['drift', false]);
  owner.tree.props.onPointerDown(event(4));
  owner.render({ ...owner.props, disabled: true });
  assert.deepEqual(held.at(-1), ['drift', false]);
  owner.tree.props.onPointerDown(event(5));
  assert.deepEqual(
    held.at(-1),
    ['drift', false],
    'disabled pointer input remains disarmed',
  );
  owner.unmount();
  main.unmount();
  assert.equal(input.at(-1), false);
});
