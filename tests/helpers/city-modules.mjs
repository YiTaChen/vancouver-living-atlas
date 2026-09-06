import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
const cache = new Map();
// Cache canonical paths so imports within assets/ resolve beside their importer,
// while ../geo and equivalent ./assets/../geo share one module instance.
const normalize = (name) => posix.normalize(name).replace(/\.ts$/, '');
export function cityModule(name) {
  name = normalize(name);
  if (cache.has(name)) return cache.get(name);
  if (name.endsWith('.json')) {
    const data = JSON.parse(
      readFileSync(new URL(`../../lib/city/${name}`, import.meta.url), 'utf8'),
    );
    const result =
      'data:text/javascript;base64,' +
      Buffer.from(`export default ${JSON.stringify(data)};`).toString('base64');
    cache.set(name, result);
    return result;
  }
  const source = readFileSync(
    new URL(`../../lib/city/${name}.ts`, import.meta.url),
    'utf8',
  );
  let code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  code = code.replace(/from ['"]([^'"]+)['"]/g, (_, id) => {
    const url =
      id === 'three' || id.startsWith('three/')
        ? import.meta.resolve(id)
        : id.startsWith('./') || id.startsWith('../')
          ? cityModule(posix.join(posix.dirname(name), id))
          : id;
    return `from '${url}'`;
  });
  const result =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  cache.set(name, result);
  return result;
}
