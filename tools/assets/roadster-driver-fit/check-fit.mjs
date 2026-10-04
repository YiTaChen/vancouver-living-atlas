import fs from 'node:fs/promises';
import * as T from 'three';
import { makeCockpitCandidate, readGlb, sha, SUPPRESSED } from './adapters/cockpit-candidate.mjs';
import { meshTriangles, makeCollider, contacts, penetrationSamples } from './contact-kernel.mjs';
const dir = new URL('./', import.meta.url);
const specs = JSON.parse(await fs.readFile(new URL('specs.json', dir), 'utf8'));
const reports = [];
for (const lod of process.argv.includes('--all') ? [0, 1, 2] : [0]) {
    const hp = process.argv.find(a => a.startsWith('--human='))?.slice(8) || new URL(`../citizen-character-variants/exports/driver-roadster-fit.lod${lod}.glb`, dir);
    const human = await readGlb(hp), mixer = new T.AnimationMixer(human.scene);
    mixer.clipAction(human.animations.find(a => a.name === specs.driver.clip)).play();
    mixer.setTime(.5);
    human.scene.position.fromArray(specs.driver.translation);
    human.scene.updateMatrixWorld(true);
    const humanTriangles = [];
    human.scene.traverse(m => { if (m.isSkinnedMesh)
        humanTriangles.push(...meshTriangles(m, true)); });
    const car = await makeCockpitCandidate({ replacementGlb: new URL(`exports/roadster-cockpit-local.lod${lod}.glb`, dir) });
    car.group.updateMatrixWorld(true);
    for (const p of car.capturedParts)
        p.updateMatrixWorld(true);
    const baseline = car.capturedParts.filter(p => ['dashboard', 'steering-rim', 'steering-spoke-horizontal', 'steering-spoke-lower'].includes(p.userData.sourceRole));
    const preserved = car.capturedParts.filter(p => !SUPPRESSED.includes(p.userData.sourceRole) && ((['cabin-floor', 'underbody', 'center-console'].includes(p.userData.sourceRole) || p.userData.sourceRole.includes('seat-')) || (p.userData.sourcePartId >= 42 && p.userData.sourcePartId <= 46) || (p.userData.sourcePartId >= 51 && p.userData.sourcePartId <= 52)));
    const replacements = [];
    car.replacement.traverse(p => { if (p.isMesh)
        replacements.push(p); });
    const nonHands = humanTriangles.filter(t => !/^hand[LR]$/.test(t.bone));
    const fit = { baseline: [], candidate: [], preserved: [], shell: [] };
    for (const p of baseline)
        fit.baseline.push(contacts(nonHands, makeCollider(p)));
    for (const p of replacements) {
        const c = makeCollider(p);
        fit.candidate.push({ ...contacts(nonHands, c), handContacts: contacts(humanTriangles.filter(t => /^hand[LR]$/.test(t.bone)), c), handPenetration: penetrationSamples(humanTriangles.filter(t => /^hand[LR]$/.test(t.bone)), c), handContactsByBone: p.name === 'steering-rim' ? Object.fromEntries(['handL', 'handR'].map(b => [b, contacts(humanTriangles.filter(t => t.bone === b), c)])) : {} });
    }
    for (const p of preserved)
        fit.preserved.push(contacts(humanTriangles, makeCollider(p)));
    // All remaining original local primitives are compared as actual SURFACES,
    // because several authored shell lofts are intentionally open, not closed solids.
    for (const p of car.capturedParts.filter(p => !SUPPRESSED.includes(p.userData.sourceRole) && !preserved.includes(p))) {
        const r = contacts(humanTriangles, makeCollider(p, { solid: false }), { clearanceCap: .01 });
        if (r.intersectingHumanTriangles || p.userData.sourcePartId < 3)
            fit.shell.push(r);
    }
    const eyes = [];
    human.scene.traverse(m => { if (!m.isSkinnedMesh)
        return; const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i++) {
        const rest = new T.Vector3().fromBufferAttribute(a, i);
        if (rest.y > 1.64 && rest.y < 1.70 && rest.z > .075 && Math.abs(rest.x) < .05) {
            const p = new T.Vector3();
            m.getVertexPosition(i, p);
            p.applyMatrix4(m.matrixWorld);
            eyes.push(p);
        }
    } });
    const posedBounds = new T.Box3();for(const t of humanTriangles)posedBounds.union(t.box);
    const eyeMean = eyes.reduce((a, p) => a.add(p), new T.Vector3()).multiplyScalar(1 / eyes.length);
    const morphState = [];
    human.scene.traverse(m => { if (m.isMesh && m.morphTargetInfluences)
        morphState.push({ mesh: m.name, dictionary: m.morphTargetDictionary, weights: m.morphTargetInfluences }); });
    const report = { lod, morphState, posedBoundsM: { min: posedBounds.min.toArray(), max: posedBounds.max.toArray() }, camera: { measuredEyeBandMeanRoadsterM: eyeMean.toArray(), sampledFaceVertices: eyes.length, originalNavigationEyeM: [.45, 1.2, 0], unchangedRuntime: true, migration: 'Explicit future integration required' }, status: 'measured', nonHandGeometryContactStatus: [...fit.candidate, ...fit.preserved, ...fit.shell].every(r => r.intersectingHumanTriangles === 0) ? 'pass' : 'fail', handGripStatus: fit.candidate.every(r => r.handPenetration.maximumSampledPenetrationM <= .003) && Object.values(fit.candidate.find(r => r.collider === 'steering-rim').handContactsByBone).every(r => r.minimumSeparationM <= .003) ? 'pass' : 'fail', handPenetrationLimitM: .003, sourceHuman: hp instanceof URL ? `tools/assets/citizen-character-variants/exports/driver-roadster-fit.lod${lod}.glb` : String(hp), sourceHumanSha256: sha(await fs.readFile(hp)), cockpitGlbSha256: sha(await fs.readFile(new URL(`exports/roadster-cockpit-local.lod${lod}.glb`, dir))), cockpitSpecSha256: sha(await fs.readFile(new URL('specs.json', dir))), characterTransform: specs.driver, scale: [1, 1, 1], triangleCount: humanTriangles.length, methods: 'Actual GLB morph weights evaluated BEFORE skinning; deformed triangles vs actual triangulated closed solids: edge-triangle crossings, closed-solid containment, triangle distance including edge/edge. Shell open surfaces: intersection only. Hands separated as intentional approximate contacts; no soft body or finger articulation.', ...fit };
    report.geometryContactStatus = report.nonHandGeometryContactStatus === 'pass' && report.handGripStatus === 'pass' ? 'pass' : 'fail';
    reports.push(report);
    await fs.writeFile(new URL(`qa/${process.argv.some(a => a.startsWith('--human=')) ? 'diagnostic-supported-' : 'driver-fit-'}lod${lod}.json`, dir), JSON.stringify(report, null, 2) + '\n');
    console.log('LOD', lod, report.geometryContactStatus, fit.candidate.map(r => [r.collider, r.intersectingHumanTriangles, r.minimumSeparationM]), fit.preserved.filter(r => r.intersectingHumanTriangles).map(r => [r.collider, r.intersectingHumanTriangles]), fit.shell.filter(r => r.intersectingHumanTriangles).map(r => [r.collider, r.intersectingHumanTriangles]));
}
await fs.writeFile(new URL('qa/driver-fit-summary.json', dir), JSON.stringify({ status: reports.every(r => r.geometryContactStatus === 'pass') ? 'pass' : 'fail', reports: reports.map(r => ({ lod: r.lod, status: r.geometryContactStatus, nonHandGeometry: r.nonHandGeometryContactStatus, handGrip: r.handGripStatus, triangles: r.triangleCount, activeMorphState: r.morphState })), limitations: ['Geometry-only static natural pose; not an ergonomic certification.', 'Driver backpack removed, torso reclined8degrees, seat assembly shifted+.265mZ; measured cushion minimum gap~4.95mm and backrest coat-normal gaps min~22.5mm/median~42.9mm remain a static visual support approximation, not physical contact or comfort certification.', 'Pedals, seat belts, entry/exit, steering animation, gameplay, WebGL and camera migration are not supplied.'] }, null, 2) + '\n');
if (reports.some(r => r.geometryContactStatus !== 'pass') && !process.argv.includes('--allow-failure'))
    process.exitCode = 1;
