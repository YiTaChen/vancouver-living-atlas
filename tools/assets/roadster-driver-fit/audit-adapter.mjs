/** Preservation proof uses world-space oriented triangle multisets. No GPU. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loader } from '../material-consumer-candidates/adapters/harness.mjs';
import { makeSource, makeCockpitCandidate, patchSource, SUPPRESSED, sha } from './adapters/cockpit-candidate.mjs';
const dir = new URL('./', import.meta.url), root = new URL('../../../', dir);
function triangles(o) { o.updateMatrixWorld(true); const out = []; o.traverse(m => { if (!m.isMesh)
    return; const a = m.geometry.attributes.position, idx = m.geometry.index; for (let i = 0; i < (idx ? idx.count : a.count); i += 3) {
    const p = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(a, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld).toArray().map(x => x.toFixed(6)).join(','));
    out.push([p.join(';'), [p[1], p[2], p[0]].join(';'), [p[2], p[0], p[1]].join(';')].sort()[0]);
} }); return out; }
function rigidEqual(a, b) { a.updateMatrixWorld(true); b.updateMatrixWorld(true); function raw(o) { const out = []; o.traverse(m => { if (!m.isMesh)
    return; const p = m.geometry.attributes.position, i = m.geometry.index; for (let n = 0; n < (i ? i.count : p.count); n += 3)
    out.push([0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(p, i ? i.getX(n + k) : n + k).applyMatrix4(m.matrixWorld))); }); return out; } const x = raw(a), y = raw(b), used = new Set(); assert.equal(x.length, y.length); let max = 0; for (const t of x) {
    let matched = false;
    for (let j = 0; j < y.length && !matched; j++) {
        if (used.has(j))
            continue;
        for (let r = 0; r < 3; r++) {
            const d = Math.max(...[0, 1, 2].map(k => t[k].distanceTo(y[j][(k + r) % 3])));
            if (d <= 1e-6) {
                used.add(j);
                max = Math.max(max, d);
                matched = true;
                break;
            }
        }
    }
    assert(matched, 'Rigid seat triangle changed');
} return max; }
function counts(a) { const m = new Map(); for (const k of a)
    m.set(k, (m.get(k) || 0) + 1); return m; }
function equal(a, b) { const ca = counts(a), cb = counts(b); assert.equal(ca.size, cb.size); for (const [k, n] of ca)
    assert.equal(cb.get(k), n, k); }
const source = await fs.readFile(new URL('lib/city/assets/roadster.ts', root), 'utf8');
let rejected = false;
try {
    patchSource(source + '\n');
}
catch {
    rejected = true;
}
assert(rejected);
const original = (await loader(false)('assets/roadster')).makeRoadster(), base = await makeSource();
equal(triangles(original.group), triangles(base.group));
const expectedSuppress = JSON.parse(await fs.readFile(new URL('specs.json', dir), 'utf8')).suppressionCounts;
const suppressed = base.capturedParts.filter(p => SUPPRESSED.includes(p.userData.sourceRole));
assert.deepEqual(Object.fromEntries(Object.entries(expectedSuppress).map(([r]) => [r, suppressed.filter(p => p.userData.sourceRole === r).length])), expectedSuppress);
const result = [];
const seatTranslation = JSON.parse(await fs.readFile(new URL('specs.json', dir), 'utf8')).driverSeatTranslation;
const rigidSeatProof = [];
for (const materialCandidate of [false, true])
    for (const lod of [0, 1, 2]) {
        const car = await makeCockpitCandidate({ replacementGlb: new URL(`exports/roadster-cockpit-local.lod${lod}.glb`, dir), materialCandidate });
        const expected = counts(triangles(base.group));
        for (const p of base.capturedParts.filter(p => p.userData.sourceRole.startsWith('driver-seat-'))) {
            const shifted = p.clone();
            shifted.position.fromArray(seatTranslation);
            const replacement = car.replacement.getObjectByName(p.name.replace('/', '-'));
            assert(replacement, p.name);
            const maxDelta = rigidEqual(shifted, replacement);
            if (!materialCandidate && lod === 0)
                rigidSeatProof.push({ sourcePart: p.name, replacementNode: replacement.name, translationM: seatTranslation, triangleCoordinatesPreservedWithinM: 1e-6, measuredMaxVertexDeltaM: maxDelta });
        }
        for (const p of suppressed)
            for (const k of triangles(p)) {
                const n = expected.get(k);
                assert(n > 0);
                if (n === 1)
                    expected.delete(k);
                else
                    expected.set(k, n - 1);
            }
        for (const k of triangles(car.replacement))
            expected.set(k, (expected.get(k) || 0) + 1);
        const actual = counts(triangles(car.group));
        assert.deepEqual(actual, expected);
        for (const [distance, steering] of [[0, 0], [1, .35], [19, -.5]]) {
            base.update(distance, steering);
            car.update(distance, steering);
            const a = [], b = [];
            base.group.children.filter(o => o.isGroup).forEach(o => a.push(...triangles(o)));
            car.group.children.filter(o => o.isGroup && o !== car.replacement).forEach(o => b.push(...triangles(o)));
            equal(a, b);
        }
        base.update(0, 0);
        car.update(0, 0);
        result.push({ lod, materialCandidate, preservedAllNonSuppressedTriangles: true, wheelGeometryAndThreeUpdateSamplesIdentical: true, rootIdentity: car.group.matrix.equals(new T.Matrix4()), preservedSourceParts: base.capturedParts.length - suppressed.length, suppressedParts: suppressed.length });
        if (!materialCandidate && lod === 0 && process.argv.includes('--write-fixtures')) {
            globalThis.FileReader = class {
                readAsArrayBuffer(b) { b.arrayBuffer().then(r => { this.result = r; this.onloadend?.(); }); }
            };
            await fs.writeFile(new URL('qa/candidate.inspection.glb', dir), Buffer.from(await new GLTFExporter().parseAsync(car.group, { binary: true })));
            const semantic = new T.Group();
            for (const p of car.capturedParts)
                if (!SUPPRESSED.includes(p.userData.sourceRole))
                    semantic.add(p.clone());
            for (const o of car.group.children)
                if (o.isGroup && o !== car.replacement)
                    semantic.add(o.clone());
            semantic.add(car.replacement.clone());
            equal(triangles(semantic), triangles(car.group));
            await fs.writeFile(new URL('qa/candidate.semantic-inspection.glb', dir), Buffer.from(await new GLTFExporter().parseAsync(semantic, { binary: true })));
        }
    }
const hashes = {};
for (const p of ['lib/city/assets/roadster.ts', 'lib/city/navigation.ts', 'lib/city/driver-camera.ts', 'lib/city/assets/cockpits.ts', 'tools/assets/material-consumer-candidates/adapters/source-patches.mjs'])
    hashes[p] = sha(await fs.readFile(new URL(p, root)));
const report = { status: 'pass', sourceSha256: sha(source), driftRejected: true, unmodifiedConstructorAndInstrumentedBaselineTriangleParity: true, sourceHashes: hashes, exactSuppressionCounts: expectedSuppress, rigidSeatProof, changedGeometry: 'Only suppressed callsites plus explicit replacement GLB; preserved world triangles compared as oriented multisets with 1um coordinate tolerance', results: result };
await fs.writeFile(new URL('qa/adapter-preservation.json', dir), JSON.stringify(report, null, 2) + '\n');
console.log('ADAPTER_PRESERVATION_PASS', result.length);
await import('./audit-materials.mjs');
