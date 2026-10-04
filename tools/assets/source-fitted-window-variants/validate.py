"""Independent actual-GLB opening, stop, normals/UV, datum and package audit."""
import importlib.util,json,math,sys,subprocess,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def load(n,p):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
common=load('windows_common',HERE.parent/'package-contract/validate.py');geom=load('windows_geometry',HERE.parent/'facade-fit-contracts/geometry.py');need=common.need

def check_source_fingerprints(fingerprints, baseline_revision):
 need(isinstance(baseline_revision,str) and len(baseline_revision)==40 and all(c in '0123456789abcdef' for c in baseline_revision),'recorded base revision')
 for path,sha in fingerprints.items():
  if path.startswith('lib/city/') and path.endswith(('.ts', '.js')):
   data=subprocess.check_output(['git','show',baseline_revision+':'+path],cwd=ROOT)
   observed=hashlib.sha256(data).hexdigest()
  else:
   observed=common.digest(ROOT/path)
  need(observed==sha,'historical consumer/protected asset drift: '+path)

def check_aperture(triangles,points,d):
 w,h,s=d['openingWidthM'],d['openingHeightM'],d['sectionM'];back=d['backZ'];front=back+d['depthM'];stop=d['stopRearZ'];thick=d['stopThicknessM'];e=d['revealExtraM'];center=[0,s+h/2,stop+thick/2]
 bounds={'min':[-w/2,s,back-.01],'max':[w/2,s+h,front+.01]};checks=geom.check_open_volume(triangles,bounds)
 for sign in [-1,1]:
  for axis,wanted in [(0,w/2),(1,h/2)]:
   direction=[sign if a==axis else 0 for a in range(3)];hits=geom.ray_hits(triangles,center,direction,5);need(hits and abs(hits[0]-wanted)<2e-5,'measured aperture edge mismatch')
 probes=[]
 for x,y,name in [(w/2+e/2,s+h/2,'right'),(-w/2-e/2,s+h/2,'left'),(0,s-e/2,'bottom'),(0,s+h+e/2,'top')]:
  origin=[x,y,front+.1];hits=geom.ray_hits(triangles,origin,[0,0,-1],front+.2)
  for z in [stop,stop+thick]:need(any(abs(t-(origin[2]-z))<2e-5 for t in hits),'missing physical glass stop front/back')
  probes.append({'side':name,'intersectionsZ':sorted(round(origin[2]-t,7) for t in hits)})
 # Surround must be present: absence of all frame geometry cannot pass open rays.
 for x,y in [(w/2+s*.65,s+h/2),(-w/2-s*.65,s+h/2),(0,s*.35),(0,s+h+s*.65)]:need(geom.ray_hits(triangles,[x,y,front+.1],[0,0,-1],front+.2),'missing solid frame')
 need(any(abs(p[2]-front)<2e-5 for p in points) and any(abs(p[2]-(front-d['bevelM']))<2e-5 for p in points),'physical front bevel missing')
 return {**checks,'apertureEdgeRays':4,'measuredClearApertureM':[w,h],'glassStopRearM':stop,'glassStopThicknessM':thick,'fourSidedStopProbes':probes,'solidFrameProbes':4}

def check_channels(doc,bin,d):
 for mesh in doc['meshes']:
  for pr in mesh['primitives']:
   a=pr['attributes'];need(all(k in a for k in ['POSITION','NORMAL','TEXCOORD_0','TANGENT']),'position normal UV tangent required');p=common.accessor(doc,bin,a['POSITION']);n=common.accessor(doc,bin,a['NORMAL']);uv=common.accessor(doc,bin,a['TEXCOORD_0']);t=common.accessor(doc,bin,a['TANGENT']);tile=d['tileMeters']
   for q,normal,tex,tan in zip(p,n,uv,t):
    need(abs(sum(normal[i]*tan[i] for i in range(3)))<.005 and abs(sum(tan[i]**2 for i in range(3))-1)<.005 and abs(abs(tan[3])-1)<1e-5,'tangent frame invalid')
    axes=[i for i in range(3) if abs(normal[i])>=max(abs(x) for x in normal)-1e-5];candidates=[]
    for axis in axes:
     u,v=(q[2],q[1]) if axis==0 else ((q[0],q[2]) if axis==1 else (q[0],q[1]));candidates.append([u/tile[0],1-v/tile[1]])
    need(any(max(abs(x-y) for x,y in zip(tex,c))<1e-5 for c in candidates),'metric shared-tile UV drift')
   inds=[i[0] for i in common.accessor(doc,bin,pr['indices'])]
   for i in range(0,len(inds),3):
    aa,bb,cc=[p[j] for j in inds[i:i+3]];u=[bb[k]-aa[k] for k in range(3)];v=[cc[k]-aa[k] for k in range(3)];cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];norm=math.sqrt(sum(x*x for x in cross));need(all(sum(cross[k]/norm*n[j][k] for k in range(3))>.99 for j in inds[i:i+3]),'normal/winding mismatch')

def validate_geometry(path,d,lod):
 doc,bin=common.read_glb(path);r=common.measure_glb(path);need(r['triangles']<=[256,80][lod],'triangle budget');need(r['geometryBytes']<=[65536,24576][lod],'geometry bytes budget');need(r['primitives']==1,'one batched opaque primitive');need(r['embeddedImageBytes']==0 and not doc.get('images'),'no private maps');need(r['materialNames']==[d['surfaceId']],'semantic role');need(r['nodeNames']==['window-frame'],'stable node identity; no QA leakage')
 expected={'min':[-d['openingWidthM']/2-d['sectionM'],0,d['backZ']],'max':[d['openingWidthM']/2+d['sectionM'],d['openingHeightM']+2*d['sectionM'],d['backZ']+d['depthM']]}
 for key in ['min','max']:need(all(abs(x-y)<2e-5 for x,y in zip(r['boundsM'][key],expected[key])),'dimension or root datum drift')
 nodes=doc['nodes'];need(all(n.get('scale',[1,1,1])==[1,1,1] and n.get('translation',[0,0,0])==[0,0,0] for n in nodes),'no runtime scale/translation compensation')
 check_channels(doc,bin,d)
 tris,points=geom.mesh_triangles(path);seen=set()
 for tri in tris:
  key=tuple(sorted(tuple(round(x,7) for x in p) for p in tri));need(key not in seen,'duplicate triangle');seen.add(key)
 return {'status':'pass',**r,'opening':check_aperture(tris,points,d),'metricUV':'pass','outwardNormalsTangents':'pass'}

def validate_sill(path,d,lod):
 doc,bin=common.read_glb(path);r=common.measure_glb(path);need(r['triangles']<=[256,80][lod] and r['geometryBytes']<=[65536,24576][lod],'sill budget');need(r['primitives']==1 and r['materialNames']==[d['surfaceId']],'sill shared semantic primitive');need(not doc.get('images') and r['embeddedImageBytes']==0,'no sill maps');need(r['nodeNames']==['window-sill'],'stable sill node');check_channels(doc,bin,d)
 profile=d['profilesZYByLod'][str(lod)];expected={'min':[-d['widthM']/2,min(p[1] for p in profile),d['backZ']],'max':[d['widthM']/2,d['topY'],d['backZ']+d['depthM']]}
 for key in ['min','max']:need(max(abs(x-y) for x,y in zip(r['boundsM'][key],expected[key]))<2e-5,'sill dimensions or shared-root drift')
 need(r['boundsM']['max'][1]<=-.006+1e-7,'sill enters lower frame');tris,points=geom.mesh_triangles(path)
 z=(d['backZ']+d['backZ']+d['depthM'])/2;expected_top=[]
 for a,b in zip(profile,profile[1:]+profile[:1]):
  if min(a[0],b[0])<=z<=max(a[0],b[0]) and abs(a[0]-b[0])>1e-8:expected_top.append(a[1]+(b[1]-a[1])*(z-a[0])/(b[0]-a[0]))
 hits=geom.ray_hits(tris,[0,1,z],[0,-1,0],2);need(hits and abs((1-hits[0])-max(expected_top))<2e-5,'actual sloped sill surface missing');need(geom.ray_hits(tris,[0,-.10,.5],[0,0,-1],.6),'physical sill nose/drip missing')
 return {'status':'pass',**r,'sharedRoot':True,'maximumYBelowFrameM':r['boundsM']['max'][1],'slopedTopRayY':1-hits[0],'physicalNoseProbe':'pass','metricUV':'pass','outwardNormalsTangents':'pass'}

def check_combined(framepath,sillpath,d,sill,lod):
 frame=validate_geometry(framepath,d,lod);sr=validate_sill(sillpath,sill,lod);need(sill['frameId']==d['id'],'paired identity mismatch');gap=frame['boundsM']['min'][1]-sr['boundsM']['max'][1];need(abs(gap-.006)<2e-5,'combined frame/sill overlap or attachment gap drift')
 # Exact separating plane proves every actual transformed triangle disjoint,
 # stronger than finite sampling. Aperture clipping includes BOTH actual GLBs.
 ft,fp=geom.mesh_triangles(framepath);st,sp=geom.mesh_triangles(sillpath);need(max(p[1] for p in sp)<min(p[1] for p in fp),'actual combined GLB intersections');ap=check_aperture(ft+st,fp+sp,d)
 return {'status':'pass','assetId':d['id'],'sillAssetId':sill['id'],'lod':lod,'frameGlbSha256':common.digest(framepath),'sillGlbSha256':common.digest(sillpath),'sharedRootTranslationM':[0,0,0],'actualVerticalSeparationM':gap,'nonOverlapMethod':'strict separating Y plane over all transformed vertices of both actual GLBs','opening':ap,'combinedTriangles':frame['triangles']+sr['triangles'],'combinedPrimitives':2,'existingSillMustBeSuppressed':True}

def validate(root=HERE):
 root=Path(root);m=json.loads((root/'manifest.json').read_text());specs=json.loads((root/'designs.json').read_text());sills=json.loads((root/'sill-designs.json').read_text());report=common.validate(root);results=[]
 need(m['textures']==[] and {a['id'] for a in m['assets']}==set(specs)|set(sills),'isolated four-asset package')
 source=json.loads((root/'qa/source-fixtures.json').read_text());audit=json.loads((root/'qa/blender-audit.json').read_text());proof=json.loads((root/'qa/source-edit-preservation.json').read_text());previews=json.loads((root/'qa/preview-index.json').read_text());fits=json.loads((root/'qa/positive-fit-fixtures.json').read_text())
 assembly_previews=json.loads((root/'qa/assembly-preview-index.json').read_text());need(assembly_previews['status']=='pass' and assembly_previews['visualReview']['status']=='pass' and len(assembly_previews['images'])==24,'assembly previews reviewed');need(len(json.loads((root/'qa/positive-assembly-fixtures.json').read_text())['results'])==4,'four actual positive assembly fixtures')
 need(len(assembly_previews['inputGlbSha256'])==8,'eight paired preview input GLBs')
 for file,sha in assembly_previews['inputGlbSha256'].items():need(common.digest(root/file)==sha,'paired assembly rendered GLB drift')
 need(audit['status']==proof['status']==previews['status']==fits['status']=='pass','required offline evidence');need(len(audit['results'])==len(proof['results'])==8 and len(fits['results'])==4,'all four sources/LODs audited');need(previews['visualReview']['status']=='pass','visual review required');need(len(previews['images'])==24,'24 compact actual-GLB previews')
 check_source_fingerprints(source['sourceFingerprints'],m['baseRevision'])
 live=subprocess.run(['node',str(HERE/'source_fixtures.mjs'),'--check'],cwd=ROOT,text=True,capture_output=True,timeout=120)
 need(live.returncode==0,'current source geometry/profile fit drift: '+live.stderr)
 for image in previews['images']+assembly_previews['images']:need(common.digest(root/image['file'])==image['sha256'],'preview stale');need(image['device']=='CPU' and image['engine']=='Cycles','CPU preview required')
 for a in m['assets']:
  is_sill=a['id'] in sills;need(a['attachmentDatum']['kind']==('shared-window-frame-root' if is_sill else 'outer-frame-bottom-at-wall-plane') and a['frontAxis']=='+Z','datum semantics');d=(sills if is_sill else specs)[a['id']]
  need(len(a['materialBindings'])==1 and a['materialBindings'][0]['role']==d['surfaceId'] and a['materialBindings'][0]['surfaceId']==d['surfaceId'],'manifest semantic binding');need(a['materialBindings'][0]['maps']=={},'no private map binding');need(a['collision']['kind']=='none','preserve GIS collision');need(abs(a['attachmentDatum']['sectionM']-d['sectionM'])<1e-8,'frame section datum metadata')
  for l in a['lods']:
   need(a['materialBindings'][0]['primitiveBindingsByLod'][str(l['level'])]==[{'node':'window-sill' if is_sill else 'window-frame','primitive':0}],'manifest primitive binding');need(any(p['originalSourceSha256']==l['sourceSha256'] for p in proof['results']),'stale artist source proof')
   need((assembly_previews if is_sill else previews)['inputGlbSha256'][l['file']]==l['sha256'],'rendered GLB drift');need(any(q['sourceSha256']==l['sourceSha256'] and q['lod']==l['level'] for q in audit['results']),'source audit stale');need((root/l['source']).stat().st_size<20*1024*1024,'source compressed size cap')
   r=(validate_sill if is_sill else validate_geometry)(root/l['file'],d,l['level']);results.append({'assetId':a['id'],'lod':l['level'],**r})
   for key in ['min','max','size']:need(max(abs(x-y) for x,y in zip(r['boundsM'][key],a['boundsM'][key]))<2e-5,'LOD datum/bounds drift')
 combined=[]
 for frameid,d in specs.items():
  sill=next(s for s in sills.values() if s['frameId']==frameid)
  for lod in [0,1]:combined.append(check_combined(root/'exports'/f'{frameid}.lod{lod}.glb',root/'exports'/f'{sill["id"]}.lod{lod}.glb',d,sill,lod))
 return {'status':'pass','optionalPairedAssemblies':combined,'commonContract':'pass','results':results,'sourceFixtures':2,'positiveLodFits':4,'positiveAssemblyLodFits':4,'sourceEditPreservation':'pass','previews':48,'protectedSourceAndLegacyHashes':'pass','runtimeStatus':'runtime_pending_webgl','runtimeChecks':'not_run'}
if __name__=='__main__':
 report=validate();(HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');(HERE/'qa/common-validation.json').write_text(json.dumps(common.validate(HERE),indent=2)+'\n');print(json.dumps(report,indent=2))
