/** Read-only actual-source fixture. No runtime edits, population or new navigation. */
import { createFixture, load, sourceHashes, THREE, geo } from '../../causeway-cpu.mjs';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const { e }=createFixture();
e.buildings=new THREE.Group();
const old=THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
try { load('lib/city/building-bodies.ts').createBuildingBodies(e); }
finally { THREE.TextureLoader.prototype.load=old; }
const state=()=>digest({terrain:e.terrain.children.filter(o=>o.geometry).map(o=>[...o.geometry.attributes.position.array]),roads:e.roads.children.filter(o=>o.geometry).map(o=>[...o.geometry.attributes.position.array]),travel:e.data.travelSurfaces,buildings:e.data.buildings,profiles:[...e.data.buildingProfiles],collision:e.data.flightBuildingVolumes});
const before=state(), priorWindow=globalThis.window, priorFlag=process.env.VANCOUVER_VISUAL_QA;
process.env.VANCOUVER_VISUAL_QA='1';globalThis.window.location={search:'?qaPerennial=baseline'};
load('lib/city/residential-ground.ts').createResidentialGround(e);
const ev=e.data.residentialPerennialQA;
if(!ev?.beds?.length) throw Error('No actual source-selected bed evidence');
const {structureKey,fitBays}=load('lib/city/facade-profile.ts');
const g=load('lib/city/ground-visibility.ts').visibilityGeometry;
const {roofFrame}=load('lib/city/building-roof.ts');
const ground=new (load('lib/city/ground-surface.ts').GroundSurfaceIndex)([e.terrain.children[0]]);
function hull(points){ const pts=[...new Map(points.map(p=>[p.map(n=>n.toFixed(6)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]); const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],hi=[];for(const p of pts){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=1e-9)lo.pop();lo.push(p);}for(const p of [...pts].reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=1e-9)hi.pop();hi.push(p);}return [...lo.slice(0,-1),...hi.slice(0,-1)]; }
const selected=ev.beds[0],points=[];
for(let i=0;i<selected.positions.length;i+=3)points.push([selected.positions[i],selected.positions[i+2]]);
const contour=hull(points),center=contour.reduce((a,p)=>[a[0]+p[0]/contour.length,a[1]+p[1]/contour.length],[0,0]);
let footprint;
for(const f of e.data.buildings.features) for(const raw of geo.rings(f)){let p=raw[0].slice(0,-1).map(geo.project); if(p.length<3)continue;const key=structureKey(f.properties,p.map(p=>p.map(n=>n.toFixed(3)).join(',')).sort().join(';'));if(key===selected.sourceId){if(g.signedArea(p)<0)p.reverse(); footprint=p;}}
if(!footprint)throw Error('Selected source missing');
const frame=roofFrame(footprint),a=footprint[frame.edge],b=footprint[(frame.edge+1)%footprint.length];
const len=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/len,tz=(b[1]-a[1])/len;
const profile=e.data.buildingProfiles.get(selected.sourceId),grid=fitBays(profile,len),entry=grid.count?grid.originM+(Math.floor(grid.count/2)+.5)*grid.pitchM:len/2;
const at=(u,v)=>[a[0]+tx*u+tz*v,a[1]+tz*u-tx*v];
const doorExclusion=[at(entry-1.45,0),at(entry+1.45,0),at(entry+1.45,2),at(entry-1.45,2)];
const {residentialOverlap}=load('lib/city/residential-ground-plan.ts');
const doorOverlapArea=g.area(g.intersect(contour,doorExclusion)); if(doorOverlapArea>1e-8)throw Error('Source bed intersects door exclusion interior: '+doorOverlapArea);
const originY=ground.sample(...center,selected.positions[1]-.012); if(!Number.isFinite(originY))throw Error('Source anchor sampling failed'); const local=p=>[(p[0]-center[0])*tx+(p[1]-center[1])*tz,-(p[0]-center[0])*tz+(p[1]-center[1])*tx];
const samples=contour.map(p=>({xz:p,y:ground.sample(...p,originY)}));
if(samples.some(p=>!Number.isFinite(p.y)))throw Error('Contour sampling failed'); const relief=Math.max(...samples.map(p=>p.y))-Math.min(...samples.map(p=>p.y));

let positive=null, searched=0;
for(const bed of ev.beds){
 searched++;const pts=[];for(let i=0;i<bed.positions.length;i+=3)pts.push([bed.positions[i],bed.positions[i+2]]);const poly=hull(pts),cent=poly.reduce((a,p)=>[a[0]+p[0]/poly.length,a[1]+p[1]/poly.length],[0,0]);const cy=ground.sample(...cent,bed.positions[1]-.012);if(!Number.isFinite(cy))continue;const ys=poly.map(p=>ground.sample(...p,cy));if(ys.some(y=>!Number.isFinite(y))||Math.max(...ys)-Math.min(...ys)>.02)continue;
 const edges=poly.map((p,i)=>({a:p,b:poly[(i+1)%poly.length],len:Math.hypot(poly[(i+1)%poly.length][0]-p[0],poly[(i+1)%poly.length][1]-p[1])})).sort((a,b)=>b.len-a.len);const ed=edges[0],tx=(ed.b[0]-ed.a[0])/ed.len,tz=(ed.b[1]-ed.a[1])/ed.len;const foot=[[-.4,-.3],[.4,-.3],[.4,.3],[-.4,.3]].map(([u,v])=>[cent[0]+u*tx-v*tz,cent[1]+u*tz+v*tx]);const covered=g.area(g.intersect(foot,poly));if(Math.abs(covered-.48)>1e-6)continue;const heights=foot.map(p=>ground.sample(...p,cy));if(heights.some(y=>!Number.isFinite(y))||Math.max(...heights)-Math.min(...heights)>.02)continue;
 positive={status:'offline_research_fit_only',sourceId:bed.sourceId,selectionRule:'First accepted bed in unchanged existing stable source/seed order with whole-contour relief <=0.02m and a centered 0.8x0.6m footprint wholly contained in that accepted bed; no new population',candidateAsset:'planter-trough',plantingContourXZ:poly,contourHeightsM:ys,contourReliefM:Math.max(...ys)-Math.min(...ys),candidateFootprintXZ:foot,candidateGroundSamplesM:heights,candidateReliefM:Math.max(...heights)-Math.min(...heights),containedAreaM2:covered,frame:{origin:[cent[0],cy,cent[1]],tangent:[tx,0,tz],up:[0,1,0]},exclusionBasis:'Contained inside a bed already accepted by canonical road/sidewalk/building/neighbor/entry exclusion. Revalidate against current rendered triangles and door sweep before runtime activation.',existingPlantSlots:ev.plants.filter(p=>p.sourceId===bed.sourceId),runtimePlacement:'not activated; must preserve existing plant slots and approve any new collision proxy'};break;
}
const after=state();if(before!==after)throw Error('Protected terrain/road/navigation changed');
const report={schemaVersion:1,packageId:'ground-planting-details',referenceOnly:true,status:'source_selected_offline_fixture',runtimePlacement:'unresolved: exact rendered triangle clipping and exclusion must be repeated in WebGL integration',geographicBasis:'Existing representative foundation-garden selector on real source building footprint; not a surveyed courtyard or planting inventory',sourceId:selected.sourceId,positiveRigidPlanterFixture:positive,rigidCandidateSearchCount:searched,sourceFiles:sourceHashes(),protectedState:{beforeSha256:before,afterSha256:after,unchanged:before===after},existingPopulation:e.data.residentialGround,sourceBuildingFootprintXZ:footprint,plantingContourXZ:contour,plantingContourLocalXZ:contour.map(local),frame:{origin:[center[0],originY,center[1]],tangent:[tx,0,tz],up:[0,1,0],derivedFrom:'actual selected footprint longest edge and accepted bed centroid; no hand-entered world placement'},contourSamples:samples,contourReliefM:relief,doorExclusionXZ:doorExclusion,doorOverlapAreaM2:doorOverlapArea,doorBoundaryRule:'An existing bed boundary may coincide with the 2.9m reserved gap boundary; no positive overlap area is allowed. A new rigid prop needs additional 0.02m inset.',doorExclusionLocalXZ:doorExclusion.map(local),existingPlantSlots:ev.plants.filter(p=>p.sourceId===selected.sourceId),populationContract:{maxPlots:500,plantsPerAcceptedBed:2,additionalPlants:0,replaceOnly:true,planters:'research fit only; adding planter collision or relocating plants requires runtime acceptance'},contracts:{surfaceOffsetM:.012,clipToActualRenderedTriangles:true,neverCreateWalkFloor:true,roadExclusion:'Reject exact polygon intersection including containment, crossing and touching against all current road/sidewalk walk-surface triangles',doorExclusion:'Preserve existing +/-1.45 m entry gap, door sweep and current walk corridor',neighborExclusion:'Reject building/previous accepted bed overlap',slope:{bedMaxReliefM:.5,maxAnchorDifferenceM:.45,rigidPlanterMaxReliefM:.02,rigidCurbs:'segment along source contour; if vertical error > .02 m reject or produce source-specific stepped geometry; never stretch cross-section',edgeSurface:'clip and drape per current rendered terrain triangle; no broad flat patch'},contour:'Use only selected planting/source surface polygons; preserve holes and triangle boundaries; 2m/10m coupons are QA studies with no world placement'}};
writeFileSync(path.join(HERE,'placement-reference.json'),JSON.stringify(report,null,2)+'\n');
if(priorFlag===undefined)delete process.env.VANCOUVER_VISUAL_QA;else process.env.VANCOUVER_VISUAL_QA=priorFlag;globalThis.window=priorWindow;
console.log(JSON.stringify({sourceId:report.sourceId,reliefM:relief,protectedUnchanged:before===after,plots:report.existingPopulation.plots,plants:report.existingPopulation.plants}));
