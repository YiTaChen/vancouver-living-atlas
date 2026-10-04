/** CPU proof: optional E02 bridge preserves geometry while separating leather. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import { makeCockpitCandidate, bindCockpitCandidateMaps, sha } from './adapters/cockpit-candidate.mjs';
import { metricError } from '../material-consumer-candidates/adapters/metre-uv.mjs';
const dir = new URL('./', import.meta.url), records = [];
for (const lod of [0, 1, 2]) {
    const file = new URL(`exports/roadster-cockpit-local.lod${lod}.glb`, dir), before = sha(await fs.readFile(file));
    const car = await makeCockpitCandidate({ replacementGlb: file, materialCandidate: true });
    const roles = {}, meshes = [];
    car.replacement.traverse(m => { if (!m.isMesh) return; meshes.push(m); (roles[m.userData.semanticRole] ??= []).push(m); assert.ok(metricError(m.geometry).maxAbsoluteEdgeErrorM < 5e-6); assert.equal(m.geometry.hasAttribute('tangent'), false, 'No stale normalized-UV tangent basis'); });
    assert.deepEqual(Object.fromEntries(Object.entries(roles).map(([r, m]) => [r, m.length])), { 'dashboard-trim': 3, 'floor-trim': 1, 'steering-trim': 1, 'steering-metal': 2, 'seat-upholstery': 8 });
    const seats = roles['seat-upholstery'], trim = meshes.filter(m => m.userData.semanticRole !== 'seat-upholstery');
    assert.ok(seats.every(m => m.userData.surfaceId === 'vehicle-seat-leather'));
    assert.ok(trim.every(m => !m.userData.surfaceId));
    assert.ok(trim.every(m => m.material !== seats[0].material));
    const fallback = trim.map(m => ({ m, color: m.material.color.clone(), roughness: m.material.roughness, metallic: m.material.metalness }));
    const maps = { basecolor: new T.Texture(), normal: new T.Texture(), orm: new T.Texture() };
    const hook = () => {}; seats[0].material.onBeforeCompile = hook;
    const count = bindCockpitCandidateMaps(car.group, { 'vehicle-seat-leather': maps });
    assert.equal(count, 2, 'One material for preserved passenger seat and one for replacement driver seat');
    for (const m of seats) { assert.equal(m.material.map, maps.basecolor); assert.equal(m.material.normalMap, maps.normal); assert.equal(m.material.roughnessMap, maps.orm); assert.equal(m.material.metalnessMap, maps.orm); assert.equal(m.material.onBeforeCompile, hook); assert.equal(m.material.color.getHex(), 0xffffff); }
    for (const f of fallback) { assert.equal(f.m.material.map, null); assert.ok(f.m.material.color.equals(f.color)); assert.equal(f.m.material.roughness, f.roughness); assert.equal(f.m.material.metalness, f.metallic); }
    assert.equal(maps.basecolor.flipY, true, 'Fresh metric charts are native Three charts');
    assert.equal(maps.basecolor.repeat.x, 2); assert.equal(maps.basecolor.colorSpace, T.SRGBColorSpace); assert.equal(maps.orm.colorSpace, T.NoColorSpace);
    assert.equal(sha(await fs.readFile(file)), before, 'Frozen ordinary GLB changed');
    const raw = await makeCockpitCandidate({ replacementGlb: file });
    assert.throws(() => bindCockpitCandidateMaps(raw.group, { 'vehicle-seat-leather': maps }), /Enable materialCandidate/);
    records.push({ lod, ordinaryGlbUnchanged: true, replacementRoles: Object.fromEntries(Object.entries(roles).map(([r, m]) => [r, m.length])), allReplacementMetreUvErrorsBelowM: 5e-6, sharedMapsBoundOnlyToSeatMaterials: true, fallbackTrimAndMetalPreserved: true, shaderHookPreserved: true, nativeMetricUvFlipY: true, staleNormalizedUvTangentsDiscarded: true });
}
await fs.writeFile(new URL('qa/material-composition.json', dir), JSON.stringify({ status: 'pass', mode: 'Optional materialCandidate only; no frozen source/GLB changes, no texture downloads', sourceUvContract: 'Ordinary GLB keeps authored normalized primitive UV and inherited seat angular UV; combined mode replaces these in memory with exact triangle metre charts before E02 binding.', records }, null, 2) + '\n');
console.log('MATERIAL_COMPOSITION_PASS');
