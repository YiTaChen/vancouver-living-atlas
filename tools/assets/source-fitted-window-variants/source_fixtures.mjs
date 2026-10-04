/** Read the actual GIS dataset and production facade planner. IDs are evidence fixtures,
 * never runtime activation rules. No world XYZ is emitted or accepted. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cityModule} from '../../../tests/helpers/city-modules.mjs';
import {data,prepareParts,summarizeStructures,createProfile,project,rings} from '../../../tests/helpers/region-rule-audit.mjs';
const {fitBays,windowBounds}=await import(cityModule('facade-profile'));
const {planPitchedRoof}=await import(cityModule('building-roof'));
const here=new URL('./',import.meta.url),root=new URL('../../../',here);
export const selections=[
 {id:'modern-source-window-surround',taskId:'C02',variant:'modern-recessed',structureId:'145639',featureId:'133049',edgeKey:'-326.275,445.400|-336.041,435.450',surfaceId:'painted-metal',sectionM:.1,depthM:.24,stopRearZ:.06,stopThicknessM:.015,revealExtraM:.02,bevelM:.008},
 {id:'cedar-source-window-surround',taskId:'C03',variant:'residential-cedar',structureId:'145755',featureId:'105546',edgeKey:'-229.513,444.825|-239.811,434.495',surfaceId:'cedar',sectionM:.07,depthM:.16,stopRearZ:.05,stopThicknessM:.015,revealExtraM:.018,bevelM:.006}
];
export function sourceFixtures(){
 const parts=prepareParts(data.buildings.features),structures=summarizeStructures(parts);
 const fixtures=selections.map(s=>{
  const p=parts.find(p=>p.key===s.structureId&&String(p.feature.properties.id)===s.featureId);if(!p)throw Error('source part missing');
  const poly=rings(p.feature)[Number(p.partId.split('#').at(-1))].map(r=>r.slice(0,-1).map(project));
  const edge=poly[0].map((a,i,r)=>[a,r[(i+1)%r.length]]).find(e=>e.map(p=>p.map(n=>n.toFixed(3)).join(',')).sort((a,b)=>a.localeCompare(b)).join('|')===s.edgeKey);if(!edge)throw Error('source edge missing');
  const length=Math.hypot(edge[1][0]-edge[0][0],edge[1][1]-edge[0][1]);
  const profile=createProfile(structures.get(p.key)),grid=fitBays(profile,length),opening=windowBounds(profile,grid,0,1);
  const roof=planPitchedRoof(poly,p.heightM,p.minHeightM,p.feature.properties.roof,p.feature.properties.source,parts.filter(q=>q.key===p.key).length);
  const input={source:{structureId:s.structureId,featureId:s.featureId,edgeKey:s.edgeKey,edgeLengthM:length},profile,heightM:p.heightM,minHeightM:p.minHeightM,wallTopM:roof?.eaveHeight??p.heightM,bay:0,row:1,entryExclusions:[],scale:[1,1,1]};
  const width=opening.right-opening.left,height=opening.top-opening.bottom;
  const old=JSON.parse(fs.readFileSync(new URL('../facade-fit-contracts/qa/source-examples.json',here))).results.find(r=>r.kind==='source-opening-dimension-check'&&r.input.source.structureId===s.structureId);
  if(!old||Math.abs(width-old.input.targetOpening.widthM)>1e-9||Math.abs(height-old.input.targetOpening.heightM)>1e-9)throw Error('legacy source evidence drift; review selection');
  return {id:s.id,design:{...s,openingWidthM:width,openingHeightM:height,backZ:.02},input,grid,opening,attachment:{rootYAboveFoundationM:opening.bottom-s.sectionM,sourceWindowLowerEdgeM:opening.bottom,localOpeningBottomM:s.sectionM,alongM:(opening.left+opening.right)/2,wallPlaneZ:0},legacyComparison:{moduleId:old.moduleId,fitReason:old.result.reason,oldDimensionCheckRootY:old.input.slot.datumYAboveFoundationM,doNotUseOldSillSlotAsFrameOrigin:true}};
 });
 const paths=['public/data/buildings.geojson','lib/city/facade-profile.ts','lib/city/building-roof.ts','lib/city/architecture-module-candidate.ts','lib/city/architecture-plan.ts','lib/city/building-bodies.ts','lib/city/navigation.ts','tools/assets/architecture-expansion/manifest.json','tools/assets/architecture-expansion/build_architecture_expansion.py','tools/assets/facade-fit-contracts/qa/source-examples.json','tools/assets/city-materials/catalog.json'];
 for(const lod of [0,1])for(const id of ['residential-cedar-sill','residential-gabled-entry-canopy'])for(const [dir,ext] of [['assets','glb'],['source','blend']])paths.push(`tools/assets/architecture-expansion/${dir}/${id}.lod${lod}.${ext}`);
 return {schemaVersion:1,status:'pass',method:'Actual prepareParts/summarizeStructures/createProfile, source polygon projection, fitBays/windowBounds bay0 row1; foundation-local scalar evidence only',fixtures,sourceFingerprints:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(new URL(p,root))).digest('hex')])),limitations:['GIS shader openings are visual masks, not true wall or collision apertures','No scene activation, world XYZ placement, cell admission or WebGL acceptance','Source IDs select reproducible tests only; general fit uses profile and dimensions']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=sourceFixtures();if(process.argv.includes('--write'))fs.writeFileSync(new URL('qa/source-fixtures.json',here),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r.fixtures.map(f=>({id:f.id,opening:f.opening,attachment:f.attachment})),null,2));}
