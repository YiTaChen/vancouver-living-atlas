import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Delaunator from 'delaunator';
import { project,unproject,rings,lines,inPolygon,hash } from './geo';
import { VIEWS,DEFAULT_SETTINGS,type FeatureCollection,type Feature,type Settings,type SceneStats,type Viewpoint } from './types';

export class CityEngine {
 scene=new THREE.Scene(); camera:THREE.PerspectiveCamera; renderer:THREE.WebGLRenderer; controls:OrbitControls;
 buildings=new THREE.Group(); vegetation=new THREE.Group(); roads=new THREE.Group(); terrain=new THREE.Group(); landmarks=new THREE.Group();
 settings={...DEFAULT_SETTINGS}; stats:SceneStats={buildings:0,trees:0,roads:0,fps:0,elevation:0,distance:0};
 data:Record<string,any>={}; landPolys:number[][][][]=[]; parkPolys:{name:string;poly:number[][][]}[]=[];
 sun=new THREE.DirectionalLight(0xffecd0,3); ambient=new THREE.HemisphereLight(0xc9e7ff,0x66746b,2.2);
 water!:THREE.Mesh; uniforms={night:{value:0},time:{value:0}}; disposed=false; frame=0; resizeObserver:ResizeObserver; lastTime=0; fpsAt=0; frames=0;
 transition:null|{start:number;duration:number;from:THREE.Vector3;to:THREE.Vector3;fromTarget:THREE.Vector3;toTarget:THREE.Vector3}=null;
 onStats:(s:SceneStats)=>void; onReady:()=>void; onError:(s:string)=>void; raf=0;
 constructor(public container:HTMLElement,onStats:(s:SceneStats)=>void,onReady:()=>void,onError:(s:string)=>void) {
  this.onStats=onStats;this.onReady=onReady;this.onError=onError;
  this.camera=new THREE.PerspectiveCamera(42,1,2,45000);
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.65));this.renderer.setSize(container.clientWidth,container.clientHeight);
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.13;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.renderer.domElement.setAttribute('aria-label','可互動的溫哥華 3D 地圖。拖曳旋轉、滾輪縮放、右鍵平移。');this.renderer.domElement.tabIndex=0;
  container.appendChild(this.renderer.domElement);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.minDistance=28;this.controls.maxDistance=12500;this.controls.maxPolarAngle=Math.PI*.485;this.controls.screenSpacePanning=false;this.controls.zoomSpeed=.75;this.controls.rotateSpeed=.65;
  this.controls.addEventListener('start',()=>{this.transition=null;});
  const pmrem=new THREE.PMREMGenerator(this.renderer);const room=new RoomEnvironment();this.scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
  this.scene.add(this.ambient,this.sun,this.buildings,this.vegetation,this.roads,this.terrain,this.landmarks);
  this.sun.position.set(-2500,3600,1400);this.sun.castShadow=true;Object.assign(this.sun.shadow.camera,{left:-2700,right:2700,top:2700,bottom:-2700,near:100,far:9500});this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0002;this.sun.shadow.normalBias=1.2;this.scene.add(this.sun.target);
  this.scene.background=new THREE.Color(0xbdd9e3);this.scene.fog=new THREE.FogExp2(0xbdd9e3,.000027);
  this.flyTo('overview',false);
  this.resizeObserver=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);});this.resizeObserver.observe(container);
  this.load().catch(e=>{if(!this.disposed)this.onError(String(e.message||e));});
 }
 async load() {
  const names=['buildings','roads','parks','land'];
  await Promise.all(names.map(async n=>{const res=await fetch(`/data/${n}.geojson`);if(!res.ok)throw new Error(`無法載入 ${n} 地理資料 (${res.status})`);this.data[n]=await res.json();}));
  const t=await fetch('/data/terrain.json');if(t.ok)this.data.elevation=await t.json();
  if(this.disposed)return;
  this.landPolys=this.data.land.features.flatMap((f:Feature)=>rings(f).map(p=>p.map(r=>r.map(project))));
  this.parkPolys=this.data.parks.features.flatMap((f:Feature)=>rings(f).map(p=>({name:f.properties.name||f.properties.park_name||'',poly:p.map(r=>r.map(project))})));
  this.makeWater();this.makeLand();this.makeParks();this.makeBuildings();this.makeRoads();
  this.applySettings(this.settings);this.onReady();this.animate(0);
 }
 elevation(x:number,z:number):number {
  const d=this.data.elevation;if(!d)return 8;
  const c=unproject(x,z); const b=d.bbox||d.bounds; const w=d.width||d.cols,n=d.height||d.rows;const values=d.heights||d.elevations||d.data||d.values;
  if(!b||!values||!w||!n)return 8;
  const u=THREE.MathUtils.clamp((c[0]-b[0])/(b[2]-b[0])*(w-1),0,w-1),v=THREE.MathUtils.clamp((b[3]-c[1])/(b[3]-b[1])*(n-1),0,n-1);
  const i=Math.min(w-2,Math.floor(u)),j=Math.min(n-2,Math.floor(v)),a=u-i,bv=v-j;
  const at=(xx:number,yy:number)=>Array.isArray(values[yy])?values[yy][xx]:values[yy*w+xx];
  return Math.max(1.2,(at(i,j)*(1-a)+at(i+1,j)*a)*(1-bv)+(at(i,j+1)*(1-a)+at(i+1,j+1)*a)*bv);
 }
 onLand(x:number,z:number) { return this.landPolys.some(p=>inPolygon([x,z],p)); }
 geometry(pos:number[],normals?:number[],colors?:number[],uvs?:number[]) {const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));if(normals)g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));else g.computeVertexNormals();if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));return g;}
 makeWater() {
  const mat=new THREE.MeshStandardMaterial({color:0x238b9f,roughness:.32,metalness:.45});
  mat.onBeforeCompile=s=>{s.uniforms.uTime=this.uniforms.time;s.vertexShader='varying vec3 vWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvWorld=(modelMatrix*vec4(position,1.0)).xyz;');s.fragmentShader='uniform float uTime;\nvarying vec3 vWorld;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float w1=sin(vWorld.x*.085+vWorld.z*.053+uTime*.7);float w2=cos(vWorld.z*.14-vWorld.x*.07+uTime*.9);
   normal=normalize(normal+vec3(w1*.12,w2*.12,0.0));`);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float wave=sin(vWorld.x*.055+vWorld.z*.08+uTime*.6)*sin(vWorld.z*.036-vWorld.x*.071+uTime*.4);
   diffuseColor.rgb*=.92+wave*.08;`);};
  this.water=new THREE.Mesh(new THREE.PlaneGeometry(80000,80000),mat);this.water.rotation.x=-Math.PI/2;this.water.position.y=.1;this.water.receiveShadow=true;this.scene.add(this.water);
 }
 makeLand() {
  const positions:number[]=[],colors:number[]=[];
  for(const poly of this.landPolys){
   const boundary=poly.flat(),xs=poly[0].map(p=>p[0]),zs=poly[0].map(p=>p[1]);
   const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs);const pts=[...boundary];
   for(let x=xmin+22;x<xmax;x+=32)for(let z=zmin+17;z<zmax;z+=32)if(inPolygon([x,z],poly))pts.push([x,z]);
   const tri=Delaunator.from(pts).triangles;
   for(let i=0;i<tri.length;i+=3){const p=[pts[tri[i]],pts[tri[i+1]],pts[tri[i+2]]];const cx=(p[0][0]+p[1][0]+p[2][0])/3,cz=(p[0][1]+p[1][1]+p[2][1])/3;if(!inPolygon([cx,cz],poly))continue;
    // Consistent upward winding in the east/south plane.
    if((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])>0)[p[1],p[2]]=[p[2],p[1]];
    for(const q of p){const h=this.elevation(q[0],q[1]);positions.push(q[0],h,q[1]);const c=new THREE.Color(0xb7b9aa).multiplyScalar(.97+hash(Math.round(cx/60)+Math.round(cz/60)*781)*.065);colors.push(c.r,c.g,c.b);}
   }
  }
  const mesh=new THREE.Mesh(this.geometry(positions,undefined,colors),new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));mesh.receiveShadow=true;this.terrain.add(mesh);
 }
 polygonMesh(poly:number[][][],color:number,offset=.5) {
  const positions:number[]=[],pts=poly.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(p[0],p[1]))), flat=pts.flat();
  if(!pts[0]?.length)return;
  const triangles=THREE.ShapeUtils.triangulateShape(pts[0],pts.slice(1));
  // Subdivide long park triangles so the green surface follows the real hills.
  const add=(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,depth=0)=>{if(depth<7&&Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>65){const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);add(a,ab,ca,depth+1);add(ab,b,bc,depth+1);add(ca,bc,c,depth+1);add(ab,bc,ca,depth+1);return;}for(const p of [a,c,b])positions.push(p.x,this.elevation(p.x,p.y)+offset,p.y);};
  triangles.forEach(t=>add(flat[t[0]],flat[t[1]],flat[t[2]]));
  const m=new THREE.Mesh(this.geometry(positions),new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));m.receiveShadow=true;this.terrain.add(m);return m;
 }
 makeParks() {this.parkPolys.forEach(p=>this.polygonMesh(p.poly,p.name.toLowerCase().includes('stanley')?0x578247:0x78975c,.65));}
 makeBuildings() {
  const pos:number[]=[],norm:number[]=[],colors:number[]=[],uv:number[]=[];const palette=[0x91aeb0,0xa3b9bc,0xaebbbc,0x8fa5a9,0xb4b6ab,0xd5d0bb,0x8dabae,0xc4c2b5,0x687f84];let count=0;
  const vertex=(x:number,y:number,z:number,nx:number,ny:number,nz:number,c:THREE.Color,u:number,v:number)=>{pos.push(x,y,z);norm.push(nx,ny,nz);colors.push(c.r,c.g,c.b);uv.push(u,v);};
  for(const f of this.data.buildings.features){const prop=f.properties,h=Math.max(2,Number(prop.height??prop.hgt_agl??8));if(h>350)continue;
   for(const polygon of rings(f)){const poly=polygon.map(r=>r.slice(0,-1).map(project));if(poly[0].length<3)continue;const center=poly[0].reduce((a,p)=>[a[0]+p[0]/poly[0].length,a[1]+p[1]/poly[0].length],[0,0]);
    const base=this.elevation(center[0],center[1])-.75,top=base+h; const c=new THREE.Color(palette[Math.floor(hash(Number(prop.id||count))*palette.length)]);if(h<15)c.lerp(new THREE.Color(0xc7bcaa),.3);
    for(const ring of poly){const area=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0);if(area<0)ring.reverse();
     for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.01)continue;const nx=dz/len,nz=-dx/len;
      [[a[0],base,a[1],0,0],[b[0],top,b[1],len,h],[b[0],base,b[1],len,0],[a[0],base,a[1],0,0],[a[0],top,a[1],0,h],[b[0],top,b[1],len,h]].forEach(v=>vertex(v[0],v[1],v[2],nx,0,nz,c,v[3],v[4]));
     }
    }
    const p2=poly.map(r=>r.map(p=>new THREE.Vector2(...p))),flat=p2.flat();for(const t of THREE.ShapeUtils.triangulateShape(p2[0],p2.slice(1)))for(const idx of [t[0],t[2],t[1]]){const p=flat[idx];vertex(p.x,top,p.y,0,1,0,c.clone().multiplyScalar(1.12),-1,-1);}count++;
   }
  }
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.63,metalness:.21,side:THREE.DoubleSide});
  mat.onBeforeCompile=s=>{s.uniforms.uNight=this.uniforms.night;s.vertexShader='varying vec2 vFacade;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFacade=uv;');s.fragmentShader='uniform float uNight;varying vec2 vFacade;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
  if(vFacade.x>=0.0){vec2 cell=vec2(vFacade.x/3.1,vFacade.y/3.25);vec2 grid=fract(cell);float pane=smoothstep(.1,.17,grid.x)*(1.0-smoothstep(.79,.9,grid.x))*smoothstep(.18,.24,grid.y)*(1.0-smoothstep(.82,.9,grid.y));
   float rand=fract(sin(dot(floor(cell),vec2(127.1,311.7)))*43758.5453);float lit=step(.52,rand)*uNight;
   diffuseColor.rgb=mix(diffuseColor.rgb*1.12,diffuseColor.rgb*vec3(.50,.69,.77),pane);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0,.69,.3),pane*lit*.85);
  }`);s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   if(vFacade.x>=0.0){vec2 grid=fract(vec2(vFacade.x/3.1,vFacade.y/3.25));float r=fract(sin(dot(floor(vec2(vFacade.x/3.1,vFacade.y/3.25)),vec2(127.1,311.7)))*43758.5453);float pane=step(.14,grid.x)*step(grid.x,.84)*step(.2,grid.y)*step(grid.y,.85);totalEmissiveRadiance+=vec3(1.,.6,.21)*pane*step(.52,r)*uNight*.9;}`);};
  const mesh=new THREE.Mesh(this.geometry(pos,norm,colors,uv),mat);mesh.castShadow=true;mesh.receiveShadow=true;this.buildings.add(mesh);this.stats.buildings=count;
 }
 ribbon(points:number[][],width:number,color:number,offset:number,group=this.roads){const p:number[]=[];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;const steps=Math.ceil(len/25);for(let j=0;j<steps;j++){const t=j/steps,s=(j+1)/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,xx=a[0]+(b[0]-a[0])*s,zz=a[1]+(b[1]-a[1])*s,dx=(b[1]-a[1])/len*width/2,dz=-(b[0]-a[0])/len*width/2;for(const v of [[x-dx,z-dz],[x+dx,z+dz],[xx+dx,zz+dz],[x-dx,z-dz],[xx+dx,zz+dz],[xx-dx,zz-dz]])p.push(v[0],this.elevation(v[0],v[1])+offset,v[1]);}}
  const m=new THREE.Mesh(this.geometry(p),new THREE.MeshStandardMaterial({color,roughness:.92,side:THREE.DoubleSide}));m.receiveShadow=true;group.add(m);return m;
 }
 makeRoads(){let count=0;const batches:Record<string,number[][][]>={arterial:[],local:[],lane:[]};
  for(const f of this.data.roads.features){const t=String(f.properties.type||f.properties.streetuse||'').toLowerCase(),n=String(f.properties.name||f.properties.hblock||'');if(/bridge|causeway/i.test(n))continue;const kind=/arterial|primary|secondary/.test(t)?'arterial':/lane/.test(t)?'lane':'local';for(const l of lines(f)){batches[kind].push(l.map(project));count++;}}
  for(const [kind,ls] of Object.entries(batches)){const width=kind==='arterial'?15:kind==='lane'?4:8;const positions:number[]=[],edge:number[]=[];for(const l of ls){for(let i=0;i<l.length-1;i++){const a=l[i],b=l[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.1)continue;for(let j=0,steps=Math.ceil(len/18);j<steps;j++){const t=j/steps,s=(j+1)/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,xx=a[0]+(b[0]-a[0])*s,zz=a[1]+(b[1]-a[1])*s;for(const [w,array,offset] of [[width+4,edge,.85],[width,positions,1.05]] as [number,number[],number][]){const dx=(b[1]-a[1])/len*w/2,dz=-(b[0]-a[0])/len*w/2;for(const p of [[x-dx,z-dz],[x+dx,z+dz],[xx+dx,zz+dz],[x-dx,z-dz],[xx+dx,zz+dz],[xx-dx,zz-dz]])array.push(p[0],this.elevation(p[0],p[1])+offset,p[1]);}}}}
   for(const [p,color] of [[edge,0xc8c5b8],[positions,0x697579]] as [number[],number][]){const mesh=new THREE.Mesh(this.geometry(p),new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;this.roads.add(mesh);}}
  this.stats.roads=count;
 }
 flyTo(id:string,animate=true){const v=VIEWS.find(p=>p.id===id)||VIEWS[0];this.fly(v,animate);}
 fly(v:Viewpoint,animate=true){const [x,z]=project(v.coord),target=new THREE.Vector3(x,0,z),pos=new THREE.Vector3(x+Math.sin(v.azimuth)*Math.cos(v.elevation)*v.distance,Math.sin(v.elevation)*v.distance,z+Math.cos(v.azimuth)*Math.cos(v.elevation)*v.distance);if(animate)this.transition={start:performance.now(),duration:1800,from:this.camera.position.clone(),to:pos,fromTarget:this.controls.target.clone(),toTarget:target};else{this.camera.position.copy(pos);this.controls.target.copy(target);this.controls.update();}}
 zoom(f:number){this.camera.position.sub(this.controls.target).multiplyScalar(f).add(this.controls.target);this.controls.update();}
 applySettings(settings:Settings){this.settings={...settings};this.buildings.visible=settings.buildings;this.vegetation.visible=settings.trees;this.controls.autoRotate=settings.autoRotate;this.controls.autoRotateSpeed=.5;const a=(settings.hour-6)/12*Math.PI,day=Math.max(0,Math.sin(a)),night=1-THREE.MathUtils.smoothstep(day,0,.38);this.uniforms.night.value=night;
  this.sun.position.set(Math.cos(a)*4500,Math.max(300,Math.sin(a)*5000),1400);this.sun.intensity=day*3.6+.04;this.sun.color.set(night>.2?0xffad73:0xffeed6);this.ambient.intensity=.42+day*1.65;
  const bg=new THREE.Color(0x102536).lerp(new THREE.Color(0xbedce9),Math.pow(day,.5));this.scene.background=bg;if(this.scene.fog)this.scene.fog.color.copy(bg);this.renderer.toneMappingExposure=1.04+night*.24;
 }
 animate=(time:number)=>{if(this.disposed)return;this.raf=requestAnimationFrame(this.animate);this.uniforms.time.value=time/1000;
  if(this.transition){const t=THREE.MathUtils.clamp((performance.now()-this.transition.start)/this.transition.duration,0,1),u=t*t*(3-2*t);this.camera.position.lerpVectors(this.transition.from,this.transition.to,u);this.controls.target.lerpVectors(this.transition.fromTarget,this.transition.toTarget,u);if(t===1)this.transition=null;}
  this.controls.update();this.renderer.render(this.scene,this.camera);this.frames++;
  if(time-this.fpsAt>800){this.stats.fps=Math.round(this.frames*1000/(time-this.fpsAt));this.stats.distance=Math.round(this.camera.position.distanceTo(this.controls.target));this.stats.elevation=Math.round(this.elevation(this.controls.target.x,this.controls.target.z));this.onStats({...this.stats});this.fpsAt=time;this.frames=0;}
 }
 screenshot(){return this.renderer.domElement.toDataURL('image/png');}
 destroy(){this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.controls.dispose();this.scene.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose();if(m.material){for(const a of Array.isArray(m.material)?m.material:[m.material])a.dispose();}});this.scene.environment?.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
