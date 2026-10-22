// Replay the exact trusted engine height methods, including its beach patch.
// This avoids importing the complete renderer in CPU geometry regression tests.
import fs from 'node:fs';
import ts from 'typescript';
import { cityModule } from './city-modules.mjs';
const { BeachGround } = await import(cityModule('beach-ground'));
const text = fs.readFileSync('lib/city/engine.ts', 'utf8');
const ast = ts.createSourceFile(
  'engine.ts',
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const node = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CityEngine',
);
const methods = ['elevation', 'rawElevation'].map((name) =>
  node.members.find((n) => n.name?.getText(ast) === name).getText(ast),
);
const code = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}';
   import { unproject } from '${cityModule('geo')}';
   export class HeightProbe { ${methods.join('\n')} }`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { HeightProbe } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const probe = new HeightProbe();
probe.data = {
  elevation: JSON.parse(fs.readFileSync('public/data/terrain.json')),
};
probe.beachGround = new BeachGround(
  JSON.parse(fs.readFileSync('public/data/beach-coast.json')),
);
export const cityElevation = (x, z) => probe.elevation(x, z);
