"""Gate offline_complete on recorded CPU, source-edit, import and render evidence."""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from validate import contract_digest
HERE=Path(__file__).resolve().parent

def need(x,s):
 if not x:raise AssertionError(s)
def read(p):return json.loads((HERE/p).read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sheet(files,name):
 width,height=320,222;cols=4;rows=(len(files)+cols-1)//cols;out=Image.new('RGB',(cols*width,rows*height),(229,234,236));d=ImageDraw.Draw(out)
 for i,f in enumerate(files):
  im=Image.open(HERE/'qa/previews'/f).convert('RGB');im.thumbnail((width,200));x=(i%cols)*width;y=(i//cols)*height;out.paste(im,(x,y));d.text((x+7,y+202),f.removesuffix('.png'),fill=(22,35,45))
 out.save(HERE/'qa/previews'/name,optimize=True)

def main():
 m=read('manifest.json');cpu=read('qa/validation.json');blender=read('qa/blender-validation.json');previews=read('qa/previews/index.json')
 need(cpu['contractSha256']==contract_digest(m),'stale geometry/metadata contract validation')
 need(cpu['status']=='pass' and blender['status']=='pass' and previews['status']=='pass','required evidence not pass');need(blender['originalSourcesUnchanged'] and blender['sourceEditPreservation']['status']=='pass','source edit preservation missing')
 need(blender['interiorBatchEditPreservation']['status']=='pass','interior source edit did not survive batching')
 need(len(blender['staticBatchEquivalence'])==2 and all(r['status']=='pass' and r['batchedPrimitives']<=12 and r['maximumVertexDeltaM']<.000002 for r in blender['staticBatchEquivalence']),'source-to-batch equivalence failed')
 for r in blender['staticBatchEquivalence']:need(digest(HERE/r['file'])==r['batchedSha256'],'stale batch equivalence evidence')
 required=['exterior-front','exterior-right-side','exterior-rear','exterior-top','light-clear','light-overcast','light-dusk','light-night','lod-0','lod-1','lod-2','lod-2-rear','doors-open','entry-front','entry-rear','interior-aisle','driver-view','longitudinal-section']+[f'seat-{i:02d}-view' for i in range(1,11)]
 names={r['file'].removesuffix('.png') for r in previews['renders']};need(set(required)<=names,'missing required views')
 for a in m['assets']:
  for l in a['lods']:
   need(digest(HERE/l['file'])==l['sha256'] and digest(HERE/l['source'])==l['sourceSha256'],'payload changed after evidence')
   source=next(q for q in blender['sourceReopenReexport'] if q['source']==l['source']);need(source['sourceSha256']==l['sourceSha256'] and source['deliveredSha256']==l['sha256'],'stale editable-source reexport evidence')
   b=next(q for q in blender['actualGLBReimports'] if q['file']==l['file']);need(b['sha256']==l['sha256'],'stale Blender reimport evidence')
 # Record precise per-view source selections and hashes. All views except three LOD studies use exterior0 + interior0.
 for r in previews['renders']:
  f=r['file'];lod=int(f[4]) if f.startswith('lod-') else 0
  r['actualGLBSources']=[f'exports/city-bus-12m-exterior.lod{lod}.glb']+([f'exports/city-bus-12m-interior.lod{min(lod,1)}.glb'] if lod<2 else [])
  r['actualGLBSha256']={p:digest(HERE/p) for p in r['actualGLBSources']};p=HERE/'qa/previews'/f;need(p.is_file(),'missing render');im=Image.open(p);need(im.size==(640,400),'render dimensions');r['sha256']=digest(p)
 (HERE/'qa/previews/index.json').write_text(json.dumps(previews,indent=2)+'\n')
 exterior=[s+'.png' for s in required if s.startswith(('exterior-','light-','lod-','doors-'))]+['interior-aisle.png','longitudinal-section.png'];passenger=[s+'.png' for s in required if s.startswith(('entry-','seat-','driver-'))]
 sheet(exterior,'contact-exterior.png');sheet(passenger,'contact-passenger.png')
 m['status']='offline_complete'
 for a in m['assets']:a['offlineChecks']['status']='pass'
 (HERE/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 handoff={'schemaVersion':1,'packageId':'boardable-bus','baseRevision':m['baseRevision'],'sourceBranch':'assets/development-backlog-oct3','packageCommit':'Not committed by asset worker; parent integrator owns the final commit','taskIds':['D02','D03'],'assetStatus':'offline_complete','integrationStatus':'runtime_pending_webgl','webglAvailable':False,'manifest':'../manifest.json','sourceEditsPreserved':True,'offlineEvidence':['validation.json','common-validation.json','blender-validation.json','measurements.json','previews/index.json','previews/contact-exterior.png','previews/contact-passenger.png','regression-tests.txt','visual-review.json','batching-review.json'],'taskChecks':{'D02':{'status':'pass','scope':'Hollow shaped exterior, opening geometry, independently animated door leaves, wheels, LODs and common-root metadata'},'D03':{'status':'pass','scope':'Actual cabin, floor, seats/pelvis/cameras, rails, driver partition, stop bell, display, reserved clear region'},'D06':{'status':'not_run','reason':'Runtime service/boarding/rider states outside this offline package'}},'runtimeChecks':{'status':'not_run','reason':'No browser/WebGL acceptance performed; existing runtime unchanged','items':['shared material binding and transparency sorting','real source stop and threshold alignment','service and passenger state machine','moving frame and collision continuity','state-aware LOD locking and lazy load','repeat boarding/alighting, failures and disposal','device input and GPU costs']},'intendedConsumers':['lib/city/city-buses.ts'],'replaces':['Future opt-in replacement of busGeometry display mesh only after runtime sample acceptance'],'loadFiles':{'exterior':'../exports/city-bus-12m-exterior.lod0.glb','interior':'../exports/city-bus-12m-interior.lod0.glb','collision':'../manifest.json#/vehicles/0/collision'},'origin':'vehicle root: tyre Y=0, centreline X=0, axle midpoint Z=0; +Z forward, -X right; scale1','exportBatching':{'interiorPrimitivesPerLOD':[7,7],'sourceObjectsEditable':True,'componentAnchors':'Original mesh nodes remain zero-draw anchors','geometryCrosscheck':'Exact batch-node extras.componentRanges copied into manifest lod.staticBatching; validator checks every vertex/index range and source node transform','bindingRule':'Render material batch meshes; use original named anchors and numeric metadata for interaction/collision. Do not expect floor or seat component anchors themselves to have a mesh.'},'sharedRoles':['paint','rubber','glass','lights','floor','panel','seat','rail'],'knownLimitations':['Representative all-low-floor proposal, not measured production vehicle or accessibility certification','LOD2 intentionally closed/empty/nonboarding; never use with occupants or open doors','CPU renders are 640x400, 24 samples without denoising because this Blender build lacks OpenImageDenoise; modest grain is visible','Collision primitives conservatively enclose static cabin geometry; dynamic door collision and legal stop/walk-surface connection require runtime implementation','No source route, stop state, ridership, D06, WebGL, full-city FPS, or deployment claims'],'nextIntegrationSteps':['Validate source hashes and vehicle-local datum; discard old ground+1.08 placement offset','Load exterior0 + interior0 and bind shared semantic roles, accounting for all primitives','Use D01 actual stop/service data and explicit sill connection at Y=.36','Implement state-aware LOD/collision and D06 service/passenger states on elapsed time','Run WebGL sample views, all entry/seat cameras, door state, repeated boarding/disposal and GPU budget checks before publishing'],'fullFileList':[]}
 for p in sorted(HERE.rglob('*')):
  if p.is_file() and '__pycache__'not in p.parts and not p.name.endswith('.blend1'):handoff['fullFileList'].append(str(p.relative_to(HERE)))
 for p in ['qa/handoff.json','qa/inventory.json']:
  if p not in handoff['fullFileList']:handoff['fullFileList'].append(p)
 (HERE/'qa/handoff.json').write_text(json.dumps(handoff,indent=2)+'\n')
 inventory=[{'file':str(p.relative_to(HERE)),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(HERE.rglob('*')) if p.is_file() and '__pycache__'not in p.parts and not p.name.endswith('.blend1') and p.name!='inventory.json']
 (HERE/'qa/inventory.json').write_text(json.dumps({'schemaVersion':1,'files':inventory},indent=2)+'\n');print('offline_complete:',len(required),'actual GLB CPU views;',len(inventory),'files; runtime_pending_webgl')
if __name__=='__main__':main()
