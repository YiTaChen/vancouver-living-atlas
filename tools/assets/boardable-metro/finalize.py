"""Finalize only after validation, source audit, and the complete real-GLB preview matrix exist."""
import json,sys,platform,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import common
from validate import main as validate
validate()
read=lambda p:json.loads((ROOT/p).read_text())
v=read('qa/validation.json');a=read('qa/source-roundtrip.json');r=read('qa/render-report.json');m=read('manifest.json')
assert v['status']==a['status']=='pass' and a['editedInteriorBatchProof']['status']=='pass';assert len(r['renders'])==119 and len({i['file'] for i in r['renders']})==119
for audited in a['sources']:
 assert common.digest(ROOT/'source'/audited['source'])==audited['sourceSha256']
 assert common.digest(ROOT/'exports'/(Path(audited['source']).stem+'.glb'))==audited['actualDeliveredSha256']
for item in r['renders']:
 path=ROOT/'qa'/item['file'];assert path.stat().st_mtime>=max((ROOT/p).stat().st_mtime for p in item['inputs']),'Preview predates its actual GLB';im=Image.open(path);assert im.size==(640,400);assert any(hi-lo>20 for lo,hi in im.convert('RGB').getextrema())
 item['sha256']=common.digest(path);item['sourceGlbSha256']={p:common.digest(ROOT/p) for p in item['inputs']}
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
def contact(name,files,cols=3):
 rows=(len(files)+cols-1)//cols;out=Image.new('RGB',(cols*320,rows*224),(235,238,240));d=ImageDraw.Draw(out)
 for i,f in enumerate(files):
  p=ROOT/'qa/previews'/f;im=Image.open(p).convert('RGB');im.thumbnail((320,200));x=(i%cols)*320;y=(i//cols)*224;out.paste(im,(x,y));d.text((x+5,y+201),f.replace('.png',''),font=font,fill=(20,30,36))
 out.save(ROOT/'qa/previews'/name)
for variant in ['lead','middle','tail']:
 contact(f'contact-{variant}-lods.png',[f'{variant}-lod{lod}-{view}.png' for lod in [0,1,2] for view in ['front','side','rear','top']],4)
 contact(f'contact-{variant}-seats.png',[f'{variant}-seat-{side}-{i:02d}-eye.png' for side in ['right','left'] for i in range(1,7)],4)
 contact(f'contact-{variant}-entries.png',[f'{variant}-entry-{side}-{pos}.png' for side in ['right','left'] for pos in ['rear','center','front']],3)
contact('contact-lighting.png',[f'{v}-{c}.png' for v in ['lead','middle','tail'] for c in ['clear','overcast','dusk','night']],4)
contact('contact-boarding.png',[f'{v}-{shot}.png' for v in ['lead','middle','tail'] for shot in ['doors-closed','doors-open','aisle','section','scale-reference']],5)
contact('contact-overview.png',[f'{v}-{shot}.png' for v in ['lead','middle','tail'] for shot in ['clear','section','aisle']],3)
contact('contact-interior-lods.png',[f'interior-lod{lod}-aisle.png' for lod in [0,1]],2)
if '--prepare-only' in sys.argv:
 print('Contact sheets ready; status not promoted.');sys.exit(0)
r.update({'status':'pass','visualReview':'See qa/visual-review.json; all expected frames rendered from real GLBs.','denoising':False,'denoisingReason':'Installed Blender build lacks OpenImageDenoise; 8-sample CPU noise retained.'});(ROOT/'qa/render-report.json').write_text(json.dumps(r,indent=2)+'\n')
# Do not promote based solely on successful rendering; reviewer supplies the explicit visual review file.
review=read('qa/visual-review.json');assert review['status']=='pass'
assert review['reviewedGlbSha256']=={str(p.relative_to(ROOT)):common.digest(p) for p in sorted((ROOT/'exports').glob('*.glb'))},'Visual review is stale for current GLBs'
m['status']='offline_complete'
for asset in m['assets']:asset['offlineChecks']={'status':'pass','evidence':['qa/validation.json','qa/source-roundtrip.json','qa/static-batching.json','qa/render-report.json','qa/visual-review.json']}
(ROOT/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
measure=read('qa/measurements.json');measure['environment']={'os':platform.platform(),'cpuModel':next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),'unknown'),'python':platform.python_version(),'blender':a['blenderVersion'],'renderer':'Cycles CPU, 2 threads, 640x400, 8 samples','webglAvailable':False};measure['sourceTotalBytes']=sum(p.stat().st_size for p in (ROOT/'source').glob('*.blend'));measure['glbTotalBytes']=sum(p.stat().st_size for p in (ROOT/'exports').glob('*.glb'));measure['statePrimitiveCosts']=[]
for asset in m['assets'][:3]:
 for lod in asset['lods']:
  interior=m['assets'][3]['lods'][min(lod['level'],1)] if lod['level']<2 else None
  measure['statePrimitiveCosts'].append({'assetId':asset['id'],'level':lod['level'],'closedExterior':lod['primitives'],'openExterior':lod['primitives'] if lod['level']<2 else None,'exteriorPlusInterior':lod['primitives']+interior['primitives'] if interior else None,'runtimeDrawCalls':'not_measured'})
(ROOT/'qa/measurements.json').write_text(json.dumps(measure,indent=2)+'\n')
h={'schemaVersion':1,'packageId':'boardable-metro','baseRevision':m['baseRevision'],'taskIds':['D04','D05'],'assetStatus':'offline_complete','integrationStatus':'runtime_pending_webgl','webglAvailable':False,'manifest':'../manifest.json','sourceEditsPreserved':True,'offlineEvidence':['validation.json','common-validation.json','measurements.json','source-roundtrip.json','static-batching.json','render-report.json','visual-review.json'],'runtimeChecks':{'status':'not_run','D06':'not_implemented','reason':'Offline package; no WebGL/runtime changes or acceptance.'},'intendedConsumers':['lib/city/railway.ts'],'replaces':['future replacement for legacy decorative metro body/window/wheel geometry only after adapter and runtime QA'],'materialReuse':'Shared semantic roles; no images and no per-car maps. Bind explicitly, preserve glass and lights.','entryFiles':['../exports/expo-metro-lead-exterior.lod0.glb','../exports/expo-metro-middle-exterior.lod0.glb','../exports/expo-metro-tail-exterior.lod0.glb','../exports/expo-metro-shared-interior.lod0.glb'],'datum':'Rail-contact Y=0; bogie midpoint Z=0; +Z forward; floor/sill Y=.95; identical car root for all resources','knownLimitations':['Representative four-car 17m profile, not Mark V or exact Mark II/III.','Moving inter-car traversal disabled; 0.30m bridge gap and curve/telescope collision need runtime resolution.','LOD2 closed empty nonboardable display only.','CPU sampled collision tests are not a continuous certified physics solver.','8-sample previews retain noise; installed Blender has no OpenImageDenoise.','Low-poly research geometry and no runtime screen content or service state.'],'nextIntegrationSteps':['Load new profile only in isolated QA consumer; preserve source paths and +Z/-X datum.','Bind shared material roles, lazy interior and LOD capability lock; keep wheels/doors dynamic.','Align platform to .95m and full 71.5m consist plus stopping margin.','Implement D06 fixed-seat single-car state transitions and collision before moving inter-car traversal.','Run four-lighting WebGL, transparency, dynamic passenger/camera and cache/dispose tests.'],'commit':'Not committed by package worker; parent owns review and commit.','publicRuntimeChanged':False}
h['staticInteriorBatching']={'levels':[0,1],'primitivesPerLevel':6,'editableSourcesPreserved':True,'namedZeroDrawAnchorsPreserved':True,'componentProvenance':'Actual GLB batch node extras.componentRanges stores source node/primitive, local-to-vehicle matrix and exact vertex/index ranges; CPU validators recover each physical component from these ranges.','evidence':'static-batching.json'}
h['statePrimitiveCosts']=measure['statePrimitiveCosts']
h['consistPrimitiveCosts']=[]
for level in [0,1,2]:
 counts={item['assetId']:item for item in measure['statePrimitiveCosts'] if item['level']==level};keys=['expo-metro-lead-exterior','expo-metro-middle-exterior','expo-metro-middle-exterior','expo-metro-tail-exterior'];h['consistPrimitiveCosts'].append({'level':level,'closedExterior':sum(counts[k]['closedExterior'] for k in keys),'openExterior':sum(counts[k]['openExterior'] for k in keys) if level<2 else None,'exteriorPlusInterior':sum(counts[k]['exteriorPlusInterior'] for k in keys) if level<2 else None,'runtimeDrawCalls':'not_measured'})
h['materialBudgetException']='Four primary paint/steel-metal/glass/lights roles plus one secondary gangway-bellows rubber role; no tire-rubber rail wheels.'
files=[]
for p in sorted(ROOT.rglob('*')):
 if p.is_file() and '__pycache__' not in p.parts and p.name!='handoff.json':files.append({'file':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':common.digest(p)})
h['files']=files;(ROOT/'qa/handoff.json').write_text(json.dumps(h,indent=2)+'\n');print(json.dumps({'status':'offline_complete','files':len(files),'renders':len(r['renders']),'glbBytes':measure['glbTotalBytes']}))
