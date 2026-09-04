import * as THREE from 'three';
import type {CityEngine} from './engine';
import {project,hash} from './geo';
export function makeContext(e:CityEngine){const d=e.data.contextTerrain;if(!d)return;const b=d.bounds,w=d.width,h=d.height,core=[-123.165,49.267,-123.095,49.315];
 const sample=(lon:number,lat:number)=>{const u=THREE.MathUtils.clamp((lon-b[0])/(b[2]-b[0])*(w-1),0,w-1),v=THREE.MathUtils.clamp((b[3]-lat)/(b[3]-b[1])*(h-1),0,h-1),i=Math.min(w-2,Math.floor(u)),j=Math.min(h-2,Math.floor(v)),a=u-i,c=v-j;return(d.heights[j*w+i]*(1-a)+d.heights[j*w+i+1]*a)*(1-c)+(d.heights[(j+1)*w+i]*(1-a)+d.heights[(j+1)*w+i+1]*a)*c;};
 const xs=Array.from({length:w},(_,i)=>b[0]+(b[2]-b[0])*i/(w-1)).concat([core[0],core[2]]).sort((a,c)=>a-c),zs=Array.from({length:h},(_,i)=>b[1]+(b[3]-b[1])*i/(h-1)).concat([core[1],core[3]]).sort((a,c)=>a-c);
 const pos:number[]=[],col:number[]=[];
 for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length-1;j++){const lon=(xs[i]+xs[i+1])/2,lat=(zs[j]+zs[j+1])/2;if(lon>core[0]&&lon<core[2]&&lat>core[1]&&lat<core[3])continue;if(sample(lon,lat)<1)continue;const verts=[[xs[i],zs[j]],[xs[i+1],zs[j]],[xs[i+1],zs[j+1]],[xs[i],zs[j]],[xs[i+1],zs[j+1]],[xs[i],zs[j+1]]];for(const c of verts){const[x,z]=project(c);let y=sample(c[0],c[1]);if((c[0]===core[0]||c[0]===core[2])&&c[1]>=core[1]&&c[1]<=core[3]||(c[1]===core[1]||c[1]===core[3])&&c[0]>=core[0]&&c[0]<=core[2])y=e.onLand(x,z)?e.elevation(x,z):0;pos.push(x,Math.max(0,y)-.5,z);const color=new THREE.Color(lat>49.32?0x416753:0x8f9b86).lerp(new THREE.Color(0x89968c),Math.max(0,y-750)/1500).multiplyScalar(.95+hash(i*421+j)*.06);col.push(color.r,color.g,color.b);}}
 const mesh=new THREE.Mesh(e.geometry(pos,undefined,col),new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;e.scene.add(mesh);
}
