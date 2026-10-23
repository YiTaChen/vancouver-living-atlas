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
    onCloseChoosing: () => calls.push(['closeChoosing']),
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

test('the chooser exposes three distinct rocket profiles with translated scale, influence and assembly timing', () => {
  for (const locale of ['en', 'zh-Hant', 'fr']) {
    const { host, calls } = setup({}, { locale, choosing: true, touch: true });
    const cards = all(
      host.tree,
      (node) => node.type === 'button' && node.props['data-rocket-kind'],
    );
    assert.deepEqual(
      cards.map((node) => node.props['data-rocket-kind']),
      ['small', 'large', 'super-heavy'],
    );
    for (const [i, card] of cards.entries()) {
      const label = text(card);
      assert.match(
        label,
        [/18.*35.*17.*6.*5/, /48.*100.*45.*10.*5/, /110.*220.*105.*16.*5/][i],
      );
      card.props.onClick();
      assert.deepEqual(calls.at(-1), [
        'choose',
        card.props['data-rocket-kind'],
      ]);
    }
    assert.match(
      text(cards[2]),
      locale === 'zh-Hant'
        ? /泰坦.*超大型.*銀色.*黑色/
        : /Titan.*Super-heavy.*silver.*dark/,
    );
    button(host, locale === 'zh-Hant' ? '取消' : 'Cancel').props.onClick();
    assert.deepEqual(calls.at(-1), ['closeChoosing']);
    host.unmount();
  }
});

test('Titan has a translated title and stronger foundation warnings across all supports without small-roof advice', () => {
  for (const locale of ['en', 'zh-Hant']) {
    for (const support of [
      'ground',
      'platform',
      'roof-small',
      'roof-large',
      'ocean',
      'river',
      'lake',
    ]) {
      const { host, props } = setup(
        { kind: 'super-heavy', phase: 'ready', support },
        { locale, touch: false },
      );
      assert.match(
        text(findClass(host, 'rocket-panel')),
        locale === 'en' ? /Titan.*Super-heavy/ : /泰坦.*超大型/,
      );
      const full = text(host.tree);
      assert.doesNotMatch(
        full,
        /A small rocket can launch|小火箭可以在這裡發射/,
      );
      if (support.startsWith('roof'))
        assert.match(
          full,
          locale === 'en'
            ? /weight and exhaust can collapse/
            : /重量與噴流.*垮塌/,
        );
      if (['ground', 'platform'].includes(support)) assert.match(full, /220 m/);
      if (support === 'ocean' || support === 'river')
        assert.match(full, locale === 'en' ? /will sink/ : /沉入/);
      if (support === 'lake')
        assert.match(full, locale === 'en' ? /unstable/ : /不穩/);
      host.render({ ...props, touch: true });
      if (support.startsWith('roof'))
        assert.match(
          text(host.tree),
          locale === 'en' ? /Titan: weight and exhaust/ : /泰坦：重量與噴流/,
        );
      host.unmount();
    }
  }
});

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
  const { host, props } = setup({
    stage: 'separating',
    stageFuel: 0,
    stageTransitionProgress: 0.6,
  });
  const stage = findClass(host, 'rocket-stage-status');
  assert.match(text(stage), /Stage separation/);
  assert.match(text(stage), /Booster released/);
  const transition = all(stage, (node) => node.type === 'progress')[0];
  assert.equal(
    transition.props['aria-label'],
    'Next stage ignition preparation',
  );
  assert.equal(transition.props.value, 0.6);
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

test('Titan shows side-booster fuel, real separation progress, then core and upper-stage fuel in both languages', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, props, calls } = setup(
      { kind: 'super-heavy', stage: 'strap-on', stageFuel: 0.4, fuel: 0.9 },
      { locale, touch: true },
    );
    let stage = findClass(host, 'rocket-stage-status');
    assert.match(
      text(stage),
      locale === 'en'
        ? /Stage 1.*4 boosters \+ core.*40.*ignite together/
        : /第一級.*四側助推器＋核心.*40.*同時點火/,
    );
    assert.equal(all(stage, (n) => n.type === 'progress')[0].props.value, 0.4);
    const before = calls.length;
    for (const [kind, fuel, progress, title, hint] of [
      [
        'strap-separating',
        0,
        0.45,
        locale === 'en' ? /Side boosters separating/ : /側助推器分離中/,
        locale === 'en'
          ? /Boosters released.*core firing/
          : /側助推器已釋放.*核心持續推進/,
      ],
      [
        'boost',
        0.64,
        0,
        locale === 'en' ? /Stage 2.*Core only.*64/ : /第二級.*核心推進.*64/,
        null,
      ],
      [
        'separating',
        0,
        0.75,
        locale === 'en' ? /Core stage separating/ : /核心級分離中/,
        locale === 'en'
          ? /Core released.*upper stage/
          : /核心已釋放.*上面級準備中/,
      ],
      [
        'upper',
        0.82,
        0,
        locale === 'en' ? /Stage 3.*Upper stage.*82/ : /第三級.*上面級.*82/,
        null,
      ],
    ]) {
      host.render({
        ...props,
        snapshot: {
          ...props.snapshot,
          stage: kind,
          stageFuel: fuel,
          stageTransitionProgress: progress,
        },
      });
      stage = findClass(host, 'rocket-stage-status');
      assert.match(text(stage), title);
      if (hint) assert.match(text(stage), hint);
      const bar = all(stage, (n) => n.type === 'progress')[0];
      assert.equal(bar.props.value, hint ? progress : fuel);
      const progressLabel =
        kind === 'strap-separating'
          ? locale === 'en'
            ? 'Side-booster release progress'
            : '側助推器釋放進度'
          : locale === 'en'
            ? 'Next stage ignition preparation'
            : '下一級點火準備';
      assert.equal(
        bar.props['aria-label'],
        hint ? progressLabel : locale === 'en' ? 'Stage fuel' : '本級燃料',
      );
      if (hint)
        assert.doesNotMatch(
          text(stage),
          /%/,
          'separation progress is not presented as a fuel reading',
        );
    }
    assert.equal(
      calls.length,
      before,
      'stage readouts never command or change the flight',
    );
    host.unmount();
  }
});

test('Titan manual camera, guidance and throttle remain available across side-booster separation', () => {
  const { host, props, calls } = setup(
    { kind: 'super-heavy', stage: 'strap-on', auto: false },
    { touch: true },
  );
  for (const stage of [
    'strap-on',
    'strap-separating',
    'boost',
    'separating',
    'upper',
  ]) {
    host.render({ ...props, snapshot: { ...props.snapshot, stage } });
    assert(findClass(host, 'rocket-throttle'));
    const range = all(
      host.tree,
      (n) => n.type === 'input' && n.props.type === 'range',
    )[0];
    range.props.onChange({ target: { value: '72' } });
    assert.deepEqual(calls.at(-1), ['setThrottle', 0.72]);
    button(host, 'Third person').props.onClick();
    assert.deepEqual(calls.at(-1), ['setView', 'first']);
    button(host, 'Manual').props.onClick();
    assert.deepEqual(calls.at(-1), ['setAuto', true]);
    assert(button(host, 'Abort launch'));
  }
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

test('support collapse and freefall show only a small accident sequence before any impact', () => {
  for (const [phase, failureStage] of [
    ['ignition', 'support-collapse'],
    ['falling', 'freefall'],
  ]) {
    for (const touch of [false, true]) {
      const { host, calls } = setup(
        {
          phase,
          failureStage,
          failureAge: 100,
          failureCause: 'impact',
          support: 'roof-small',
          supportIntegrity: 0,
          damaged: 1,
          burning: 2,
          debris: 5,
        },
        { touch, optionsOpen: true },
      );
      assert(findClass(host, 'rocket-accident-observation'));
      assert.match(
        text(host.tree),
        /Foundation collapsing.*Uncontrolled descent.*Impact/,
      );
      assert.equal(all(host.tree, (node) => node.type === 'button').length, 0);
      for (const name of [
        'rocket-panel',
        'rocket-compact-controls',
        'rocket-telemetry',
        'rocket-countdown',
        'rocket-stage-status',
      ])
        assert.equal(
          findClass(host, name),
          undefined,
          `${name} must not cover the accident`,
        );
      assert.deepEqual(
        calls.at(-1),
        ['setInputEnabled', true],
        'Escape and camera input stay enabled',
      );
      host.unmount();
    }
  }
});

test('recovery actions appear at five seconds after impact even with mobile HUD hidden or options open', () => {
  for (const locale of ['en', 'zh-Hant']) {
    for (const extra of [
      { touch: false },
      { touch: true },
      { touch: true, minimal: true, panelVisible: false },
      { touch: true, optionsOpen: true },
    ]) {
      const { host, props, calls } = setup(
        {
          phase: 'crashed',
          failureStage: 'wreckage',
          failureAge: 0,
          failureCause: 'fire',
          warning: 'raw vehicle-destroyed English reason',
          damaged: 1,
          burning: 2,
          debris: 5,
        },
        { ...extra, locale },
      );
      for (const failureAge of [0, 4.999]) {
        host.render({ ...props, snapshot: { ...props.snapshot, failureAge } });
        assert(findClass(host, 'rocket-accident-observation'));
        assert.equal(
          all(host.tree, (node) => node.type === 'button').length,
          0,
        );
        assert.equal(findClass(host, 'rocket-telemetry'), undefined);
        assert.doesNotMatch(text(host.tree), /raw vehicle-destroyed/);
      }
      host.render({ ...props, snapshot: { ...props.snapshot, failureAge: 5 } });
      assert(findClass(host, 'rocket-failure-panel'));
      assert.equal(findClass(host, 'rocket-accident-observation'), undefined);
      assert.equal(findClass(host, 'rocket-compact-controls'), undefined);
      assert.match(
        text(host.tree),
        locale === 'en' ? /Vehicle fire \/ explosion/ : /箭體起火／爆炸/,
      );
      button(
        host,
        locale === 'en' ? 'Rebuild at this site' : '在此重新搭建',
      ).props.onClick();
      assert.deepEqual(calls.at(-1), ['retry']);
      button(
        host,
        locale === 'en' ? 'Back to Vancouver' : '返回溫哥華',
      ).props.onClick();
      assert.deepEqual(calls.at(-1), ['returnToCity']);
      button(
        host,
        locale === 'en' ? 'Restore city' : '修復城市',
      ).props.onClick();
      assert.deepEqual(calls.at(-1), ['resetDamage']);
      button(host, locale === 'en' ? 'New rocket' : '新火箭').props.onClick();
      assert.deepEqual(calls.at(-1), ['choose', 'small']);
      host.unmount();
    }
  }
});

test('a subsequent explosion resets the recovery delay without a wall-clock timeout', () => {
  const { host, props } = setup({
    phase: 'crashed',
    failureStage: 'wreckage',
    failureAge: 5.2,
    failureCause: 'impact',
  });
  assert(findClass(host, 'rocket-failure-panel'));
  host.render({
    ...props,
    snapshot: { ...props.snapshot, failureCause: 'fire', failureAge: 0 },
  });
  assert.equal(findClass(host, 'rocket-failure-panel'), undefined);
  assert.equal(all(host.tree, (node) => node.type === 'button').length, 0);
  host.render({
    ...props,
    snapshot: { ...props.snapshot, failureCause: 'fire', failureAge: 5 },
  });
  assert(findClass(host, 'rocket-failure-panel'));
  host.render({
    ...props,
    snapshot: {
      ...props.snapshot,
      missionId: 8,
      phase: 'falling',
      failureStage: 'freefall',
      failureAge: 0,
    },
  });
  assert.equal(findClass(host, 'rocket-failure-panel'), undefined);
  assert(findClass(host, 'rocket-accident-observation'));
  host.unmount();
});

test('aerodynamic failure is localized while the vehicle is still falling', () => {
  const { host } = setup(
    {
      phase: 'falling',
      failureStage: 'freefall',
      failureCause: 'aerodynamic',
      warning: 'raw high-dynamic-pressure',
    },
    { locale: 'zh-Hant' },
  );
  assert.match(
    text(findClass(host, 'rocket-accident-observation')),
    /氣動失控.*撞擊/,
  );
  assert.doesNotMatch(text(host.tree), /aerodynamic|high-dynamic-pressure/);
  host.unmount();
});

test('an airborne vehicle fire warns about heat while guidance and abort controls remain available', () => {
  for (const locale of ['en', 'zh-Hant']) {
    for (const touch of [false, true]) {
      const { host, calls } = setup(
        { vehicleFire: 0.4, vehicleHeat: 0.72 },
        { locale, touch },
      );
      assert.match(
        text(findClass(host, 'rocket-alert')),
        locale === 'en'
          ? /Rocket on fire.*Vehicle heat 72%/
          : /箭體起火.*箭體溫度 72%/,
      );
      assert.equal(findClass(host, 'rocket-accident-observation'), undefined);
      assert(button(host, locale === 'en' ? 'Autopilot' : '自動駕駛'));
      button(
        host,
        locale === 'en' ? 'Abort launch' : '中止發射',
      ).props.onClick();
      assert.deepEqual(calls.at(-1), ['abort']);
      host.unmount();
    }
  }
});

test('an airborne fire accident shows burning before explosion without inventing a prior fall', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host } = setup(
      {
        phase: 'crashed',
        failureStage: 'wreckage',
        failureCause: 'fire',
        failureAge: 0.4,
      },
      { locale },
    );
    const timeline = text(findClass(host, 'rocket-accident-timeline'));
    assert.match(
      timeline,
      locale === 'en'
        ? /Rocket on fire.*Vehicle fire \/ explosion/
        : /箭體起火.*箭體起火／爆炸/,
    );
    assert.doesNotMatch(timeline, /Uncontrolled descent|失控下墜/);
    assert.equal(all(host.tree, (node) => node.type === 'button').length, 0);
    host.unmount();
  }
});

test('engine aborts and sinking keep their immediate recovery controls without an accident timer', () => {
  for (const phase of ['aborted', 'sinking']) {
    const { host } = setup({ phase, failureStage: 'none', failureAge: 0 });
    assert(findClass(host, 'rocket-panel'));
    assert.equal(findClass(host, 'rocket-accident-observation'), undefined);
    assert(button(host, 'Rebuild at this site'));
    assert(button(host, 'Back to Vancouver'));
    host.unmount();
  }
});

const wallContact = {
  time: 25,
  point: { x: 18, y: 52, z: 4 },
  normal: { x: -1, y: 0, z: 0 },
  source: 'building',
  part: 'strap-on',
  objectHeight: 102,
  normalSpeed: 0.6,
  severity: 0.2,
  fatal: false,
};

test('ordinary surveyed road grade is described as leveled while steep ground gives a placement warning', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, props } = setup(
      {
        phase: 'ready',
        kind: 'super-heavy',
        groundSlopeGrade: 0.08,
        steepSurface: false,
      },
      { locale },
    );
    assert.match(text(findClass(host, 'rocket-surface-condition')), /8\.0%/);
    assert.match(
      text(host.tree),
      locale === 'en' ? /level this ground slope/ : /發射架已調平/,
    );
    host.render({
      ...props,
      snapshot: {
        ...props.snapshot,
        groundSlopeGrade: 0.24,
        steepSurface: true,
      },
    });
    assert.match(
      text(findClass(host, 'rocket-surface-condition')),
      locale === 'en' ? /Steep ground.*lean/ : /坡度過大.*傾斜/,
    );
    assert(button(host, locale === 'en' ? 'Begin countdown' : '開始倒數'));
    host.unmount();
  }
});

test('a real scrape explains the struck rocket part and building without presenting a fatal accident', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, props } = setup(
      {
        kind: 'super-heavy',
        speed: 200,
        integrity: 0.95,
        contactState: 'scraping',
        contactImpact: wallContact,
        contactAge: 0.1,
      },
      { locale, touch: true, minimal: true, panelVisible: false },
    );
    const cue = text(findClass(host, 'rocket-contact-cue'));
    assert.match(
      cue,
      locale === 'en' ? /Side booster.*102 m Building/ : /側助推器.*102 m 建築/,
    );
    assert.match(cue, /0\.6\s+m\/s.*95/);
    assert.doesNotMatch(cue, /200 m\/s|breakup|解體|火災/);
    assert.equal(findClass(host, 'rocket-accident-observation'), undefined);
    host.render({
      ...props,
      snapshot: { ...props.snapshot, contactState: 'none', contactAge: 2.1 },
    });
    assert.equal(
      findClass(host, 'rocket-contact-cue'),
      undefined,
      'cleared contacts expire instead of remaining as an unrelated warning',
    );
    host.unmount();
  }
});

test('a fatal ascending wall strike explains collision then breakup, preserving the five-second observation delay', () => {
  for (const locale of ['en', 'zh-Hant']) {
    const { host, props } = setup(
      {
        phase: 'crashed',
        failureStage: 'wreckage',
        failureCause: 'impact',
        failureAge: 0.4,
        contactState: 'impact',
        contactImpact: { ...wallContact, normalSpeed: 80, fatal: true },
        supportCollapsed: false,
      },
      { locale },
    );
    const timeline = text(findClass(host, 'rocket-accident-timeline'));
    assert.match(
      timeline,
      locale === 'en' ? /Building.*Vehicle breakup/ : /建築.*箭體破裂/,
    );
    assert.doesNotMatch(
      timeline,
      /Uncontrolled descent|失控下墜|Rocket on fire|箭體起火/,
    );
    assert.match(
      text(findClass(host, 'rocket-accident-observation')),
      /102 m.*80\.0\s+m\/s/,
    );
    assert.equal(all(host.tree, (node) => node.type === 'button').length, 0);
    host.render({ ...props, snapshot: { ...props.snapshot, failureAge: 5 } });
    assert(findClass(host, 'rocket-failure-panel'));
    assert.match(
      text(findClass(host, 'rocket-failure-panel')),
      locale === 'en'
        ? /Collision caused the breakup.*Side booster/
        : /碰撞導致箭體解體.*側助推器/,
    );
    host.unmount();
  }
});

test('a past scrape cannot replace the actual fire or foundation cause and ignition fire is already visible in the HUD', () => {
  const { host, props } = setup(
    {
      phase: 'ignition',
      vehicleFire: 0.4,
      vehicleHeat: 0.76,
      contactState: 'none',
      contactImpact: wallContact,
      contactAge: 4,
    },
    { locale: 'zh-Hant' },
  );
  assert.match(text(findClass(host, 'rocket-alert')), /箭體起火.*76%/);
  assert(button(host, '中止發射'));
  host.render({
    ...props,
    snapshot: {
      ...props.snapshot,
      phase: 'crashed',
      failureStage: 'wreckage',
      failureCause: 'fire',
      failureAge: 0,
    },
  });
  assert.match(
    text(findClass(host, 'rocket-accident-timeline')),
    /箭體起火.*箭體起火／爆炸/,
  );
  assert.doesNotMatch(
    text(findClass(host, 'rocket-accident-timeline')),
    /建築/,
  );
  host.render({
    ...props,
    snapshot: {
      ...props.snapshot,
      phase: 'crashed',
      failureStage: 'wreckage',
      failureCause: 'impact',
      failureAge: 0,
      vehicleFire: 0,
      supportCollapsed: true,
      support: 'ground',
      supportIntegrity: 0,
      contactImpact: { ...wallContact, fatal: true },
    },
  });
  assert.match(
    text(findClass(host, 'rocket-accident-timeline')),
    /地基.*垮塌.*失控下墜.*撞擊/,
  );
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
test('the production chooser renders three different vehicle silhouettes and keeps cancel outside its scrolling body', () => {
  const html = renderToStaticMarkup(
    React.createElement(RocketControls, {
      controller: {},
      snapshot: EMPTY_ROCKET,
      choosing: true,
      locale: 'en',
      touch: true,
      onChoose() {},
      onCloseChoosing() {},
    }),
  );
  const icons = [
    ...html.matchAll(
      /<svg\b[^>]*data-rocket-silhouette="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g,
    ),
  ];
  assert.deepEqual(
    icons.map((match) => match[1]),
    ['small', 'large', 'super-heavy'],
  );
  assert.equal(
    new Set(icons.map((match) => match[2])).size,
    3,
    'vehicle shapes differ, not only their SVG size',
  );
  const straps = [...icons[2][2].matchAll(/data-rocket-strap="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    straps,
    ['rear-left', 'rear-right', 'front-left', 'front-right'],
    'Titan silhouette depicts all four external boosters',
  );
  assert.match(html, /4 external boosters/);
  const header = html.match(/<header>([\s\S]*?)<\/header>/)[1];
  assert.match(header, /rocket-chooser-cancel/);
  assert.match(header, /Cancel/);
  assert(html.indexOf('</header>') < html.indexOf('rocket-chooser-body'));
});

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

const panelButton = (host, section) =>
  all(
    host.tree,
    (node) =>
      node.type === 'button' &&
      node.props['aria-controls'] === `rocket-${section}-content`,
  )[0];
const panelContent = (host, section) =>
  all(host.tree, (node) => node.props.id === `rocket-${section}-content`)[0];

test('minimizing rocket controls preserves input, launch and abort while snapshots cannot reopen the panel', () => {
  const { host, props, calls } = setup({ phase: 'ready' });
  const initialCalls = calls.length;
  panelButton(host, 'main').props.onClick();
  host.render();
  assert.equal(panelButton(host, 'main').props['aria-expanded'], false);
  assert.equal(panelContent(host, 'main').props.hidden, true);
  assert.equal(
    calls.length,
    initialCalls,
    'presentation does not command or disable the rocket',
  );
  let actions = findClass(host, 'rocket-minimized-actions');
  all(
    actions,
    (node) => node.type === 'button' && /Launch/.test(text(node)),
  )[0].props.onClick();
  assert.deepEqual(calls.at(-1), ['launch']);
  host.render({
    ...props,
    snapshot: { ...props.snapshot, phase: 'flight', missionId: 8 },
  });
  assert.equal(
    panelContent(host, 'main').props.hidden,
    true,
    'new snapshots and missions retain the user preference',
  );
  actions = findClass(host, 'rocket-minimized-actions');
  all(
    actions,
    (node) => node.type === 'button' && /Abort launch/.test(text(node)),
  )[0].props.onClick();
  assert.deepEqual(calls.at(-1), ['abort']);
  panelButton(host, 'main').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'main').props.hidden, false);
  assert.equal(panelButton(host, 'main').props['aria-expanded'], true);
  assert.equal(calls.filter((call) => call[0] === 'setInputEnabled').length, 1);
  host.unmount();
});

test('chooser and placement can be minimized independently without cancelling a build or losing their restore controls', () => {
  const { host, props, calls } = setup({}, { choosing: true });
  panelButton(host, 'chooser').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'chooser').props.hidden, true);
  assert(panelButton(host, 'chooser'));
  assert(button(host, 'Cancel'), 'cancel remains in the visible header');
  assert.equal(
    calls.some((call) => call[0] === 'choose' || call[0] === 'closeChoosing'),
    false,
  );
  host.render({
    ...props,
    choosing: false,
    snapshot: { ...props.snapshot, placing: true },
  });
  panelButton(host, 'placement').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'placement').props.hidden, true);
  assert.equal(
    calls.some((call) => call[0] === 'cancelPlacement'),
    false,
  );
  panelButton(host, 'placement').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'placement').props.hidden, false);
  host.render(props);
  assert.equal(panelContent(host, 'chooser').props.hidden, true);
  host.unmount();
});

test('minimized space observation keeps a city exit and restores the same selected destination and mission details', () => {
  const { host, props, calls } = setup({
    phase: 'space',
    spaceFocus: 'sun',
    altitude: 100000,
  });
  button(host, 'Mission details').props.onClick();
  host.render();
  panelButton(host, 'space').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'space').props.hidden, true);
  const exit = all(
    findClass(host, 'rocket-minimized-actions'),
    (node) => node.type === 'button',
  )[0];
  exit.props.onClick();
  assert.deepEqual(calls.at(-1), ['returnToCity']);
  host.render({ ...props, snapshot: { ...props.snapshot, altitude: 100200 } });
  assert.equal(panelContent(host, 'space').props.hidden, true);
  panelButton(host, 'space').props.onClick();
  host.render();
  assert.equal(panelContent(host, 'space').props.hidden, false);
  assert(findClass(host, 'rocket-mission-details'));
  assert.equal(
    all(host.tree, (node) => node.props['data-rocket-focus'] === 'sun')[0]
      .props['aria-pressed'],
    true,
  );
  assert.equal(
    calls.some((call) => call[0] === 'setSpaceFocus'),
    false,
  );
  host.unmount();
});

test('telemetry, stage and throttle minimize independently while manual flight continues updating', () => {
  const { host, props, calls } = setup({ auto: false, throttle: 0.4 });
  const initialCalls = calls.length;
  for (const section of ['telemetry', 'stage', 'throttle']) {
    panelButton(host, section).props.onClick();
    host.render();
    assert.equal(panelContent(host, section).props.hidden, true);
  }
  host.render({
    ...props,
    snapshot: {
      ...props.snapshot,
      throttle: 0.8,
      stageFuel: 0.2,
      altitude: 800,
    },
  });
  assert.equal(calls.length, initialCalls);
  for (const section of ['telemetry', 'stage', 'throttle']) {
    assert.equal(panelContent(host, section).props.hidden, true);
    panelButton(host, section).props.onClick();
    host.render();
    assert.equal(panelContent(host, section).props.hidden, false);
  }
  assert.equal(
    all(host.tree, (node) => node.props.id === 'rocket-throttle')[0].props
      .value,
    80,
  );
  host.unmount();
});

test('rocket disclosure labels follow every supported interface language', () => {
  const labels = {
    en: ['Collapse panel', 'Expand panel'],
    fr: ['Réduire le panneau', 'Développer le panneau'],
    es: ['Contraer panel', 'Expandir panel'],
    'zh-Hant': ['收合面板', '展開面板'],
    'zh-Hans': ['收起面板', '展开面板'],
    de: ['Bedienfeld einklappen', 'Bedienfeld ausklappen'],
    ja: ['パネルを折りたたむ', 'パネルを展開'],
    ko: ['패널 접기', '패널 펼치기'],
    uk: ['Згорнути панель', 'Розгорнути панель'],
    ru: ['Свернуть панель', 'Развернуть панель'],
  };
  for (const [locale, [collapse, expand]] of Object.entries(labels)) {
    const { host } = setup({ phase: 'ready' }, { locale });
    assert(panelButton(host, 'main').props['aria-label'].startsWith(collapse));
    panelButton(host, 'main').props.onClick();
    host.render();
    assert(panelButton(host, 'main').props['aria-label'].startsWith(expand));
    host.unmount();
  }
});

test('manual attitude disclosure keeps guidance input enabled and restores the latest live attitude', () => {
  for (const touch of [false, true]) {
    const { host, props, calls } = setup(
      { auto: false, pitch: 12, roll: -9, verticalSpeed: 45 },
      { touch },
    );
    assert(
      findClass(host, 'rocket-attitude').props.className.includes('ui-chrome'),
    );
    assert.deepEqual(calls.at(-1), ['setInputEnabled', true]);
    const initialCalls = calls.length;
    panelButton(host, 'attitude').props.onClick();
    host.render();
    assert.equal(panelContent(host, 'attitude').props.hidden, true);
    assert.equal(panelButton(host, 'attitude').props['aria-expanded'], false);
    host.render({
      ...props,
      snapshot: { ...props.snapshot, pitch: 24, roll: -18, verticalSpeed: 80 },
    });
    assert.equal(panelContent(host, 'attitude').props.hidden, true);
    assert.equal(
      calls.length,
      initialCalls,
      'presentation never changes axes, autopilot or input ownership',
    );
    panelButton(host, 'attitude').props.onClick();
    host.render();
    assert.equal(panelContent(host, 'attitude').props.hidden, false);
    assert.equal(panelButton(host, 'attitude').props['aria-expanded'], true);
    assert.match(
      text(findClass(host, 'rocket-attitude-values')),
      /\+24\s*°.*-18\s*°.*\+80\s+m\/s/,
    );
    assert.equal(calls.length, initialCalls);
    host.unmount();
  }
});
