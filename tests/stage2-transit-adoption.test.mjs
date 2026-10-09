import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBusV2Projection } from '../tools/project-bus-v2-runtime.mjs';
import { loadMetroProjection } from '../tools/metro-projection.mjs';
import { verifyStage2TransitAdoption } from '../tools/verify-stage2-transit-adoption.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stage2-adoption-'));
  try {
    const bus = await loadBusV2Projection(),
      metro = await loadMetroProjection();
    const entries = [...bus.entries, ...metro.entries];
    const put = async (name, data) => {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    };
    for (const entry of entries)
      await put(
        'models/blender/' + entry.path,
        await readFile('public/models/blender/' + entry.path),
      );
    await put(
      'models/blender/adopted-manifest.json',
      JSON.stringify({ version: 1, files: entries }),
    );
    await fn({ root, put, entries });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('production Stage 2 inventory matches canonical sources, geometry and camera projections', () =>
  fixture(async ({ root }) => {
    const result = await verifyStage2TransitAdoption(root);
    assert.equal(result.status, 'pass');
    assert.equal(result.adoptedFiles, 10);
    assert.equal(result.geometryBytes, 3009124);
  }));
test('changed GLB and invented provenance cannot pass the Stage 2 gate', () =>
  fixture(async ({ root, put, entries }) => {
    const file = 'models/blender/' + entries[0].path;
    const original = await readFile(path.join(root, file));
    const altered = Buffer.from(original);
    altered[altered.length - 1] ^= 1;
    await put(file, altered);
    await assert.rejects(verifyStage2TransitAdoption(root), /payload changed/);
    await put(file, original);
    entries[0].sourceRevision = 'invented';
    await put(
      'models/blender/adopted-manifest.json',
      JSON.stringify({ version: 1, files: entries }),
    );
    await assert.rejects(
      verifyStage2TransitAdoption(root),
      /inventory and provenance/,
    );
  }));
test('renamed detailed master and duplicate approved GLBs remain protected outside adopted paths', () =>
  fixture(async ({ root, put, entries }) => {
    await put(
      'assets/renamed.bin',
      await readFile(
        'tools/assets/boardable-bus-v2/exports/city-bus-12m-interior-v2.lod0.glb',
      ),
    );
    await assert.rejects(
      verifyStage2TransitAdoption(root),
      /Unapproved Stage 2/,
    );
    await rm(path.join(root, 'assets/renamed.bin'));
    await put(
      'assets/duplicate.bin',
      await readFile('public/models/blender/' + entries[0].path),
    );
    await assert.rejects(
      verifyStage2TransitAdoption(root),
      /Unapproved Stage 2/,
    );
  }));
test('extra model metadata and unmounted interactive consumers fail closed', () =>
  fixture(async ({ root, put }) => {
    await put('models/blender/metro/extra.txt', 'unexpected');
    await assert.rejects(verifyStage2TransitAdoption(root), /Unlisted Stage 2/);
    await rm(path.join(root, 'models/blender/metro/extra.txt'));
    await put('assets/consumer.js', 'class InteractiveRendererCandidate {}');
    await assert.rejects(
      verifyStage2TransitAdoption(root),
      /Unmounted Stage 2/,
    );
  }));
