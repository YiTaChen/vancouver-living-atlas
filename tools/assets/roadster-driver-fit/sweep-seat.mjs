import fs from 'node:fs/promises';
import * as T from 'three';
import { makeSource, readGlb, sha } from './adapters/cockpit-candidate.mjs';
import { meshTriangles, makeCollider, contacts } from './contact-kernel.mjs';
const file = process.argv[2] || new URL('../citizen-character-variants/exports/driver-roadster-fit.lod0.glb', import.meta.url), h = await readGlb(file), mixer = new T.AnimationMixer(h.scene);
mixer.clipAction(h.animations.find(a => a.name === 'driver-seated')).play();
mixer.setTime(.5);
h.scene.position.set(.44, 0, -.06);
h.scene.updateMatrixWorld(true);
const ht = [];
h.scene.traverse(m => { if (m.isSkinnedMesh)
    ht.push(...meshTriangles(m, true)); });
const source = await makeSource(), parts = source.capturedParts.filter(p => p.userData.sourceRole.startsWith('driver-seat-')), results = [];
for (const z of [.16, .18, .20, .22, .24, .25, .26, .27, .28, .30]) {
    const c = [];
    for (const p of parts) {
        p.position.z = z;
        p.updateMatrixWorld(true);
        c.push(contacts(ht, makeCollider(p), { clearanceCap: .15 }));
    }
    const result = { translationZ: z, intersections: c.reduce((s, r) => s + r.intersectingHumanTriangles, 0), parts: c };
    results.push(result);
    console.log(z, result.intersections, c.map(r => [r.collider, r.intersectingHumanTriangles, r.minimumSeparationM]));
}
await fs.writeFile(new URL('qa/driver-seat-sweep.json', import.meta.url), JSON.stringify({ humanFile: String(file), humanSha256: sha(await fs.readFile(file)), results }, null, 2) + '\n');
