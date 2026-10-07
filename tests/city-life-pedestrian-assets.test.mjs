import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MOTION_CONTRACT, deformVertex, stateInputs } from '../tools/assets/city-life-pedestrians/motion.mjs';
const root = resolve('tools/assets/city-life-pedestrians');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function glb(path) {
  const bytes = readFileSync(path), jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = bytes.subarray(28 + jsonLength);
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const types = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE'] };
  function accessor(index) {
    const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
    const [bytesPerComponent, read] = types[a.componentType], n = widths[a.type];
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || n * bytesPerComponent;
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: n }, (_, k) => binary[read](offset + i * stride + k * bytesPerComponent)));
  }
  const primitive = doc.meshes[0].primitives[0];
  return { doc, indices: accessor(primitive.indices).flat(), attrs: Object.fromEntries(Object.entries(primitive.attributes).map(([k, v]) => [k, accessor(v)])) };
}
const data = manifest.assets.flatMap((asset) => asset.lods.map((lod) => ({ asset, lod, ...glb(join(root, lod.file)) })));

test('background package follows common schema and actual-file CPU validator', () => {
  const result = JSON.parse(execFileSync('python3', [join(root, 'validate.py')], { encoding: 'utf8' }));
  assert.equal(result.status, 'pass'); assert.equal(result.results.length, 8);
  assert.equal(manifest.integrationStatus, 'runtime_pending_webgl');
  assert.equal(manifest.provenance.nearSkeleton.startsWith('not_implemented'), true);
});
test('four original silhouettes use one opaque merged mesh per LOD and no textures', () => {
  assert.equal(manifest.assets.length, 4); assert.equal(data.length, 8);
  for (const { asset, lod, doc, attrs, indices } of data) {
    assert.equal(sha(join(root, lod.file)), lod.sha256);
    assert.equal(doc.meshes.length, 1); assert.equal(doc.meshes[0].primitives.length, 1);
    assert.equal(doc.materials.length, 1); assert.equal(doc.materials[0].alphaMode || 'OPAQUE', 'OPAQUE');
    assert.equal((doc.textures || []).length, 0); assert.equal((doc.skins || []).length, 0);
    assert.equal(indices.length / 3, lod.triangles);
    assert.ok(lod.level === 0 ? lod.triangles >= 300 && lod.triangles <= 1000 : lod.triangles >= 80 && lod.triangles <= 250);
    assert.ok(Math.abs(Math.min(...attrs.POSITION.map((p) => p[1]))) < 1e-7);
    assert.ok(Math.abs(Math.max(...attrs.POSITION.map((p) => p[1])) - asset.expectedDimensionsM.dressedHeight) < 1e-6);
    assert.deepEqual(Object.keys(attrs).sort(), ['COLOR_0', 'NORMAL', 'POSITION', '_LIMB', '_PALETTE', '_PIVOT_X', '_PIVOT_Y', '_PIVOT_Z'].sort());
  }
});
test('every exported triangle retains a single rigid limb and pivot, including bags and caps', () => {
  for (const { attrs, indices } of data) for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    for (const b of [indices[t + 1], indices[t + 2]]) for (const key of ['_LIMB', '_PIVOT_X', '_PIVOT_Y', '_PIVOT_Z']) assert.deepEqual(attrs[key][a], attrs[key][b]);
  }
});
test('walk, idle, look and yield positions stay inside measured analytic animated bounds', () => {
  const states = MOTION_CONTRACT.states.map((state) => stateInputs(state, Math.PI / 2));
  for (let p = 0; p <= 32; p++) for (const walkWeight of [0, 1]) for (const yieldWeight of [0, 1]) for (const lookYawRadians of [-.75, .75]) states.push({ phaseRadians: p * Math.PI / 16, walkWeight, yieldWeight, lookYawRadians });
  for (const { attrs, lod } of data) for (const inputs of states) for (let i = 0; i < attrs.POSITION.length; i++) {
    const pivot = ['X', 'Y', 'Z'].map((axis) => attrs['_PIVOT_' + axis][i][0]);
    const result = deformVertex(attrs.POSITION[i], attrs.NORMAL[i], attrs._LIMB[i][0], pivot, inputs);
    for (let axis = 0; axis < 3; axis++) assert.ok(result.position[axis] >= lod.animatedBoundsM.min[axis] && result.position[axis] <= lod.animatedBoundsM.max[axis], `${lod.file}: envelope axis ${axis}`);
    assert.ok(Math.abs(Math.hypot(...result.normal) - 1) < .0001);
  }
});
test('deformed normals match actual deformed triangle normals, not the undeformed stance', () => {
  const subtract = (a, b) => a.map((x, i) => x - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const { attrs, indices } of data) for (const inputs of [{ phaseRadians: 1.3, walkWeight: 1, yieldWeight: 1, lookYawRadians: .75 }, stateInputs('yield'), stateInputs('look', 0, -.75)]) {
    for (let t = 0; t < indices.length; t += 3) {
      const v = indices.slice(t, t + 3).map((i) => deformVertex(attrs.POSITION[i], attrs.NORMAL[i], attrs._LIMB[i][0], ['X', 'Y', 'Z'].map((axis) => attrs['_PIVOT_' + axis][i][0]), inputs));
      const n = cross(subtract(v[1].position, v[0].position), subtract(v[2].position, v[0].position)), length = Math.hypot(...n);
      const dot = n.reduce((sum, value, i) => sum + value / length * v[0].normal[i], 0);
      assert.ok(dot > .999, `normal deformation mismatch ${dot}`);
    }
  }
});
test('state input limits remain bounded and arbitrary state names cannot silently render', () => {
  assert.throws(() => stateInputs('teleport'), RangeError);
  const a = deformVertex([1, 2, 3], [0, 1, 0], 1, [0, 1, 0], { lookYawRadians: 100 });
  const b = deformVertex([1, 2, 3], [0, 1, 0], 1, [0, 1, 0], { lookYawRadians: .75 });
  assert.deepEqual(a, b);
});
test('validator rejects tampered triangle metadata rather than trusting manifest claims', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pedestrian-negative-'));
  try {
    cpSync(root, temp, { recursive: true });
    const changed = structuredClone(manifest); changed.assets[0].lods[0].triangles++;
    writeFileSync(join(temp, 'manifest.json'), JSON.stringify(changed));
    assert.throws(() => execFileSync('python3', [join(root, 'validate.py'), '--package', temp], { stdio: 'pipe' }));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
