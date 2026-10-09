import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
function parse(path) {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, root), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
function collect(source, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
const page = parse('app/page.tsx');
const group = collect(page, (node) => {
  if (
    !ts.isJsxOpeningElement(node) ||
    node.tagName.getText(page) !== 'RadioGroup'
  )
    return false;
  return node.attributes.properties.some(
    (p) =>
      ts.isJsxAttribute(p) &&
      p.name.getText(page) === 'aria-label' &&
      p.initializer?.getText(page) === "{tr('quality')}",
  );
})[0];
assert.ok(group, 'public quality control exists');
function expression(attribute) {
  const item = group.attributes.properties.find(
    (p) => ts.isJsxAttribute(p) && p.name.getText(page) === attribute,
  );
  assert.ok(item?.initializer && ts.isJsxExpression(item.initializer));
  return item.initializer.expression;
}
function evaluate(node, scope = {}) {
  const code = ts.transpileModule(`(${node.getText(page)})`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return vm.runInNewContext(code, scope);
}

test('quality control keeps Automatic selected through effective tier changes and treats legacy settings as manual', () => {
  const value = expression('value');
  for (const quality of ['balanced', 'high', 'ultra']) {
    assert.equal(
      evaluate(value, { settings: { qualityMode: 'auto', quality } }),
      'auto',
    );
    assert.equal(
      evaluate(value, { settings: { qualityMode: 'manual', quality } }),
      quality,
    );
    assert.equal(evaluate(value, { settings: { quality } }), quality);
  }
  const options = collect(
    group.parent,
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(page) === 'RadioGroupItem',
  ).map(
    (node) =>
      node.attributes.properties.find(
        (p) => ts.isJsxAttribute(p) && p.name.getText(page) === 'value',
      )?.initializer?.text,
  );
  assert.deepEqual(options, ['auto', 'ultra', 'high', 'balanced']);
});

test('quality choices explicitly exit Auto for every manual tier and can restore Auto without overwriting its tier', () => {
  let settings = { quality: 'high', qualityMode: 'auto', mode: 'drive' };
  const choose = evaluate(expression('onValueChange'), {
    change: (patch) => {
      settings = { ...settings, ...patch };
    },
  });
  for (const quality of ['ultra', 'balanced', 'high']) {
    choose(quality);
    assert.equal(settings.qualityMode, 'manual');
    assert.equal(settings.quality, quality);
    assert.equal(settings.mode, 'drive');
    choose('auto');
    assert.equal(settings.qualityMode, 'auto');
    assert.equal(settings.quality, quality);
  }
  const prior = { ...settings };
  for (const invalid of [null, undefined, '', 'low', 'AUTO', 42])
    choose(invalid);
  assert.deepEqual(settings, prior);
});

test('current quality label follows effective engine detail rather than the requested setting', () => {
  const currentLabel = collect(
    page,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(page) === 'tr' &&
      node.arguments[0]?.getText(page).includes('stats.effectiveQuality'),
  )[0];
  assert.ok(currentLabel);
  const labels = {
    balanced: 'balancedQuality',
    high: 'highQuality',
    ultra: 'ultraQuality',
  };
  for (const [effectiveQuality, label] of Object.entries(labels))
    assert.equal(
      evaluate(currentLabel, {
        tr: (key) => key,
        stats: { effectiveQuality },
        settings: { qualityMode: 'auto', quality: 'ultra' },
      }),
      label,
    );
  assert.equal(
    evaluate(currentLabel, {
      tr: (key) => key,
      stats: {},
      settings: { quality: 'high' },
    }),
    'highQuality',
  );
});

test('explicit visual QA quality overrides take authority from a previously automatic setting', () => {
  const files = [
    'visual-qa',
    'upgrade-qa',
    'offline-asset-validation-qa',
    'blender-delivery-qa',
    'architecture-module-candidate-qa',
    'offline-material-study-qa',
  ];
  let checked = 0;
  for (const file of files) {
    const source = parse(`lib/city/${file}.ts`);
    const calls = collect(
      source,
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'applySettings',
    );
    for (const call of calls) {
      const argument = call.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) continue;
      const properties = argument.properties;
      if (!properties.some((p) => p.name?.getText(source) === 'quality'))
        continue;
      const mode = properties.find(
        (p) => p.name?.getText(source) === 'qualityMode',
      );
      // Purpose-built Auto QA may explicitly opt into adaptation. Fixed tier
      // comparisons must override a spread Auto preference with manual mode.
      if (
        mode &&
        ts.isPropertyAssignment(mode) &&
        mode.initializer.getText(source) === "'auto'"
      )
        continue;
      assert.ok(
        mode && ts.isPropertyAssignment(mode),
        `${file}: explicit quality needs explicit mode`,
      );
      assert.equal(mode.initializer.getText(source), "'manual'", file);
      const lastSpread = properties.findLastIndex((p) =>
        ts.isSpreadAssignment(p),
      );
      assert.ok(
        properties.indexOf(mode) > lastSpread,
        `${file}: spread must not overwrite manual mode`,
      );
      checked++;
    }
  }
  assert.ok(
    checked >= 9,
    'all existing fixed-tier QA entry points are checked',
  );
});
