import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const locales = [
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
];
const catalogs = Object.fromEntries(
  locales.map((id) => [
    id,
    JSON.parse(
      readFileSync(new URL(`../lib/i18n/${id}.json`, import.meta.url), 'utf8'),
    ),
  ]),
);
const placeholders = (value) =>
  [...value.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const teslaCatalogs = JSON.parse(
  readFileSync(new URL('../lib/i18n/tesla.json', import.meta.url), 'utf8'),
);

test('Tesla controls cover all ten locales with complete quality and portable keyboard help', () => {
  assert.deepEqual(Object.keys(teslaCatalogs).sort(), [...locales].sort());
  const keys = Object.keys(teslaCatalogs.en).sort();
  for (const locale of locales) {
    const catalog = teslaCatalogs[locale];
    assert.deepEqual(Object.keys(catalog).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof catalog[key], 'string', `${locale}/${key}`);
      assert.ok(catalog[key].trim(), `${locale}/${key}`);
      assert.deepEqual(
        placeholders(catalog[key]),
        placeholders(teslaCatalogs.en[key]),
      );
    }
    for (const key of ['auto', 'low', 'medium', 'high'])
      assert.ok(catalog[key]);
    assert.match(catalog.desktopHint, /Q/, locale);
    assert.match(catalog.desktopHint, /E/, locale);
    assert.match(catalog.desktopHint, /P/, locale);
    assert.notEqual(catalog.adhesion, catalog.freeDrive, locale);
    assert.notEqual(catalog.wallHolding, catalog.parked, locale);
    assert.ok(
      catalog.desktopHint
        .toLocaleLowerCase()
        .includes(catalog.park.toLocaleLowerCase()),
      `${locale} explains manual parking`,
    );
    for (const hint of [catalog.desktopHint, catalog.touchHint])
      assert.ok(
        hint
          .toLocaleLowerCase()
          .includes(catalog.freeDrive.toLocaleLowerCase()),
        `${locale} explains the alternative driving mode`,
      );
    assert.notEqual(catalog.cockpit, catalog.chase, locale);
  }
});

test('Tesla names the default wall mode and optional parking explicitly in the requested Chinese and English', () => {
  assert.equal(teslaCatalogs.en.adhesion, 'Wall Grip');
  assert.equal(teslaCatalogs.en.freeDrive, 'Free Drive');
  assert.equal(teslaCatalogs['zh-Hant'].adhesion, '壁面吸附');
  assert.equal(teslaCatalogs['zh-Hant'].freeDrive, '自由行駛');
  assert.match(teslaCatalogs.en.desktopHint, /starts on.*hold automatically/);
  assert.match(teslaCatalogs.en.desktopHint, /manual park \(optional\)/);
  assert.match(teslaCatalogs['zh-Hant'].desktopHint, /預設.*自動保持/);
  assert.match(teslaCatalogs['zh-Hant'].desktopHint, /手動停車（選用）/);
});
let source = readFileSync(
  new URL('../lib/i18n/index.ts', import.meta.url),
  'utf8',
);
source = source.replace(
  /import (\w+) from '\.\/(.+)\.json';/g,
  (_, binding, locale) =>
    `const ${binding} = ${JSON.stringify(catalogs[locale])};`,
);
const compiledI18n = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const i18n = await import(
  `data:text/javascript;base64,${Buffer.from(compiledI18n).toString('base64')}`
);

test('all ten languages cover every visible message and preserve substitutions', () => {
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
  for (const value of [null, undefined, '', 'xx', 'zh', 'ua', 42])
    assert.equal(i18n.resolveLocale(value), 'en');
  for (const locale of locales)
    assert.equal(i18n.resolveLocale(locale), locale);
});

test('every locale distinguishes unavailable graphics, interrupted graphics and asset loading', () => {
  for (const locale of locales) {
    const message = i18n.translate(locale, 'graphicsUnavailable');
    assert.match(message, /WebGL[ -]2/, locale);
    assert.notEqual(message, i18n.translate(locale, 'graphicsError'), locale);
    assert.notEqual(message, i18n.translate(locale, 'loadErrorDetail'), locale);
    if (locale !== 'en')
      assert.notEqual(message, catalogs.en.graphicsUnavailable, locale);
  }
});

test('every locale explains automatic quality and names the actual current detail without internal diagnostics', () => {
  for (const locale of locales) {
    for (const key of [
      'autoQuality',
      'autoQualityDescription',
      'effectiveQuality',
    ]) {
      const message = i18n.translate(locale, key);
      assert.ok(message.trim(), `${locale}/${key}`);
      if (locale !== 'en')
        assert.notEqual(message, catalogs.en[key], `${locale}/${key}`);
      assert.doesNotMatch(
        message,
        /resolutionScale|targetFps|frameMs|p95Ms|qualityMode|\b60\s*fps\b/i,
      );
    }
    assert.notEqual(
      i18n.translate(locale, 'autoQuality'),
      i18n.translate(locale, 'highQuality'),
    );
    assert.notEqual(
      i18n.translate(locale, 'autoQualityDescription'),
      i18n.translate(locale, 'highQualityDescription'),
    );
    const quality = i18n.translate(locale, 'effectiveQuality');
    assert.doesNotMatch(quality, /[{}]/);
  }
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

test('language menu and catalogs expose the same ten locales', () => {
  assert.deepEqual(
    i18n.LANGUAGES.map((language) => language.id),
    locales,
  );
  assert.deepEqual(Object.keys(i18n.MESSAGES).sort(), [...locales].sort());
  for (const [id, label] of Object.entries({
    de: 'Deutsch',
    ja: '日本語',
    ko: '한국어',
    uk: 'Українська',
    ru: 'Русский',
  }))
    assert.equal(
      i18n.LANGUAGES.find((language) => language.id === id).label,
      label,
    );
});
