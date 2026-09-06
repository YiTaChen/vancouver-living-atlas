// Original MIT. Portable canonical Stage 6 CPU audit; no browser or GPU.
import{writeFileSync}from'node:fs';
import path from'node:path';
import{createHash}from'node:crypto';
import{createFixture,sourceHashes,load as cityLoad,samplePolyline,replay}from'./causeway-cpu.mjs';
const outputIndex=process.argv.indexOf('--output');
if(outputIndex<0||!process.argv[outputIndex+1])throw new Error('Usage: node tools/audit-ground-harmonization.mjs --output docs/ground-harmonization-cpu.json');
const output=path.resolve(process.argv[outputIndex+1]);
const load=name=>cityLoad('lib/city/'+name);
import{auditGeometry}from'./causeway-geometry-audit.mjs';
const{prepareRoadLowering:prepare,lowerRoadSurface:lower}=load('road-lowering.ts');
const{reconcileGroundVisibility:clip,compareGroundHeights:compare,visibilityGeometry:G}=load('ground-visibility.ts');
const{groundHarmonizationScopes}=load('ground-harmonization-scopes.ts');
const{applyShoreLowering,shoreGroundMeshes}=load('shore-lowering.ts');
const start=performance.now(),fixture=createFixture({harmonize:false}),{e,nav,geo,THREE,groundPathMeshes}=fixture;
// The canonical fixture executes the actual Nature shoreline constructor once.
const shoreMeshes=e.terrain.children.filter(m=>m.userData.groundShoreSource==='measured-shoreline-strip');
if(shoreMeshes.length!==2)throw new Error('Expected exactly the two marked canonical shore strips');
const shoreDescriptors=shoreMeshes.map(mesh=>({kind:'shore',shoreKind:mesh.userData.groundShoreKind,mesh}));
const originalShore=shoreMeshes.map(m=>Array.from(m.geometry.getAttribute('position').array));
const digest=p=>createHash('sha256').update(Buffer.from(new Float32Array(p).buffer)).digest('hex');
const flat=m=>m.geometry.getAttribute('position').array;
const ids=new Set([363686270,648864806,44032491,115939816,74267973]);
const lowerPaths=groundPathMeshes.filter(m=>ids.has(m.userData.auditPathId));
const bounds=[-706.459716796875,-1326.8353271484375,-558.3389282226562,-920.0067138671875];
const all=[],asphalt=[];e.roads.traverse(m=>{if(m instanceof THREE.Mesh&&m.userData.walkSurface){all.push(m);if(m.userData.asphaltSurface&&!m.userData.protectedSurface)asphalt.push(m);}});
const source=(m,kind)=>({id:m.userData.auditPathId?`OSM:${m.userData.auditPathId}`:m.name,kind,positions:flat(m),level:m.userData.protectedSurface?'upper':'ground',protectedSurface:!!m.userData.protectedSurface});
const protectedBefore=all.filter(m=>m.userData.protectedSurface).map(m=>[m,digest(flat(m))]);
const pathBefore=lowerPaths.map(m=>digest(flat(m))),profilesBefore=JSON.stringify([e.data.causeway.segments,e.data.causewayPathSegments]);
const gates=e.data.causewayConnections.filter(c=>c.geometry.kind==='gate').map(g=>({gate:g,point:[(g.geometry.a[0]+g.geometry.b[0])/2,(g.geometry.a[1]+g.geometry.b[1])/2]}));
const gateBefore=gates.map(g=>nav.groundHeight(...g.point));
const scopes=groundHarmonizationScopes(geo.project),plans=[],changes=[];
const activeBounds=[];
const originalAsphalt=asphalt.map(m=>flat(m)),originalTerrain=flat(e.terrain.children[0]);
const coastal=all.find(m=>m.userData.groundPath&&!m.userData.auditPathId&&!m.userData.protectedSurface);
if(!coastal)throw new Error('Missing actual canonical coastal path mesh');
const allPathBefore=[...groundPathMeshes,coastal].map(m=>[m,digest(flat(m))]);
const local=(p,b)=>{const out=[];for(let i=0;i<p.length;i+=9){if(Math.max(p[i],p[i+3],p[i+6])<b[0]||Math.min(p[i],p[i+3],p[i+6])>b[2]||Math.max(p[i+2],p[i+5],p[i+8])<b[1]||Math.min(p[i+2],p[i+5],p[i+8])>b[3])continue;for(let j=0;j<9;j++)out.push(p[i+j]);}return out;};
for(const scope of scopes){
 const targets=scope.pathSourceIds.includes('coastal-paths')?[coastal]:groundPathMeshes.filter(m=>scope.pathSourceIds.includes(`OSM:${m.userData.auditPathId}`));
 const planningStarted=performance.now(),plan=prepare(asphalt.map(m=>source(m,'asphalt')),targets.map(m=>({...source(m,'path'),id:m===coastal?'coastal-paths':`OSM:${m.userData.auditPathId}`})),scope);
 plans.push({scope:scope.id,constraints:plan.constraints.length,areas:plan.sourceAreasM2,blendM:plan.blendM,gridM:plan.gridM});
 activeBounds.push(...plan.constraints.map(c=>c.bounds));
for(const m of asphalt){
 const result=lower({positions:flat(m)},plan);
 if(!result.changedTriangles.length)continue;
 const old=flat(m), geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(result.positions,3));geometry.computeVertexNormals();m.geometry=geometry;
 changes.push({scope:scope.id,mesh:m.name,statistics:result.statistics,beforeVsPath:targets.map(p=>({id:p===coastal?'stage5-coastal-paths':p.userData.auditPathId,...compare(local(old,scope.focusBounds),flat(p),scope.focusBounds)})),afterVsPath:targets.map(p=>({id:p===coastal?'stage5-coastal-paths':p.userData.auditPathId,...compare(local(flat(m),scope.focusBounds),flat(p),scope.focusBounds)}))});
}
 plans.at(-1).elapsedMs=performance.now()-planningStarted;
}
const actualPathSources=[...groundPathMeshes.map(m=>source(m,'path')),{...source(coastal,'path'),id:'coastal-paths'}],shoreChanges=[];
for(const scope of scopes.filter(s=>s.id!=='causeway-lower'))shoreChanges.push(applyShoreLowering(shoreDescriptors,actualPathSources,scope));
const finalCovers=[...all.map(m=>source(m,m.userData.asphaltSurface?'asphalt':m.userData.auditPathId?'path':'sidewalk')),...shoreGroundMeshes(shoreDescriptors).map(s=>({...source(s.mesh,'shore'),id:s.id}))];
const terrain=e.terrain.children[0],profileFloats=e.data.beachCoast.profilePositions.length,profileFirst=flat(terrain).length/9-profileFloats/9,profileBefore=digest(flat(terrain).slice(-profileFloats));
const regions=scopes.map(s=>s.bounds),union=[Math.min(...regions.map(b=>b[0])),Math.min(...regions.map(b=>b[1])),Math.max(...regions.map(b=>b[2])),Math.max(...regions.map(b=>b[3]))];
const terrainResult=clip({positions:flat(terrain),protectedTriangleRanges:[[profileFirst,flat(terrain).length/9]]},finalCovers,{bounds:union,regions});
terrain.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(terrainResult.positions,3));
const residue=clip({positions:flat(terrain),protectedTriangleRanges:[[flat(terrain).length/9-profileFloats/9,flat(terrain).length/9]]},finalCovers,{bounds:union,regions});
const{GroundSurfaceIndex}=cityLoad('lib/city/ground-surface.ts');e.data.roadSurface=new GroundSurfaceIndex(asphalt);nav.groundSurface=null;
const gateAfter=gates.map(g=>nav.groundHeight(...g.point)),movement=[];
for(const p of lowerPaths){const f=e.data.paths.features.find(f=>Number(f.properties.sourceId??f.properties.id)===p.userData.auditPathId);for(const line of geo.lines(f))for(const reverse of[false,true]){let points=line.map(geo.project);if(reverse)points.reverse();movement.push(replay(fixture,`lower:${p.userData.auditPathId}:${reverse?'reverse':'forward'}`,samplePolyline(points),'walk',undefined,'ground'));}}
for(const{gate,point:c}of gates){const g=gate.geometry,dx=g.b[0]-g.a[0],dz=g.b[1]-g.a[1],len=Math.hypot(dx,dz),v=[g.fromSide*dz/len,-g.fromSide*dx/len],a=[c[0]-v[0]*2,c[1]-v[1]*2],b=[c[0]+v[0]*2,c[1]+v[1]*2],mode=gate.allowedModes[0];movement.push(replay(fixture,`gate:${gate.id}:enter`,samplePolyline([a,c,b]),mode,undefined,gate.to.surfaceId));movement.push(replay(fixture,`gate:${gate.id}:exit`,samplePolyline([b,c,a]),mode,gate.to.surfaceId,'ground'));}
const groundIndex=new GroundSurfaceIndex([...all.filter(m=>!m.userData.protectedSurface),...shoreMeshes]);
const visibleFloor=[];for(const p of lowerPaths){const f=flat(p);let maximumFloorBelowPath=0;for(let i=0;i<f.length;i+=9){const x=(f[i]+f[i+3]+f[i+6])/3,z=(f[i+2]+f[i+5]+f[i+8])/3,y=(f[i+1]+f[i+4]+f[i+7])/3;maximumFloorBelowPath=Math.max(maximumFloorBelowPath,y-groundIndex.sample(x,z,y));}visibleFloor.push({id:p.userData.auditPathId,maximumFloorBelowPath});}
const northSurvey=[];for(const[id,coord]of[['north-coast-trail',[-123.147165,49.313101]],['northwest-coast-trail',[-123.156028,49.306809]]]){
 const p=geo.project(coord),b=[p[0]-120,p[1]-120,p[0]+120,p[1]+120],a=asphalt.flatMap(m=>local(flat(m),b)),nearby=[];
 for(const path of groundPathMeshes){const f=local(flat(path),b);if(!f.length)continue;const overlap=compare(a,f,b);if(overlap.areaM2)nearby.push({sourceId:path.userData.auditPathId,...overlap});}
 if(coastal){const overlap=compare(a,local(flat(coastal),b),b);if(overlap.areaM2)nearby.push({sourceId:'Stage5 merged coastal paths',...overlap});}
 const targetPaths=id==='north-coast-trail'?groundPathMeshes.filter(m=>[381179591,863811845].includes(m.userData.auditPathId)):[coastal];
 northSurvey.push({id,coord,bounds:b,cityAsphaltVsPaths:nearby,terrainVsAsphalt:compare(local(flat(terrain),b),a,b),originalTerrainVsOriginalAsphalt:compare(local(originalTerrain,b),originalAsphalt.flatMap(p=>local(p,b)),b),shoreVsPaths:targetPaths.map(m=>({id:m.userData.auditPathId??'coastal-paths',...compare(shoreMeshes.flatMap(m=>local(flat(m),b)),local(flat(m),b),b)})),originalShoreVsPaths:targetPaths.map(m=>({id:m.userData.auditPathId??'coastal-paths',...compare(originalShore.flatMap(p=>local(p,b)),local(flat(m),b),b)}))});
}
const geometry=auditGeometry(fixture),gatesUnchanged=gates.map((g,i)=>({id:g.gate.id,before:gateBefore[i],after:gateAfter[i],difference:gateAfter[i]-gateBefore[i]}));
const slabCity={road:compare(fixture.road.result.buffers.slab,asphalt.flatMap(m=>local(flat(m),bounds)),bounds),path:compare(fixture.paths.result.buffers.slab,asphalt.flatMap(m=>local(flat(m),bounds)),bounds)};
for(const q of Object.values(slabCity))if(q.minimumPoint)q.minimumLonLat=geo.unproject(...q.minimumPoint);
const paint=cityLoad('lib/city/street-layout.ts').streetPaint(e.data.roadGraph).paint;
const paintPotentialOverlap=paint.filter(p=>{const r=Math.hypot(p.width,p.length)/2,b=[p.center[0]-r,p.center[1]-r,p.center[0]+r,p.center[1]+r];return activeBounds.some(a=>G.overlaps(a,b));}).length;
const trafficSourcePotentialOverlap=[];for(const[findex,f]of e.data.roads.features.entries()){
 if(/bikeway|lane|private|non.city/i.test(f.properties.class||'')||/bridge|causeway/i.test(f.properties.name||''))continue;
 if(geo.lines(f).some(l=>{const p=l.map(geo.project);return p.slice(1).some((q,i)=>activeBounds.some(b=>G.overlaps(b,[Math.min(p[i][0],q[0]),Math.min(p[i][1],q[1]),Math.max(p[i][0],q[0]),Math.max(p[i][1],q[1])])));}))trafficSourcePotentialOverlap.push({index:findex,...f.properties});
}
const report={version:4,scopes,plans,changes,shoreChanges,terrainClipping:terrainResult.statistics,quantizedResidualOcclusionAreaM2:residue.statistics.removedPlanAreaM2,gatesUnchanged,movement,visibleFloor,northSurvey,slabCity,protectedBeachProfileUnchanged:profileBefore===digest(flat(terrain).slice(-profileFloats)),paintPotentialOverlap,trafficSourcePotentialOverlap,
 upperMeshesUnchanged:protectedBefore.every(([m,h])=>digest(flat(m))===h),pathsUnchanged:allPathBefore.every(([m,h])=>digest(flat(m))===h),profilesUnchanged:profilesBefore===JSON.stringify([e.data.causeway.segments,e.data.causewayPathSegments]),geometry,sourceHashes:sourceHashes(),elapsedMs:performance.now()-start};
report.valid=report.upperMeshesUnchanged&&report.pathsUnchanged&&report.profilesUnchanged&&report.protectedBeachProfileUnchanged&&geometry.valid&&movement.every(r=>r.valid)&&gatesUnchanged.every(g=>Math.abs(g.difference)<1e-6)&&changes.every(c=>c.statistics.maximumUpwardChangeM<1e-6&&c.afterVsPath.every(p=>p.maximumDeltaM===null||p.maximumDeltaM<-.0199))&&shoreChanges.every(s=>s.changes.every(c=>c.maximumUpwardChangeM<1e-6&&Math.abs(c.inputPlanAreaM2-c.outputPlanAreaM2)<1e-5))&&report.quantizedResidualOcclusionAreaM2<.05&&northSurvey.every(s=>s.shoreVsPaths.every(p=>p.maximumDeltaM===null||p.maximumDeltaM<-.0198));
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({valid:report.valid,output,movement:{passed:movement.filter(r=>r.valid).length,total:movement.length},sourceFiles:report.sourceHashes.length,protectedBeachProfileUnchanged:report.protectedBeachProfileUnchanged,quantizedResidualOcclusionAreaM2:report.quantizedResidualOcclusionAreaM2,roadChanges:changes.length,shoreChanges:shoreChanges.map(s=>({scope:s.scope,changes:s.changes.length})),elapsedMs:report.elapsedMs},null,2));if(!report.valid)process.exitCode=1;
