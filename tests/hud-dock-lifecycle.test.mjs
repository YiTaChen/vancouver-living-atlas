import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(
  new URL('../components/hud-dock.tsx', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function load({ react = React, reactDom = ReactDOM, globals = {} } = {}) {
  const cjs = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, globals)(
    (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return jsx;
      if (id === 'react-dom') return reactDom;
      if (id.endsWith('.css')) return {};
      throw new Error(`Unexpected import ${id}`);
    },
    cjs,
    cjs.exports,
  );
  return cjs.exports;
}

test('server renders collapsed content inline and gives the dock an accessible name', () => {
  const { HudDock, HudDockItem } = load();
  const item = renderToStaticMarkup(
    React.createElement(
      HudDockItem,
      { id: 'map' },
      React.createElement('button', null, 'Map'),
    ),
  );
  assert.match(item, /<button>Map<\/button>/);
  const dock = renderToStaticMarkup(React.createElement(HudDock));
  assert.match(dock, /aria-label="Collapsed panels"/);
  assert.match(dock, /aria-controls="hud-dock-rail"/);
  assert.match(dock, /aria-expanded="false"/);
});

function element() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    listeners,
    attributes,
    dataset: {},
    style: {},
    hidden: true,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    contains(node) {
      return node === this.contained;
    },
    focus() {
      this.focused = true;
    },
  };
}

function mountHarness() {
  const refs = [];
  let effect;
  let subscription;
  const observers = [];
  const frames = [];
  const timers = new Map();
  let nextTimer = 1;
  const window = element();
  window.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.cancelAnimationFrame = () => {};
  window.getComputedStyle = (target) => ({
    paddingLeft: '0',
    paddingRight: '0',
    paddingTop: '0',
    paddingBottom: '0',
    visibility: target.style?.visibility ?? 'visible',
    display: 'block',
  });
  const document = Object.assign(element(), {
    documentElement: { lang: 'en' },
    body: {},
    activeElement: null,
    getElementById: () => null,
    defaultView: window,
  });
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const react = {
    useRef(value) {
      const ref = { current: value };
      refs.push(ref);
      return ref;
    },
    useCallback(callback) {
      return callback;
    },
    useLayoutEffect(callback) {
      effect = callback;
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      subscription = { subscribe, getSnapshot, getServerSnapshot };
      return getSnapshot();
    },
  };
  const reactDom = {
    createPortal: (children, container) => ({ children, container }),
  };
  const globals = {
    window,
    document,
    ResizeObserver: Observer,
    MutationObserver: Observer,
    clearTimeout: window.clearTimeout,
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame(callback) {
      frames.push(callback);
    },
  };
  const components = load({ react, reactDom, globals });
  const tree = components.HudDock();
  const [triggerElement, railElement] = tree.props.children;
  const host = element();
  const rail = element();
  const trigger = element();
  const atlas = element();
  host.closest = () => atlas;
  host.getBoundingClientRect = () => ({
    left: 0,
    right: 390,
    top: 0,
    bottom: 844,
  });
  atlas.querySelectorAll = () => [];
  rail.children = [
    { offsetWidth: 44, offsetHeight: 44, getClientRects: () => [1] },
  ];
  refs[0].current = host;
  refs[2].current = trigger;
  return {
    ...components,
    tree,
    host,
    atlas,
    rail,
    trigger,
    document,
    window,
    observers,
    frames,
    runTimer(delay) {
      const timer = [...timers.entries()].find(
        ([, value]) => value.delay === delay,
      );
      assert.ok(timer, `scheduled ${delay}ms timer`);
      timers.delete(timer[0]);
      timer[1].callback();
    },
    timers,
    attach: (value) => railElement.props.ref(value),
    startEffect: () => effect(),
    getSubscription: () => subscription,
    triggerElement,
  };
}

test('items follow the mounted host and unsubscribe cleanly', () => {
  const h = mountHarness();
  const child = React.createElement('button', null, 'Map');
  assert.equal(h.HudDockItem({ id: 'map', children: child }), child);
  const subscription = h.getSubscription();
  assert.equal(subscription.getServerSnapshot(), null);
  assert.equal(subscription.getSnapshot(), null);
  let notices = 0;
  const unsubscribe = subscription.subscribe(() => notices++);
  h.attach(h.rail);
  assert.equal(notices, 1);
  assert.equal(subscription.getSnapshot(), h.rail);
  const portal = h.HudDockItem({ id: 'map', essential: true, children: child });
  assert.equal(portal.container, h.rail);
  assert.equal(portal.children.props['data-hud-dock-id'], 'map');
  assert.equal(portal.children.props['data-essential'], true);
  h.attach(h.rail);
  assert.equal(notices, 1, 'attaching the same host does not re-notify');
  h.attach(null);
  assert.equal(subscription.getSnapshot(), null);
  assert.equal(notices, 2);
  unsubscribe();
  h.attach(h.rail);
  assert.equal(notices, 2, 'removed subscribers are not notified');
  h.attach(null);
});

test('overflow closes on Escape and unmount removes scene and observer listeners', () => {
  const h = mountHarness();
  h.attach(h.rail);
  const cleanup = h.startEffect();
  h.host.dataset.overflow = 'true';
  h.trigger.hidden = false;
  h.triggerElement.props.onClick({
    stopPropagation() {},
    currentTarget: h.trigger,
  });
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(h.rail.style.visibility, 'visible');
  let stopped = false;
  h.trigger.dispatch('keydown', {
    key: 'Escape',
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.rail.style.visibility, 'hidden');
  assert.equal(h.trigger.focused, true);
  for (const type of ['pointerdown', 'click', 'wheel']) {
    stopped = false;
    h.rail.dispatch(type, {
      target: { closest: () => null },
      stopPropagation() {
        stopped = true;
      },
    });
    assert.equal(stopped, true, `${type} must not reach the scene`);
  }
  cleanup();
  assert.ok(h.observers.every((observer) => observer.disconnected));
  for (const listeners of [
    h.rail.listeners,
    h.trigger.listeners,
    h.window.listeners,
  ]) {
    assert.ok([...listeners.values()].every((set) => set.size === 0));
  }
  h.attach(null);
});

test('closing overflow after an action returns focus without stealing an expanded panel focus', () => {
  const h = mountHarness();
  h.attach(h.rail);
  const cleanup = h.startEffect();
  const button = { id: '' };
  const event = { target: { closest: () => button }, stopPropagation() {} };
  h.host.dataset.overflow = 'true';
  h.host.dataset.open = 'true';
  h.trigger.hidden = false;
  h.rail.contained = button;
  h.document.activeElement = button;
  h.rail.dispatch('click', event);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.rail.style.visibility, 'hidden');
  h.frames.shift()();
  assert.equal(h.trigger.focused, true);

  h.trigger.focused = false;
  h.host.dataset.open = 'true';
  h.document.activeElement = button;
  h.rail.dispatch('click', event);
  h.document.activeElement = { id: 'expanded-panel-control' };
  h.frames.shift()();
  assert.equal(
    h.trigger.focused,
    false,
    'focus already moved to expanded panel',
  );
  cleanup();
  h.attach(null);
});

test('changing language updates the overflow entry and region names', () => {
  const h = mountHarness();
  h.attach(h.rail);
  const cleanup = h.startEffect();
  h.document.documentElement.lang = 'zh-Hant';
  h.observers
    .find((observer) => observer.target === h.document.documentElement)
    .callback();
  assert.equal(h.trigger.getAttribute('aria-label'), '顯示收合的面板');
  assert.equal(h.rail.getAttribute('aria-label'), '收合的面板');
  cleanup();
  h.attach(null);
});

function keyboardFocusSetup() {
  const h = mountHarness();
  h.attach(h.rail);
  h.rail.style.visibility = 'hidden';
  h.rail.parentElement = { querySelector: () => h.trigger };
  const current = { ownerDocument: h.document };
  const target = {
    style: h.rail.style,
    getClientRects: () => [1],
    closest: () => h.rail,
    focus(options) {
      this.focused = true;
      this.focusOptions = options;
    },
  };
  h.trigger.getClientRects = () => [1];
  h.document.activeElement = current;
  const cleanup = h.startEffect();
  return { h, current, target, cleanup };
}

test('keyboard disclosure restores focus only after the dock is positioned and visible', () => {
  const { h, current, target, cleanup } = keyboardFocusSetup();
  h.restoreHudFocus(current, () => target);
  h.document.activeElement = h.document.body;
  h.frames.shift()();
  assert.notEqual(
    target.focused,
    true,
    'the hidden target cannot receive focus',
  );
  h.runTimer(100);
  assert.equal(h.rail.style.visibility, 'visible');
  assert.equal(
    target.focused,
    true,
    'layout restores focus once the target is visible',
  );
  assert.equal(target.focusOptions.preventScroll, true);
  assert.equal(h.timers.size, 0, 'successful focus clears the expiry');
  cleanup();
  h.attach(null);
});

test('user input or focus moving elsewhere cancels delayed restoration', () => {
  for (const eventType of ['pointerdown', 'keydown', 'focusin']) {
    const { h, current, target, cleanup } = keyboardFocusSetup();
    h.restoreHudFocus(current, () => target);
    h.document.activeElement = h.document.body;
    h.frames.shift()();
    const other = { id: 'another-control' };
    h.document.activeElement = other;
    h.document.dispatch(eventType, {});
    h.runTimer(100);
    assert.equal(h.document.activeElement, other);
    assert.notEqual(
      target.focused,
      true,
      `${eventType} must cancel delayed focus`,
    );
    for (const type of ['pointerdown', 'keydown', 'focusin']) {
      assert.equal(h.document.listeners.get(type)?.size ?? 0, 0);
    }
    cleanup();
    h.attach(null);
  }
});

test('keyboard focus falls back to the visible overflow entry on a crowded screen', () => {
  const { h, current, target, cleanup } = keyboardFocusSetup();
  const obstacle = element();
  obstacle.getClientRects = () => [1];
  obstacle.closest = () => null;
  obstacle.getBoundingClientRect = () => ({
    left: 0,
    right: 390,
    top: 0,
    bottom: 844,
  });
  h.atlas.querySelectorAll = (selector) =>
    selector.startsWith('.ui-chrome') ? [obstacle] : [];
  h.restoreHudFocus(current, () => target);
  h.document.activeElement = h.document.body;
  h.frames.shift()();
  h.runTimer(100);
  assert.equal(h.rail.style.visibility, 'hidden');
  assert.equal(h.trigger.hidden, false);
  assert.equal(h.trigger.focused, true);
  assert.notEqual(target.focused, true);
  cleanup();
  h.attach(null);
});

test('unmount cancels pending focus and its listeners and timers', () => {
  const { h, current, target, cleanup } = keyboardFocusSetup();
  h.restoreHudFocus(current, () => target);
  h.document.activeElement = h.document.body;
  h.frames.shift()();
  assert.notEqual(target.focused, true);
  cleanup();
  for (const type of ['pointerdown', 'keydown', 'focusin']) {
    assert.equal(h.document.listeners.get(type)?.size ?? 0, 0);
  }
  assert.equal(h.timers.size, 0);
  h.rail.style.visibility = 'visible';
  assert.notEqual(target.focused, true);
  h.attach(null);
});

test('a mouse operation without focused disclosure never schedules focus restoration', () => {
  const { h, current, target, cleanup } = keyboardFocusSetup();
  h.document.activeElement = h.document.body;
  h.restoreHudFocus(current, () => target);
  assert.equal(h.frames.length, 0);
  for (const type of ['pointerdown', 'keydown', 'focusin']) {
    assert.equal(h.document.listeners.get(type)?.size ?? 0, 0);
  }
  cleanup();
  h.attach(null);
});

test('a missing disclosure expires without stealing focus later', () => {
  const { h, current, target, cleanup } = keyboardFocusSetup();
  let replacement = null;
  h.restoreHudFocus(current, () => replacement);
  h.document.activeElement = h.document.body;
  h.frames.shift()();
  h.runTimer(5000);
  replacement = target;
  h.runTimer(100);
  assert.notEqual(target.focused, true);
  for (const type of ['pointerdown', 'keydown', 'focusin']) {
    assert.equal(h.document.listeners.get(type)?.size ?? 0, 0);
  }
  cleanup();
  h.attach(null);
});
