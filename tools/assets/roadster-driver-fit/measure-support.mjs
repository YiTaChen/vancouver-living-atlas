import * as T from 'three';
import { readGlb, makeSource } from './adapters/cockpit-candidate.mjs';
const hp = process.argv[2] || new URL('../citizen-character-variants/exports/driver-roadster-fit.lod0.glb', import.meta.url), h = await readGlb(hp), mixer = new T.AnimationMixer(h.scene);
mixer.clipAction(h.animations.find(a => a.name === 'driver-seated')).play();
mixer.setTime(.5);
h.scene.position.set(.44, 0, -.06);
h.scene.updateMatrixWorld(true);
const car = await makeSource(), back = car.capturedParts.find(p => p.name === 'driver-seat-back/040');
back.position.z = Number(process.argv[3] || 0);
back.updateMatrixWorld(true);
back.material = back.material.clone();
back.material.side = T.DoubleSide;
const results = [];
const cushion = car.capturedParts.find(p => p.name === 'driver-seat-cushion/039');
cushion.position.z = Number(process.argv[3] || 0);
cushion.updateMatrixWorld(true);
const pelvis = [];
h.scene.traverse(m => { if (!m.isSkinnedMesh)
    return; m.skeleton.update(); const a = m.geometry.attributes; for (let i = 0; i < a.position.count; i++) {
    const rest = new T.Vector3().fromBufferAttribute(a.position, i);
    if (rest.y < .78 || rest.y > .96 || Math.abs(rest.x) > .17)
        continue;
    const v = rest.clone();
    m.applyBoneTransform(i, v).applyMatrix4(m.matrixWorld);
    if (v.y > .68)
        continue;
    const ray = new T.Raycaster(new T.Vector3(v.x, 1.5, v.z), new T.Vector3(0, -1, 0));
    const hit = ray.intersectObject(cushion, false)[0];
    pelvis.push({ point: v.toArray(), cushionY: hit?.point.y, gap: hit ? v.y - hit.point.y : null });
} const idx = m.geometry.index, n = a.position.count, parent = Array.from({ length: n }, (_, i) => i), seen = new Map(); const find = i => { while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
} return i; }; const union = (a, b) => parent[find(a)] = find(b); for (let i = 0; i < n; i++) {
    const k = [a.position.getX(i), a.position.getY(i), a.position.getZ(i)].map(v => v.toFixed(6)).join(',');
    if (seen.has(k))
        union(i, seen.get(k));
    else
        seen.set(k, i);
} for (let i = 0; i < idx.count; i += 3) {
    union(idx.getX(i), idx.getX(i + 1));
    union(idx.getX(i), idx.getX(i + 2));
} const cs = new Map(); for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!cs.has(r))
        cs.set(r, []);
    cs.get(r).push(i);
} for (const ids of cs.values()) {
    const rest = ids.map(i => new T.Vector3().fromBufferAttribute(a.position, i)), box = new T.Box3().setFromPoints(rest), size = box.getSize(new T.Vector3());
    const coat = box.min.y > .82 && box.min.y < .85 && box.max.y > 1.46 && size.x > .70;
    const bag = box.min.y > .95 && box.max.y > 1.1 && box.max.z < -.09;
    if (!coat && !bag)
        continue;
    const samples = [];
    for (const i of ids) {
        const p = new T.Vector3().fromBufferAttribute(a.position, i);
        if (Math.abs(p.x) > .11 || p.y < 1.0 || p.y > 1.39 || p.z > -.075)
            continue;
        m.applyBoneTransform(i, p).applyMatrix4(m.matrixWorld);
        if (p.y < .72 || p.y > 1.14)
            continue;
        const ray = new T.Raycaster(p, new T.Vector3(0, 0, -1));
        const hit = ray.intersectObject(back, false)[0];
        if (hit)
            samples.push({ normalSeparation: Math.abs(p.clone().sub(hit.point).dot(hit.face.normal.clone().transformDirection(back.matrixWorld))), distance: hit.distance, bodyPoint: p.toArray(), backrestPoint: hit.point.toArray() });
    }
    samples.sort((a, b) => a.distance - b.distance);
    results.push({ role: coat ? 'coat-torso-back' : 'backpack-component', restBounds: { min: box.min.toArray(), max: box.max.toArray() }, sampleCount: samples.length, gapMinM: samples[0]?.distance, gapMedianM: samples[Math.floor(samples.length / 2)]?.distance, normalGapMinM: Math.min(...samples.map(s => s.normalSeparation)), normalGapMedianM: samples.length ? samples.map(s => s.normalSeparation).sort((a, b) => a - b)[Math.floor(samples.length / 2)] : null, gapMaxM: samples.at(-1)?.distance, nearest: samples[0] });
} });
console.log(JSON.stringify({ seatTranslationM: [0, 0, Number(process.argv[3] || 0)], pelvisSupport: { selection: 'Rest pelvis/proximal thigh Y .78–.96, |X|<.17; posed lower surface Y<=.68', pointCount: pelvis.length, overCushion: pelvis.filter(p => p.gap !== null).length, closest: pelvis.filter(p => p.gap !== null).sort((a, b) => a.gap - b.gap).slice(0, 5), posedBounds: { min: [0, 1, 2].map(k => Math.min(...pelvis.map(p => p.point[k]))), max: [0, 1, 2].map(k => Math.max(...pelvis.map(p => p.point[k]))) }, hipBoneRoadsterM: [.44, .72, -.06], originalCushionCenter: [.44, .53, -.21], candidateCushionCenter: [.44,.53,-.21+Number(process.argv[3]||0)], cushionPlanRadii: [.275, .32] }, method: 'Ray from selected actual posterior coat/backpack vertices toward -Z to exact original driver backrest triangulation; no AABB proxy', results }, null, 2));
