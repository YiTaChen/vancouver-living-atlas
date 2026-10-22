import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(
  new URL('../components/vehicle-condition-panel.tsx', import.meta.url),
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
  .outputText.replace(/import ['"]\.\/vehicle-condition-panel\.css['"];?/, '')
  .replace(
    /from ['"]([^'"]+)['"]/g,
    (_, id) => `from '${import.meta.resolve(id)}'`,
  );
const { VehicleConditionPanel, readVehiclePanelState, vehicleConditionText } =
  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
const zones = (front = 0) => ({ front, rear: 0, left: 0, right: 0, roof: 0 });
const condition = (front = 0) => ({
  damage: { overall: front, zones: zones(front), scratches: zones(0) },
  performance: {
    acceleration: 1 - front * 0.45,
    steering: 1 - front * 0.2,
    braking: 1 - front * 0.15,
  },
});
const city = (patch = {}) => ({
  settings: { mode: 'drive' },
  navigation: { condition: condition(0.42), speed: 0 },
  tesla: { active: true, condition: condition(0.71), speedMps: 0 },
  impactFeedback: { stats: () => ({ audioEnabled: false }) },
  ...patch,
});
const render = (engine = city(), locale = 'en', visible = true) =>
  renderToStaticMarkup(
    React.createElement(VehicleConditionPanel, {
      city: engine,
      locale,
      visible,
    }),
  );

test('active-vehicle snapshots keep independent Tesla and ordinary Drive damage/speed separate', () => {
  const engine = city();
  assert.equal(readVehiclePanelState(engine).damage, 42);
  engine.settings.mode = 'tesla';
  assert.equal(readVehiclePanelState(engine).damage, 71);
  engine.tesla.active = false;
  assert.equal(readVehiclePanelState(engine), null);
  engine.settings.mode = 'walk';
  assert.equal(readVehiclePanelState(engine), null);
  assert.equal(readVehiclePanelState(null), null);
});

test('repair availability uses finite absolute speed with a0.5m/s cutoff, including reverse and Tesla flight', () => {
  const engine = city();
  for (const speed of [0, 0.5, -0.5]) {
    engine.navigation.speed = speed;
    assert.equal(readVehiclePanelState(engine).stopped, true);
  }
  for (const speed of [0.50001, -0.50001, Infinity, NaN]) {
    engine.navigation.speed = speed;
    assert.equal(readVehiclePanelState(engine).stopped, false);
  }
  engine.settings.mode = 'tesla';
  engine.tesla.speedMps = 7;
  assert.equal(readVehiclePanelState(engine).stopped, false);
  assert.match(render(engine), /data-vehicle-repair="true"[^>]*disabled/);
});

test('all10locales include five struck-body zones and a named muted audio gesture control', () => {
  for (const locale of [
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
  ]) {
    const html = render(city(), locale);
    assert.equal((html.match(/<meter/g) ?? []).length, 5, locale);
    for (const zone of ['front', 'rear', 'left', 'right', 'roof'])
      assert.ok(
        html.includes(vehicleConditionText(locale, zone)),
        `${locale}:${zone}`,
      );
    assert.match(html, /data-impact-audio="true" aria-pressed="false"/);
    assert.ok(html.includes(vehicleConditionText(locale, 'soundOff')));
    assert.ok(html.includes(vehicleConditionText(locale, 'repair')));
    assert.match(html, /<output[^>]*aria-live="polite" aria-atomic="true"/);
    assert.doesNotMatch(html, /\bopen=""/);
  }
});

test('clean/hidden/inactive views emit no condition HUD and pristine cars cannot repair unnecessarily', () => {
  assert.equal(render(city(), 'en', false), '');
  assert.equal(render(null), '');
  assert.equal(render(city({ settings: { mode: 'orbit' } })), '');
  const pristine = city();
  pristine.navigation.condition = condition(0);
  const html = render(pristine);
  assert.match(html, /No damage/);
  assert.match(html, /data-vehicle-repair="true"[^>]*disabled/);
  pristine.navigation.condition.damage.scratches.left = 0.2;
  assert.equal(readVehiclePanelState(pristine).damaged, true);
  assert.doesNotMatch(
    render(pristine),
    /data-vehicle-repair="true"[^>]*disabled/,
  );
});

test('no audio is allocated or enabled by rendering or polling; audio follows actual feedback state', () => {
  let enabled = false;
  const engine = city({
    impactFeedback: {
      stats: () => ({ audioEnabled: enabled }),
      setAudioEnabled: () => {
        throw new Error('unexpected audio allocation');
      },
    },
  });
  assert.equal(readVehiclePanelState(engine).audio, false);
  render(engine);
  enabled = true;
  assert.equal(readVehiclePanelState(engine).audio, true);
  assert.match(render(engine), /data-impact-audio="true" aria-pressed="true"/);
});
