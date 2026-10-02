import {readFile,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const loader=new GLTFLoader();loader.register(()=>({name:'CPU_QA',loadTexture:async()=>new THREE.Texture()}));
async function load(p){const b=await readFile(p);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const root=new URL('./',import.meta.url);const ref=await load(new URL('../../../../public/models/citizen/vancouver-citizen.glb',root));
const result=[];
for(const id of ['lod0','lod1','lod2']){
 const candidate=await load(new URL(`glb/citizen-${id}.glb`,root));
 const a=ref.scene.getObjectByProperty('type','SkinnedMesh'),b=candidate.scene.getObjectByProperty('type','SkinnedMesh');
 assert.deepEqual(a.skeleton.bones.map(x=>x.name),b.skeleton.bones.map(x=>x.name));
 assert.equal(b.geometry.attributes.uv.count,b.geometry.attributes.position.count);
 for(const name of ['position','normal','uv','skinWeight'])for(const v of b.geometry.attributes[name].array)assert.ok(Number.isFinite(v));
 let maxMatrixDifference=0;const clips=[];
 for(const name of ['idle','walk','run']){
  const ac=ref.animations.find(x=>x.name===name),bc=candidate.animations.find(x=>x.name===name);assert.ok(bc);assert.ok(Math.abs(ac.duration-bc.duration)<1e-5);
  const am=new THREE.AnimationMixer(ref.scene),bm=new THREE.AnimationMixer(candidate.scene);am.clipAction(ac).play();bm.clipAction(bc).play();
  for(let i=0;i<40;i++){
   am.setTime(ac.duration*i/40);bm.setTime(ac.duration*i/40);ref.scene.updateMatrixWorld(true);candidate.scene.updateMatrixWorld(true);
   for(let j=0;j<a.skeleton.bones.length;j++)for(let k=0;k<16;k++)maxMatrixDifference=Math.max(maxMatrixDifference,Math.abs(a.skeleton.bones[j].matrixWorld.elements[k]-b.skeleton.bones[j].matrixWorld.elements[k]));
  }am.stopAllAction();bm.stopAllAction();clips.push({name,duration:bc.duration,samples:40});
 }assert.ok(maxMatrixDifference<.0001,`${id} bone matrix drift ${maxMatrixDifference}`);
 result.push({id,boneOrderIdentical:true,maxMatrixDifference,clips,finiteAttributes:true,uvPerVertex:true});
}
await writeFile(new URL('qa/rig-comparison.json',root),JSON.stringify(result,null,2));console.log(result);
