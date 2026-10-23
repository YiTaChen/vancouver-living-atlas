import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const messages = JSON.parse(
  readFileSync(new URL('../lib/i18n/panels.json', import.meta.url), 'utf8'),
);
const source = readFileSync(
  new URL('../components/panel-toggle.tsx', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const cjs = { exports: {} };
const require = (id) => {
  if (id === 'react/jsx-runtime') return jsx;
  if (id === 'lucide-react')
    return new Proxy(
      {},
      { get: () => () => React.createElement('svg', { 'aria-hidden': true }) },
    );
  if (id === '@/lib/i18n/panels.json') return { default: messages };
  if (id.endsWith('.css')) return {};
  throw new Error(`Unexpected panel import ${id}`);
};
vm.runInNewContext(`(function(require,module,exports){${code}\n})`)(
  require,
  cjs,
  cjs.exports,
);
const { PanelToggle, panelText } = cjs.exports;

test('all ten locales expose named and reversible disclosure controls', () => {
  assert.equal(Object.keys(messages).length, 10);
  for (const [locale, labels] of Object.entries(messages)) {
    assert.deepEqual(
      Object.keys(labels).sort(),
      Object.keys(messages.en).sort(),
    );
    for (const value of Object.values(labels)) assert.ok(value.trim());
    assert.notEqual(
      panelText(locale, 'showInterface'),
      panelText(locale, 'hideInterface'),
    );
    for (const expanded of [false, true]) {
      const props = { locale, title: labels.map, expanded, onToggle() {} };
      const tree = PanelToggle(props);
      const html = renderToStaticMarkup(tree);
      assert.equal(
        tree.props['aria-label'],
        `${labels[expanded ? 'collapse' : 'expand']} ${labels.map}`,
      );
      assert.equal(tree.props['aria-expanded'], expanded);
      assert.match(html, new RegExp(`aria-expanded="${expanded}"`));
      assert.equal(
        tree.props.type,
        'button',
        'disclosure cannot submit a surrounding form',
      );
    }
  }
});

test('pointer disclosure keeps the canvas focus and never starts a scene drag', () => {
  let toggles = 0;
  const tree = PanelToggle({
    locale: 'en',
    title: 'Map',
    expanded: true,
    onToggle: () => toggles++,
  });
  for (const pointerType of ['mouse', 'touch']) {
    let stopped = false,
      prevented = false;
    tree.props.onPointerDown({
      pointerType,
      stopPropagation() {
        stopped = true;
      },
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(stopped, true);
    assert.equal(
      prevented,
      pointerType === 'mouse',
      'touch retains its native click while mouse retains game focus',
    );
  }
  tree.props.onClick({ stopPropagation() {} });
  assert.equal(toggles, 1);
});

test('Space and Enter disclosure cannot leak into vehicle commands', () => {
  const tree = PanelToggle({
    locale: 'en',
    title: 'Tools',
    expanded: false,
    onToggle() {},
  });
  for (const key of [' ', 'Enter', 'w']) {
    let stopped = false;
    tree.props.onKeyDown({
      key,
      stopPropagation() {
        stopped = true;
      },
    });
    assert.equal(stopped, key !== 'w');
  }
});
