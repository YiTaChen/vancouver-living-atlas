import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const catalogs = JSON.parse(
  readFileSync(new URL('../lib/i18n/tesla.json', import.meta.url), 'utf8'),
);
const dataModule = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const modules = new Map();
function componentModule(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(
    new URL(`../components/${name}.tsx`, import.meta.url),
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
    .outputText.replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
      const url =
        id === './travel-joystick'
          ? componentModule('travel-joystick')
          : id === '@/lib/city/touch-input'
            ? cityModule('touch-input')
            : id === '@/lib/i18n/tesla.json'
              ? dataModule(`export default ${JSON.stringify(catalogs)};`)
              : import.meta.resolve(id);
      return `from '${url}'`;
    });
  const url = dataModule(code);
  modules.set(name, url);
  return url;
}
const { TeslaControls } = await import(componentModule('tesla-controls'));
const { EMPTY_TESLA } = await import(cityModule('tesla-snapshot'));
const controller = {
  setAxes() {},
  setButton() {},
  setInputEnabled() {},
  command() {},
  pulse() {},
  setQuality() {},
  toggleView() {},
  recover() {},
};
const render = (patch = {}, props = {}) =>
  renderToStaticMarkup(
    React.createElement(TeslaControls, {
      controller,
      state: { ...EMPTY_TESLA, active: true, wallHolding: false, ...patch },
      locale: 'en',
      touch: false,
      controlsEnabled: true,
      panelVisible: true,
      optionsOpen: false,
      onCloseOptions() {},
      ...props,
    }),
  );
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'");
const button = (html, action) => {
  const match = html.match(
    new RegExp(
      `<button\\b[^>]*data-tesla-action="${action}"[^>]*>[\\s\\S]*?<\\/button>`,
    ),
  );
  assert(match, `visible ${action} button`);
  return match[0];
};

test('desktop and touch expose the current driving mode and a stable accessible two-mode toggle in all ten locales', () => {
  assert.match(button(render(), 'grip'), /aria-pressed="true"/);
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const touch of [false, true])
      for (const adhesion of [true, false]) {
        const html = render({ adhesion }, { touch, locale }),
          grip = button(html, 'grip'),
          current = adhesion ? catalog.adhesion : catalog.freeDrive;
        assert.match(grip, new RegExp(`aria-pressed="${adhesion}"`));
        assert.match(grip, /aria-keyshortcuts="E"/);
        assert.match(
          grip,
          new RegExp(
            `data-tesla-driving-mode="${adhesion ? 'wall-grip' : 'free-drive'}"`,
          ),
        );
        assert(
          text(grip).includes(current),
          `${locale} displays its current mode`,
        );
        const accessible = text(grip.match(/aria-label="([^"]+)"/)[1]);
        assert(accessible.includes(catalog.adhesion));
        assert(accessible.includes(catalog.freeDrive));
        const park = button(html, 'park');
        assert(text(park).includes(catalog.park));
        assert.match(park, /aria-pressed="false"/);
        if (touch) {
          const cluster = html.match(
            /<div class="touch-drive-controls tesla-touch-controls ui-chrome"[^>]*>([\s\S]*?)<\/div>/,
          );
          assert(cluster);
          assert.equal((cluster[1].match(/<button\b/g) ?? []).length, 8);
        }
      }
});

test('the visible mode toggle changes wall permission without requesting manual parking', () => {
  const source = ts.createSourceFile(
    'tesla-controls.tsx',
    readFileSync(
      new URL('../components/tesla-controls.tsx', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let click;
  const visit = (node) => {
    if (
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(source) === 'button'
    ) {
      const attributes = node.attributes.properties;
      if (
        attributes.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === 'data-tesla-action' &&
            attribute.initializer?.text === 'grip',
        )
      ) {
        click = attributes.find(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === 'onClick',
        )?.initializer?.expression;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(click);
  const commands = [],
    code = ts.transpileModule(`(${click.getText(source)})()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
  vm.runInNewContext(code, {
    controller: { command: (command) => commands.push(command) },
  });
  assert.deepEqual(commands, ['adhesionToggle']);
});

test('automatic wall hold has a distinct status and never marks manual parking as pressed', () => {
  for (const touch of [false, true]) {
    const automatic = render(
      { mode: 'wall', wallHolding: true, parked: false },
      { touch },
    );
    assert(text(automatic).includes(catalogs.en.wallHolding));
    assert.match(button(automatic, 'park'), /aria-pressed="false"/);
    const manual = render(
      { mode: 'wall', wallHolding: true, parked: true },
      { touch },
    );
    assert(text(manual).includes(catalogs.en.parked));
    assert(!text(manual).includes(catalogs.en.wallHolding));
    assert.match(button(manual, 'park'), /aria-pressed="true"/);
    const ground = render({ mode: 'ground', wallHolding: true }, { touch });
    assert(!text(ground).includes(catalogs.en.wallHolding));
  }
});

test('inactive vehicles and modal-disabled touch controls expose no driving buttons', () => {
  assert.equal(render({ active: false }), '');
  assert.equal(
    render({}, { touch: true, controlsEnabled: false, panelVisible: false }),
    '',
  );
});
