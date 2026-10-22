import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const { EMPTY_ROCKET } = await import(cityModule('rocket-snapshot'));
const source = readFileSync(
  new URL('../components/rocket-controls.tsx', import.meta.url),
  'utf8',
);
const compile = (module) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

// Preserve state across renders and execute the production component callbacks.
// Scheduling and SVG icons are substituted; flight simulation stays outside UI tests.
function setup(patch = {}, extra = {}) {
  let active;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
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
  const cjs = { exports: {} };
  const require = (id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime')
      return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === './travel-joystick') return { TravelJoystick: () => null };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected UI import ${id}`);
  };
  vm.runInNewContext(
    `(function(require,module,exports){${compile(ts.ModuleKind.CommonJS)}\n})`,
  )(require, cjs, cjs.exports);
  const calls = [];
  const controller = Object.fromEntries(
    [
      'setInputEnabled',
      'setSpaceFocus',
      'setView',
      'returnToCity',
      'launch',
      'setAuto',
      'setStabilize',
      'setMuted',
      'setAxes',
      'retry',
      'abort',
      'resetDamage',
      'setThrottle',
      'cancelPlacement',
      'retryLoad',
    ].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  const props = {
    controller,
    snapshot: {
      ...EMPTY_ROCKET,
      exists: true,
      active: true,
      loaded: true,
      missionId: 7,
      phase: 'flight',
      stage: 'boost',
      stageFuel: 0.37,
      fuel: 0.11,
      ...patch,
    },
    locale: 'en',
    touch: false,
    onChoose: (...args) => calls.push(['choose', ...args]),
    onCloseChoosing() {},
    ...extra,
  };
  const host = { slots: [], cursor: 0, pending: [], props, tree: null };
  host.render = (next = host.props) => {
    host.props = next;
    host.cursor = 0;
    active = host;
    host.tree = cjs.exports.RocketControls(next);
    active = null;
    host.pending.splice(0).forEach((effect) => effect());
    return host.tree;
  };
  host.unmount = () => host.slots.forEach((slot) => slot.cleanup?.());
  host.render();
  return { host, calls, props };
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
  if (Array.isArray(tree)) return Array.from(tree).map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const findClass = (host, name) =>
  all(host.tree, (node) => node.props.className?.split(' ').includes(name))[0];
const button = (host, name) =>
  all(
    host.tree,
    (node) =>
      node.type === 'button' &&
      (node.props['aria-label'] === name || text(node).trim() === name),
  )[0];

test('the flight readout follows the active stage and its fuel instead of whole-vehicle fuel', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, props } = setup({}, { locale, touch: true });
    let stage = findClass(host, 'rocket-stage-status');
    assert.match(
      text(stage),
      locale === 'en' ? /Stage 1.*37\s*%/ : /第一級.*37\s*%/,
    );
    assert.equal(
      all(stage, (node) => node.type === 'progress')[0].props.value,
      0.37,
    );
    host.render({
      ...props,
      snapshot: { ...props.snapshot, stage: 'upper', stageFuel: 0.82 },
    });
    stage = findClass(host, 'rocket-stage-status');
    assert.match(
      text(stage),
      locale === 'en' ? /Stage 2.*82\s*%/ : /第二級.*82\s*%/,
    );
    assert.equal(
      all(stage, (node) => node.type === 'progress')[0].props.value,
      0.82,
    );
    host.unmount();
  }
});

test('stage separation is announced before a fresh upper-stage fuel gauge appears', () => {
  const { host, props } = setup({ stage: 'separating', stageFuel: 0 });
  const stage = findClass(host, 'rocket-stage-status');
  assert.match(text(stage), /Stage separation/);
  assert.match(text(stage), /Booster released/);
  assert.equal(all(stage, (node) => node.type === 'progress').length, 0);
  assert.equal(
    all(stage, (node) => node.type === 'output')[0].props['aria-live'],
    'polite',
  );
  host.render({
    ...props,
    snapshot: { ...props.snapshot, stage: 'upper', stageFuel: 1 },
  });
  assert.equal(
    all(
      findClass(host, 'rocket-stage-status'),
      (node) => node.type === 'progress',
    )[0].props.value,
    1,
  );
  host.unmount();
});

test('space immediately exposes four observation targets and camera/city actions without a blocking mission dialog', () => {
  for (const locale of ['en', 'zh-Hant'])
    for (const touch of [false, true]) {
      const { host, calls, props } = setup(
        {
          phase: 'space',
          stage: 'coast',
          altitude: 100000,
          spaceFocus: 'earth',
          view: 'first',
        },
        { locale, touch },
      );
      const panel = findClass(host, 'rocket-space-panel');
      assert(panel, 'an observation card is visible immediately');
      assert.equal(
        all(
          host.tree,
          (node) => node.type === 'dialog' || node.props.role === 'dialog',
        ).length,
        0,
      );
      assert.equal(findClass(host, 'rocket-panel'), undefined);
      assert.equal(findClass(host, 'rocket-telemetry'), undefined);
      assert.equal(findClass(host, 'rocket-compact-controls'), undefined);
      const targets = all(
        panel,
        (node) => node.type === 'button' && node.props['data-rocket-focus'],
      );
      assert.deepEqual(
        targets.map((node) => node.props['data-rocket-focus']),
        ['earth', 'sun', 'moon', 'rocket'],
      );
      assert.equal(targets[0].props['aria-pressed'], true);
      assert.match(
        text(panel),
        locale === 'en' ? /Earth.*Sun.*Moon.*Rocket/ : /地球.*太陽.*月球.*火箭/,
      );
      for (const target of targets) target.props.onClick();
      assert.deepEqual(
        calls.filter((call) => call[0] === 'setSpaceFocus'),
        [
          ['setSpaceFocus', 'earth'],
          ['setSpaceFocus', 'sun'],
          ['setSpaceFocus', 'moon'],
          ['setSpaceFocus', 'rocket'],
        ],
      );
      all(
        panel,
        (node) =>
          node.type === 'button' && 'data-rocket-space-view' in node.props,
      )[0].props.onClick();
      assert.deepEqual(calls.at(-1), ['setView', 'chase']);
      button(host, locale === 'en' ? 'City view' : '城市視角').props.onClick();
      assert.deepEqual(calls.at(-1), ['returnToCity']);
      host.render({
        ...props,
        snapshot: { ...props.snapshot, spaceFocus: 'moon' },
      });
      assert.equal(
        all(host.tree, (node) => node.props['data-rocket-focus'] === 'moon')[0]
          .props['aria-pressed'],
        true,
      );
      host.unmount();
    }
});

test('mission details remain collapsed by default and reset for a new mission id', () => {
  const { host, props, calls } = setup({
    phase: 'space',
    altitude: 100000,
    damaged: 3,
    burning: 4,
    debris: 5,
    kind: 'large',
  });
  assert.equal(findClass(host, 'rocket-mission-details'), undefined);
  button(host, 'Mission details').props.onClick();
  host.render();
  const stats = findClass(host, 'rocket-mission-stats');
  assert.match(text(stats), /100\.0\s*km/);
  assert.match(text(stats), /3\s*Buildings damaged/);
  assert.match(text(stats), /4\s*Fires/);
  assert.match(text(stats), /5\s*Debris fragments/);
  button(host, 'New rocket').props.onClick();
  assert.deepEqual(calls.at(-1), ['choose', 'large']);
  host.render({ ...props, snapshot: { ...props.snapshot, altitude: 100001 } });
  assert(
    findClass(host, 'rocket-mission-details'),
    'snapshot updates retain an explicitly opened result',
  );
  host.render({ ...props, snapshot: { ...props.snapshot, missionId: 8 } });
  assert.equal(
    findClass(host, 'rocket-mission-details'),
    undefined,
    'a new run starts with an unobstructed observation view',
  );
  host.unmount();
});

test('launch labels do not assume a countdown duration and render the supplied countdown', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, calls, props } = setup({ phase: 'ready' }, { locale });
    const launch = button(
      host,
      locale === 'en' ? 'Begin countdown' : '開始倒數',
    );
    assert(launch);
    launch.props.onClick();
    assert.deepEqual(calls.at(-1), ['launch']);
    assert.doesNotMatch(text(host.tree), /5.second|5 秒/);
    host.render({
      ...props,
      snapshot: { ...props.snapshot, phase: 'countdown', countdown: 2.5 },
    });
    assert.match(text(findClass(host, 'rocket-countdown')), /^3\s/);
    host.unmount();
  }
});

test('minimal mobile space UI retains observation controls and hiding a panel releases flight input', () => {
  const { host, props, calls } = setup(
    { phase: 'space', altitude: 100000 },
    { touch: true, minimal: true, panelVisible: false },
  );
  assert(findClass(host, 'rocket-space-panel'));
  host.render({ ...props, hidden: true });
  assert.equal(host.tree, null);
  assert.deepEqual(calls.at(-1), ['setInputEnabled', false]);
  host.unmount();
});

const dataModule = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const components = new Map();
function componentModule(name) {
  if (components.has(name)) return components.get(name);
  const code = ts
    .transpileModule(
      readFileSync(
        new URL(`../components/${name}.tsx`, import.meta.url),
        'utf8',
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    )
    .outputText.replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
      const url =
        id === './travel-joystick'
          ? componentModule('travel-joystick')
          : id === '@/lib/city/touch-input'
            ? cityModule('touch-input')
            : import.meta.resolve(id);
      return `from '${url}'`;
    });
  const url = dataModule(code);
  components.set(name, url);
  return url;
}
const { RocketControls } = await import(componentModule('rocket-controls'));
test('real React server rendering exposes a named observation region and pressed celestial target', () => {
  const html = renderToStaticMarkup(
    React.createElement(RocketControls, {
      controller: {},
      snapshot: {
        ...EMPTY_ROCKET,
        active: true,
        exists: true,
        phase: 'space',
        altitude: 100000,
        spaceFocus: 'sun',
      },
      locale: 'en',
      touch: true,
      onChoose() {},
      onCloseChoosing() {},
    }),
  );
  assert.match(html, /aria-label="Space observation"/);
  assert.match(html, /data-rocket-focus="sun" aria-pressed="true"/);
  assert.doesNotMatch(html, /<dialog|Observe space|Autopilot|rocket-telemetry/);
});
