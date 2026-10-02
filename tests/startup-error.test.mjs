import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const { GraphicsUnavailableError, startupErrorMessageKey } = await import(
  cityModule('startup-error')
);
const catalog = JSON.parse(
  readFileSync(new URL('../lib/i18n/en.json', import.meta.url), 'utf8'),
);
const source = readFileSync(
  new URL('../app/page.tsx', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'page.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect, overlay;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === 'useEffect' &&
    node.arguments[0].getText(ast).includes("import('@/lib/city/engine')")
  )
    effect = node.arguments[0].getText(ast);
  if (
    ts.isJsxExpression(node) &&
    node.expression?.getText(ast).startsWith('!ready &&')
  )
    overlay = node.expression.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(effect && overlay, 'exercise the production page startup and overlay');
const code = ts
  .transpileModule(
    `
  import { startupErrorMessageKey } from ${JSON.stringify(cityModule('startup-error'))};
  const Mountain = () => null;
  export function start({ host, engine, importEngine, setReady, setError, setLoadProgress }) {
    const setStats = () => {}, setSettings = () => {}, go = () => {};
    const localeRef = { current: 'en' }, labelHost = { current: null }, minimap = { current: null };
    return (${effect.replace("import('@/lib/city/engine')", 'importEngine()')})();
  }
  export function renderOverlay({ ready = false, error = null, loadProgress = 0, tr }) {
    return ${overlay};
  }
`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  )
  .outputText.replace(
    '"react/jsx-runtime"',
    JSON.stringify(import.meta.resolve('react/jsx-runtime')),
  );
const { start, renderOverlay } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const settle = () => new Promise(setImmediate);
function fixture(importEngine) {
  const errors = [],
    ready = [],
    progress = [];
  const engine = { current: null };
  const stop = start({
    host: { current: {} },
    engine,
    importEngine,
    setReady: (value) => ready.push(value),
    setError: (value) => errors.push(value),
    setLoadProgress: (value) => progress.push(value),
  });
  return { errors, ready, progress, engine, stop };
}

test('only typed renderer errors and the existing context-loss sentinel get graphics guidance', () => {
  const cause = new Error('Error creating WebGL context.');
  const error = new GraphicsUnavailableError(cause);
  assert(error instanceof Error);
  assert.equal(error.name, 'GraphicsUnavailableError');
  assert.equal(error.code, 'graphics-unavailable');
  assert.equal(error.cause, cause);
  assert.equal(startupErrorMessageKey(error), 'graphicsUnavailable');
  assert.equal(
    startupErrorMessageKey('graphics-context-lost'),
    'graphicsError',
  );
  for (const other of [
    new Error('Failed to fetch'),
    'Missing required terrain',
    new Error('Error creating WebGL context.'),
    'WebGL unavailable',
    new Error('graphics-context-lost'),
    'Error: graphics-context-lost',
    'graphics-unavailable',
    { code: 'graphics-unavailable' },
    { message: 'graphics-context-lost' },
    new TypeError('Failed to fetch dynamically imported module'),
    null,
    undefined,
    false,
    0,
    '',
  ])
    assert.equal(startupErrorMessageKey(other), 'loadErrorDetail');
});

test('page classifies constructor and import rejections before losing their error type', async () => {
  for (const reason of [
    new GraphicsUnavailableError(new Error('WebGL')),
    new Error('Missing asset'),
    null,
  ]) {
    for (const stage of ['constructor', 'import']) {
      const f = fixture(() =>
        stage === 'import'
          ? Promise.reject(reason)
          : Promise.resolve({
              CityEngine: class {
                constructor() {
                  throw reason;
                }
              },
            }),
      );
      await settle();
      assert.deepEqual(f.errors, [null, startupErrorMessageKey(reason)]);
      assert.deepEqual(f.ready, [false]);
      assert.equal(f.engine.current, null);
      f.stop();
    }
  }
});

test('page preserves callback errors and ignores results after cleanup', async () => {
  let report,
    destroyed = 0;
  const f = fixture(async () => ({
    CityEngine: class {
      constructor(_host, _stats, _ready, onError) {
        report = onError;
      }
      destroy() {
        destroyed++;
      }
    },
  }));
  await settle();
  report('graphics-context-lost');
  report('Missing required terrain');
  assert.deepEqual(f.errors, [null, 'graphicsError', 'loadErrorDetail']);
  f.stop();
  report('graphics-context-lost');
  assert.equal(f.errors.length, 3);
  assert.equal(f.engine.current, null);
  assert.equal(destroyed, 1);

  let reject;
  const pending = fixture(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  pending.stop();
  reject(new GraphicsUnavailableError('late failure'));
  await settle();
  assert.deepEqual(pending.errors, [null]);
});

test('production overlay presents the appropriate guidance, retains reload and hides progress on failure', () => {
  for (const error of [
    'graphicsUnavailable',
    'graphicsError',
    'loadErrorDetail',
  ]) {
    const html = renderToStaticMarkup(
      renderOverlay({ error, tr: (key) => catalog[key] }),
    );
    assert(html.includes(catalog[error]));
    assert(html.includes(catalog.loadFailed));
    assert(html.includes(catalog.reload));
    assert(!html.includes('role="progressbar"'));
    for (const other of [
      'graphicsUnavailable',
      'graphicsError',
      'loadErrorDetail',
    ])
      if (other !== error) assert(!html.includes(catalog[other]));
  }
  const loading = renderToStaticMarkup(
    renderOverlay({ loadProgress: 48, tr: (key) => catalog[key] }),
  );
  assert(loading.includes('aria-valuenow="48"'));
  assert(loading.includes(catalog.loading));
  assert(!loading.includes(catalog.reload));
  assert.equal(
    renderToStaticMarkup(
      renderOverlay({ ready: true, tr: (key) => catalog[key] }),
    ),
    '',
  );
});
