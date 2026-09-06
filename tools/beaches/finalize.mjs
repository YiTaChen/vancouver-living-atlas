import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
const data=JSON.parse(readFileSync(new URL('../../work/beach-build/beach-coast.raw.json',import.meta.url)));
const source=readFileSync(new URL('../../lib/city/beach-surface.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {BeachSurfaceIndex}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const surface=new BeachSurfaceIndex(data.fixtures);
let missing=0;
for(let i=0;i<data.profilePositions.length;i+=3){
 const [x,raw,z]=data.profilePositions.slice(i,i+3),s=surface.sample(x,z,raw);
 if(!s){missing++;throw new Error(`Missing profile at ${x},${z}`);}
 data.profilePositions[i+1]=s.height;
}
// Float32 conversion matches the exact GPU vertices; height / collision read
// the same stored numbers, avoiding separate rounding paths at the coast.
function validTriangles(values){const f=Array.from(new Float32Array(values)),out=[];for(let i=0;i<f.length;i+=9){const area=(f[i+3]-f[i])*(f[i+8]-f[i+2])-(f[i+5]-f[i+2])*(f[i+6]-f[i]);if(Math.abs(area)>1e-9){const p=f.slice(i,i+9);if(area>0)out.push(...p.slice(0,3),...p.slice(6,9),...p.slice(3,6));else out.push(...p);}}return out;}
data.profilePositions=validTriangles(data.profilePositions);
data.outsidePositions=validTriangles(data.outsidePositions);
data.statistics.profileTriangles=data.profilePositions.length/9;
data.statistics.outsideTriangles=data.outsidePositions.length/9;
writeFileSync(new URL('../../work/beach-build/beach-coast.json',import.meta.url),JSON.stringify(data));
console.log(JSON.stringify({missing,...data.statistics,bytes:JSON.stringify(data).length}));
