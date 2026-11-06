import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
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
const cjs = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${code}\n})`)(
  (id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsx;
    if (id === 'react-dom') return { createPortal() {} };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected import ${id}`);
  },
  cjs,
  cjs.exports,
);
const { chooseOverflowPosition } = cjs.exports;
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const intersects = (x, y, box) =>
  x < box.right && x + 44 > box.left && y < box.bottom && y + 44 > box.top;

test('overflow entrance avoids actual buttons even when both edges contain panels', () => {
  const frame = rect(8, 8, 312, 560);
  const controls = [rect(268, 8, 312, 210), rect(8, 450, 52, 560)];
  const chosen = chooseOverflowPosition(frame, [
    { box: rect(8, 8, 312, 560), interactive: false },
    ...controls.map((box) => ({ box, interactive: true })),
  ]);
  assert.ok(controls.every((box) => !intersects(chosen.x, chosen.y, box)));
  assert.ok(chosen.x >= frame.left && chosen.x + 44 <= frame.right);
  assert.ok(chosen.y >= frame.top && chosen.y + 44 <= frame.bottom);
});

test('overflow stays in safe bounds when every edge is occupied', () => {
  const frame = rect(32, 8, 536, 312);
  const chosen = chooseOverflowPosition(frame, [
    { box: rect(0, 0, 600, 320), interactive: true },
  ]);
  assert.ok(chosen.score > 0);
  assert.ok(chosen.x >= frame.left && chosen.x + 44 <= frame.right);
  assert.ok(chosen.y >= frame.top && chosen.y + 44 <= frame.bottom);
});
