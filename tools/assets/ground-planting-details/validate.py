"""Measured common-schema manifest and strict package CPU/UV/sampler/evidence validation."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,math,struct,subprocess,sys
from PIL import Image
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
REPEAT={'soil':[2,2],'grass':[2,2],'sand':[2,2],'concrete':[1.5,1.5],'asphalt':[3,3],'street-brick':[1.92,1.92],'soil-grass-edge':[2,2],'foliage':[1,1]}
def j(p):return json.loads(Path(p).read_text())
def dump(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def uv_span(d,blob):
 uv=[row for m in d['meshes']for p in m['primitives']for row in c.accessor(d,blob,p['attributes']['TEXCOORD_0'])];return [max(p[k]for p in uv)-min(p[k]for p in uv)for k in range(2)]
def check_glb(path,aid,lod,study,inspection):
 r=c.measure_glb(path);d,bb=c.read_glb(path);c.need(r['embeddedImageBytes']==0,'no embedded private maps');c.need(r['primitives']<=2,'B-PROP roles/primitive count');c.need(r['triangles']<=([1000,200][lod]),'B-PROP triangle budget');c.need(r['geometryBytes']<=([192,48][lod])*1024,'B-PROP geometry bytes');c.need(not d.get('animations')and not d.get('skins'),'unrigged static local assets');c.need(all(not n.get('name','').startswith('QA')for n in d['nodes']),'QA reference in GLB')
 for m in d.get('materials',[]):c.need(m['name'].startswith('role-')and m.get('alphaMode','OPAQUE')=='OPAQUE','semantic opaque role')
 for me in d['meshes']:
  for p in me['primitives']:
   c.need('TEXCOORD_0'in p['attributes'],'UV required');c.need('TANGENT'in p['attributes'] or 'normalTexture' not in d['materials'][p['material']],'tangent required when normal mapped')
   for t in (c.accessor(d,bb,p['attributes']['TANGENT']) if 'TANGENT' in p['attributes'] else []):c.need(abs(sum(v*v for v in t[:3])-1)<.01 and abs(abs(t[3])-1)<1e-5,'unit tangent')
 if not inspection:c.need(not r['images']and not d.get('textures'),'role runtime GLB must not carry private maps')
 if study:
  sid,size=aid[len('surface-'):].rsplit('-',1);size=int(size[:-1]);want=[size/REPEAT[sid][k]for k in range(2)];c.need(all(abs(a-b)<1e-5 for a,b in zip(uv_span(d,bb),want)),'physical coupon UV period');c.need(all(abs(a-b)<1e-5 for a,b in zip(r['boundsM']['size'],[size,0,size])),'true flat coupon size');c.need(r['triangles']==2,'surface study is a plane, not a terrain patch')
 if aid=='soil-grass-edge-1m':
  p=d['meshes'][0]['primitives'][0];c.need('_GRASS_WEIGHT'in p['attributes'],'separate low frequency grass weight');a=c.accessor(d,bb,p['attributes']['_GRASS_WEIGHT']);c.need(min(v[0]for v in a)==0 and max(v[0]for v in a)==1,'weight range');c.need(all(abs(a-b)<1e-6 for a,b in zip(uv_span(d,bb),[.2,.5])),'edge UV 0.4m x 1m crop of 2m source, not stretched full map')
  if inspection:c.need(d.get('samplers') and all(s.get('wrapS')==33071 and s.get('wrapT')==10497 for s in d['samplers']),'clamp-U/repeat-V edge sampler')
 elif inspection:c.need(all(s.get('wrapS')==10497 and s.get('wrapT')==10497 for s in d.get('samplers',[])),'repeat surfaces')
 if aid.startswith('perennial-'):c.need(.15<=r['boundsM']['size'][1]<=.6,'plant height');c.need(all(m.get('doubleSided')for m in d['materials']),'opaque two-sided plant blades')
 if aid.startswith('planter-'):c.need(.35<=r['boundsM']['size'][1]<=.65,'planter height')
 c.need(abs(r['boundsM']['min'][1])<1e-6,'ground attachment datum Y=0')
 return r

def finalize():
 assets=[];allrows=[];alltex={};inspection=[]
 for p in sorted((HERE/'exports').glob('*.glb')):
  stem=p.name.split('.lod')[0];lod=int(p.name.split('.lod')[1][0]);study=stem.startswith('surface-');insp='.inspection.'in p.name;r=check_glb(p,stem,lod,study,insp);allrows.append({'file':str(p.relative_to(HERE)),**r})
  d,bb=c.read_glb(p)
  for im in d.get('images',[]):
   ip=p.parent/im['uri'];h=c.digest(ip)
   with Image.open(ip)as pil:w,height=pil.size
   alltex[h]={'id':h[:20],'file':str(ip.relative_to(HERE)),'sha256':h,'bytes':ip.stat().st_size,'width':w,'height':height,'uniqueTexelBytesWithMips':w*height*4*4/3,'scope':'shared inspection maps only; never automatically resident from role-only prop GLBs','residencyBasis':'Conservative RGBA8 full mip estimate; not GPU measurement'}
  if insp and not study:inspection.append({'assetId':stem,'level':lod,'file':str(p.relative_to(HERE)),**{k:r[k]for k in ['bytes','geometryBytes','embeddedImageBytes','triangles','primitives']}})
 ids=sorted({p.name.split('.lod')[0]for p in (HERE/'exports').glob('*.glb')})
 for aid in ids:
  study=aid.startswith('surface-');lods=[]
  for level in ([0]if study else[0,1]):
   p=HERE/'exports'/f'{aid}.lod{level}{".inspection"if study else""}.glb';src=HERE/'source'/f'{aid}.lod{level}.blend';r=check_glb(p,aid,level,study,study);c.need(src.stat().st_size<20*1024**2,'compressed source size target');c.need(src.read_bytes()[:4] in (b'\x28\xb5\x2f\xfd',b'\x1f\x8b\x08\x00'),'actual compressed blend header');lods.append({'level':level,'file':str(p.relative_to(HERE)),'sha256':c.digest(p),'source':str(src.relative_to(HERE)),'sourceSha256':c.digest(src),**{k:r[k]for k in ['triangles','vertices','primitives','bytes','boundsM','geometryBytes','embeddedImageBytes']}})
  rr=c.measure_glb(HERE/lods[0]['file']);roles=rr['materialNames'];c.need(study or lods[1]['triangles']<lods[0]['triangles'],'LOD simplification')
  collision={'enabled':False,'reason':'No new walk/collision surface; existing ground owns height. Planter proxy is metadata for later review.'}
  if aid.startswith('planter'):collision['futureProxy']={'type':'aabb','min':rr['boundsM']['min'],'max':rr['boundsM']['max'],'walkable':False,'activation':'Only after footprint/door/road clearance and runtime collision approval'}
  assets.append({'id':aid,'taskId':'A02/C04'if study else('C04'if aid.startswith('curb')else'F03/C04'),'variant':'representative-offline-study'if study else'local-reusable-detail','kind':'surface-study'if study else'local-model','source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':rr['boundsM'],'expectedDimensionsM':([int(aid.rsplit('-',1)[1][:-1]),0,int(aid.rsplit('-',1)[1][:-1])] if study else {'curb-straight-1m':[1,.15,.18],'soil-grass-edge-1m':[.4,0,1],'planter-trough':[.8,.5,.6],'planter-round':[.65,.4,.65],'perennial-rosette':[.45,.30,.45],'perennial-tuft':[.304,.45,.289]}[aid]),'dimensionToleranceM':.04 if aid.startswith('perennial')else .02,'dimensionBasis':'Representative design dimensions verified from exported GLB; not surveyed landscape measurements','pivot':[0,0,0],'attachmentDatum':{'kind':'existing rendered ground surface','localY':0,'origin':'contact center; plane center for coupons; never a navigation elevation'},'frontAxis':'+Z','materialBindings':[{'material':role,'semanticRole':role.removeprefix('role-'),'sharedSurfaceId':role.removeprefix('role-'),'uvConvention':'UVMap normalized physical tile coordinates; multiply by tileMeters once to feed existing metre-UV city shader','tileMeters':REPEAT[role.removeprefix('role-')],'channels':{'baseColor':'sRGB','normal':'Non-Color OpenGL +Y','orm':'linear R=1 neutral AO, G roughness, B metallic'},'runtimeBinding':'explicit semantic-role binding, no color guessing','inspectionBinding':'exports/textures deduplicated PNGs; inspection-only unless separately approved'}for role in roles],'textureMode':'external-shared-inspection'if study else'role-placeholders-shared-consumer-binding','textureCost':{'geometryBytes':sum(l['geometryBytes']for l in lods),'embeddedImageBytes':0,'glbTotalBytes':sum(l['bytes']for l in lods),'uniqueTexelBytesWithMips':sum({i['sha256']:i['texelBytesWithMips']for i in rr['images']}.values()),'allPackageInspectionCostReference':'qa/measurements.json','notes':'Prop default files bind zero new maps. Existing production city atlas is referenced separately; reused vegetation maps are not assumed resident.'},'lodPolicy':{'levels':[l['level']for l in lods],'proposalDistancesM':[]if study else[0,20,55],'switch':'QA coupon has no runtime LOD'if study else'one LOD active; cull beyond 55m proposal; runtime threshold/hysteresis pending','preserve':'root datum, role identity, plant height, rigid footprints','populationChange':0},'clearance':{'contract':'placement-reference.json','mustReject':['road or sidewalk triangle overlap','door gap/sweep overlap','contour/holes/neighbor overlap','nonfinite or unsampled heights'],'rigidMaximumReliefM':.02,'surfaceMaxReliefM':.5,'newNavigation':False},'collision':collision,'anchors':[],'placementCompatibility':{'referenceOnly':True,'sourceReference':'placement-reference.json','sourceId':'137668','geographicPlacement':'unresolved runtime drape/clearance; coupons have no geographic placement','class':'existing source-selected planting contour; preserve 500-plot cap and two plant slots per bed','noNonUniformScaling':True,'rigidPlanterSelectedBedResult':'reject: 0.0557 m contour relief exceeds 0.02 m rigid tolerance'},'intendedConsumer':['lib/city/residential-ground.ts','lib/city/residential-ground-plan.ts','lib/city/road-surfaces.ts','lib/city/material-library.ts','lib/city/beach-ground.ts'],'offlineChecks':{'status':'pass','evidence':['qa/validation.json','qa/reimports.json','qa/artist-edit-proof.json','qa/render-evidence.json']},'runtimeChecks':{'status':'not_run','reason':'No WebGL terrain placement, navigation, GPU, frame time, device, lifecycle or deployment acceptance'}})
 for asset in assets:
  sample=HERE/'exports'/f'{asset["id"]}.lod0.inspection.glb';doc,blob=c.read_glb(sample)
  for binding in asset['materialBindings']:
   material=next(x for x in doc['materials'] if x['name']==binding['material']);pbr=material.get('pbrMetallicRoughness',{});maps={}
   for channel,slot in [('baseColor',pbr.get('baseColorTexture')),('normal',material.get('normalTexture')),('orm',pbr.get('metallicRoughnessTexture'))]:
    if slot is None:continue
    tex=doc['textures'][slot['index']];image=doc['images'][tex['source']];path=sample.parent/image['uri'];sampler=doc['samplers'][tex.get('sampler',0)]
    maps[channel]={'file':str(path.relative_to(HERE)),'sha256':c.digest(path),'wrapS':sampler.get('wrapS',10497),'wrapT':sampler.get('wrapT',10497),'colorSpace':'sRGB' if channel=='baseColor' else 'Non-Color'}
   binding['inspectionMaps']=maps
   binding['runtimeMapPolicy']='Existing engine-owned city atlas by named surface slot; do not load inspection derivative maps' if binding['semanticRole'] in ['concrete','asphalt','street-brick'] else 'Role-only props default to no maps; any optional candidate map binding must be explicitly selected and counted'
 m={'schemaVersion':1,'packageId':'ground-planting-details','version':'1.0.0','baseRevision':'752cd68b2664d7d87d1c89e31de2308b145ced3a','status':'offline_complete','integrationStatus':'runtime_pending_webgl','units':'metres','coordinateSystem':{'authoring':'Blender Z-up','export':'glTF Y-up','mapping':'(x,y,z) -> (x,z,-y), once'},'provenance':{'author':'Original additions based on Vancouver Living Atlas by YiTaChen','source':'https://github.com/YiTaChen/vancouver-living-atlas','license':'LicenseRef-Vancouver-Living-Atlas-NC-1.0','existingSources':['vegetation_ground maps and weight semantics','residential-perennial editable source and envelope','city-materials atlas and metre catalog'],'surveyClaim':False},'reexportCommand':'blender -b -t 2 --python-exit-code 1 --python tools/assets/ground-planting-details/export.py -- --source tools/assets/ground-planting-details/source --output /tmp/ground-reexport','validationCommand':'python tools/assets/ground-planting-details/validate.py','assets':assets,'textures':list(alltex.values()),'inspectionVariants':inspection,'referenceOnlyMetadata':['placement-reference.json','source-references.json'],'newRuntimePopulation':0,'replaces':[]}
 dump(HERE/'manifest.json',m);dump(HERE/'qa/measurements.json',{'status':'pass','files':allrows,'modelAssets':len(assets),'glbCount':len(allrows),'uniqueInspectionTextureCount':len(alltex),'uniqueInspectionTexelBytesWithMips':sum(t['uniqueTexelBytesWithMips']for t in alltex.values()),'uniqueInspectionPNGBytes':sum(t['bytes']for t in alltex.values()),'defaultPropAdditionalTextureBytes':0,'sourceTotalBytes':sum(p.stat().st_size for p in (HERE/'source').glob('*.blend')),'note':'All inspection resources counted, even reused offline vegetation maps. No GPU allocation claimed.'})

def validate():
 m=j(HERE/'manifest.json');results=c.validate(HERE);r=j(HERE/'qa/reimports.json');ed=j(HERE/'qa/artist-edit-proof.json');re=j(HERE/'qa/render-evidence.json');sel=j(HERE/'placement-reference.json');sand=j(HERE/'qa/sand-edit-proof.json');c.need(sand['status']=='pass' and sand['masterSourceSha256']==c.digest(HERE/'source/sand-procedural-master.blend') and sand['proceduralTintEditChangedActualBake'] and sand['changedGLBVerified'],'sand editable procedural source proof')
 visual=j(HERE/'qa/visual-review.json');c.need(visual['status']=='pass','visual review');
 c.need(ed['status']=='pass'and ed['allOriginalSourcesUnchanged']and all(ed['roundtripGLBs'].values()),'artist source proof');c.need(len(re['renders'])==32,'complete four-light/multiple-view/LOD matrix');c.need(sel['protectedState']['unchanged']and sel['existingPopulation']['plots']==500 and sel['existingPopulation']['plants']==1954,'source cohort protection');c.need(math.isfinite(sel['contourReliefM']),'source finite contour');positive=sel['positiveRigidPlanterFixture'];c.need(positive and positive['contourReliefM']<=.02 and abs(positive['containedAreaM2']-.48)<1e-6,'actual positive rigid source fixture')
 for row in r['files']:
  path=HERE/row['file'];c.need(c.digest(path)==row['sha256'],'reimport stale');aid=path.name.split('.lod')[0];lod=int(path.name.split('.lod')[1][0]);actual=check_glb(path,aid,lod,aid.startswith('surface-'),'.inspection.'in path.name)
  for k in ['min','max','size']:c.need(all(abs(a-b)<1e-5 for a,b in zip(actual['boundsM'][k],row['boundsM'][k])),'actual GLB Blender reimport bounds')
 for row in re['renders']:
  c.need(c.digest(HERE/row['file'])==row['sha256'],'render image stale')
  for imp in row['imports']:c.need(c.digest(HERE/imp['file'])==imp['sha256'],'rendered GLB stale')
 for path in (HERE/'exports').glob('*.inspection.glb'):
  doc,blob=c.read_glb(path)
  for mat in doc['materials']:
   for key,slot in [('normal',mat.get('normalTexture')),('orm',mat.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture'))]:
    if slot is None:continue
    image=doc['images'][doc['textures'][slot['index']]['source']];im=Image.open(path.parent/image['uri']).convert('RGB');pixels=list(zip(*[iter(im.tobytes())]*3))
    if key=='orm':c.need(all(p[0]==255 and p[2]==0 for p in pixels),'neutral AO/nonmetal ground ORM')
    else:c.need(all(p[2]>=128 for p in pixels),'tangent normal upper hemisphere')
 catalog=j(ROOT/'public/materials/city/manifest.json')
 for sid in ['concrete','asphalt','street-brick']:
  slot=next(i for i,x in enumerate(catalog['materials'])if x['id']==sid);x=slot%4*256+8;y=slot//4*256+8
  for channel in ['color','normal','orm']:
   original=Image.open(ROOT/'public/materials/city'/f'{channel}.png').convert('RGB');crop=original.crop((x,original.height-y-240,x+240,original.height-y));observed=Image.open(HERE/'qa/atlas-inspection'/f'{sid}-{channel}.png').convert('RGB');c.need(crop.tobytes()==observed.tobytes(),'city slot pixel/gamma preservation')
 for a in m['assets']:
  for l in a['lods']:
   c.need(l['sourceSha256']==c.digest(HERE/l['source']),'source hash stale');c.need(all(abs(x-y)<=a['dimensionToleranceM'] for x,y in zip(l['boundsM']['size'],a['expectedDimensionsM'])),'independent design dimension target')
 for row in j(HERE/'source-references.json')['files']:c.need(c.digest(ROOT/row['file'])==row['sha256'],'preserved source dependency hash changed')
 results['packageChecks']={'physicalCouponSizesAndUV':'pass','edgeSamplerAndLowFrequencyWeight':'pass','twoLODPropBudgets':'pass','sourceSelectionAndPopulation':'pass','sourcePreservingArtistExport':'pass','actualGLBReimport':'pass','cyclesCPU32ViewMatrix':'pass','runtime':'not_run'};dump(HERE/'qa/validation.json',results);print(json.dumps({'status':'pass','assets':len(m['assets']),'GLBs':len(r['files']),'previews':len(re['renders'])}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--finalize-manifest',action='store_true');a=p.parse_args()
 if a.finalize_manifest:finalize()
 validate()
