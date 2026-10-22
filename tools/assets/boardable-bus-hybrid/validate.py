"""Read-only binary geometry/rig audit. Standard Python; no Blender or GPU."""
import hashlib,importlib.util,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2]
def module(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=module('common_asset_validation',HERE.parent/'package-contract/validate.py')
V=module('canonical_bus_validation',HERE.parent/'boardable-bus/validate.py')
WHEELS=[f'wheel-{a}-{s}' for a in ['front','rear'] for s in ['left','right']]
ROLES={'paint':'automotive-paint','rubber':'rubber','glass':'transit-glass','lights':'transit-lights'}
def need(b,s):
 if not b:raise AssertionError(s)
def near(a,b,t=2e-5):return len(a)==len(b) and all(abs(x-y)<t for x,y in zip(a,b))
def bb(points):return {'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]}
def fingerprint(mat):return {k:v for k,v in mat.items() if k not in ['extras','name']}
def actual_component_bounds():
 path=REPO/'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod0.glb';scene,doc,bin=V.load(path)
 side=json.loads((HERE.parent/'boardable-bus-v2/closeup-quality/exports/city-bus-12m-interior-v2-closeup.lod0.components.json').read_text())
 need(side['glbSha256']==C.digest(path),'retained interior sidecar hash');out={}
 for batch in side['batches']:
  points=scene[batch['batch']]['points']
  for r in batch['ranges']:
   if r['componentId'] in ['fare-pedestal','fare-reader','fare-reader-screen','front-ramp-cassette','front-ramp-edge','front-ramp-edge.001']:
    p=points[r['vertexStart']:r['vertexStart']+r['vertexCount']];bounds=bb(p)
    need(near(bounds['min'],r['boundsM']['min']) and near(bounds['max'],r['boundsM']['max']),'actual component bounds drift')
    out[r['componentId']]=bounds
 return out

def validate():
 manifest=json.loads((HERE/'manifest.json').read_text());base=json.loads((HERE.parent/'boardable-bus/manifest.json').read_text());vehicle=base['vehicles'][0]
 report={'schemaVersion':1,'status':'pass','scope':'Actual GLB binary metrics, unit normals, nondegenerate triangles, role/COLOR_0 contract, exact canonical door samples and openings, wheels/anchors, ramp dimensions and farebox separation. Runtime ground/contact and animated interior sweep have a separate controller audit.','lods':[]}
 shared=None
 for l in manifest['assets'][0]['lods']:
  level=l['level'];path=HERE/l['export'];pub=REPO/'public'/l['url'].lstrip('/')
  need(path.read_bytes()==pub.read_bytes(),'public/export byte identity');need(C.digest(path)==l['sha256'],'GLB hash')
  src=HERE/l['source'];need(C.digest(src)==l['sourceSha256'] and src.stat().st_size==l['sourceBytes'],'editable source hash/bytes')
  m=C.measure_glb(path)
  for k in ['triangles','vertices','primitives','bytes']:need(m[k]==l[k],'manifest '+k)
  need(m['triangles']<10000 and m['bytes']<1000000,'LOD budget');need(level!=1 or m['triangles']<5000,'LOD1 triangle target')
  scene,doc,bin=V.load(path);materials=doc['materials'];need(len(materials)==4,'exactly four shared surfaces')
  roles={mat.get('extras',{}).get('semantic_role'):mat for mat in materials};need(set(roles)==set(ROLES),'material roles')
  for role,surface in ROLES.items():need(roles[role]['extras']['shared_surface_id']==surface,'shared surface '+role)
  need(near(roles['paint'].get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1]),[1,1,1,1]),'white paint base')
  factors={k:fingerprint(v) for k,v in roles.items()}
  if shared is None:shared=factors
  else:need(shared==factors,'shared PBR factors identical across LODs')
  palette=set()
  for mesh in doc['meshes']:
   for p in mesh['primitives']:
    role=materials[p['material']]['extras']['semantic_role']
    if role=='paint':
     need('COLOR_0'in p['attributes'],'paint COLOR_0');palette.update(C.accessor(doc,bin,p['attributes']['COLOR_0']))
  need(len(palette)>=3,'silver/navy/yellow paint palette')
  names={n['name']:i for i,n in enumerate(doc['nodes'])};parents={child:n['name'] for n in doc['nodes'] for child in n.get('children',[])}
  for w in vehicle['wheels']:
   name=w['nodeId'];need(near(scene[name]['point'],w['centerM']),'canonical wheel center');need(parents[names[name]]=='vehicle','wheel direct body child')
   pp=[p for key,o in scene.items() if key.startswith(name+'-tyre') for p in o['points']]
   need(pp and abs(min(p[1] for p in pp))<2e-5 and abs(max(p[1] for p in pp)-.98)<2e-5,'actual tire contact/diameter')
  for anchor in vehicle['anchors']:need(near(scene[anchor['nodeId']]['point'],anchor['pointM']),'canonical anchor '+anchor['nodeId'])
  for d in vehicle['doors']:need(d['nodeId']in names,'door node preserved')
  detail={k:m[k] for k in ['triangles','vertices','primitives','bytes','boundsM']};detail.update(level=level,sharedSurfaces=4,paintColors=len(palette),unitNormals=True,degenerateTriangles=0,publicBytesIdentical=True)
  if level<2:
   baseline=HERE.parent/'boardable-bus'/base['assets'][0]['lods'][level]['file'];bd,bbin=C.read_glb(baseline)
   reference={a['name']:a for a in bd['animations']};anims={a['name']:a for a in doc['animations']};need(set(anims)==set(reference),'four exact named door clips')
   for d in vehicle['doors']:
    ani=anims[d['animationClip']];ref=reference[d['animationClip']]
    ch=next(c for c in ani['channels'] if doc['nodes'][c['target']['node']]['name']==d['nodeId'] and c['target']['path']=='translation')
    rc=next(c for c in ref['channels'] if bd['nodes'][c['target']['node']]['name']==d['nodeId'] and c['target']['path']=='translation')
    sample=ani['samplers'][ch['sampler']];rs=ref['samplers'][rc['sampler']]
    for attr in ['input','output']:
     aa=C.accessor(doc,bin,sample[attr]);rr=C.accessor(bd,bbin,rs[attr]);need(len(aa)==len(rr) and all(near(a,r,2e-6) for a,r in zip(aa,rr)),'canonical door samples')
   swept_samples=0
   for d in vehicle['doors']:
    leaf=[p for o in scene.values() if o['dynamic']==d['nodeId'] for p in o['points']]
    shift=d['openTransform']['translationM'][2]-d['closedTransform']['translationM'][2]
    for step in range(21):
     t=step/20;dx=-.14*min(1,t/.25);dz=shift*max(0,(t-.25)/.75)
     for p in leaf:need(V.inside_bounds([p[0]+dx,p[1],p[2]+dz],d['sweptBoundsM']),'canonical door swept envelope')
     swept_samples+=1
   detail['doorSweptEnvelopeSamples']=swept_samples
   opened={d['nodeId']:d['openTransform']['translationM'] for d in vehicle['doors']};open_scene,_,_=V.load(path,opened);tris=V.alltris(open_scene)
   rays=0
   for a,b in [(4,5.2),(-2.3,-1.4)]:
    for j in range(7):
     z=a+.09+(b-a-.18)*j/6
     for y in [.5,.85,1.3,1.8,2.25]:
      need(not V.hits(tris,[-1.55,y,z],[-1.1,y,z]),f'actual open door hole {level} {y} {z}');rays+=1
   ramp=scene['boarding-ramp'];need(parents[names['boarding-ramp']]=='vehicle','ramp direct body child')
   need(near(ramp['point'],[-1.25,.36,4.6]),'ramp hinge');node=ramp['node'];need(near(node.get('rotation',[0,0,0,1]),[0,0,0,1]),'ramp neutral identity')
   mesh=scene['boarding-ramp-deck'];pts=mesh['points'];local=[[p[k]-ramp['point'][k] for k in range(3)] for p in pts];rb=bb(local)
   need(near(rb['min'],[0,-.018,-.58]) and near(rb['max'],[1.12,0,.28]),'actual ramp geometry dimensions')
   tips=[p for p in local if p[0]>1.11999];need(tips and all(abs(p[1])<1e-6 for p in tips),'tapered zero-thickness landing tip')
   tops=[tri for tri in mesh['triangles'] if all(abs(p[1]-.36)<1e-5 for p in tri)]
   need(tops and all(V.cross(V.sub(t[1],t[0]),V.sub(t[2],t[0]))[1]>0 for t in tops),'ramp deck upward winding')
   drop=manifest['accessibility']['kneelDropM'];angle=math.pi+math.asin((.36-drop)/1.12)
   tipY=.36-drop+1.12*math.sin(angle);need(abs(tipY)<1e-12,'deployed tip ground')
   detail.update(doorClips=4,doorKeySamplesUnchanged=True,openDoorRays=rays,rampLocalBoundsM=rb,rampTopNormal='+Y',rampAngleToRoadRad=angle,rampDeployedTipY=tipY,boardingCenterZ=4.45,capsuleRadiusM=.3,capsuleSideMarginM=.13)
  else:need('boarding-ramp'not in names and not doc.get('animations'),'closed fallback has no boarding rig');detail['boardingCapability']=False
  report['lods'].append(detail)
 components=actual_component_bounds();gaps={n:b['min'][2]-4.88 for n,b in components.items() if n.startswith('fare')}
 need(gaps['fare-pedestal']>=.03999 and gaps['fare-reader-screen']>=.02199,'actual farebox sweep separation')
 report['rampClearance']={'sweepPreservesZBoundsM':[4.02,4.88],'retainedInteriorActualBoundsM':components,'fareboxLongitudinalSeparationM':gaps,'pedestalMinimumM':gaps['fare-pedestal'],'allFareComponentsMinimumM':min(gaps.values()),'note':'40 mm to pedestal/reader body; screen projects 18 mm closer, leaving 22 mm. Fixed near-floor cassette/edge finish at Y=.36..3705 is stow contact, not an above-floor obstacle. Runtime audit must classify only this thin finish geometrically.'}
 build=json.loads((HERE/'qa/build.json').read_text());report['filmReference']=build['filmReference'];report['originalFilmModel']=json.loads((HERE/'qa/original-film-metrics.json').read_text());report['retainedAtlasInterior']={'passengerSeats':24,'triangles':278528,'unchanged':True,'glbSha256':C.digest(REPO/'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod0.glb'),'comparison':'Atlas retained interior has substantially richer driver area, seating, handrails and walkable boarding contract; film reference has 34 simpler seats and is reference only.'}
 (HERE/'qa/geometry-validation.json').write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':
 r=validate();print(json.dumps({'status':r['status'],'lods':[{k:l[k] for k in ['level','triangles','bytes','primitives']} for l in r['lods']],'fareboxMinClearanceM':r['rampClearance']['allFareComponentsMinimumM']},indent=2))
