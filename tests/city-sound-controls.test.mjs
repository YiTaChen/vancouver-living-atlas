import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const messages = JSON.parse(
  readFileSync(new URL('../lib/i18n/soundscape.json', import.meta.url), 'utf8'),
);
const jsonModule =
  'data:text/javascript;base64,' +
  Buffer.from(`export default ${JSON.stringify(messages)};`).toString('base64');
const source = readFileSync(
  new URL('../components/city-sound-controls.tsx', import.meta.url),
  'utf8',
);
const code = ts
  .transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(/import ['"]\.\/city-sound-controls\.css['"];?/, '')
  .replace(
    /from ['"]([^'"]+)['"]/g,
    (_, id) =>
      `from '${id.endsWith('soundscape.json') ? jsonModule : import.meta.resolve(id)}'`,
  );
const { CitySoundControls, citySoundText } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const render = (soundscape, locale = 'en') =>
  renderToStaticMarkup(
    React.createElement(CitySoundControls, { soundscape, locale }),
  );

test('all ten locales render a named off switch and volume without trying to allocate or enable audio', () => {
  let enables = 0;
  const soundscape = {
    snapshot: { requested: false, volume: 0.65, error: null },
    setEnabled() {
      enables++;
    },
  };
  assert.equal(Object.keys(messages).length, 10);
  for (const locale of Object.keys(messages)) {
    const html = render(soundscape, locale);
    assert(html.includes(citySoundText(locale, 'title')), locale);
    assert(html.includes(citySoundText(locale, 'volume')), locale);
    assert.match(html, /type="checkbox" role="switch" aria-checked="false"/);
    assert.doesNotMatch(html, /checked=""/);
    assert.match(html, /type="range" min="0" max="100" step="1" value="65"/);
    assert.match(html, /class="city-sound-status" aria-live="polite"/);
  }
  assert.equal(enables, 0);
});

test('unready engine has disabled controls, and a failed prior gesture gives a localized retry status', () => {
  assert.equal((render(null).match(/disabled=""/g) ?? []).length, 2);
  const soundscape = {
    snapshot: { requested: false, volume: 0.4, error: 'unavailable' },
  };
  assert(
    render(soundscape, 'zh-Hant').includes(messages['zh-Hant'].unavailable),
  );
});
