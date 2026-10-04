import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { roadsterPatch, interiorPatch } from './source-patches.mjs';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const PACKAGE = resolve(ROOT, 'tools/assets/material-consumer-candidates');
const uvURL = new URL('./metre-uv.mjs', import.meta.url).href;
export const originalSource = name => readFileSync(resolve(ROOT,'lib/city',name + '.ts'),'utf8');
export function patchedSource(name) {
  const s = originalSource(name);
  return name === 'assets/roadster' ? roadsterPatch(s,uvURL) : name === 'interiors' ? interiorPatch(s,uvURL) : s;
}
export function loader(candidate = false) {
  const cache = new Map();
  function url(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    let code;
    if (file.endsWith('.json')) code = `export default ${readFileSync(file,'utf8')};`;
    else {
      let source = readFileSync(file,'utf8');
      if (candidate && file.endsWith('/lib/city/assets/roadster.ts')) source = roadsterPatch(source,uvURL);
      if (candidate && file.endsWith('/lib/city/interiors.ts')) source = interiorPatch(source,uvURL);
      code = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText;
      code = code.replace(/from ['"]([^'"]+)['"]/g, (_,id) => {
        if (id.startsWith('file:')) return `from '${id}'`;
        const target = id.startsWith('.') ? url(resolve(dirname(file), /\.(json|js|ts)$/.test(id) ? id : id+'.ts')) : import.meta.resolve(id);
        return `from '${target}'`;
      });
    }
    const result = 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
    cache.set(file,result); return result;
  }
  return name => import(url(resolve(ROOT,'lib/city',name+'.ts')));
}
