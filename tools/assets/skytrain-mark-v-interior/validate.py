"""Independent byte, topology, texture, budget and conservative spatial checks."""
import hashlib,importlib.util,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def check(cond,msg):
 if not cond:raise ValueError(msg)
def component_rows(path, expected_hash=None):
 sidepath=path.with_suffix('.components.json')
 if expected_hash is not None:check(C.digest(sidepath)==expected_hash,'provenance sidecar manifest hash mismatch')
 side=json.loads(sidepath.read_text());C.finite(side);check(side['glbSha256']==C.digest(path),'provenance GLB hash mismatch')
 d,b=C.read_glb(path);out=[]
 # Offline ranges are baked in vehicle metres. Fail closed rather than trusting
 # raw POSITION arrays after someone moves a mesh or any ancestor in the scene.
 check(len(d.get('scenes',[]))==1,'single baked scene required')
 roots=d['scenes'][d.get('scene',0)]['nodes'];check(len(roots)==1,'single baked vehicle root required');root=d['nodes'][roots[0]]
 check(root.get('name')=='vehicle','vehicle root required');check(all(abs(a-b)<1e-7 for a,b in zip(C.transform(root),C.IDENTITY)),'baked vehicle ancestor transform must be identity')
 mesh_ids=[i for i,n in enumerate(d['nodes']) if 'mesh' in n];children=root.get('children',[])
 check(len(children)==len(set(children)),'duplicate child instances forbidden')
 for i in mesh_ids:
  check(i in children,'baked mesh batch must be direct vehicle child')
  check(sum(i in n.get('children',[]) for n in d['nodes'])==1,'mesh batch has multiple ancestors')
  check(all(abs(a-b)<1e-7 for a,b in zip(C.transform(d['nodes'][i]),C.IDENTITY)),'baked mesh batch transform must be identity')
 batch_nodes={n['name']:n for n in d['nodes'] if 'mesh' in n};check(len(batch_nodes)==len(mesh_ids),'duplicate material batch names')
 batches=side.get('batches');check(isinstance(batches,list) and batches,'missing/empty component batches')
 names=[r.get('batch') for r in batches];check(len(set(names))==len(names),'duplicate component batches');check(set(names)==set(batch_nodes),'component batches do not cover every mesh')
 for batch in batches:
  node=batch_nodes[batch['batch']];primitives=d['meshes'][node['mesh']]['primitives'];check(len(primitives)==1,'one primitive per batch required');pr=primitives[0]
  ps=C.accessor(d,b,pr['attributes']['POSITION']);ix=[x[0] for x in C.accessor(d,b,pr['indices'])];ranges=batch.get('ranges');check(isinstance(ranges,list) and ranges,'missing/empty component ranges');index_intervals=[];vertex_intervals=[]
  for r in ranges:
   for key in ['indexStart','indexCount','vertexStart','vertexCount','triangleCount']:check(type(r.get(key)) is int,'component range integer required')
   start,count,vstart,vcount=r['indexStart'],r['indexCount'],r['vertexStart'],r['vertexCount']
   check(start>=0 and count>0 and start%3==0 and count%3==0 and start+count<=len(ix),'component index range out of bounds')
   check(vstart>=0 and vcount>0 and vstart+vcount<=len(ps),'component vertex range out of bounds');check(r['triangleCount']==count//3,'component triangle count mismatch')
   index_intervals.append((start,start+count));vertex_intervals.append((vstart,vstart+vcount));ids=ix[start:start+count]
   check(all(vstart<=i<vstart+vcount for i in ids),'indices escape component vertex range')
   pts=[ps[i] for i in ids];bounds={s:[f(p[k] for p in pts) for k in range(3)] for s,f in [('min',min),('max',max)]}
   check(all(abs(bounds[s][k]-r['boundsM'][s][k])<1e-5 for s in ['min','max'] for k in range(3)),'component bounds do not match actual binary')
   out.append({**({'foldProfileXZ':sorted(set((round(p[0],6),round(p[2],6)) for p in pts),key=lambda p:p[1])} if r['componentId'].startswith('gangway-side-bellows') else {}),'name':r['componentId'],**bounds,**({'supportTrianglesM':[[ps[i] for i in ids[j:j+3]] for j in range(0,len(ids),3)]} if r['componentId'] in ['floor-slab','gangway-bridge'] else {})})
  for intervals,total,label in [(index_intervals,len(ix),'index'),(vertex_intervals,len(ps),'vertex')]:
   cursor=0
   for start,end in sorted(intervals):check(start==cursor,'component '+label+' coverage gap/overlap');cursor=end
   check(cursor==total,'incomplete component '+label+' coverage')
 return d,out

def support_height(rows,x,z):
 heights=[]
 for row in rows:
  for a,b,c in row.get('supportTrianglesM',[]):
   den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
   if abs(den)<1e-10:continue
   u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;w=1-u-v
   if min(u,v,w)>=-1e-6:heights.append(u*a[1]+v*b[1]+w*c[1])
 return max(heights) if heights else None

def validate_open_gangway(rows):
 """Conservative full-volume exclusion, independent of component naming.
 A 1.2 m wide x 2.015 m high open prism spans the entire connection and
 thresholds. This rejects any closure panel, including transparent glazing,
 narrow off-center leaves and obstacles between the older three samples.
 """
 low=[-.60,.035,-8.535];high=[.60,2.05,-7.60]
 for r in rows:
  overlap=all(r['max'][i]>low[i]+1e-6 and r['min'][i]<high[i]-1e-6 for i in range(3))
  check(not overlap,'open gangway blocked by '+r['name'])
 sides=[r for r in rows if r['name'].startswith('gangway-side-bellows')]
 check(len(sides)==2,'two flexible gangway sides required')
 for r in sides:
  profile=r.get('foldProfileXZ',[])
  check(len(profile)>=7,'gangway bellows must retain visible folds')
  differences=[profile[i+1][0]-profile[i][0] for i in range(len(profile)-1)]
  check(all(abs(d)>.025 for d in differences) and all(a*b<0 for a,b in zip(differences,differences[1:])),'gangway bellows must be accordion folds, not flat door-like slabs')
 for x in [-.55,0,.55]:
  for j in range(33):
   z=-8.53+j*(.93/32);h=support_height(rows,x,z)
   check(h is not None and -.001<=h<=.0035,'continuous gangway floor support missing')
 return {'status':'pass','doorLeafPresent':False,'openVolumeM':{'min':low,'max':high},'method':'full-volume conservative component bounds from exact complete GLB ranges, plus 99 triangle-based support probes','foldedSides':2,'supportProbes':99,'scope':'static A-car connector only, no moving coupling or accessibility certification'}

def validate_anchors(doc,layout):
 nodes=doc['nodes'];names=[n.get('name','') for n in nodes];check(len(names)==len(set(names)),'duplicate node/anchor IDs')
 expected={seat['id']+'-pelvis':seat['pelvisM'] for seat in layout['seats']}
 expected_cameras={seat['id']+'-camera':[seat['originXZ'][0]+seat['facingXZ'][0]*.19,1.14,seat['originXZ'][1]+seat['facingXZ'][1]*.19] for seat in layout['seats']}
 check(len(expected)==22 and len(expected_cameras)==22,'layout anchor ID uniqueness')
 actual={n['name'] for n in nodes if n.get('name','').endswith('-pelvis')};actual_cameras={n['name'] for n in nodes if n.get('name','').startswith('seat-') and n['name'].endswith('-camera')}
 check(actual==set(expected),'exact pelvis anchor ID set mismatch');check(actual_cameras==set(expected_cameras),'exact seat-camera anchor ID set mismatch')
 root=nodes[doc['scenes'][doc.get('scene',0)]['nodes'][0]]
 for name,want in {**expected,**expected_cameras}.items():
  i=names.index(name);check(i in root.get('children',[]),'reference anchor must be direct vehicle child');check(sum(i in n.get('children',[]) for n in nodes)==1,'reference anchor has multiple ancestors')
  actual=C.point(C.matmul(C.transform(root),C.transform(nodes[i])),[0,0,0]);check(all(abs(a-b)<1e-5 for a,b in zip(actual,want)),'reference anchor transformed position mismatch: '+name)
 return {'pelvisIDs':22,'cameraIDs':22,'uniqueExactSets':True,'transformedPositionsMatched':True,'orientationScope':'position-only reference anchors; facingXZ is representative layout data, not a bound runtime quaternion'}

def main():
 report=C.validate(HERE);write(HERE/'qa/common-validation.json',report);m=json.loads((HERE/'manifest.json').read_text());budgets=[];clear=[]
 layout=json.loads((HERE/'layout-assumptions.json').read_text());unique_images={}
 for asset in m['assets']:
  for lod in asset['lods']:
   check(lod['componentsFile']==str(Path(lod['file']).with_suffix('.components.json')),'sidecar path mismatch');doc,unused=component_rows(HERE/lod['file'],lod['componentsSha256']);validate_anchors(doc,layout);validate_open_gangway(unused)
   actual=C.measure_glb(HERE/lod['file']);check(lod['images']==actual['images'],'manifest embedded image inventory mismatch');check(lod['embeddedImageBytes']==actual['embeddedImageBytes'],'manifest embedded image bytes mismatch')
   for im in actual['images']:unique_images[im['sha256']]=im['texelBytesWithMips']
 check(sum(unique_images.values())<=16*1024*1024,'deduplicated shared texture budget exceeded')
 for texture in m['textures']:check(C.digest(C.inside(HERE,texture['file']))==texture['sha256'],'original texture file hash mismatch')
 for lod in m['assets'][0]['lods']:
  level=lod['level'];triCap=12000 if level==0 else 3000;byteCap=int(1.5*1024*1024) if level==0 else 384*1024
  check(lod['triangles']<=triCap,'triangle budget exceeded');check(lod['bytes']<=byteCap,'byte budget exceeded');check(lod['primitives']<=10,'material primitive budget exceeded')
  check(sum(i['texelBytesWithMips'] for i in lod['images'])<=16*1024*1024,'texture budget exceeded')
  d,rows=component_rows(HERE/lod['file'],lod['componentsSha256']);check(len([n for n in d['nodes'] if n.get('name','').endswith('-pelvis')])==22,'seat anchor count')
  check(not d.get('animations'),'unexpected runtime animation');check(not d.get('skins'),'unexpected skin')
  check(all(not x.get('emissiveFactor') or not any(x['emissiveFactor']) for x in d['materials']),'night/emissive scope change')
  open_gangway=validate_open_gangway(rows)
  samples=[];hits=[]
  # Conservative component AABBs tested against 1.95 m standing capsules in a
  # central route offset around the deliberately centered stanchions. Not navigation.
  for j in range(257):
   x=.33;z=-7.4+j*(12.75/256);hit=[]
   h=support_height(rows,x,z);check(h is not None and abs(h)<.001,'aisle support surface missing or off datum')
   for r in rows:
    if r['max'][1]<=.035 or r['min'][1]>=1.95:continue
    dx=max(r['min'][0]-x,0,x-r['max'][0]);dz=max(r['min'][2]-z,0,z-r['max'][2])
    if dx*dx+dz*dz<.25**2:hit.append(r['name'])
   if hit:hits.append({'pointM':[x,0,z],'components':hit})
  check(not hits,'conservative corridor conflicts: '+str(hits[:2]))
  # Independent central gangway corridor. Exterior boarding doors stay closed;
  # the inter-car gangway has no door leaves or closing panels.
  for z in [-8.38,-8.1,-7.82]:
   h=support_height(rows,0,z);check(h is not None and abs(h-.0025)<.001,'gangway support surface missing or off datum')
   for r in rows:
    if r['max'][1]<=.035 or r['min'][1]>=2.05:continue
    dx=max(r['min'][0],0,-r['max'][0]);dz=max(r['min'][2]-z,0,z-r['max'][2]);check(dx*dx+dz*dz>=.25**2,'gangway standing corridor conflict')
  budgets.append({'lod':level,'triangles':lod['triangles'],'triangleCap':triCap,'bytes':lod['bytes'],'byteCap':byteCap,'materialPrimitives':lod['primitives'],'status':'pass'})
  clear.append({'lod':level,'status':'pass','capsuleHeightM':1.95,'radiusM':.25,'aislePath':{'xM':.33,'zMinM':-7.4,'zMaxM':5.35,'samples':257},'openGangway':open_gangway,'gangwayCentralSamples':3,'gangwayTestHeightM':2.05,'method':'Conservative component AABBs plus barycentric support-height intersections on actual floor/bridge triangles, independently from GLB binary ranges','limits':'No door traversal, seated ingress, moving collision, platform binding, accessibility certification or front-salon free-walk validation'})
 write(HERE/'qa/clearance-validation.json',{'status':'pass','scope':'offline sampled static corridor only','lods':clear})
 write(HERE/'qa/validation.json',{'status':'pass','scope':'packaging, actual geometry, budgets, texture inventory and conservative static clearance; not runtime','budgetChecks':budgets,'authoringStudyBudget':'intentionally over budget; never runtime-enabled','seatCount':22,'anchorValidation':'exact unique pelvis/camera ID sets and transformed positions match layout','runtime':'not_run','placementCompatibility':'not_assumed'})
 print(json.dumps({'status':'pass','budgetChecks':budgets,'clearance':'pass','runtime':'not_run'},indent=2))
if __name__=='__main__':main()
