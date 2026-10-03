/** Read-only loader for repository TypeScript consumers; no browser or emitted runtime files. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { compileFunction } from 'node:vm';
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
export const require = createRequire(path.join(ROOT, 'package.json'));
export const sources = new Set();
const cache = new Map();
export const textFile = (name) => {
  sources.add(name);
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
};
export const jsonFile = (name) => JSON.parse(textFile(name));
export function load(name) {
  name = path.posix.normalize(name);
  if (cache.has(name)) return cache.get(name).exports;
  const loaded = { exports: {} };
  cache.set(name, loaded);
  if (name.endsWith('.json')) {
    loaded.exports = jsonFile(name);
    return loaded.exports;
  }
  const output = ts.transpileModule(textFile(name), {
    fileName: name,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (id) => {
    if (!id.startsWith('.')) return require(id);
    let p = path.posix.join(path.posix.dirname(name), id);
    if (!/\.(ts|js|json)$/.test(p)) p += '.ts';
    return load(p);
  };
  compileFunction(output, ['require', 'module', 'exports'])(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
/** Extract the actual two elevation methods, including beach override, instead of copying their formula. */
export function elevationMethods(THREE, geo) {
  const name = 'lib/city/engine.ts',
    text = textFile(name);
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const found = [];
  function visit(n) {
    if (
      ts.isMethodDeclaration(n) &&
      ['elevation', 'rawElevation'].includes(n.name.getText(ast))
    )
      found.push(n.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (found.length !== 2)
    throw new Error('Expected exact engine elevation methods');
  const output = ts.transpileModule(
    `export const methods={${found.join(',\n')}}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  compileFunction(output, ['THREE', 'unproject', 'module', 'exports'])(
    THREE,
    geo.unproject,
    loaded,
    loaded.exports,
  );
  return loaded.exports.methods;
}
