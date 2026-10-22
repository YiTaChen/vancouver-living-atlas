import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  verifyBusHybridAdoption,
  auditHybridGLB,
  BUS_HYBRID_SOURCE,
  BUS_HYBRID_PREFIX,
} from '../tools/verify-bus-hybrid-adoption.mjs';

const source = path.resolve(BUS_HYBRID_SOURCE);
async function fixture(run, copySource = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-hybrid-adoption-'));
  const output = path.join(root, 'public'),
    authoring = copySource ? path.join(root, 'source') : source;
  try {
    const m = JSON.parse(
      await readFile(path.join(source, 'manifest.json'), 'utf8'),
    );
    const put = async (name, bytes) => {
      const file = path.join(output, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    };
    for (const name of [
      'manifest.json',
      ...m.assets[0].lods.map((l) => l.file),
    ])
      await put(
        BUS_HYBRID_PREFIX + name,
        await readFile(path.join('public', BUS_HYBRID_PREFIX, name)),
      );
    await put(
      'models/blender/adopted-manifest.json',
      await readFile('public/models/blender/adopted-manifest.json'),
    );
    if (copySource) {
      await mkdir(authoring, { recursive: true });
      await copyFile(
        path.join(source, 'manifest.json'),
        path.join(authoring, 'manifest.json'),
      );
      for (const lod of m.assets[0].lods)
        for (const name of [lod.source, 'exports/' + lod.file]) {
          await mkdir(path.dirname(path.join(authoring, name)), {
            recursive: true,
          });
          await copyFile(path.join(source, name), path.join(authoring, name));
        }
    }
    await run({ output, authoring, m, put });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('hybrid runtime is the exact small reviewed GLB projection; original passenger payloads remain separate', async () => {
  const result = await verifyBusHybridAdoption(path.resolve('public'));
  assert.equal(result.status, 'pass');
  assert.equal(result.adoptedFiles, 4);
  assert(
    result.lods.every(
      (l) => l.triangles <= 10000 && l.bytes <= 1000000 && l.materials === 4,
    ),
  );
  assert.equal(result.lods.length, 3);
});
test('hybrid delivery rejects modified bytes, even under the expected URL', async () =>
  fixture(async (f) => {
    const file = path.join(
      f.output,
      BUS_HYBRID_PREFIX,
      f.m.assets[0].lods[0].file,
    );
    const bytes = await readFile(file);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(file, bytes);
    await assert.rejects(
      verifyBusHybridAdoption(f.output, f.authoring),
      /differs from reviewed export/,
    );
  }));
test('hybrid source edit requires a fresh export and review', async () =>
  fixture(async (f) => {
    await writeFile(
      path.join(f.authoring, f.m.assets[0].lods[0].source),
      'changed editable geometry',
    );
    await assert.rejects(
      verifyBusHybridAdoption(f.output, f.authoring),
      /source changed/,
    );
  }, true));
test('hybrid inventory cannot silently omit the new exterior', async () =>
  fixture(async (f) => {
    const file = path.join(f.output, 'models/blender/adopted-manifest.json');
    const m = JSON.parse(await readFile(file, 'utf8'));
    m.files = m.files.filter((entry) => !entry.path.startsWith('bus-hybrid/'));
    await writeFile(file, JSON.stringify(m));
    await assert.rejects(
      verifyBusHybridAdoption(f.output, f.authoring),
      /Exact hybrid adoption inventory/,
    );
  }));
test('editable Blender files stay in the repository authoring folder, outside browser delivery', async () =>
  fixture(async (f) => {
    await f.put(
      BUS_HYBRID_PREFIX + 'film-reference.blend',
      Buffer.from('authoring source'),
    );
    await assert.rejects(
      verifyBusHybridAdoption(f.output, f.authoring),
      /Only reviewed hybrid runtime payloads/,
    );
  }));
test('hybrid binary cost is measured from triangles, not trusted from metadata', async () => {
  const m = JSON.parse(
    await readFile(path.join(source, 'manifest.json'), 'utf8'),
  );
  const lod = m.assets[0].lods[0];
  const bytes = await readFile(path.join(source, 'exports', lod.file));
  assert.throws(
    () => auditHybridGLB(bytes, { ...lod, triangles: lod.triangles + 1 }),
    /Actual hybrid triangle count/,
  );
});
