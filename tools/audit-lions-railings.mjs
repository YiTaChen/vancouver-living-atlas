import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createFixture} from './causeway-cpu.mjs';
const {e,nav}=createFixture();
const report={valid:true,sides:[]};
for(const [side,id] of [['east',70954668],['west',70954672]]) {
 const spans=e.data.lionsRailingSpans.filter(s=>s.side===side);
 const source=e.data.causewayPathSegments.filter(s=>s.sourceId===id);
 const sourceLength=source.reduce((n,s)=>n+s.s1-s.s0,0);
 const railLength=spans.reduce((n,s)=>n+s.s1-s.s0,0);
 const gaps=[];let maxJoinError=0;
 for(let i=1;i<spans.length;i++) {
  const a=spans[i-1],b=spans[i],gap=b.s0-a.s1;
  if(gap>1e-5)gaps.push(gap);
  else maxJoinError=Math.max(maxJoinError,Math.hypot(...a.b.map((v,k)=>v-b.a[k])));
 }
 assert(maxJoinError<.001);
 assert.equal(gaps.length,side==='west'?2:0);
 assert(side==='west'?sourceLength-railLength<12.1:Math.abs(sourceLength-railLength)<1e-5);
 report.sides.push({side,sourceLength,railLength,gaps,maxJoinError,spans:spans.length});
}
let triangles=0,batches=0;
e.roads.traverse(m=>{if(m.name.startsWith('Lions Gate outer pedestrian railing')){triangles+=m.geometry.getAttribute('position').count/3;batches++;}});
Object.assign(report,{triangles,batches});
const i=process.argv.indexOf('--output');if(i>=0)fs.writeFileSync(process.argv[i+1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));nav.destroy();
