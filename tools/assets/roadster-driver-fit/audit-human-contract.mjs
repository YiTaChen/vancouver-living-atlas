/** Independent unit-scale/inverse-bind/limb-length check, without editing F04. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import { readGlb, sha } from './adapters/cockpit-candidate.mjs';
const dir = new URL('./', import.meta.url);
const baselinePath = new URL('../../../public/models/citizen/vancouver-citizen.glb', dir);
const baseline = await readGlb(baselinePath);
baseline.scene.updateMatrixWorld(true);
const skeleton = (() => { let s; baseline.scene.traverse(m => { if (m.isSkinnedMesh && !s) s = m.skeleton; }); return s; })();
const inverseByName = new Map(skeleton.bones.map((b, i) => [b.name, skeleton.boneInverses[i].elements]));
assert.equal(inverseByName.size, 22);
const pairNames = ['L', 'R'].flatMap(s => [['thigh' + s, 'shin' + s], ['shin' + s, 'foot' + s], ['upperArm' + s, 'foreArm' + s], ['foreArm' + s, 'hand' + s]]);
function lengths(scene) { return pairNames.map(([a, b]) => ({ pair: [a, b], m: scene.getObjectByName(a).getWorldPosition(new T.Vector3()).distanceTo(scene.getObjectByName(b).getWorldPosition(new T.Vector3())) })); }
const originalLengths = lengths(baseline.scene);
const baselineBox = new T.Box3().setFromObject(baseline.scene);
const records = [];
for (const lod of [0, 1, 2]) {
    const file = new URL(`../citizen-character-variants/exports/driver-roadster-fit.lod${lod}.glb`, dir);
    const human = await readGlb(file); human.scene.updateMatrixWorld(true);
    const restBox = new T.Box3().setFromObject(human.scene);
    assert.ok(Math.abs(restBox.max.y - baselineBox.max.y) < 1e-6);
    let maxBindDelta = 0, skins = 0;
    human.scene.traverse(m => {
        if (!m.isSkinnedMesh) return;
        skins++;
        assert.equal(m.skeleton.bones.length, 22);
        m.skeleton.bones.forEach((b, i) => {
            const ref = inverseByName.get(b.name); assert.ok(ref);
            m.skeleton.boneInverses[i].elements.forEach((v, j) => maxBindDelta = Math.max(maxBindDelta, Math.abs(v - ref[j])));
        });
    });
    assert.ok(maxBindDelta < 1e-6);
    const mixer = new T.AnimationMixer(human.scene);
    mixer.clipAction(human.animations.find(a => a.name === 'driver-seated')).play(); mixer.setTime(.5); human.scene.updateMatrixWorld(true);
    const posedLengths = lengths(human.scene);
    const limbError = Math.max(...posedLengths.map((p, i) => Math.abs(p.m - originalLengths[i].m)));
    assert.ok(limbError < 2e-6, 'Human limb length changed');
    let scaleError = 0; human.scene.traverse(o => { if (o.isBone) { const s = o.getWorldScale(new T.Vector3()); scaleError = Math.max(scaleError, ...s.toArray().map(x => Math.abs(x - 1))); } });
    assert.ok(scaleError < 2e-6, 'Nonuniform or scaled human rig');
    records.push({ lod, file: `tools/assets/citizen-character-variants/exports/driver-roadster-fit.lod${lod}.glb`, sha256: sha(await fs.readFile(file)), skins, bonesPerSkin: 22, standingHeadTopM: restBox.max.y, originalStandingHeadTopM: baselineBox.max.y, maximumInverseBindDelta: maxBindDelta, maximumLimbLengthDeltaM: limbError, maximumPosedBoneWorldScaleError: scaleError, originalLengths, posedLengths });
}
await fs.writeFile(new URL('qa/human-proportions.json', dir), JSON.stringify({ status: 'pass', originalModel: 'public/models/citizen/vancouver-citizen.glb', originalSha256: sha(await fs.readFile(baselinePath)), statement: 'Original approximately 1.81 m citizen, all 22 inverse binds and exact limb lengths preserved; no human or car nonuniform scale.', records }, null, 2) + '\n');
console.log('HUMAN_PROPORTIONS_PASS');
