/** Development probe against actual optional cockpit rim; full acceptance belongs
 * to roadster-driver-fit's all-solid checker and independent review. */
import fs from 'node:fs/promises';
import * as T from 'three';
import { readGlb, sha } from '../roadster-driver-fit/adapters/cockpit-candidate.mjs';
import { meshTriangles, makeCollider, contacts, penetrationSamples } from '../roadster-driver-fit/contact-kernel.mjs';
const root=new URL('./',import.meta.url),results=[];
for(const lod of [0,1,2]){
 const hp=new URL(`exports/driver-roadster-fit.lod${lod}.glb`,root);const human=await readGlb(hp);const mixer=new T.AnimationMixer(human.scene);mixer.clipAction(human.animations.find(a=>a.name==='driver-seated')).play();mixer.setTime(.5);human.scene.position.set(.44,0,-.06);human.scene.updateMatrixWorld(true);
 const hands=[];human.scene.traverse(m=>{if(m.isSkinnedMesh)hands.push(...meshTriangles(m,true).filter(t=>/^hand[LR]$/.test(t.bone)))});
 const cockpit=await readGlb(new URL(`../roadster-driver-fit/exports/roadster-cockpit-local.lod${lod}.glb`,root));cockpit.scene.updateMatrixWorld(true);const rim=cockpit.scene.getObjectByName('steering-rim');if(!rim)throw new Error('Missing actual rim');const collider=makeCollider(rim),depth=penetrationSamples(hands,collider),byHand=Object.fromEntries(['handL','handR'].map(b=>[b,contacts(hands.filter(t=>t.bone===b),collider)]));results.push({lod,sourceSha256:sha(await fs.readFile(hp)),maximumDepthM:depth.maximumSampledPenetrationM,depth,byHand});
 console.log(lod,'max depth',depth.maximumSampledPenetrationM,'gaps',Object.values(byHand).map(h=>h.minimumSeparationM));
}
await fs.writeFile(new URL('qa/grip-probe.json',root),JSON.stringify({status:results.every(r=>r.maximumDepthM<=.003&&Object.values(r.byHand).every(h=>h.minimumSeparationM<=.003))?'pass':'fail',scope:'hand/rim only; exact optional-cockpit helper reused, not an independent full-cabin audit',results},null,2)+'\n');
