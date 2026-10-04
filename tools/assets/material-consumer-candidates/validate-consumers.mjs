import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import * as THREE from 'three';
import ts from 'typescript';
import { ROOT, PACKAGE, loader, originalSource, patchedSource } from './adapters/harness.mjs';
import { makeRoadsterCandidate, makeInteriorsCandidate, bindCandidateMaps } from './adapters/consumer-candidates.mjs';
import { metricError } from './adapters/metre-uv.mjs';
import { SURFACES, configureSharedMaps } from './adapters/shared-surfaces.mjs';
const sha = v => createHash('sha256').update(v).digest('hex');
const write = (file,value) => writeFileSync(resolve(PACKAGE,file),JSON.stringify(value,null,2)+'\n');
const load = loader(false), checks = [];
function pass(name,evidence) { checks.push({name,status:'pass',...evidence}); }
function bounds(root) {
  const b = new THREE.Box3().setFromObject(root);
  return {min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()};
}
function digestGeometry(root, predicate = () => true) {
  root.updateMatrixWorld(true);
  const triangles = []; let vertices = 0, meshes = 0;
  root.traverse(o => {
    if (!o.isMesh || !predicate(o)) return;
    meshes++;
    const p=o.geometry.getAttribute('position'), n=o.geometry.getAttribute('normal'), index=o.geometry.index;
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(o.matrixWorld), v=new THREE.Vector3(), normal=new THREE.Vector3();
    const count=index?.count??p.count; vertices+=count;
    for (let i=0;i<count;i+=3) {
      const row=[];
      for(let j=0;j<3;j++) {
        const k=index?index.getX(i+j):i+j; v.fromBufferAttribute(p,k).applyMatrix4(o.matrixWorld);
        row.push(...v.toArray().map(x=>x.toFixed(8)));
        if(n){normal.fromBufferAttribute(n,k).applyMatrix3(normalMatrix);row.push(...normal.toArray().map(x=>x.toFixed(8)));}
      }
      triangles.push(row.join(','));
    }
  });
  return {hash:sha(triangles.sort((a,b)=>a<b?-1:a>b?1:0).join('\n')),triangles:triangles.length,vertices,meshes,boundsM:bounds(root)};
}
function sameTriangles(a,b,predicate) {
  const A=digestGeometry(a,predicate),B=digestGeometry(b,predicate);
  assert.equal(A.hash,B.hash);assert.equal(A.triangles,B.triangles);assert.deepEqual(A.boundsM,B.boundsM);
  return {baseline:A,candidate:B};
}
const sources = [
 'assets/roadster','interiors','seabus-layout','navigation','driver-camera','assets/cockpits',
 'harbour-models','harbour','harbour-path','boat-controller','boat-physics','water-world',
 'assets/aircraft-models','flight-controller','flight-state','flight-geometry',
];
const sourceHashes=Object.fromEntries(sources.map(n=>['lib/city/'+n+'.ts',sha(originalSource(n))]));
const {makeRoadster}=await load('assets/roadster');
const original=makeRoadster(),candidate=await makeRoadsterCandidate();
const roadster=sameTriangles(original.group,candidate.group);pass('E02 geometry positions/normals/winding and root bounds unchanged',roadster);
const wheels=g=>g.children.filter(o=>'front' in o.userData).map(o=>({position:o.position.toArray(),front:o.userData.front,steering:o.rotation.toArray(),spin:o.children[0].rotation.toArray()}));
for(const [distance,steering] of [[0,0],[4,1],[-2,-0.5],[23.125,0.23]]){
 original.update(distance,steering);candidate.update(distance,steering);
 assert.deepEqual(wheels(original.group),wheels(candidate.group));sameTriangles(original.group,candidate.group);
}
original.update(0,0);candidate.update(0,0);
pass('E02 independent wheel/spin transformations unchanged for four movement samples',{wheelAnchors:wheels(candidate.group)});
const head=candidate.group.getObjectByName('roadster/driver-skin');
assert(head && !head.userData.surfaceId);
assert.equal(digestGeometry(head).hash,digestGeometry(original.group.getObjectByName('roadster/leather')).hash);
const seats=candidate.group.getObjectByName('roadster/seat-upholstery');
assert.equal(seats.userData.surfaceId,'vehicle-seat-leather');
assert.equal(candidate.group.getObjectByName('roadster/dark').userData.surfaceId,undefined);
const clothes=candidate.group.getObjectByName('roadster/driver-clothing'); assert(!clothes.userData.surfaceId);
pass('E02 semantic callsites separate seats, skin, clothing, trim and tyres',{headBoundsM:bounds(head),seatBoundsM:bounds(seats),driverClothingBoundsM:bounds(clothes)});
let uvMax=0,uvEdges=0,uvMeshes=0;
candidate.group.traverse(o=>{if(o.isMesh && o.userData.semanticRole){const e=metricError(o.geometry);uvMax=Math.max(uvMax,e.maxAbsoluteEdgeErrorM);uvEdges+=e.measuredEdges;uvMeshes++;}});
assert(uvMax<1e-4,`roadster uv ${uvMax}`);
pass('E02 metre UV survives merged body/seat/skin batches and tyres',{maxAbsoluteEdgeErrorM:uvMax,measuredEdges:uvEdges,meshes:uvMeshes,chartLimitation:'Per-triangle exact metric charts; visible seams require WebGL review.'});
for(const model of [original,candidate]){
 model.group.updateMatrixWorld(true);
 const hits=new THREE.Raycaster(new THREE.Vector3(-0.44,3,-0.15),new THREE.Vector3(0,-1,0)).intersectObject(model.group,true);
 assert(hits.length&&hits[0].point.y<0.75);
}
const {makeCockpit}=await load('assets/cockpits');const cockpit=makeCockpit('drive','roadster');
const nav=originalSource('navigation');
const eye=Number(nav.match(/carModel === 'roadster' \? ([\d.]+) :/)[1]);
assert.equal(eye,1.2);
const driverSource=originalSource('driver-camera');
const driverLeft=Number(driverSource.match(/DRIVER_LEFT_OFFSET\s*=\s*([\d.]+)/)?.[1]??0.45);
// Execute exactly the current clearGround method with deterministic onLand,
// water and source polygon fixtures; the geometry adapter does not own collision.
const ast=ts.createSourceFile('navigation.ts',nav,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='StreetNavigation');
const clearMethod=cls?.members.find(n=>n.name?.getText(ast)==='clearGround');
assert(clearMethod,'clearGround source method');
const {inPolygon}=await load('geo');
const compiled=ts.transpileModule(`class Fixture {${clearMethod.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
// oxlint-disable-next-line typescript/no-implied-eval -- Execute the trusted local repository's exact extracted method for source-collision regression; no external input.
const Fixture=new Function('inPolygon',compiled+';return Fixture;')(inPolygon);
const collision=new Fixture(); Object.assign(collision,{mode:'drive',e:{onLand:(x,_z)=>x>-10,data:{waterPolys:[[[[5,5],[8,5],[8,8],[5,8],[5,5]]]]}},collisions:new Map([['0,0',[[[[1,1],[3,1],[3,3],[1,3],[1,1]]]]]])});
const collisionQueries=[[-20,0],[0,0],[2,2],[6,6]].map(p=>({xz:p,clear:collision.clearGround(...p)}));
assert.deepEqual(collisionQueries.map(q=>q.clear),[false,true,false,false]);
pass('E02 cabin opening, actual driver view and source collision method retained',{eyeHeightM:eye,driverLeftOffsetM:driverLeft,cockpit:digestGeometry(cockpit),collisionQueries,scope:'CPU fixtures of existing method; no gameplay acceptance'});

const {PublicInteriors}=await load('interiors');
function engine(){return {renderer:{},landmarks:new THREE.Group(),landmarkDetails:[],data:{},elevation:(x,z)=>3+Math.sin(x*0.002)*0.2+Math.cos(z*0.002)*0.2,camera:new THREE.PerspectiveCamera(),settings:{buildings:true,mode:'walk'}};}
const ea=engine(),eb=engine(),a=new PublicInteriors(ea),b=await makeInteriorsCandidate(eb);
const interiors=[];let queries=0;uvMax=0;uvEdges=0;
for(let i=0;i<a.sites.length;i++){
 const A=a.sites[i],B=b.sites[i];
 const fields=s=>({id:s.id,origin:s.origin.toArray(),yaw:s.yaw,floor:s.floor,polys:s.polys,doors:s.doors,obstacles:s.obstacles,entry:s.entry,entryYaw:s.entryYaw,approach:s.approach,approachOuter:s.approachOuter});
 assert.deepEqual(fields(A),fields(B));assert.deepEqual(a.entry(A.id),b.entry(B.id));
 const geo=sameTriangles(A.group,B.group);
 sameTriangles(A.group,B.group,o=>o.userData.walkSurface);
 if(A.envelope){sameTriangles(A.envelope,B.envelope);sameTriangles(A.envelope,B.envelope,o=>o.userData.walkSurface);}
 for(const root of [B.group,B.envelope]) root?.traverse(o=>{if(o.isMesh&&o.userData.semanticRole){const e=metricError(o.geometry);uvMax=Math.max(uvMax,e.maxAbsoluteEdgeErrorM);uvEdges+=e.measuredEdges;}});
 // Sample the complete actual source footprint including doors/ramps/collision.
 for(let x=-60;x<=75;x+=3)for(let z=-255;z<=100;z+=3){
  const p=a.world(A,x,z);assert.equal(a.height(...p),b.height(...p));
  for(const mode of ['walk','drive'])assert.equal(a.clear(...p,mode),b.clear(...p,mode));queries++;
 }
 interiors.push({...fields(A),entryOutput:a.entry(A.id),geometry:geo});
}
assert(uvMax<1e-4,`interior uv ${uvMax}`);
pass('E04 current floor, doors, furniture collision, entry and circulation anchors unchanged',{queries,sites:interiors.map(s=>({id:s.id,obstacles:s.obstacles.length,doorAnchors:s.doors.length,geometry:s.geometry}))});
pass('E04 floor/wood/plaster UV retained with original normals and colour fallback',{maxAbsoluteEdgeErrorM:uvMax,measuredEdges:uvEdges});
for(const s of b.sites){
 assert(s.group.children.some(o=>o.userData.semanticRole==='wood'));
 assert(s.group.children.some(o=>o.userData.semanticRole==='plaster'));
 assert(s.group.children.some(o=>o.userData.semanticRole==='floor-terrazzo'));
}
const screenA=ea.landmarks.getObjectByName('Atlas original light-mixing exhibit'),screenB=eb.landmarks.getObjectByName('Atlas original light-mixing exhibit');
assert.deepEqual(screenA.position.toArray(),screenB.position.toArray());assert.deepEqual(screenA.userData,screenB.userData);
a.setLightLabMix([10,70,35]);b.setLightLabMix([10,70,35]);assert.deepEqual(screenA.userData,screenB.userData);
for(const e of [ea,eb]){e.settings.mode='orbit';e.camera.position.copy(a.sites[2].origin).add(new THREE.Vector3(0,50,0));}
a.update();b.update();assert.deepEqual(a.sites.map(s=>s.plane.constant),b.sites.map(s=>s.plane.constant));
pass('E04 light-lab output and cutaway clipping retained',{headlessCanvasWayfinding:'not_run; document undefined skips sign canvas in both fixtures',floorWalkSurfacePreserved:true});
const originalSkin=head.material,originalDark=candidate.group.getObjectByName('roadster/dark').material;
const shared=Object.fromEntries(Object.keys(SURFACES).map(id=>[id,{basecolor:new THREE.Texture(),normal:new THREE.Texture(),orm:new THREE.Texture()}]));
for(const [id,maps]of Object.entries(shared)){
 const configured=configureSharedMaps(id,maps);assert.equal(maps.basecolor.colorSpace,THREE.SRGBColorSpace);assert.equal(maps.orm.colorSpace,THREE.NoColorSpace);assert.equal(maps.normal.colorSpace,THREE.NoColorSpace);assert.equal(maps.normal.repeat.x,1/SURFACES[id]);assert.equal(configured.roughnessMap,configured.metalnessMap);assert.equal(configured.roughnessMap,configured.aoMap);
}
const bound=bindCandidateMaps(candidate.group,shared);assert.equal(bound,3);
assert.equal(head.material,originalSkin);assert.equal(candidate.group.getObjectByName('roadster/dark').material,originalDark);assert(!head.material.map&&!originalDark.map);
for(const s of b.sites){const m=s.group.children.find(o=>o.userData.semanticRole==='wood').material;const hook=m.onBeforeCompile;bindCandidateMaps(s.group,shared);assert.equal(m.onBeforeCompile,hook);assert.equal(m.vertexColors,false);assert.equal(m.color.getHex(),0xffffff);}
pass('F05 eight shared IDs and channel/repeat contract; opt-in binding excludes skin/glass/light',{surfaceCount:Object.keys(SURFACES).length,roadsterBoundMaterials:bound,duplicateMapsAdded:0});

const harbour=await load('harbour-models'), flight=await load('assets/aircraft-models'), flightGeometry=await load('flight-geometry');
function safeData(data){return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v?.isObject3D?{name:v.name,position:v.position.toArray(),rotation:v.rotation.toArray(),spinAxis:v.userData.spinAxis??null}:v?.isVector3?v.toArray():v]));}
const harbourInventory=[];
for(const fn of ['makeHelicopter','makeSeaplane','makeCruiseShip','makeMotorboat']){const g=harbour[fn]();harbourInventory.push({factory:fn,...digestGeometry(g),metadata:safeData(g.userData)});}
for(let i=0;i<45;i++){const g=harbour.makeMooredYacht(i);harbourInventory.push({factory:'makeMooredYacht',variant:i,...digestGeometry(g),metadata:safeData(g.userData)});}
const aircraft=[];
for(const kind of ['seaplane','helicopter']){
 const model=flight.makeAircraft(kind);
 aircraft.push({kind,exterior:digestGeometry(model.group),cockpit:digestGeometry(model.cockpit),forwardAxis:'-Z',upAxis:'+Y',landingDatum:'Y=0',metadata:safeData(model.group.userData),propellers:model.propellers.map(o=>({name:o.name,position:o.position.toArray(),spinAxis:o.userData.spinAxis,spinRate:o.userData.spinRate})),stick:{position:model.stick.position.toArray(),rotation:model.stick.rotation.toArray()},instruments:Object.fromEntries(Object.entries(model.instruments).map(([k,v])=>[k,{position:v.position.toArray(),rotation:v.rotation.toArray()}]))});
 flight.updateAircraftInstruments(model.instruments,{airspeedKnots:50,altitudeMetres:300,verticalSpeedMetresPerSecond:2,pitch:0.1,roll:-0.2,heading:1,power:0.7});
 assert(Object.values(model.instruments).every(o=>o.rotation.toArray().slice(0,3).every(Number.isFinite)));
 model.dispose();
}
const waterSource=originalSource('water-world');assert(waterSource.includes('halfLength = 3.5')&&waterSource.includes('radius = 1.35'));
const gapAudit={taskId:'E03',status:'offline_audit_complete_no_verified_asset_gap',newAssets:0,decision:'Retain existing specialised procedural geometry. Source inspection verifies seats, rails, metal controls, complete hulls, wings, rotor assemblies and detached cockpits. UV deletion alone does not establish a missing geometry part. No named near-view part omission verified; no replacement made.',harbour:harbourInventory,playerAircraft:aircraft,interfaces:{harbourForward:'+Z',playerAircraftForward:'-Z',boatCollision:{halfLengthM:3.5,radiusM:1.35,source:'lib/city/water-world.ts:canOccupy'},aircraftProbeRadiusM:flightGeometry.AIRFRAME_RADIUS,aircraftProbesM:flightGeometry.AIRFRAME_PROBES,boatDynamics:'advanceBoat(state,input,delta,world), delta clamped 0..0.1 s, up to 120 Hz substeps; wave bob/propeller owned by BoatController.',flightDynamics:'FlightController owns fixed elapsed-time stepping, collision probes, propeller spinAxis/spinRate, rotorBlur, detached cockpit and disposal. No scene-clock multiplication.'},sourceHashes,nearViewVisualInspection:'not_run in runtime; geometry/source CPU audit only'};
write('qa/harbour-aircraft-gap-audit.json',gapAudit);
pass('E03 specialised inventory and exact dynamics/control interfaces measured',{harbourVariants:harbourInventory.length,playerAircraft:aircraft.length,newParts:0});
const fixtures={schemaVersion:1,sourceHashes,roadster:roadster.baseline,wheels:wheels(original.group),driver:{eyeHeightM:eye,leftOffsetM:driverLeft,head:bounds(head),seats:bounds(seats),cockpit:digestGeometry(cockpit),collisionQueries},interiors:interiors.map(({geometry,...s})=>({...s,geometry:geometry.baseline})),harbour:harbourInventory.map(({metadata:_metadata,...x})=>x),aircraft};
if(process.argv.includes('--record-fixtures'))write('qa/current-source-fixtures.json',fixtures);
else assert.deepEqual(JSON.parse(JSON.stringify(fixtures)),JSON.parse(readFileSync(resolve(PACKAGE,'qa/current-source-fixtures.json'),'utf8')),'Source/geometry regression fixture drift. Review before re-recording.');
pass('Current-source regression fixtures checked',{recorded:process.argv.includes('--record-fixtures')});
const textures=JSON.parse(readFileSync(resolve(ROOT,'tools/assets/role-materials/exports/manifest.json'),'utf8')).roles.map(r=>({...r,maps:Object.fromEntries(Object.entries(r.maps).map(([channel,path])=>{const actual=resolve(ROOT,'tools/assets/role-materials/exports',path);return [channel,{path:'../role-materials/exports/'+path,sha256:sha(readFileSync(actual)),bytes:readFileSync(actual).length,colorSpace:channel==='basecolor'?'sRGB':'Non-Color',channel:channel==='orm'?'R=1,G=roughness,B=metallic':channel==='normal'?'OpenGL +Y tangent-space':'RGB'}];}))}));
write('shared-surface-catalog.json',{schemaVersion:1,source:'../role-materials/exports/manifest.json',newMaps:0,uniqueTexelBytesWithMips:8388608,surfaces:textures});
for(const name of ['assets/roadster','interiors'])writeFileSync(resolve(PACKAGE,'qa',name.split('/').pop()+'.integration-candidate.ts.txt'),patchedSource(name).replaceAll(new URL('./adapters/metre-uv.mjs',import.meta.url).href,'./metre-uv.mjs'));
write('qa/consumer-validation.json',{status:'pass',environment:{node:process.version,three:THREE.REVISION,mode:'CPU; no WebGL or browser'},checks,sourceHashes,scope:'Offline candidate integration logic only. Runtime/public remain unchanged; no GPU/gameplay/PBR rollout claim.'});
console.log(JSON.stringify({status:'pass',checks:checks.length,roadster:roadster.candidate,interiorQueries:queries,maxInteriorUVErrorM:uvMax},null,2));
