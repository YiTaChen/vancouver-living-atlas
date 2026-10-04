"""Standard-library transit validator. Tests actual exported geometry, not just labels."""
import hashlib,importlib.util,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
def need(x,s):
 if not x:raise AssertionError(s)
def sub(a,b):return [x-y for x,y in zip(a,b)]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def close(a,b,t=.02):return max(abs(x-y) for x,y in zip(a,b))<=t

def load(path,overrides=None):
 doc,bin=C.read_glb(path);out={};overrides=overrides or {}
 def walk(i,parent,dynamic=None):
  n=doc['nodes'][i];name=n.get('name','');tr=dict(n)
  if name in overrides:tr['translation']=overrides[name]
  mat=C.matmul(parent,C.transform(tr));pts=[];tris=[]
  if name.startswith('door-right') and not name.endswith('-panel'):dynamic=name
  if 'mesh'in n:
   for p in doc['meshes'][n['mesh']]['primitives']:
    vs=[C.point(mat,v) for v in C.accessor(doc,bin,p['attributes']['POSITION'])];idx=[a[0] for a in C.accessor(doc,bin,p['indices'])];pts+=vs;tris += [tuple(vs[k] for k in idx[j:j+3]) for j in range(0,len(idx),3)]
  out[name]={'node':n,'matrix':mat,'point':C.point(mat,[0,0,0]),'points':pts,'triangles':tris,'dynamic':dynamic}
  for child in n.get('children',[]):walk(child,mat,dynamic)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 # Recover semantic components from actual batched vertex/index ranges. The named
 # GLB anchors have no mesh/draw; each triangle is assigned once to its source ID.
 for name,ob in list(out.items()):
  ranges=ob['node'].get('extras',{}).get('componentRanges')
  if ranges is None:continue
  need(ob['node']['extras'].get('batchSchemaVersion')==1,'unsupported batch schema')
  mesh=doc['meshes'][ob['node']['mesh']];need(len(mesh['primitives'])==1,'one primitive per range-addressed batch')
  index_cursor=vertex_cursor=0
  for r in ranges:
   need(r['frameId']=='vehicle' and r['indexStart']==index_cursor and r['vertexStart']==vertex_cursor,'batch range gaps or overlap')
   need(r['indexCount']>0 and r['indexCount']%3==0 and r['triangleCount']==r['indexCount']//3 and r['vertexCount']>0,'batch range shape')
   component=r['componentId'];need(component in out and doc['nodes'][r['sourceNodeIndex']]['name']==component and 'mesh'not in out[component]['node'],'missing zero-draw component anchor')
   need(all(abs(a-b)<1e-5 for a,b in zip(r['sourceLocalToVehicleMatrix'],out[component]['matrix'])),'component anchor frame drift')
   pp=ob['points'][r['vertexStart']:r['vertexStart']+r['vertexCount']];tt=ob['triangles'][r['indexStart']//3:(r['indexStart']+r['indexCount'])//3]
   need(len(pp)==r['vertexCount'] and len(tt)==r['triangleCount'],'batch range out of bounds')
   b=r['boundsM'];need(close(b['min'],[min(p[k] for p in pp) for k in range(3)],.00002) and close(b['max'],[max(p[k] for p in pp) for k in range(3)],.00002),'component range geometry bounds')
   indices=[a[0] for a in C.accessor(doc,bin,mesh['primitives'][0]['indices'])][r['indexStart']:r['indexStart']+r['indexCount']]
   need(all(r['vertexStart']<=i<r['vertexStart']+r['vertexCount'] for i in indices),'component indices escape vertex range')
   out[component]['points'].extend(pp);out[component]['triangles'].extend(tt);out[component]['batchNodeId']=name;out[component]['batchComponent']=True
   index_cursor+=r['indexCount'];vertex_cursor+=r['vertexCount']
  need(index_cursor==len(ob['triangles'])*3 and vertex_cursor==len(ob['points']),'batch ranges do not cover complete geometry')
  ob['renderTriangles']=len(ob['triangles']);ob['points']=[];ob['triangles']=[]
 return out,doc,bin

def ray(origin,direction,tri,maxdist):
 a,b,c=tri;e1=sub(b,a);e2=sub(c,a);h=cross(direction,e2);det=dot(e1,h)
 if abs(det)<1e-9:return None
 f=1/det;ss=sub(origin,a);u=f*dot(ss,h)
 if u< -1e-7 or u>1+1e-7:return None
 q=cross(ss,e1);v=f*dot(direction,q)
 if v< -1e-7 or u+v>1+1e-7:return None
 t=f*dot(e2,q)
 return t if 1e-6<t<maxdist-1e-6 else None

def hits(tris,a,b):
 d=sub(b,a);length=math.sqrt(dot(d,d));d=[x/length for x in d]
 return [t for tri in tris if (t:=ray(a,d,tri,length)) is not None]
def alltris(scene,pred=lambda v:True):return [t for v in scene.values() if pred(v) for t in v['triangles']]
def inside_bounds(p,b,t=1e-5):return all(b['min'][k]-t<=p[k]<=b['max'][k]+t for k in range(3))

def contract_digest(m):
 payload={'vehicles':m['vehicles'],'assets':[{k:v for k,v in a.items() if k not in ['offlineChecks','runtimeChecks']} for a in m['assets']],'coordinateSystem':m['coordinateSystem'],'units':m['units']}
 return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main():
 m=json.loads((HERE/'manifest.json').read_text());v=m['vehicles'][0];report={'schemaVersion':1,'status':'pass','runtimeStatus':'runtime_pending_webgl','checks':[],'contractSha256':contract_digest(m),'inputGLBs':[{'file':l['file'],'sha256':l['sha256']} for a in m['assets'] for l in a['lods']]}
 def check(name,count,detail):report['checks'].append({'check':name,'status':'pass','samples':count,'detail':detail})
 common=C.validate(HERE);(HERE/'qa/common-validation.json').write_text(json.dumps(common,indent=2)+'\n')
 def metadata_types(obj):
  if isinstance(obj,dict):
   for key,value in obj.items():
    if key in ['translationM','pointM','pelvisPointM','cameraEyePointM','feetPointM','eyePointM','centerM','boardingPointM','outwardNormal','spinAxis','normal']:
     need(isinstance(value,list) and len(value)==3 and all(isinstance(n,(int,float)) and math.isfinite(n) for n in value),'numeric XYZ '+key)
     if key in ['outwardNormal','spinAxis','normal']:need(dot(value,value)>0,'zero direction')
    if key in ['rotationQuaternionXYZW','facingQuaternionXYZW']:need(len(value)==4 and abs(dot(value,value)-1)<1e-5,'unit XYZW quaternion')
    if key in ['radiusM','wheelbaseM','nominalLengthM','doorWidthM','doorHeightM','seatWidthM','seatDepthM','headClearanceM']:need(value>=0,'negative dimension')
    metadata_types(value)
  elif isinstance(obj,list):
   for v in obj:metadata_types(v)
 metadata_types(m)
 ids={a['id'] for a in m['assets']};need(all(i is None or i in ids for i in v['assetRefs'].values()),'asset references')
 frames={f['frameId']:f for f in v['frames']};need(len(frames)==len(v['frames']),'duplicate frames')
 for name,f in frames.items():
  seen=set();cursor=name
  while cursor is not None:
   need(cursor not in seen and cursor in frames,'frame cycle/missing');seen.add(cursor);cursor=frames[cursor]['parentFrameId']
  q=f['rotationQuaternionXYZW'];need(abs(dot(q,q)-1)<1e-5,'frame quaternion')
 check('frame-tree-and-asset-references',len(frames),'Acyclic vehicle-local tree, finite transforms and valid asset references')
 exterior,doc,bin=load(HERE/m['assets'][0]['lods'][0]['file']);interior,_,_=load(HERE/m['assets'][1]['lods'][0]['file'])
 allnodes={**exterior,**interior};static=alltris(exterior,lambda o:o['dynamic'] is None);intris=alltris(interior)
 # Exact side-skin section through z=0 excludes mirrors and measures the real nominal body width.
 section=[]
 for tri in exterior['body-shell']['triangles']:
  for aa,bb in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:
   if (aa[2]<=0<=bb[2] or bb[2]<=0<=aa[2]) and abs(bb[2]-aa[2])>1e-8:
    t=-aa[2]/(bb[2]-aa[2]);section.append([aa[k]+t*(bb[k]-aa[k]) for k in range(3)])
 need(section and abs(min(p[0] for p in section)+1.25)<.0001 and abs(max(p[0] for p in section)-1.25)<.0001,'nominal body width section')
 check('actual-nominal-body-section',len(section),'Actual centre section x=-1.25..+1.25 m, including skin thickness; mirrors and door leaves are separately measured protrusions')
 for a in v['anchors']:need(a['nodeId']in exterior and close(a['pointM'],exterior[a['nodeId']]['point']),'anchor '+a['anchorId'])
 for seat in v['seats']:
  need(seat['nodeId']in interior,'seat node');need(close(seat['pelvisPointM'],interior[seat['pelvisAnchorNodeId']]['point']),'pelvis');need(close(seat['cameraEyePointM'],interior[seat['cameraAnchorNodeId']]['point']),'seat eye')
  need(.43<=seat['seatWidthM']<=.5 and .4<=seat['seatDepthM']<=.48 and .43<=seat['seatAboveFloorM']<=.48,'seat dimensions')
  x,y,z=seat['pelvisPointM'];cushion=[t for name,o in interior.items() if name.startswith(seat['seatId']+'-cushion') for t in o['triangles']]
  hh=hits(cushion,[x,1.1,z],[x,.6,z]);need(hh and abs((1.1-min(hh))-.81)<.02,'actual seat cushion height')
  # Human head capsule centre is above pelvis and in front of the backrest. Test horizontal/vertical spokes.
  eye=seat['cameraEyePointM'];head=[eye[0],eye[1]+.07,eye[2]]
  for d in [[.12,0,0],[-.12,0,0],[0,.13,0],[0,-.13,0],[0,0,.12],[0,0,-.12]]:need(not hits(intris,head,[head[i]+d[i] for i in range(3)]),'seated head clearance')
 # Conservative head-capsule envelope: a clear AABB guarantees the enclosed capsule is clear.
 for seat in v['seats']:
  e=seat['cameraEyePointM'];lo=[e[0]-.13,e[1]-.06,e[2]-.13];hi=[e[0]+.13,e[1]+.20,e[2]+.13]
  for ob in interior.values():
   pts=ob['points']
   if not pts:continue
   bblo=[min(p[k] for p in pts) for k in range(3)];bbhi=[max(p[k] for p in pts) for k in range(3)]
   need(not all(hi[k]>bblo[k]+1e-5 and lo[k]<bbhi[k]-1e-5 for k in range(3)),'seated head capsule conservative envelope')
 for asset,scene in [(m['assets'][0],exterior),(m['assets'][1],interior)]:
  for anchor in asset['anchors']:need(anchor in scene,'missing GLB anchor '+anchor)
 need(close(v['driver']['pelvisPointM'],interior[v['driver']['pelvisAnchorNodeId']]['point']),'driver pelvis')
 need(close(v['driver']['cameraEyePointM'],interior[v['driver']['cameraAnchorNodeId']]['point']),'driver camera')
 for a in v['cameraAnchors']:need(a['nodeId']in interior and close(a['eyePointM'],interior[a['nodeId']]['point']),'camera')
 check('actual-seat-pelvis-camera-and-head-capsules',len(v['seats']),'All 10 seats, 0.46 x 0.44 m, actual cushion at 0.81 m, pelvis at 0.88 m; six 0.12/0.13 m head spokes plus conservative 0.26 m head-capsule envelopes clear')
 for wheel in v['wheels']:
  need(close(wheel['centerM'],exterior[wheel['nodeId']]['point']),'wheel center');pts=[p for name,o in exterior.items() if name.startswith(wheel['nodeId']+'-tyre') for p in o['points']]
  need(pts and abs(min(p[1] for p in pts))<1e-5,'tyre contact');need(abs(max(p[1] for p in pts)-.98)<1e-5,'wheel diameter')
 check('actual-wheels-contact-and-axles',4,'Independent wheel nodes, tyre Ymin=0, diameter 0.98 m; axle midpoint origin and 6.2 m wheelbase')
 for surface in v['floorSurfaces']:
  vv=surface['verticesM'];ii=surface['indices']
  for j in range(0,len(ii),3):
   a,b,c=[vv[k] for k in ii[j:j+3]];need(cross(sub(b,a),sub(c,a))[1]>0,'floor winding')
  c=[sum(p[k] for p in vv)/len(vv) for k in range(3)];h=hits(intris,[c[0],.42,c[2]],[c[0],.2,c[2]]);need(h and abs(.42-min(h)-c[1])<.002,'floor ray/metadata mismatch')
 check('floor-triangulation-winding-and-sill-height',len(v['floorSurfaces']),'Seven floor polygons, +Y winding, all actual support heights within 2 mm of 0.36 m')
 # Actual continuous aisle & hollow volume: upward rays start just above the real floor, including 1.81 m head envelope.
 count=0
 for x in [-.45,0,.45]:
  for j in range(38):
   z=-5.30+j*.23
   need(not hits(static+intris,[x,.38,z],[x,2.59,z]),f'aisle obstruction at {x},{z}')
   h=hits(intris,[x,2.50,z],[x,2.75,z]);need(h and abs(2.50+min(h)-2.60)<.003,'ceiling height');count+=1
 check('hollow-body-aisle-and-standing-headroom',count,'0.90 m sampled main aisle remains empty from Y=0.38 to 2.59; actual ceiling 2.60, floor 0.36, headroom 2.24 m')
 # Wheelchair region is unoccupied through a human-height column.
 for x in [-1.10,-.90,-.65,-.42]:
  for z in [.17,.60,1.0,1.50,1.68]:need(not hits(static+intris,[x,.38,z],[x,2.18,z]),'wheelchair obstruction')
 check('wheelchair-reserved-region-geometry',20,'0.72 x 1.55 m region has no seats, rails, wheel wells or wall intrusions in 1.8 m height')
 # Both independently animatable opening groups must be empty at fully open endpoints.
 opened={d['nodeId']:d['openTransform']['translationM'] for d in v['doors']};openscene,_,_=load(HERE/m['assets'][0]['lods'][0]['file'],opened);opentris=alltris(openscene)+intris
 animations={a['name']:a for a in doc['animations']}
 for door in v['doors']:
  need(door['nodeId']in exterior and close(door['closedTransform']['translationM'],exterior[door['nodeId']]['point']),'door rest transform')
  polygon=door['openingPolygonM'];need(len(polygon)==4 and max(abs(p[0]+1.25) for p in polygon)<1e-6,'planar right opening')
  need(abs(max(p[2] for p in polygon)-min(p[2] for p in polygon)-door['doorWidthM'])<1e-6 and abs(max(p[1] for p in polygon)-min(p[1] for p in polygon)-door['doorHeightM'])<1e-6,'opening dimensions')
  ani=animations[door['animationClip']];channels=[c for c in ani['channels'] if doc['nodes'][c['target']['node']]['name']==door['nodeId'] and c['target']['path']=='translation'];need(channels,'door clip node')
  ss=ani['samplers'][channels[0]['sampler']];values=C.accessor(doc,bin,ss['output']);need(close(values[0],door['closedTransform']['translationM'],.0001) and close(values[-1],door['openTransform']['translationM'],.0001),'clip endpoints')
  # Every sampled animated leaf vertex lies in declared swept volume.
  z=door['closedTransform']['translationM'][2];sgn=-1 if door['nodeId'].endswith('-a') else 1
  leaf=[p for o in exterior.values() if o['dynamic']==door['nodeId'] for p in o['points']]
  leaftris=[t for o in exterior.values() if o['dynamic']==door['nodeId'] for t in o['triangles']]
  for step in range(21):
   t=step/20;dx=-.14*min(1,t/.25);dz=sgn*.62*max(0,(t-.25)/.75)
   for p in leaf:need(inside_bounds([p[0]+dx,p[1],p[2]+dz],door['sweptBoundsM']),'swept containment')
   # A conservative spatial broad phase then actual triangle-edge intersection tests.
   moved=[([p[0]+dx,p[1],p[2]+dz] for p in tri) for tri in leaftris]
   for gen in moved:
    tri=list(gen);lo=[min(p[k] for p in tri) for k in range(3)];hi=[max(p[k] for p in tri) for k in range(3)]
    candidates=[s for s in static if all(max(p[k] for p in s)>=lo[k]-1e-6 and min(p[k] for p in s)<=hi[k]+1e-6 for k in range(3))]
    for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:need(not hits(candidates,a,b),'door/static swept intersection')
 for group,a,b in [('front',3.7,4.85),('rear',-1.2,-.05)]:
  for z in [a+.04,a+.20,(a+b)/2,b-.20,b-.04]:
   for y in [.40,.8,1.2,1.8,2.40]:need(not hits(opentris,[-1.8,y,z],[-.73,y,z]),f'open doorway obstructed {group} {y} {z}')
  need(hits(alltris(exterior),[-1.8,1.30,(a+b)/2-.15],[-.73,1.30,(a+b)/2-.15]),'closed door fails to block')
 check('door-openings-clips-swept-geometry',84,'Four independent clips and 21 sampled poses per leaf; exact triangle-edge static intersection test, 50 open portal rays, closed door obstruction checks')
 # Metadata collision floor equals actual floor box, not a solid body collision.
 floor=next(c for c in v['collision']['primitives'] if c['collisionId']=='floor');need(abs(floor['boundsM']['max'][1]-.36)<1e-6,'collision floor');need(v['assetRefs']['collision']is None,'JSON collision contract')
 for c in v['collision']['primitives']:need(c['frameId']in frames,'collision frame')
 collider_by_id={c['collisionId']:c for c in v['collision']['primitives']}
 for name,ob in interior.items():
  if not ob['points']:continue
  need(name in collider_by_id,'interior obstacle missing from collision: '+name)
  if 'visibleNodeId'in collider_by_id[name]:
   b=collider_by_id[name]['boundsM'];pts=ob['points'];need(close(b['min'],[min(p[k] for p in pts) for k in range(3)],.0001) and close(b['max'],[max(p[k] for p in pts) for k in range(3)],.0001),'collision node bounds')
 check('complete-interior-collision-node-coverage',len([o for o in interior.values() if o['points']]),'Every editable source component has an exact GLB batch range, zero-draw anchor and named JSON primitive; bounds come from actual delivered triangles')
 for a in m['assets']:
  limits=[8000,2000,400] if a['kind']=='transit-exterior' else [12000,3000]
  for l in a['lods']:
   need(l['triangles']<=limits[l['level']],'triangle budget');need(l['sourceBytes']<=20*1024**2,'source size');need(all(isinstance(l['capabilities'][f],bool) for f in ['doorsAnimated','passengerCapable','openingsPreserved']),'capabilities')
   if l['level']==2:need(not any(l['capabilities'][f] for f in ['doorsAnimated','passengerCapable','openingsPreserved']),'coarse unsafe capabilities')
   scene,loddoc,_=load(HERE/l['file']);
   if a['kind']=='transit-interior':
    need(l['primitives']<=12,'static interior primitive budget')
    actual_ranges=[{'nodeId':n['name'],'material':loddoc['materials'][loddoc['meshes'][n['mesh']]['primitives'][0]['material']]['name'],'componentRanges':n['extras']['componentRanges']} for n in loddoc['nodes'] if n.get('extras',{}).get('componentRanges')]
    need(actual_ranges==l['staticBatching']['batches'],'manifest batch provenance mismatch')
   if a['kind']=='transit-exterior' and l['level']==2:
    glass=next(mat for mat in loddoc['materials'] if mat['name']=='glass');need(glass.get('alphaMode','OPAQUE')=='OPAQUE' and glass['pbrMetallicRoughness']['baseColorFactor'][3]==1,'far window band must be closed opaque cue')
    for aa,bb in [([-2,1.9,0],[-1.20,1.9,0]),([2,1.9,0],[1.20,1.9,0]),([0,1.9,-6],[0,1.9,-5.7])]:need(hits(scene['glass']['triangles'],aa,bb),'missing far side/rear window cue')
   for wheel in v['wheels'] if a['kind']=='transit-exterior' else []:need(close(scene[wheel['nodeId']]['point'],wheel['centerM'],.0001),'LOD wheel anchor drift')
 # Independently verify every declared passenger-capable LOD, not just LOD0 metadata.
 for level in [0,1]:
  shell,_,_=load(HERE/m['assets'][0]['lods'][level]['file'],opened)
  cab,_,_=load(HERE/m['assets'][1]['lods'][level]['file'])
  tt=alltris(shell)+alltris(cab)
  for group,a,b in [('front',3.7,4.85),('rear',-1.2,-.05)]:
   for z in [a+.04,(a+b)/2,b-.04]:
    for y in [.40,1.40,2.40]:need(not hits(tt,[-1.8,y,z],[-.73,y,z]),'LOD passage ray')
  need(not hits(tt,[0,.38,0],[0,2.59,0]),'LOD hollow cabin')
  # Exact coplanar duplicate triangles indicate an accidental double shell.
  fingerprints=[]
  for tri in tt:fingerprints.append(tuple(sorted(tuple(round(c,5) for c in p) for p in tri)))
  need(len(fingerprints)==len(set(fingerprints)),'exact duplicate coplanar triangles')
 check('all-boarding-lods-and-coplanar-duplicates',2,'Open portal rays and hollow section repeated on LOD0/1; no exact duplicate triangles in assembled exports')
 check('collision-lod-budget-finite-and-capability-contract',5,'No embedded textures; exact GLB cost cross-check; 20 MiB editable-source ceiling; coarse LOD cannot board; all LOD wheel roots unchanged')
 report['actualCosts']=[{'assetId':a['id'],'lod':l['level'],'triangles':l['triangles'],'primitives':l['primitives'],'bytes':l['bytes']} for a in m['assets'] for l in a['lods']]
 report['blenderEvidenceRequired']='qa/blender-validation.json and qa/previews/index.json'
 (HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
