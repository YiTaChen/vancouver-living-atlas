/** Export the actual THREE mesh for offline Blender authoring; never a public asset. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = resolve(root, 'lib/city/assets/olympic-cauldron.ts');
const source = await readFile(sourcePath, 'utf8');
const code = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(
    /from ['"]three['"]/g,
    `from '${import.meta.resolve('three')}'`,
  );
const { makeOlympicCauldron, disposeOlympicCauldron } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const group = makeOlympicCauldron();
const meshes = group.children.map((mesh) => {
  const attributes = Object.fromEntries(
    Object.entries(mesh.geometry.attributes).map(([key, attribute]) => [
      key,
      Array.from(attribute.array),
    ]),
  );
  const digest = createHash('sha256');
  for (const name of ['position', 'normal', 'color'])
    digest.update(Buffer.from(new Float32Array(attributes[name]).buffer));
  return {
    name: mesh.name,
    attributes,
    // JSON numbers discard signed zero; retain exact binary Float32 values too.
    attributeBytes: Object.fromEntries(
      Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [
        name,
        Buffer.from(
          attribute.array.buffer,
          attribute.array.byteOffset,
          attribute.array.byteLength,
        ).toString('base64'),
      ]),
    ),
    triangles: attributes.position.length / 9,
    geometrySha256: digest.digest('hex'),
    material: {
      roughness: mesh.material.roughness,
      metalness: mesh.material.metalness,
    },
  };
});
const output = resolve(
  root,
  process.argv[2] ?? 'work/olympic-cauldron/runtime-mesh.json',
);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({
    schema: 'vancouver-living-atlas/olympic-cauldron-runtime-mesh-v1',
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    units: 'metres',
    coordinateSystem: 'THREE Y-up',
    metadata: group.userData,
    meshes,
  }),
);
console.log(
  JSON.stringify({
    output,
    triangles: group.userData.triangles,
    drawCalls: group.userData.drawCalls,
    geometryBytes: group.userData.geometryBytes,
    bounds: group.userData.bounds,
  }),
);
disposeOlympicCauldron(group);
