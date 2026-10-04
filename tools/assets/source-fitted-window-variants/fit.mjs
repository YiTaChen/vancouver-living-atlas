/** Offline, source-local fit only. A matching window mask does not cut a GIS wall. */
import fs from 'node:fs';
import {cityModule} from '../../../tests/helpers/city-modules.mjs';
const {fitBays,windowBounds}=await import(cityModule('facade-profile'));
export const designs=JSON.parse(fs.readFileSync(new URL('designs.json',import.meta.url)));
const fail=reason=>({compatible:false,reason,fallback:'retain-existing-procedural-or-shader-detail',runtimeStatus:'runtime_pending_webgl'});
export function fitWindow(id,input,options={}){
 const d=designs[id];if(!d)return fail('unknown-variant');
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 if(!input||!input.source||!['structureId','featureId','edgeKey'].every(k=>typeof input.source[k]==='string'&&input.source[k]))return fail('missing-source-identity');
 if(['x','y','z','worldXYZ','worldPosition','position'].some(k=>k in input||k in input.source))return fail('world-placement-not-supported');
 if('slot' in input||'datumYAboveFoundationM' in input)return fail('sill-slot-datum-not-frame-datum');
 if(!Array.isArray(input.scale)||input.scale.length!==3||input.scale.some(n=>n!==1))return fail('fixed-section-no-stretch');
 if(!input.profile||input.profile.kind!==(d.taskId==='C02'?'midrise-grid':'domestic-cladding'))return fail('profile-incompatible');
 const p=input.profile;
 if(!['targetBayM','storeyM','groundStoreyM','edgeMarginM'].every(k=>finite(p[k]))||p.targetBayM<=0||p.storeyM<=0||p.edgeMarginM<0||!Array.isArray(p.pane)||p.pane.length!==4||p.pane.some(n=>!finite(n)||n<0||n>1)||p.pane[0]>=p.pane[1]||p.pane[2]>=p.pane[3])return fail('invalid-profile');
 if(!['heightM','minHeightM','wallTopM'].every(k=>finite(input[k]))||!finite(input.source.edgeLengthM)||input.source.edgeLengthM<=0||input.minHeightM<0||input.heightM<=input.minHeightM||input.wallTopM>input.heightM)return fail('invalid-source-extents');
 if(!Number.isInteger(input.bay)||!Number.isInteger(input.row)||input.bay<0||input.row<0)return fail('invalid-bay-row');
 const g=fitBays(p,input.source.edgeLengthM);if(input.bay>=g.count)return fail('no-full-source-bay');
 const o=windowBounds(p,g,input.bay,input.row),w=o.right-o.left,h=o.top-o.bottom;
 if(Math.abs(w-d.openingWidthM)>.02||Math.abs(h-d.openingHeightM)>.02)return fail('opening-mismatch');
 // Reject even sub-2 cm encroachment: the tolerance is a comparison tolerance,
 // not permission to cover a source opening. New dimensions need a new variant.
 if(d.openingWidthM+1e-6<w||d.openingHeightM+1e-6<h)return fail('would-occlude-source-aperture');
 const x0=o.left-d.sectionM,x1=o.right+d.sectionM,y0=o.bottom-d.sectionM,y1=o.top+d.sectionM;
 if(x0<0||x1>input.source.edgeLengthM)return fail('frame-outside-source-edge');
 if(y0<input.minHeightM||y1>input.wallTopM)return fail('frame-outside-source-wall');
 if(!Array.isArray(input.entryExclusions))return fail('missing-entry-exclusions');
 for(const r of input.entryExclusions){if(!r||!['left','right','bottom','top'].every(k=>finite(r[k]))||r.left>=r.right||r.bottom>=r.top)return fail('invalid-entry-exclusion');if(x0<r.right&&x1>r.left&&y0<r.top&&y1>r.bottom)return fail('entry-exclusion-overlap');}
 if(options.lod!==undefined&&![0,1].includes(options.lod))return fail('unsupported-lod');
 return {compatible:true,reason:null,status:'offline-aperture-compatible-only',assemblyAccepted:false,assemblyStatus:'requires-retained-sill-coexistence-check',runtimeStatus:'runtime_pending_webgl',assetId:id,lod:options.lod??0,scale:[1,1,1],source:input.source,opening:o,clearApertureM:{width:d.openingWidthM,height:d.openingHeightM},attachment:{frame:'source-edge-foundation-local',alongM:(o.left+o.right)/2,rootYAboveFoundationM:o.bottom-d.sectionM,wallNormalOffsetM:0,wallPlaneZ:0,localOpeningBottomM:d.sectionM,rule:'rootY=actual windowBounds.bottom-chosen sectionM; never use sill slot Y or recenter bounds'},preserveExisting:['source-footprint-height-foundation','GIS-wall-and-collision','cedar-sill','ground-datum-entry-canopy','shader-glazing'],noNewWorldPlacement:true,createsPassableOpening:false};
}

export const sillDesigns=JSON.parse(fs.readFileSync(new URL('sill-designs.json',import.meta.url)));
/** Optional coherent assembly. Future consumer must atomically replace the old
 * sill descriptor and frame detail; leaving the old sill is explicitly rejected. */
export function fitAssembly(frameId,input,options={}){
 const frame=fitWindow(frameId,input,options);if(!frame.compatible)return frame;
 if(options.suppressExistingSill!==true||typeof options.existingSillSlotId!=='string'||!options.existingSillSlotId)return fail('existing-sill-not-suppressed');
 const s=Object.values(sillDesigns).find(s=>s.frameId===frameId);if(!s)return fail('missing-paired-sill');
 const x=frame.attachment.alongM,y=frame.attachment.rootYAboveFoundationM;
 const profile=s.profilesZYByLod[String(options.lod??0)];const ymin=Math.min(...profile.map(p=>p[1])),ymax=Math.max(...profile.map(p=>p[1]));
 if(x-s.widthM/2<0||x+s.widthM/2>input.source.edgeLengthM)return fail('sill-outside-source-edge');
 if(y+ymin<input.minHeightM||y+ymax>input.wallTopM)return fail('sill-outside-source-wall');
 for(const r of input.entryExclusions)if(x-s.widthM/2<r.right&&x+s.widthM/2>r.left&&y+ymin<r.top&&y+ymax>r.bottom)return fail('sill-entry-exclusion-overlap');
 return {...frame,status:'offline-paired-assembly-compatible',assemblyAccepted:true,assemblyStatus:'offline-geometric-pair-only',sillAssetId:s.id,sillAttachment:{frame:'same-window-frame-root',translationM:[0,0,0],scale:[1,1,1],topYAboveFoundationM:y+s.topY,frameBottomYAboveFoundationM:y,verifiedGapM:s.frameSeparationM,rule:'sillTop=actual windowBounds.bottom-sectionM-0.006; never legacy sill-slot Y'},replacement:{mode:'optional-atomic-pair',suppressExistingSillSlotId:options.existingSillSlotId,retainOldFiles:true,requireCandidateEnabled:true,keepCanopyAndGISWallCollision:true},runtimeStatus:'runtime_pending_webgl'};
}
