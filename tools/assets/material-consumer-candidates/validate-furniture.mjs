import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {PACKAGE,loader} from './adapters/harness.mjs';
import {furnitureReplacementPlan,checkFurnitureFit} from './adapters/furniture-plan.mjs';
const {PublicInteriors}=await loader(false)('interiors');
const e={renderer:{},landmarks:new THREE.Group(),landmarkDetails:[],data:{},elevation:()=>3,camera:new THREE.PerspectiveCamera(),settings:{buildings:true,mode:'walk'}};
const i=new PublicInteriors(e),plan=furnitureReplacementPlan(i.sites),manifest=JSON.parse(readFileSync(PACKAGE+'/manifest.json'));
assert.equal(plan.placements.filter(p=>p.assetId==='lecture-chair-module').length,54);assert.equal(plan.placements.filter(p=>p.assetId==='admissions-counter-module').length,4);
const results=[];
for(const level of [0,1]){const b=Object.fromEntries(manifest.assets.map(a=>[a.id,a.lods.find(l=>l.level===level).boundsM]));results.push({level,...checkFurnitureFit(plan,b)});}
const bad=structuredClone(plan);bad.placements[0].translationM[0]+=.1;
assert.throws(()=>checkFurnitureFit(bad,Object.fromEntries(manifest.assets.map(a=>[a.id,a.boundsM]))),/escapes/);
const sites=i.sites.map(s=>({...s,obstacles:s.obstacles.map(o=>({...o}))}));sites[1].obstacles.find(o=>o.w===.65).w=.66;assert.throws(()=>furnitureReplacementPlan(sites),/drift/);
writeFileSync(PACKAGE+'/qa/furniture-replacement-plan.json',JSON.stringify(plan,null,2)+'\n');
writeFileSync(PACKAGE+'/qa/furniture-fit.json',JSON.stringify({status:'pass',results,negativeTests:['escaped collision footprint rejected','changed source obstacle rejected'],runtimeIntegration:'not_run; no visual replacement or collision edits applied'},null,2)+'\n');
console.log('Furniture fit passes 58 source-selected placements × 2 LODs; no collision expansion.');
