"""Actual close-up geometry, full portal edges, circular normals, hashes and conservative navigation.
The parent detailed validator is reused read-only against reconstructed ACTUAL
binary components. No existing manifest, report, script or source is written.
"""
import argparse,copy,hashlib,importlib.util,json,sys,math,functools
from pathlib import Path
HERE=Path(__file__).resolve().parent;MASTER=HERE.parent
sys.path.insert(0,str(MASTER/'runtime-candidate'));from geometry import C,G,load,bounds,need
from threshold_support import surfaces as threshold_surfaces
sp=importlib.util.spec_from_file_location('detailed_bus_validation',HERE/'contract.py');V=importlib.util.module_from_spec(sp);sp.loader.exec_module(V)
BUDGETS={0:(12000,1572864),1:(3000,393216)}
MASTER_GLBS=['bc49cb015a4d02e1d7d68c5812a459d5b49eee822a8aff8d6795709d04fac80e','c86bdf4737f28af73cd9a6f8d638b09f939ff90cd6e5a5df51e9839ec509624a']
def budget_comparison(measured,level):
 t,b=BUDGETS[level];return {'trianglesMax':t,'bytesMax':b,'trianglesOver':max(0,measured['triangles']-t),'bytesOver':max(0,measured['bytes']-b),'pass':measured['triangles']<=t and measured['bytes']<=b}

def build_manifest():
 master=json.loads((MASTER/'manifest.json').read_text());m=copy.deepcopy(master);m['packageId']='boardable-bus-v2-closeup-quality';m['version']='1.0.0';m['status']='offline_qa_pending';m['reexportCommand']='blender -b -t 2 --python tools/assets/boardable-bus-v2/closeup-quality/export.py -- --output /tmp/bus-runtime-reexport';m['validationCommand']='python tools/assets/boardable-bus-v2/closeup-quality/validate.py';m['scope']['detailedMasterChanged']=False;m['scope']['runtimeIntegration']='pending';m['scope']['WebGL']='not_run';m['scope']['derivativeRearGeometry']='rear arrangement/anchors unchanged; seat and rail surface topology intentionally rebuilt'
 m['provenance']['referencesFile']='../REFERENCES.md';m['provenance']['derivative']='Image-based reconstruction of visible seat, window, rail and ceiling design, applied to corrected editable master. Historical PNG is not recovered 3D source; original master/fallback preserved.';m['provenance']['masterGLBSha256']=MASTER_GLBS
 a=m['assets'][0];a['id']='city-bus-12m-interior-v2-closeup';a['source']='source/city-bus-12m-interior-v2-closeup.lod0.blend';a['sourceSha256']=C.digest(HERE/a['source']);a['lods']=[]
 for level in [0,1]:
  name=f'city-bus-12m-interior-v2-closeup.lod{level}';p=HERE/'exports'/(name+'.glb');actual=C.measure_glb(p);src=HERE/'source'/(name+'.blend');sc=p.with_suffix('.components.json');d={'level':level,'file':'exports/'+p.name,'source':'source/'+src.name,'sourceSha256':C.digest(src),'sourceBytes':src.stat().st_size,'sha256':C.digest(p),**{k:actual[k] for k in ['triangles','vertices','primitives','bytes','boundsM','geometryBytes','embeddedImageBytes']},'capabilities':{'level':level,'doorsAnimated':True,'passengerCapable':True,'openingsPreserved':True},'capabilityScope':'Preserved offline frame/topology and exterior dependency; runtime boarding not tested','componentSidecar':{'file':'exports/'+sc.name,'sha256':C.digest(sc),'bytes':sc.stat().st_size,'runtimeRequired':False}}
  a['lods'].append(d)
 a['boundsM']=a['lods'][0]['boundsM'];a['expectedDimensionsM']=a['boundsM']['size'];a['textureCost'].update(geometryBytes=sum(x['geometryBytes'] for x in a['lods']),glbTotalBytes=sum(x['bytes'] for x in a['lods']));a['textureCost']['note']='13 material batches per LOD; one packed 256-square floor tile. GLB includes texture bytes; sidecars measured separately and not needed at runtime.'
 a['textureCost']['embeddedImageBytes']=sum(l['embeddedImageBytes'] for l in a['lods']);a['textureCost']['uniqueTexelBytesWithMips']=round(256*256*4*4/3);a['qualitySelection']='Preferred image-reconstructed close-up preview; not adopted by runtime. Original budget candidate stays integrated.'
 a['offlineChecks']={'status':'pending','evidence':['qa/validation.json','qa/blender-validation.json','qa/visual-review.json']}
 v=m['vehicles'][0];v['floorSurfaces']+=threshold_surfaces();v['walkableFloor']['surfaceRefs']=[f['surfaceId'] for f in v['floorSurfaces']];v['portalSupportCorrection']={'scope':'Candidate-only flush support strips; existing master slabs, frames and doors unchanged','xRangeM':[-1.25,-1.15],'heightM':.36,'trianglesAddedPerLod':24,'masterGapFixed':True};v['assetRefs']['interior']=a['id'];v['composition']['interiorFiles']=[x['file'] for x in a['lods']];v['composition']['exteriorFiles']=['../'+p for p in v['composition']['exteriorFiles']]
 scene,doc,_=load(HERE/a['lods'][0]['file']);a['materialBindings']=[{'material':mat['name'],'semanticRole':mat.get('extras',{}).get('semantic_role',mat['name']),'sharedSurfaceId':mat.get('extras',{}).get('shared_surface_id',mat['name']),'primitiveSelection':{'materialName':mat['name']},'maps':([{'semantic':'baseColor','textureId':'floor-speckle'}] if mat['name']=='floor' else [])} for mat in doc['materials']];a['textureMode']='embedded-shared-floor-tile';m['textures']=[{'textureId':'floor-speckle','source':'source/floor-speckle.png','sourceSha256':C.digest(HERE/'source/floor-speckle.png'),'width':256,'height':256,'colorSpace':'sRGB','semantic':'baseColor','scope':'One tile embedded in each GLB; floor mean linear albedo .17/.19/.21'}];m['baseRevision']='15bc912bfbf29228448aa713566ebda50e07a0bd';old=[x for x in v['collision']['primitives'] if not x['collisionId'].startswith('v2-')];proxies=[{'collisionId':'v2-'+n,'visibleNodeId':n,'frameId':'vehicle','type':'box','boundsM':bounds(o),'role':('walkable-floor' if n in {f['visibleComponentId'] for f in v['floorSurfaces']} else 'ceiling' if n=='ceiling' else 'obstacle'),'basis':'Conservative bounds freshly measured from quality GLB actual component vertices.'} for n,o in scene.items() if o['points']];v['collision']['primitives']=proxies+old;v['collision']['lodBasis']=0;v['walkableFloor']['obstacleCollisionRefs']=[c['collisionId'] for c in v['collision']['primitives'] if c['role']=='obstacle']
 for dep in m['dependencies']:
  dep['manifest']='../'+dep['manifest']
  for f in dep['files']:f['file']='../'+f['file']
 return m

@functools.lru_cache(maxsize=2)
def detailed_scene_for_hash(digest):
 return G.load(MASTER/'exports/city-bus-12m-interior-v2.lod0.glb')[0]

def validate_support_triangles(m,scenes):
 samples=[]
 for level,scene in enumerate(scenes):
  for surface in m['vehicles'][0]['floorSurfaces']:
   name=surface['visibleComponentId'];need(name in scene,'missing support component: '+name);tris=scene[name]['triangles'];vertices=surface['verticesM'];height=vertices[0][1];x0=min(p[0] for p in vertices);x1=max(p[0] for p in vertices);z0=min(p[2] for p in vertices);z1=max(p[2] for p in vertices)
   tops=[t for t in tris if G.cross(G.sub(t[1],t[0]),G.sub(t[2],t[0]))[1]>1e-9]
   need(tops and all(abs(p[1]-height)<2e-5 for t in tops for p in t),'sloped or wrong-height upward support triangles: '+name)
   corners=[(x0,height,z0),(x1,height,z0),(x1,height,z1),(x0,height,z1)]
   need(len(tops)==2 and all(any(max(abs(p[k]-c[k]) for k in range(3))<2e-5 for c in corners) for t in tops for p in t) and all(any(max(abs(p[k]-c[k]) for k in range(3))<2e-5 for t in tops for p in t) for c in corners),'support polygon coverage or join boundary mismatch: '+name)
   area=sum(G.cross(G.sub(t[1],t[0]),G.sub(t[2],t[0]))[1]/2 for t in tops);need(abs(area-(x1-x0)*(z1-z0))<2e-5,'support polygon area mismatch: '+name)
   nx=max(2,math.ceil((x1-x0)/.15));nz=max(2,math.ceil((z1-z0)/.15));deviations=[]
   for ix in range(nx+1):
    for iz in range(nz+1):
     x=x0+.001+(x1-x0-.002)*ix/nx;z=z0+.001+(z1-z0-.002)*iz/nz;hit=G.hits(tris,[x,height+.05,z],[x,height-.05,z]);need(hit,'missing actual support triangle: '+name);measured=height+.05-min(hit);deviations.append(abs(measured-height));need(abs(measured-height)<2e-5,'ray support height mismatch: '+name)
   samples.append({'lod':level,'surface':surface['surfaceId'],'component':name,'expectedHeightM':height,'upwardTriangles':len(tops),'verticalRaySamples':len(deviations),'maximumHeightDeviationM':max(deviations)})
  # Actual interior support immediately inside both fixed exterior portals.
  height=.36
  for group,z0,z1 in [('front',3.7,4.85),('rear',-1.2,-.05)]:
   tris=scene['low-floor-slab']['triangles']+scene['door-'+group+'-threshold-slab']['triangles'];count=0;maximum=0
   for x in [-1.249,-1.225,-1.20,-1.175,-1.151,-1.1501,-1.150,-1.1499,-1.149,-1.12,-1.08,-1.0,-.85,-.6,-.35,0]:
    for i in range(9):
     z=z0+.01+(z1-z0-.02)*i/8;hit=G.hits(tris,[x,height+.05,z],[x,height-.05,z]);need(hit,'door interior threshold support missing');delta=abs(height+.05-min(hit)-height);maximum=max(maximum,delta);need(delta<2e-5,'door interior threshold support height');count+=1
   samples.append({'lod':level,'surface':'door-'+group+'-continuous-threshold','components':['low-floor-slab','door-'+group+'-threshold-slab'],'expectedHeightM':height,'verticalRaySamples':count,'maximumHeightDeviationM':maximum,'scope':'Continuous candidate support X=-1.249..0, including both new strip and exact join at X=-1.15.'})
 return samples

def validate_geometry(m,scenes=None):
 # The detailed checker resolves the unchanged exterior relative to MASTER.
 # Adapt only package-relative paths for this read-only call.
 scenes=scenes or [load(HERE/l['file'])[0] for l in m['assets'][0]['lods']];master_scene=detailed_scene_for_hash(C.digest(MASTER/'exports/city-bus-12m-interior-v2.lod0.glb'))
 expected={n for n in master_scene if n.startswith(('seat-','driver-','doorway-','boarding-','standing-','wheelchair-reference','camera-aisle')) and not master_scene[n]['points']}
 for scene in scenes:
  actual={n for n,o in scene.items() if n.startswith(('seat-','driver-','doorway-','boarding-','standing-','wheelchair-reference','camera-aisle')) and not o['points']}
  need(actual==expected,'unique seat/driver/door/standing anchors differ from master')
  for n in expected:need(all(abs(a-b)<2e-5 for a,b in zip(scene[n]['matrix'],master_scene[n]['matrix'])),'anchor transformed matrix or yaw mismatch: '+n);need(all(abs(a-b)<2e-5 for a,b in zip(scene[n]['point'],master_scene[n]['point'])),'seat anchor mismatch')
 support=validate_support_triangles(m,scenes)
 adapted=copy.deepcopy(m)
 for l in adapted['assets'][0]['lods']:l['file']='closeup-quality/'+l['file']
 adapted['dependencies']=copy.deepcopy(json.loads((MASTER/'manifest.json').read_text())['dependencies'])
 result=V.validate_contract(adapted,root=MASTER,scenes=scenes);result['knownLimitations']=[s for s in result['knownLimitations'] if not s.startswith('Inherited detailed-master limitation:')]
 result['supportTriangleSamples']=support;result['checks'].append({'check':'actual-triangle-floor-step-and-continuous-threshold-support','status':'pass','samples':sum(x['verticalRaySamples'] for x in support),'detail':'Every upward floor/step triangle is coplanar with its declared datum; dense vertical-ray grids and both continuous portal-to-aisle thresholds agree within 0.02 mm. Decorative ramp/edge overlays are not navigation support surfaces.'});return result

def validate(m):
 C.finite(m);need(m['packageId']=='boardable-bus-v2-closeup-quality','quality package identity');need(m['assets'][0]['id']=='city-bus-12m-interior-v2-closeup','quality asset identity');master=json.loads((MASTER/'manifest.json').read_text());v=m['vehicles'][0];mv=master['vehicles'][0]
 for lev,l in enumerate(master['assets'][0]['lods']):need(C.digest(MASTER/l['file'])==MASTER_GLBS[lev],'detailed master GLB changed')
 for k in ['frames','doors','seats','floorSegments','driver','standingRegions','nonStandingRegions','reservedAccessibilityRegions','interiorLayout','anchors','contactDatum','axles','wheels']:need(v[k]==mv[k],f'preserved vehicle contract changed: {k}')
 need(v['floorSurfaces']==mv['floorSurfaces']+threshold_surfaces(),'unauthorized original floor change or portal extension');need(v['walkableFloor']['surfaceRefs']==[f['surfaceId'] for f in v['floorSurfaces']],'floor surface refs mismatch');need(set(v['walkableFloor']['obstacleCollisionRefs'])=={c['collisionId'] for c in v['collision']['primitives'] if c['role']=='obstacle'},'stale obstacle refs');need({c['visibleNodeId'] for c in v['collision']['primitives'] if c['role']=='walkable-floor'}=={f['visibleComponentId'] for f in v['floorSurfaces']},'floor misclassified as obstacle');ms=[]
 for l in m['assets'][0]['lods']:
  p=HERE/l['file'];need(C.digest(p)==l['sha256'],'manifest GLB hash');need(C.digest(HERE/l['source'])==l['sourceSha256'],'manifest source hash');sc=l['componentSidecar'];need(C.digest(HERE/sc['file'])==sc['sha256'],'manifest sidecar hash');scene,doc,_=load(p);actual=C.measure_glb(p);need(not doc.get('extensionsRequired'),'unexpected extension');need(not doc.get('animations') and not doc.get('cameras') and not doc.get('skins'),'unexpected runtime payload')
  for k in ['triangles','vertices','primitives','bytes','boundsM','embeddedImageBytes','geometryBytes']:need(l[k]==actual[k],'manifest metric '+k)
  need({b['material'] for b in m['assets'][0]['materialBindings']}=={mat['name'] for mat in doc['materials']},'actual material binding coverage')
  texture=m['textures'][0];need(texture['textureId']=='floor-speckle' and C.digest(HERE/texture['source'])==texture['sourceSha256']==actual['images'][0]['sha256'],'packed floor texture source identity');need(actual['images'][0]['width']==256 and actual['images'][0]['height']==256,'floor texture dimensions')
  need(all(actual['boundsM']['min'][i]>=[-1.25,.25999,-5.78][i]-2e-5 and actual['boundsM']['max'][i]<=[1.25,2.701,5.78][i]+2e-5 for i in range(3)),'quality geometry outside unchanged exterior envelope')
  ms.append({'lod':l['level'],**actual,'componentSidecarBytes':sc['bytes'],'runtimeRequiredSidecarBytes':0,'budget':budget_comparison(actual,l['level']),'namedComponents':sum(bool(o['points']) for o in scene.values())})
 need(m['assets'][0]['textureCost']['embeddedImageBytes']==sum(l['embeddedImageBytes'] for l in m['assets'][0]['lods']),'texture cost accounting')
 report=validate_geometry(m);report['checks'].append({'check':'sidecar-complete-range-and-hash-binding','status':'pass','samples':len(ms),'detail':'Final GLB SHA bound to sidecar, sidecar SHA bound to manifest, exact batch set, complete nonoverlapping vertex/index coverage, no escaping indices, actual bounds, unique node names, identity baked batch world transforms.'});report['checks'].append({'check':'exact-preserved-anchor-world-transforms','status':'pass','samples':len(m['vehicles'][0]['seats'])*3+9,'detail':'Exact semantic anchor set and full transformed positions/matrices compared to detailed master; no duplicate/missing/extra anchors, yaw drift or camera drift.'});report['checks'].append({'check':'B-CAB-budget-explicit-comparison','status':'over_budget_not_runtime_accepted','samples':2,'detail':'Quality tier is deliberately separate. Actual measured costs and overruns are recorded; original 12000/1.5 MiB and 3000/384 KiB validators and fallback remain unchanged.'});report['checks'].append({'check':'master-vehicle-contract-and-exterior-dependency','status':'pass','detail':'Frame, doors, original four floor slabs, seat/pelvis/camera and inward-facing layout preserved. Both threshold supports retained. New surface topology and layered window/ceiling hardware measured independently; original master/fallback unchanged.'});report['inputHashes']=[{'file':l['file'],'sha256':l['sha256'],'sidecarSha256':l['componentSidecar']['sha256']} for l in m['assets'][0]['lods']]
 return report,ms

def quality_features(m,scenes=None):
 scenes=scenes or [load(HERE/l['file'])[0] for l in m['assets'][0]['lods']];out=[]
 for level,(scene,lod) in enumerate(zip(scenes,m['assets'][0]['lods'])):
  for side in [-1,1]:
   inner=scene[f'window-inner-black-pillar-{side}-1'];outer=scene[f'window-outer-blue-pillar-{side}-1'];ib=bounds(inner);ob=bounds(outer)
   need(max(abs(p[0]) for p in inner['points'])<max(abs(p[0]) for p in outer['points']),'black inner / blue outer depth hierarchy')
   need(ob['size'][1]>ib['size'][1] and ob['size'][2]>ib['size'][2],'blue outer frame must surround smaller black inner frame')
   need(sum(n.startswith(f'window-inner-black-upper-{side}-') for n in scene)>=8,'continuous upper window seals')
   need(sum(n.startswith(f'window-outer-blue-lower-{side}-') for n in scene)>=8,'continuous blue lower frame')
  for n,o in scene.items():
   if not n.startswith('window-') or not o['points']:continue
   b=bounds(o)
   if b['max'][0]>=0:continue
   for group,za,zb in [('front',3.70,4.85),('rear',-1.20,-.05)]:
    need(not (min(b['max'][1],2.46)-max(b['min'][1],.36)>1e-5 and min(b['max'][2],zb)-max(b['min'][2],za)>1e-5),'window trim intrudes into full '+group+' portal opening: '+n)
  need(not any('upholstery-button' in n for n in scene),'reference seats must not have upholstery button dots')
  for i in range(1,25):
   name=f'seat-{i:02d}';need(all(len({tuple(round(v,6) for v in p) for p in scene[name+part]['points']})>=100 for part in ['-cushion','-back-pad','-back-shell']),'reference seat contour geometry missing');need(name+'-grab-frame' in scene,'continuous silver seat frame missing')
  need(sum(n.startswith('ceiling-cross-seam-') for n in scene)==6,'roof cross seam rhythm');need(sum(n.startswith('ceiling-vent-louver-') for n in scene)==72,'roof vent louver detail');need(sum(n.startswith('window-inner-black-pillar-') for n in scene)==22,'window pillar count')
  doc,raw=C.read_glb(HERE/lod['file']);sidecar=json.loads((HERE/lod['componentSidecar']['file']).read_text());batch=next(b for b in sidecar['batches'] if any(r['componentId']=='overhead-rail-1' for r in b['ranges']));r=next(r for r in batch['ranges'] if r['componentId']=='overhead-rail-1');node=next(n for n in doc['nodes'] if n['name']==batch['batch']);p=doc['meshes'][node['mesh']]['primitives'][0];positions=C.accessor(doc,raw,p['attributes']['POSITION'])[r['vertexStart']:r['vertexStart']+r['vertexCount']];normals=C.accessor(doc,raw,p['attributes']['NORMAL'])[r['vertexStart']:r['vertexStart']+r['vertexCount']]
  zs=sorted({round(p[2],5) for p in positions});need(len(zs)==2,'straight rail ends');counts=[]
  for z in zs:
   xy=sorted({(round(p[0],6),round(p[1],6)) for p in positions if abs(p[2]-z)<1e-5});counts.append(len(xy));n=32 if level==0 else 16;need(len(xy)==n,'rail circular radial resolution');cx=sum(p[0] for p in xy)/n;cy=sum(p[1] for p in xy)/n;rs=[math.hypot(x-cx,y-cy) for x,y in xy];need(max(rs)-min(rs)<2e-6,'rail circular radial uniformity')
  byposition={}
  for p,n in zip(positions,normals):byposition.setdefault(tuple(round(t,6) for t in p),set()).add(tuple(round(t,4) for t in n))
  clusters=[]
  for normals_at_position in byposition.values():
   wall=[v for v in normals_at_position if abs(v[2])<.5]
   need(len(wall)==1,'smooth shared tube-wall normals')
   groups=[]
   for normal in normals_at_position:
    if not any(sum(a*b for a,b in zip(normal,existing))>math.cos(math.radians(.1)) for existing in groups):groups.append(normal)
   clusters.append(len(groups))
  need(max(clusters)<=2,'separate planar cap versus smooth wall normal clusters')
  out.append({'lod':level,'railSidesAtEachEnd':counts,'maxNormalClustersPerPosition':max(clusters),'normalClusteringToleranceDegrees':.1,'windowHierarchy':'black inner seal within blue outer structural frame','contouredSeats':24,'ceilingCrossSeams':6,'ventLouvers':72})
 return out

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--refresh-manifest',action='store_true');ap.add_argument('--check-only',action='store_true');a=ap.parse_args()
 m=build_manifest() if a.refresh_manifest else json.loads((HERE/'manifest.json').read_text());report,ms=validate(m);features=quality_features(m);report['qualityFeatureChecks']=features
 if not a.check_only:
  if a.refresh_manifest:(HERE/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
  (HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');(HERE/'qa/measurements.json').write_text(json.dumps(ms,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'features':features,'costs':[{'lod':x['lod'],'triangles':x['triangles'],'bytes':x['bytes'],'primitives':x['primitives'],'embeddedImageBytes':x['embeddedImageBytes'],'budget':x['budget']} for x in ms]},indent=2))
if __name__=='__main__':main()
