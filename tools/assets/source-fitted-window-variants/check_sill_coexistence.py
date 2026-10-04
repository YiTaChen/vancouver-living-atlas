"""Diagnostic only: never call aperture-only fit an accepted assembled replacement.
Reconstruct current source-selected sill transforms without changing any old file.
"""
import json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));from validate import geom,common
old=json.loads((HERE.parent/'facade-fit-contracts/qa/source-examples.json').read_text())['results'];source=json.loads((HERE/'qa/source-fixtures.json').read_text())['fixtures'];out=[]
def inside(tri,p):return len(geom.ray_hits(tri,p,[0,0,1],10))%2==1
for f in source:
 s=f['input']['source'];candidates=[r for r in old if r['kind']=='source-selected-existing-upper-sill' and r['input']['source']['structureId']==s['structureId'] and r['input']['source']['edgeKey']==s['edgeKey'] and r['input']['windowRow']==f['input']['row']]
 r=min(candidates,key=lambda r:abs(r['input']['source']['alongM']-f['attachment']['alongM']));a=r['input'];offset=[a['source']['alongM']-f['attachment']['alongM'],a['slot']['datumYAboveFoundationM']-f['attachment']['rootYAboveFoundationM'],a['slot']['datumOffsetFromSourceWallM']];scale=r['result']['scale'];assert abs(offset[0])<1e-5
 oldfile=HERE.parent/'architecture-expansion/assets'/f"{r['moduleId']}.lod0.glb";oldtri,_=geom.mesh_triangles(oldfile);oldtri=[[[p[k]*scale[k]+offset[k] for k in range(3)] for p in t] for t in oldtri]
 for lod in [0,1]:
  newfile=HERE/'exports'/f"{f['id']}.lod{lod}.glb";tri,_=geom.mesh_triangles(newfile);d=f['design'];samples=[]
  for iy in range(7):
   for iz in range(16):
    p=[0,d['sectionM']*(iy+.5)/7,d['backZ']+d['depthM']*(iz+.5)/16]
    if inside(tri,p) and inside(oldtri,p):samples.append(p)
  out.append({'assetId':f['id'],'lod':lod,'existingSillId':r['moduleId'],'existingSlotId':a['existingSlotId'],'existingSillGLBSha256':common.digest(oldfile),'frameGLBSha256':common.digest(newfile),'sillToFrameRoot':{'translationM':offset,'scale':scale},'interiorSampleCount':112,'jointInteriorWitnessCount':len(samples),'jointInteriorWitnessesM':samples[:8],'assemblyAccepted':False,'finding':'sampled solid intersection exists' if samples else 'no sampled intersection; not a complete collision proof','requiredAction':'Keep runtime fallback. Do not simply add closed lower frame rail over retained sill. Consumer/next geometry revision must resolve lower-rail coexistence without changing source aperture or removing the protected sill.'})
report={'status':'diagnostic_complete','scope':'actual current source-selected upper sill against new frame geometry; finite point-in-solid diagnostic, not comprehensive mesh Boolean proof','results':out,'assetOnlyFitStillValid':True,'runtimeAssemblyStatus':'blocked-on-sill-frame-coexistence','oldFilesModified':False}
(HERE/'qa/existing-sill-coexistence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps([{'id':r['assetId'],'lod':r['lod'],'intersections':r['jointInteriorWitnessCount']} for r in out],indent=2))
