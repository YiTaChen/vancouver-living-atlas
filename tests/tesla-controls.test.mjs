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
    .outputText.replace(/import ['"][^'"]+\.css['"];?/g, '')
    .replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
      const url =
        id === './travel-joystick' || id === './panel-toggle'
          ? componentModule(id.slice(2))
          : id === '@/lib/city/touch-input'
            ? cityModule('touch-input')
            : id === '@/lib/i18n/tesla.json'
              ? dataModule(`export default ${JSON.stringify(catalogs)};`)
              : id === '@/lib/i18n/panels.json'
                ? dataModule(
                    `export default ${readFileSync(new URL('../lib/i18n/panels.json', import.meta.url), 'utf8')};`,
                  )
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
const driftButton = (html) => {
  const match = html.match(
    /<button\b[^>]*data-tesla-hold="drift"[^>]*>[\s\S]*?<\/button>/,
  );
  assert(match, 'a visible drift hold button');
  return match[0];
};

test('drift is translated, ground-only and separate from the existing recovery, brake and stunt shortcuts', () => {
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const touch of [false, true]) {
      const html = render({}, { locale, touch }),
        drift = driftButton(html);
      assert.match(drift, /aria-keyshortcuts="X"/);
      assert.match(drift, /aria-pressed="false"/);
      assert(!drift.includes('disabled=""'));
      assert(text(drift).includes(catalog.drift));
      assert(
        text(drift.match(/title="([^"]+)"/)[1]).includes(catalog.driftHint),
      );
      assert.match(
        button(
          touch ? render({}, { locale, touch, optionsOpen: true }) : html,
          'recover',
        ),
        /<kbd>R<\/kbd>/,
      );
      assert.match(button(html, 'vortex'), /aria-keyshortcuts="V"/);
      const active = render(
        { drifting: true, driftIntensity: 0.5 },
        { locale, touch },
      );
      assert.match(driftButton(active), /aria-pressed="true"/);
      assert(text(active).includes(catalog.drifting));
      for (const patch of [
        { mode: 'air' },
        { mode: 'wall' },
        { onRoof: true },
        { parked: true },
        { transitioning: true },
        { vortexActive: true },
      ])
        assert.match(
          driftButton(render(patch, { locale, touch })),
          /disabled=""/,
        );
    }
  assert.match(
    driftButton(render({}, { controlsEnabled: false })),
    /disabled=""/,
  );
});

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
          assert.equal((cluster[1].match(/<button\b/g) ?? []).length, 10);
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

test('Vortex Jump stays beside the touch drift action and exposes its real availability, progress and keyboard shortcut in every locale', () => {
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const touch of [false, true]) {
      const html = render({ vortexAvailable: true }, { locale, touch }),
        vortex = button(html, 'vortex');
      assert.match(vortex, /aria-keyshortcuts="V"/);
      assert(!vortex.includes('disabled=""'));
      assert(text(vortex).includes(catalog.vortex));
      assert(!vortex.includes('aria-busy="true"'));
      const unavailable = button(render({}, { locale, touch }), 'vortex');
      assert.match(unavailable, /disabled=""/);
      const active = render(
        { vortexAvailable: false, vortexActive: true, vortexProgress: 0.5 },
        { locale, touch },
      );
      assert.match(button(active, 'vortex'), /disabled=""/);
      assert.match(button(active, 'vortex'), /aria-busy="true"/);
      assert(text(active).includes(catalog.vortexActive));
      assert(text(button(active, 'vortex')).includes('50%'));
      if (touch) {
        const cluster = html.match(
          /<div class="touch-drive-controls tesla-touch-controls ui-chrome"[^>]*>([\s\S]*?)<\/div>/,
        )[1];
        assert(
          cluster.lastIndexOf('data-tesla-action="vortex"') >
            cluster.indexOf('data-tesla-action="camera"'),
        );
      }
    }
  const disabled = button(
    render({ vortexAvailable: true }, { controlsEnabled: false }),
    'vortex',
  );
  assert.match(disabled, /disabled=""/);
});

test('roof driving and automatic roof hold stay distinct from the road, wall and manual park status', () => {
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const touch of [false, true]) {
      const roof = render({ mode: 'ground', onRoof: true }, { locale, touch });
      assert(text(roof).includes(catalog.roof));
      const held = render(
        { mode: 'ground', onRoof: true, surfaceHolding: true, parked: false },
        { locale, touch },
      );
      assert(text(held).includes(catalog.roofHolding));
      assert.match(button(held, 'park'), /aria-pressed="false"/);
      const manual = render(
        { mode: 'ground', onRoof: true, surfaceHolding: true, parked: true },
        { locale, touch },
      );
      assert(text(manual).includes(catalog.parked));
      assert(!text(manual).includes(catalog.roofHolding));
      assert.match(button(manual, 'park'), /aria-pressed="true"/);
      const road = render({ mode: 'ground' }, { locale, touch });
      assert(!text(road).includes(catalog.roofHolding));
    }
});

test('all four quality choices and both camera views remain available beside the stunt control', () => {
  for (const touch of [false, true])
    for (const quality of ['auto', 'low', 'medium', 'high']) {
      const html = render(
        { quality, vortexAvailable: true },
        { touch, optionsOpen: touch },
      );
      assert.equal((html.match(/<option\b/g) ?? []).length, 4);
      for (const value of ['auto', 'low', 'medium', 'high'])
        assert(html.includes(`value="${value}"`));
      assert.match(html, new RegExp(`<option value="${quality}" selected=""`));
      assert(text(button(html, 'camera')).includes(catalogs.en.cockpit));
      assert(
        text(button(render({ view: 'cockpit' }), 'camera')).includes(
          catalogs.en.chase,
        ),
      );
    }
});
