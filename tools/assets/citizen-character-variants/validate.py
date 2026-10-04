"""Read-only package validation; fails on stale/missing evidence or sources."""
import json,hashlib,struct,sys
from pathlib import Path
from PIL import Image
from glb_io import read_glb
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[2]
checks=[]
def check(name,fn):
 try:result=fn();checks.append({'name':name,'status':'pass','details':result})
 except Exception as exc:checks.append({'name':name,'status':'fail','error':str(exc)})
def require(value,message):
 if not value:raise AssertionError(message)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads((ROOT/p).read_text())
m=read('manifest.json')
check('common-root-schema',lambda:require(all(k in m for k in ['schemaVersion','packageId','version','baseRevision','status','units','coordinateSystem','provenance','reexportCommand','validationCommand','assets','textures']),'missing common manifest fields'))
check('unchanged-public-baseline',lambda:require(sha(REPO/m['provenance']['source'])=='14d66fabe097abf82ef36800561c06ee7263c0acfd6b5ea1265a40ed35841ff8','public baseline changed'))
all_image_uris=set();all_lods=[]
for asset in m['assets']:
 aid=asset['id'];required=['id','taskId','variant','kind','source','sourceSha256','lods','boundsM','expectedDimensionsM','dimensionToleranceM','dimensionBasis','pivot','attachmentDatum','frontAxis','materialBindings','textureMode','textureCost','lodPolicy','clearance','collision','anchors','placementCompatibility','intendedConsumer','offlineChecks','runtimeChecks']
 check(aid+':common-fields',lambda:require(all(k in asset for k in required),'missing common asset fields'))
 check(aid+':runtime-not-claimed',lambda:require(asset['runtimeChecks']['status']=='not_run'and asset['runtimeChecks']['integrationStatus']=='runtime_pending_webgl','false runtime acceptance'))
 for l in asset['lods']:
  all_lods.append(l);label=aid+':LOD'+str(l['level']);p=ROOT/l['glb'];s=ROOT/l['source']
  def package_check():
   require(sha(p)==l['sha256'],'GLB hash');require(sha(s)==l['sourceSha256'],'source hash');require(s.stat().st_size<20*1024**2,'source size');require(s.read_bytes()[:4]in [b'\x28\xb5\x2f\xfd',b'\x1f\x8b\x08\x00'],'source not compressed Blend');d,b=read_glb(p)
   triangles=sum(d['accessors'][q['indices']]['count']//3 for mesh in d['meshes']for q in mesh['primitives']);require(triangles==l['triangles']and triangles<=40000,'triangle budget/count');require(p.stat().st_size==l['bytes']and l['bytes']<4*1024**2,'GLB budget/count');require(l['standaloneDownloadBytesIncludingMaps']<4*1024**2,'geometry+required-shared-maps goal');require(all(len(skin['joints'])==22 for skin in d['skins']),'22 bones');require(not d.get('cameras')and not d.get('extensions',{}).get('KHR_lights_punctual'),'QA objects in GLB')
   require(all('uri'in im and 'bufferView'not in im for im in d['images']),'images must be external');require(len(d['images'])==3,'expected three shared maps')
   for im in d['images']:
    image=p.parent/im['uri'];require(image.resolve().is_relative_to(ROOT.resolve()),'image path escaped package');require(image.exists(),'missing external image');all_image_uris.add(im['uri']);pic=Image.open(image);pic.verify();require(pic.size==(1024,1024),'unexpected image size')
   for im in d.get('extensionsRequired',[]):require(im not in ['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'],'new runtime decoder')
   return {'triangles':triangles,'bytes':p.stat().st_size,'sourcesBytes':s.stat().st_size,'externalImages':len(d['images'])}
  check(label+':packaging-cost-rig',package_check)
  def bounds_check():
   v=l['boundsM'];require(all(abs(v['max'][i]-v['min'][i]-v['size'][i])<1e-8 for i in range(3)),'bounds min/max/size');require(all(abs(v['size'][i]-asset['boundsM']['size'][i])<.02 for i in range(3)),'LOD stature/silhouette bounds');return v
  check(label+':metric-bounds',bounds_check)
check('all-external-image-references-deduplicated',lambda:require(len(all_image_uris)==3,'runtime map references are not deduplicated'))
for x in m['textures']:
 def texcheck():
  p=ROOT/x['path'];require(sha(p)==x['sha256'],'texture hash');require(x['fileBytes']==p.stat().st_size,'image bytes');require(x['colorSpace']==('sRGB'if x['role']=='baseColor'else'Non-Color'),'color space');return {'role':x['role'],'bytes':x['fileBytes'],'sha256':x['sha256']}
 check('texture:'+x['id'],texcheck)
for name in ['cpu-tests','blender-reimport','artist-edit-proof','visual-review']:
 check('actual-evidence:'+name,lambda name=name:require(read('qa/'+name+'.json')['status']=='pass',name+' has not passed'))
check('fresh-blender-reimport-hashes',lambda:require(all(a.get('sha256')==sha(ROOT/'exports'/a['file'])for a in read('qa/blender-reimport.json')['assets']),'stale/unbound Blender reimport'))
check('three-lod-driver-study-clearance-and-inspection-only-status',lambda:require(all(read('qa/'+name+'.json')['status']=='inspection_only'and read('qa/'+name+'.json')['clearanceStatus']=='pass'for name in ['driver-fit','driver-fit-lod1','driver-fit-lod2']),'Rejected study must remain inspection-only despite clear study-pose solids'))
def preserved_check():
 records=read('qa/source-preserving-export.json');require(len(records)==len(all_lods),'all manifest sources must re-export');require({r['source']for r in records}=={Path(l['source']).name for l in all_lods},'exact source inventory mismatch');out=[]
 for r in records:
  source=ROOT/'source'/r['source'];require(r['sourceSha256Before']==r['sourceSha256After']==sha(source),'source overwritten or stale proof');require(r['outputSha256']==sha(ROOT/'exports'/r['output']),'source re-export differs from canonical output');out.append(r['source'])
 return {'sourceCount':len(out),'hashIdenticalCanonicalExports':True}
check('preserved-source-reexport-equals-final',preserved_check)
def source_partitions():
 allrows=read('qa/source-preserving-export.json');baseline=read('qa/source-preserving-export-baseline.json');natural=read('qa/source-preserving-export-natural-driver.json');require(len(baseline)==9 and len(natural)==3,'baseline/new source evidence counts');require(sorted(baseline+natural,key=lambda r:r['source'])==sorted(allrows,key=lambda r:r['source']),'partitioned source evidence differs from final combined export');return {'originalSources':9,'optionalNaturalSources':3}
check('baseline-and-natural-source-proofs-preserved-separately',source_partitions)
def integration_gates():
 study=next(a for a in m['assets']if a['variant']=='driver');natural=next(a for a in m['assets']if a['variant']=='driver-roadster-fit')
 require(study['integrationEligible']is False and study['integrationMode']=='inspection-only'and study['placementCompatibility']['runtimeSelectable']is False,'rejected driver study could be selected')
 require(natural['integrationEligible']is True and natural['integrationMode']=='optional-profile-only','natural driver lacks explicit eligibility gate');dep=natural['requiredCockpit'];require(dep['packageId']=='roadster-driver-fit','incorrect cockpit dependency')
 require(sha(REPO/dep['specs']['file'])==dep['specs']['sha256'],'cockpit specs changed')
 for row in dep['lods']:
  require(sha(REPO/row['file'])==row['sha256'],'cockpit GLB changed');r=json.loads((REPO/'tools/assets/roadster-driver-fit/qa'/f"driver-fit-lod{row['level']}.json").read_text());require(r['geometryContactStatus']=='pass','static cockpit fit failed');require(r['sourceHumanSha256']==sha(ROOT/'exports'/f"driver-roadster-fit.lod{row['level']}.glb"),'stale cockpit character evidence');require(r['cockpitGlbSha256']==row['sha256']and r['cockpitSpecSha256']==dep['specs']['sha256'],'stale cockpit dependency proof')
 return {'inspectionOnly':'driver','eligibleOnlyWithPinnedProfile':'driver-roadster-fit','staticPoseOnly':True}
check('explicit-inspection-gate-and-cockpit-dependency',integration_gates)

def render_check():
 evidence=read('qa/render-evidence.json');files={r['file']for r in evidence};require(len(evidence)==len(files),'duplicate render evidence');require(len(files)>=31,'missing previews');required={f'qa/previews/{k}-{v}.png'for k in [a['variant']for a in m['assets']]for v in ['front','side','back']};required|={f'qa/previews/{k}-lods-{l}.png'for k in [a['variant']for a in m['assets']]for l in ['sunny','overcast','dusk','night']};required|={f'qa/previews/citizen-lod{i}-critical-waist.png'for i in range(3)};require(required<=files,'required view absent')
 for e in evidence:
  require((ROOT/e['file']).exists(),'missing preview file');require(e['device']=='CPU'and e['renderer']=='Cycles'and e['threads']==2,'render environment');pic=Image.open(ROOT/e['file']);pic.verify()
  for source in e['inputs']:
   p=REPO/source['file'];require(p.exists()and sha(p)==source['sha256'],'render uses stale source '+source['file'])
 return {'count':len(files),'allInputsHashVerified':True}
check('fresh-glb-cycles-previews',render_check)
failed=[c for c in checks if c['status']=='fail'];report={'schemaVersion':1,'packageId':m['packageId'],'status':'fail'if failed else'pass','passed':len(checks)-len(failed),'failed':len(failed),'checks':checks,'runtimeChecks':{'status':'not_run','integrationStatus':'runtime_pending_webgl'}};(ROOT/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'passed':report['passed'],'failed':failed},indent=2));sys.exit(bool(failed))
