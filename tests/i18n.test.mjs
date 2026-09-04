import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const locales = ['en', 'fr', 'es', 'zh-Hant', 'zh-Hans'];
const catalogs = Object.fromEntries(
  locales.map((id) => [
    id,
    JSON.parse(
      readFileSync(new URL(`../lib/i18n/${id}.json`, import.meta.url), 'utf8'),
    ),
  ]),
);
const placeholders = (value) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
let source = readFileSync(
  new URL('../lib/i18n/index.ts', import.meta.url),
  'utf8',
);
source = source.replace(
  /import (\w+) from '\.\/(.+)\.json';/g,
  (_, binding, locale) =>
    `const ${binding} = ${JSON.stringify(catalogs[locale])};`,
);
const module = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const i18n = await import(
  `data:text/javascript;base64,${Buffer.from(module).toString('base64')}`
);

test('all five languages cover every visible message and preserve substitutions', () => {
  const keys = Object.keys(catalogs.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof catalogs[locale][key], 'string', `${locale}/${key}`);
      assert(catalogs[locale][key].trim(), `${locale}/${key} is empty`);
      assert.deepEqual(
        placeholders(catalogs[locale][key]),
        placeholders(catalogs.en[key]),
        `${locale}/${key}`,
      );
    }
  }
});

test('first visits and invalid saved preferences use English, valid choices persist', () => {
  assert.equal(i18n.DEFAULT_LOCALE, 'en');
  for (const value of [null, undefined, '', 'de', 'zh', 42])
    assert.equal(i18n.resolveLocale(value), 'en');
  for (const locale of locales)
    assert.equal(i18n.resolveLocale(locale), locale);
});

test('localized map labels and numeric messages resolve without placeholders', () => {
  for (const locale of locales) {
    assert(
      i18n
        .translate(locale, 'buildingCount', { count: '7,806' })
        .includes('7,806'),
    );
    assert(
      !i18n.translate(locale, 'elevation', { height: 0 }).includes('{height}'),
    );
    for (const id of [
      'overview',
      'downtown',
      'stanley',
      'science',
      'canada',
      'english',
      'falsecreek',
      'lions',
    ]) {
      for (const field of ['name', 'tag', 'description'])
        assert(i18n.viewText(locale, id, field).length > 0);
      const name = i18n.viewText(locale, id, 'name');
      assert(i18n.translate(locale, 'goToPlace', { name }).includes(name));
    }
  }
});

test('both requested Chinese scripts remain distinct', () => {
  assert.equal(catalogs['zh-Hant'].language, '語言');
  assert.equal(catalogs['zh-Hans'].language, '语言');
  assert.notEqual(
    catalogs['zh-Hant'].loadingDetails,
    catalogs['zh-Hans'].loadingDetails,
  );
});
