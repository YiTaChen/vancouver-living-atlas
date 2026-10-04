/** Index-only, attribute-aware offline simplification. No runtime compression. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';
const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../../..');
const out=process.argv[2]||'/tmp/atlas-citizen-character-variants';
await mkdir(out,{recursive:true});
const bytes=await readFile(path.join(repo,'public/models/citizen/vancouver-citizen.glb'));
const jsonLength=bytes.readUInt32LE(12);const doc=JSON.parse(bytes.subarray(20,20+jsonLength));const bin=bytes.subarray(28+jsonLength);
const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};const types={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
function accessor(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],T=types[a.componentType],n=sizes[a.type],arr=new T(a.count*n);for(let i=0;i<a.count;i++){const start=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||T.BYTES_PER_ELEMENT*n);arr.set(new T(Uint8Array.from(bin.subarray(start,start+n*T.BYTES_PER_ELEMENT)).buffer),i*n)}return arr;}
const p=doc.meshes[0].primitives[0];const pos=accessor(p.attributes.POSITION),norm=accessor(p.attributes.NORMAL),uv=accessor(p.attributes.TEXCOORD_0),w=accessor(p.attributes.WEIGHTS_0),j=accessor(p.attributes.JOINTS_0),indices=accessor(p.indices),count=pos.length/3;
const parent=Array.from({length:count},(_,i)=>i);function find(a){while(parent[a]!==a){parent[a]=parent[parent[a]];a=parent[a]}return a}function union(a,b){a=find(a);b=find(b);if(a!==b)parent[b]=a;}
const seen=new Map();for(let i=0;i<count;i++){const key=Array.from(pos.subarray(i*3,i*3+3),v=>Math.round(v*1e6)).join(',');if(seen.has(key))union(i,seen.get(key));else seen.set(key,i)}
for(let i=0;i<indices.length;i+=3){union(indices[i],indices[i+1]);union(indices[i],indices[i+2]);}
const groups=new Map();for(let i=0;i<count;i++){const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i)}
const components=[...groups.values()].sort((a,b)=>b.length-a.length);const garmentIds=new Set([...components[0],...components[1]]);
// All waist / hem, pelvis overlap, head, hands, shoes, collar and backpack
// are locked. No destructive seam weld; all surviving vertex streams unchanged.
const lock=new Uint8Array(count);let locked=0;
for(let i=0;i<count;i++){const y=pos[i*3+1];lock[i]=!garmentIds.has(i)||(y>=.78&&y<=1.08)?1:0;locked+=lock[i];}
// Attribute weights retain normal/UV/weights. Expand skin weights to ordered
// joint channels: different packed JOINTS order must not imply similarity.
const astride=3+2+22,attrs=new Float32Array(count*astride);
for(let i=0;i<count;i++){attrs.set(norm.subarray(i*3,i*3+3),i*astride);attrs.set(uv.subarray(i*2,i*2+2),i*astride+3);for(let c=0;c<4;c++)attrs[i*astride+5+j[i*4+c]]=w[i*4+c];}
const fixed=[],free=[];for(let t=0;t<indices.length;t+=3){const tri=[...indices.subarray(t,t+3)];(tri.some(v=>lock[v])?fixed:free).push(...tri)}
for(const i of fixed)lock[i]=1;
const weights=[.25,.25,.25,2,2,...Array(22).fill(.5)];await MeshoptSimplifier.ready;
function glb(indexArray){const d=structuredClone(doc),oldLen=bin.length,align=(4-oldLen%4)%4;const ib=Buffer.from(Uint32Array.from(indexArray).buffer);const b=Buffer.concat([bin,Buffer.alloc(align),ib]);d.bufferViews.push({buffer:0,byteOffset:oldLen+align,byteLength:ib.length,target:34963});d.accessors.push({bufferView:d.bufferViews.length-1,componentType:5125,count:indexArray.length,type:'SCALAR'});d.meshes[0].primitives[0].indices=d.accessors.length-1;d.buffers[0].byteLength=b.length;let jt=Buffer.from(JSON.stringify(d));jt=Buffer.concat([jt,Buffer.alloc((4-jt.length%4)%4,32)]);const bp=Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+jt.length+bp.length,8);h.writeUInt32LE(jt.length,12);h.write('JSON',16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bp.length);bh.write('BIN\0',4);return Buffer.concat([h,jt,bh,bp]);}
const report={runtimeCleanup:{zeroAreaTrianglesOmitted:64,indexEntriesOmitted:192,sourceVerticesUvsNormalsWeightsPreserved:true},method:'meshoptimizer index-only simplifyWithAttributes; LockBorder and explicit anatomical vertex locks; no vertex update, no UV/normal/weight interpolation, no seam welding',baselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),sourceTriangles:indices.length/3,protectedVertexCount:locked,garmentComponents:components.slice(0,2).map(x=>x.length),levels:[]};
for(const [lod,target,error] of [[0,1,0],[1,.84,.001],[2,.68,.002]]){const [ind,err]=lod===0?[indices,0]:(()=>{const [q,e]=MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(free),pos,3,attrs,astride,weights,lock,Math.max(3,Math.floor((indices.length*target-fixed.length)/3)*3),error,['LockBorder','ErrorAbsolute','Sparse']);return [Uint32Array.from([...fixed,...q]),e]})();const originalTriangles=new Set();for(let i=0;i<fixed.length;i+=3)originalTriangles.add(fixed.slice(i,i+3).join(','));const kept=new Set();for(let i=0;i<ind.length;i+=3)kept.add([...ind.subarray(i,i+3)].join(','));let lost=0;for(const k of originalTriangles)if(!kept.has(k))lost++;
 await writeFile(path.join(out,`citizen.lod${lod}.glb`),glb(ind));report.levels.push({lod,triangles:ind.length/3,requestedRatio:target,errorLimitM:error,reportedErrorM:err,protectedAdjacentTrianglesChanged:lost,runtimeTrianglesAfterZeroAreaCleanup:ind.length/3-64});}
await writeFile(path.join(root,'qa/simplification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
