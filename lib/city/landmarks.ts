import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {project,hash} from './geo';
import type {CityEngine} from './engine';

// All landmark meshes below are original parametric geometry. Dimensions and
// coordinates come from primary architectural references and public map data.
class Builder {
 groups=new Map<string,{material:THREE.MeshStandardMaterial;geometries:THREE.BufferGeometry[]}>();
 origin=new THREE.Vector3();yaw=0;
 constructor(public engine:CityEngine){}
 at(lon:number,lat:number,yaw=0,base?:number){const [x,z]=project([lon,lat]);this.origin.set(x,base??this.engine.elevation(x,z),z);this.yaw=yaw;return this;}
 add(g:THREE.BufferGeometry,color:number,x=0,y=0,z=0,rot?:THREE.Euler,metal=.1){const local=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(rot||new THREE.Euler()),new THREE.Vector3(1,1,1)),world=new THREE.Matrix4().makeRotationY(this.yaw);world.setPosition(this.origin);g.applyMatrix4(world.multiply(local));g.deleteAttribute('uv');g=g.index?g.toNonIndexed():g;const key=color+':'+metal;if(!this.groups.has(key))this.groups.set(key,{material:new THREE.MeshStandardMaterial({color,metalness:metal,roughness:metal>.3?.3:.78}),geometries:[]});this.groups.get(key)!.geometries.push(g);}
 box(w:number,h:number,d:number,color:number,x=0,y=0,z=0){this.add(new THREE.BoxGeometry(w,h,d),color,x,y,z);}
 cylinder(rt:number,rb:number,h:number,color:number,x=0,y=0,z=0,segments=24){this.add(new THREE.CylinderGeometry(rt,rb,h,segments),color,x,y,z);}
 beam(a:THREE.Vector3,b:THREE.Vector3,r:number,color:number){const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());this.add(new THREE.CylinderGeometry(r,r,a.distanceTo(b),6),color,...a.clone().lerp(b,.5).toArray() as [number,number,number],new THREE.Euler().setFromQuaternion(q));}
 finish(){for(const{material,geometries}of this.groups.values()){const merged=mergeGeometries(geometries);if(!merged)continue;const m=new THREE.Mesh(merged,material);m.castShadow=true;m.receiveShadow=true;this.engine.landmarks.add(m);geometries.forEach(g=>g.dispose());}}
}
export function createLandmarks(engine:CityEngine){const b=new Builder(engine),white=0xe8e4d7,glass=0x456d79,steel=0x7a9390;
 // Science World: 40 m geodesic sphere above a low, tiered waterfront pavilion.
 b.at(-123.1039114,49.2733499,0,3.4);
 b.cylinder(45,46,2.2,0x9a9b90,10,1,0,48);b.cylinder(34,36,7,0xa09e94,8,5.2,0,48);b.cylinder(31,31,2,0x507779,8,8.5,0,48);b.cylinder(31.8,31.8,.75,white,8,10.1,0,48);b.cylinder(14.5,16,6,0x833e36,0,12,0);
 const sphere=new THREE.IcosahedronGeometry(20,3);b.add(sphere.clone(),0xa3bcc2,0,30,0,undefined,.75);
 const edges=new THREE.EdgesGeometry(sphere,1),ep=edges.attributes.position;
 for(let i=0;i<ep.count;i+=2)b.beam(new THREE.Vector3(ep.getX(i),ep.getY(i)+30,ep.getZ(i)),new THREE.Vector3(ep.getX(i+1),ep.getY(i+1)+30,ep.getZ(i+1)),.16,0xd6d8cb);
 for(let a=0;a<Math.PI*2;a+=Math.PI/14)b.box(1.2,8,1.2,white,Math.cos(a)*32,5,Math.sin(a)*32);
 b.box(57,1,26,0xb2aa91,57,.8,-13);b.box(13,5,42,glass,37,4,-23);
 // BC Place: elliptical bowl, 36 roof masts and radial tension cables.
 b.at(-123.1120067,49.2766985,.677,5);
 const bowl=new THREE.CylinderGeometry(1,1,31,72,1,true);bowl.scale(113,1,92);b.add(bowl,0xa4aaa4,0,17,0);const ring=new THREE.RingGeometry(.49,1,96,1);ring.rotateX(-Math.PI/2);ring.scale(116,1,96);b.add(ring,white,0,43,0);
 const field=new THREE.PlaneGeometry(100,67);field.rotateX(-Math.PI/2);b.add(field,0x407454,0,4,0);
 for(let i=0;i<36;i++){const a=i/36*Math.PI*2,x=Math.cos(a)*114,z=Math.sin(a)*94;b.beam(new THREE.Vector3(x*.96,19,z*.96),new THREE.Vector3(x*1.04,64,z*1.04),.72,white);b.beam(new THREE.Vector3(x*1.04,64,z*1.04),new THREE.Vector3(Math.cos(a)*56,43,Math.sin(a)*44),.23,steel);b.beam(new THREE.Vector3(x,38,z),new THREE.Vector3(Math.cos(a)*56,43,Math.sin(a)*44),.27,white);}
 for(let i=0;i<72;i++){const a=i/72*Math.PI*2;b.box(2,24,2,0xd0d2ca,Math.cos(a)*112,19,Math.sin(a)*92);}
 // Canada Place: five tensile sail roofs aligned along the actual pier.
 b.at(-123.111352,49.2886214,-1.073,3.5);b.box(96,5,502,0xaaa99c,0,0,0);b.box(67,17,270,0xafb6b0,0,12,-37);b.box(68,5,280,0xeee8d5,0,21,-37);
 for(let i=0;i<5;i++){const z=-148+i*50,vertices:number[]=[];const N=16;
  const pt=(u:number,v:number)=>{const peak=20*Math.pow(1-Math.abs(u),.65)*(1-Math.abs(v)*.55)+8*Math.abs(v);return new THREE.Vector3(u*33,26+peak,z+v*24);};
  for(let u=0;u<N;u++)for(let v=0;v<N;v++){const a=pt(u/N*2-1,v/N*2-1),c=pt((u+1)/N*2-1,v/N*2-1),d=pt((u+1)/N*2-1,(v+1)/N*2-1),e=pt(u/N*2-1,(v+1)/N*2-1);for(const p of[a,d,c,a,e,d])vertices.push(...p.toArray());}
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();b.add(g,0xf3f0df);
  b.beam(new THREE.Vector3(0,24,z),new THREE.Vector3(0,55,z),.48,white);for(const s of[-1,1]){b.beam(new THREE.Vector3(0,55,z),new THREE.Vector3(s*34,25,z+24),.16,steel);b.beam(new THREE.Vector3(0,55,z),new THREE.Vector3(s*34,25,z-24),.16,steel);}
 }
 b.box(76,75,83,glass,0,42,175);for(let j=0;j<24;j++)b.box(78,.65,85,0xc0c7be,0,8+j*3.1,175);
 // Vancouver Convention Centre living roof, incl the roof's westward slope.
 b.at(-123.1159678,49.2890752,-.403,4);b.box(200,22,138,0x3c666e,0,12,0);b.box(204,3,143,0x647d4b,0,24,0);for(let x=-95;x<=95;x+=12)b.box(.5,21,140,0xb2beb6,x,12,0);
 // Harbour Centre: rectilinear office shaft and layered revolving lookout.
 b.at(-123.1120903,49.2847656,-.8);b.box(62,21,71,0xa8a390,0,10.5,0);b.box(35,116,37,0x8b9290,0,58,0);for(let y=4;y<116;y+=3.3)b.box(36,.7,38,0xc9c8b8,0,y,0);for(let x=-14;x<17;x+=7)b.box(.7,111,38,white,x,58,0);
 b.at(-123.112215,49.284683);b.cylinder(6.7,6.7,12,0x8f9b96,0,122,0);b.cylinder(15,7,8,0xc9cebf,0,132,0);b.cylinder(17.2,15,8,glass,0,140,0);b.cylinder(19.3,19.3,3.5,white,0,146,0);b.cylinder(9.2,17,8,0xbec4b8,0,152,0);b.cylinder(.45,.7,21,white,0,166.5,0);
 // Vancouver House: widening upper floors and a white balcony lattice.
 b.at(-123.131029,49.2749256,-.78);b.box(49,25,49,glass,0,12.5,0);
 for(let i=0;i<49;i++){const t=i/48,width=15+29*Math.pow(t,.55),shift=(1-t)*11,y=i*3.2; b.box(width,2.65,34,glass,shift,y+1.35,0);b.box(width+1.8,.5,36.5,white,shift,y+3,0);for(let x=-width/2;x<width/2;x+=5.5){b.box(.38,3.2,.5,white,x+shift,y+1.6,-18);b.box(.38,3.2,.5,white,x+shift,y+1.6,18);}}
 // Burrard, Granville, and Cambie: bridge decks follow actual endpoints.
 bridge(b,engine,[-123.13392,49.27759],[-123.1374,49.27147],24,'burrard');
 bridge(b,engine,[-123.1301,49.27599],[-123.13539,49.26824],29,'granville');
 bridge(b,engine,[-123.1147,49.2753],[-123.11517,49.2669],19,'cambie');
 // Lions Gate suspension span extends to the northern edge of the study.
 bridge(b,engine,[-123.1408,49.3105],[-123.1330,49.3181],63,'lions');
 // Siwash Rock, the outcrop off Stanley Park's western cliffs.
 b.at(-123.15987,49.30552,0,0);b.cylinder(4.2,9.5,17,0x756d5b,0,8.5,0,7);b.cylinder(4,4.8,1.4,0x56713b,0,17.5,0,7);b.cylinder(0,3.6,9,0x2d523f,0,22,0,6);
 b.finish();
}
function bridge(b:Builder,e:CityEngine,a:number[],c:number[],deck:number,kind:string){const p=project(a),q=project(c),length=Math.hypot(q[0]-p[0],q[1]-p[1]),yaw=Math.atan2(q[0]-p[0],q[1]-p[1]);const center=[(a[0]+c[0])/2,(a[1]+c[1])/2];b.at(center[0],center[1],yaw,0);const width=kind==='lions'?20:kind==='granville'?27:25,color=kind==='lions'?0x486e5e:0xb3b2a2;
 b.box(width,3.2,length,color,0,deck,0);b.box(width-3,.3,length,0x566668,0,deck+1.8,0);b.box(.45,1.3,length,0xe0daca,-width/2,deck+2.3,0);b.box(.45,1.3,length,0xe0daca,width/2,deck+2.3,0);
 for(let z=-length/2+14;z<length/2;z+=18)b.box(.35,.08,8,0xe4d6a1,0,deck+2,z);
 if(kind==='lions'){
  for(const z of[-236,236])for(const x of[-10.8,10.8]){b.box(3.4,111,4,color,x,74,z);for(let y=48;y<127;y+=18){b.box(23,2,2,color,0,y,z);b.beam(new THREE.Vector3(-10,y,z),new THREE.Vector3(10,y+18,z),.6,color);}}
  for(const x of[-10.5,10.5]){for(let section=0;section<3;section++){const start=section===0?-length/2:section===1?-236:236,end=section===0?-236:section===1?236:length/2;const points:THREE.Vector3[]=[];for(let i=0;i<=40;i++){const z=start+(end-start)*i/40,t=(z+236)/472;let y=section===1?deck+10+52*Math.pow((t-.5)*2,2):section===0?65+61*(i/40):126-61*(i/40);points.push(new THREE.Vector3(x,y,z));if(i%2===0)b.beam(new THREE.Vector3(x,deck+2,z),new THREE.Vector3(x,y,z),.21,0x4f7568);}for(let i=0;i<points.length-1;i++)b.beam(points[i],points[i+1],.52,color);}}
 }else{
  for(let z=-length/2+80;z<length/2;z+=kind==='burrard'?140:95){for(const x of[-width*.3,width*.3])b.box(4.5,deck-3,6,color,x,(deck-3)/2,z);b.box(width,3,11,color,0,deck-4,z);}
  if(kind==='burrard')for(const z of[-length*.2,length*.2]){for(const x of[-width/2,width/2]){b.box(5,30,7,0xc0b69c,x,deck+11,z);b.box(7,3,9,0xd7ccaa,x,deck+26,z);}b.box(width,5,6,0xbfb497,0,deck+22,z);}
 }
}
