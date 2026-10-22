import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const messages = JSON.parse(
  fs.readFileSync(
    new URL('../lib/i18n/interactions.json', import.meta.url),
    'utf8',
  ),
);
const source = fs.readFileSync(
  new URL('../components/proximity-interaction-prompt.tsx', import.meta.url),
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
const jsx = (type, props) => ({ type, props: props ?? {} });
const cjs = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${code}\n})`)(
  (id) => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === '@/lib/i18n/interactions.json') return messages;
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected import ${id}`);
  },
  cjs,
  cjs.exports,
);
const { ProximityInteractionPrompt, interactionActionText } = cjs.exports;
const props = (patch = {}) => ({
  snapshot: {
    id: 'bench:1',
    kind: 'seat',
    action: 'sit',
    anchor: [1, 0.9, 2],
    distance: 1,
  },
  screen: { x: 0.5, y: 0.6 },
  locale: 'zh-Hant',
  touch: false,
  enabled: true,
  onInteract() {},
  ...patch,
});
const descendants = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(descendants)
      : [tree, ...descendants(tree.props?.children)];
const text = (tree) =>
  Array.isArray(tree)
    ? tree.map(text).join('')
    : typeof tree === 'string'
      ? tree
      : tree && typeof tree === 'object'
        ? text(tree.props?.children)
        : '';
const button = (tree) =>
  descendants(tree).find((node) => node.type === 'button');

test('actual localized prompt shows Sit/F then Stand/F and delegates one shared click intent', () => {
  let actions = 0,
    stopped = 0;
  const options = props({ onInteract: () => actions++ });
  const tree = ProximityInteractionPrompt(options),
    b = button(tree);
  assert.equal(tree.props['data-interaction-id'], 'bench:1');
  assert.equal(b.props['aria-label'], '坐下（F）');
  assert.equal(b.props['aria-keyshortcuts'], 'F');
  assert.equal(text(b), '坐下F');
  b.props.onPointerDown({
    stopPropagation() {
      stopped++;
    },
  });
  assert.equal(actions, 0, 'pointer down does not run a premature action');
  b.props.onClick({
    stopPropagation() {
      stopped++;
    },
  });
  assert.equal(actions, 1);
  assert.equal(stopped, 2, 'interaction input does not become a scene drag');
  const standing = button(
    ProximityInteractionPrompt({
      ...options,
      snapshot: { ...options.snapshot, action: 'stand' },
    }),
  );
  assert.equal(standing.props['aria-label'], '起身（F）');
});

test('touch affordance uses a localized tap button and hidden/offscreen/disabled prompts are not actionable', () => {
  const mobile = button(ProximityInteractionPrompt(props({ touch: true })));
  assert.equal(mobile.props['aria-label'], '坐下');
  assert.equal(mobile.props['aria-keyshortcuts'], undefined);
  assert.equal(text(mobile), '坐下');
  for (const patch of [
    { enabled: false },
    { snapshot: null },
    { screen: null },
    { screen: { x: NaN, y: 0.5 } },
    { screen: { x: 1.1, y: 0.5 } },
    { screen: { x: 0.5, y: -0.1 } },
  ])
    assert.equal(ProximityInteractionPrompt(props(patch)), null);
  const css = fs.readFileSync(
    new URL('../components/proximity-interaction-prompt.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test('all ten locales cover sitting, standing and generic future interaction actions', () => {
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
  assert.deepEqual(Object.keys(messages).sort(), expected);
  for (const locale of expected) {
    assert.deepEqual(
      Object.keys(messages[locale]).sort(),
      Object.keys(messages.en).sort(),
    );
    for (const action of ['sit', 'stand', 'use', 'talk', 'inspect']) {
      assert(messages[locale][action].length > 0);
      assert.equal(
        interactionActionText(locale, action),
        messages[locale][action],
      );
      assert.equal(
        button(ProximityInteractionPrompt(props({ locale }))).props[
          'aria-label'
        ],
        messages[locale].shortcut.replace('{action}', messages[locale].sit),
      );
    }
    assert.equal(
      interactionActionText(locale, 'future-door-action'),
      messages[locale].use,
    );
  }
});
