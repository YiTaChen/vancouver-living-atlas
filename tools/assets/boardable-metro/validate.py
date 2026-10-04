"""CPU contract and actual GLB triangle checks. No rendering/runtime claims."""
import json,math,sys,copy,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));from contract import common

def need(ok,msg):
 if not ok:raise ValueError(msg)
def polygon_simple(points):
 p=np.array(points)[:,[0,2]]
 def orient(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 for i in range(len(p)):
  for j in range(i+1,len(p)):
   if (i-j)%len(p) in [0,1,len(p)-1]:continue
   a,b=p[i],p[(i+1)%len(p)];c,d=p[j],p[(j+1)%len(p)]
   if orient(a,b,c)*orient(a,b,d)<0 and orient(c,d,a)*orient(c,d,b)<0:return False
 return True
def close(a,b,tol=.02):return np.max(np.abs(np.array(a)-np.array(b)))<=tol

def geometry(path,overrides=None):
 doc,buf=common.read_glb(path);nodes={};alltris=[];names=[];dupes=[];keys=set();normfail=0;uv=True
 def visit(idx,parent):
  nonlocal normfail,uv
  n=doc['nodes'][idx];name=n.get('name','');tr=common.transform((overrides or {}).get(name,n));mat=common.matmul(parent,tr);nodes[name]={'position':mat[12:15],'matrix':mat,'node':n}
  if 'mesh' in n:
   for p in doc['meshes'][n['mesh']]['primitives']:
    localpts=np.array(common.accessor(doc,buf,p['attributes']['POSITION']));norms=np.array(common.accessor(doc,buf,p['attributes']['NORMAL']));pts=[common.point(mat,x) for x in localpts];inds=[a[0] for a in common.accessor(doc,buf,p['indices'])];uv=uv and 'TEXCOORD_0' in p['attributes']
    for ia,ib,ic in np.array(inds).reshape(-1,3):need(np.dot(np.cross(localpts[ib]-localpts[ia],localpts[ic]-localpts[ia]),norms[ia]+norms[ib]+norms[ic])>0,'triangle winding/normal mismatch')
    ranges=n.get('extras',{}).get('componentRanges')
    if ranges:
     need(len(doc['meshes'][n['mesh']]['primitives'])==1,'batch primitive count');ci=cv=0
     for r in ranges:
      need(r['componentId']==r['sourceNodeId'],'component identity mismatch');need(0<=r['sourceNodeIndex']<len(doc['nodes']) and doc['nodes'][r['sourceNodeIndex']]['name']==r['sourceNodeId'],'source node index mismatch');need(r['frameId']=='vehicle' and r['indexStart']==ci and r['vertexStart']==cv,'noncontiguous or overlapping batch ranges');need(r['indexCount']%3==0 and r['triangleCount']==r['indexCount']//3,'invalid component triangle count');need(all(cv<=j<cv+r['vertexCount'] for j in inds[ci:ci+r['indexCount']]),'component index escapes vertex range');need(r['sourceNodeId'] in nodes,'component zero-draw anchor missing');need('mesh' not in nodes[r['sourceNodeId']]['node'],'component must be a zero-draw anchor');need(close(nodes[r['sourceNodeId']]['matrix'],r['sourceLocalToVehicleMatrix'],1e-5),'component source transform differs');vp=np.array(pts[cv:cv+r['vertexCount']]);need(close(vp.min(axis=0),r['boundsM']['min'],1e-5) and close(vp.max(axis=0),r['boundsM']['max'],1e-5),'component range bounds mismatch');ci+=r['indexCount'];cv+=r['vertexCount']
     need(ci==len(inds) and cv==len(pts),'incomplete component range coverage')
    for i in range(0,len(inds),3):
     tri=[pts[j] for j in inds[i:i+3]];alltris.append(tri);logical=name
     ranges=n.get('extras',{}).get('componentRanges')
     if ranges:
      owners=[r for r in ranges if r['indexStart']<=i<r['indexStart']+r['indexCount']];need(len(owners)==1,'batch component range coverage');logical=owners[0]['componentId']
     names.append(logical);key=tuple(sorted(tuple(round(x,6) for x in v) for v in tri))
     if key in keys:dupes.append(name)
     keys.add(key)
  for ch in n.get('children',[]):visit(ch,mat)
 for idx in doc['scenes'][doc.get('scene',0)]['nodes']:visit(idx,common.IDENTITY)
 return {'nodes':nodes,'triangles':np.array(alltris),'names':np.array(names),'duplicateTriangles':dupes,'uvPresent':uv,'doc':doc}

def ray(g,origin,direction,exclude=(),max_t=100):
 ts=g['triangles'];d=np.array(direction,float);o=np.array(origin,float);e1=ts[:,1]-ts[:,0];e2=ts[:,2]-ts[:,0];h=np.cross(d,e2);a=np.einsum('ij,ij->i',e1,h);ok=np.abs(a)>1e-9;f=np.zeros(len(a));f[ok]=1/a[ok];s=o-ts[:,0];u=f*np.einsum('ij,ij->i',s,h);q=np.cross(s,e1);v=f*np.einsum('j,ij->i',d,q);t=f*np.einsum('ij,ij->i',e2,q);ok &= (u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8)&(t>1e-5)&(t<=max_t)
 if exclude:ok &= ~np.isin(g['names'],exclude)
 return sorted([(float(t[i]),str(g['names'][i])) for i in np.flatnonzero(ok)])

def distance_to_triangles(g,p):
 t=g['triangles'];p=np.array(p,float);a=t[:,0];b=t[:,1];c=t[:,2];u=b-a;v=c-a;w=p-a
 d00=np.einsum('ij,ij->i',u,u);d01=np.einsum('ij,ij->i',u,v);d11=np.einsum('ij,ij->i',v,v);d20=np.einsum('ij,ij->i',w,u);d21=np.einsum('ij,ij->i',w,v);den=d00*d11-d01*d01;beta=(d11*d20-d01*d21)/den;gamma=(d00*d21-d01*d20)/den;n=np.cross(u,v);nn=np.einsum('ij,ij->i',n,n);plane=np.einsum('ij,ij->i',w,n)**2/nn;plane[(beta<0)|(gamma<0)|(beta+gamma>1)]=np.inf
 out=plane
 for aa,bb in [(a,b),(b,c),(c,a)]:
  e=bb-aa;f=np.clip(np.einsum('ij,ij->i',p-aa,e)/np.einsum('ij,ij->i',e,e),0,1);d=p-aa-e*f[:,None];out=np.minimum(out,np.einsum('ij,ij->i',d,d))
 return float(np.sqrt(out.min()))

def combine(*gs):return {'triangles':np.concatenate([g['triangles'] for g in gs]),'names':np.concatenate([g['names'] for g in gs])}
def overrides(v,t=1):
 # Two-stage plug-clearance then longitudinal slide, not straight interpolation.
 out={}
 for d in v['doors']:
  a=np.array(d['closedTransform']['translationM']);b=np.array(d['openTransform']['translationM']);p=a.copy();p[0]=a[0]+(b[0]-a[0])*min(t*2,1);p[2]=a[2]+(b[2]-a[2])*max(0,t*2-1)
  out[d['nodeId']]={'translation':p.tolist(),'rotation':[0,0,0,1],'scale':[1,1,1]}
 return out

def validate_manifest(m,root=ROOT,deep=True):
 common.finite(m);ids={a['id']:a for a in m['assets']};need(len(ids)==4,'four assets required');results=[]
 for v in m['vehicles']:
  vid=v['vehicleId'];frames={f['frameId']:f for f in v['frames']};need(len(frames)==len(v['frames']),'duplicate frames');need('vehicle' in frames,'vehicle frame missing')
  for f in frames.values():
   seen=set();p=f
   while p['parentFrameId'] is not None:
    need(p['frameId'] not in seen,'frame cycle');seen.add(p['frameId']);need(p['parentFrameId'] in frames,'missing parent frame');p=frames[p['parentFrameId']]
   need(p['frameId']=='vehicle','disconnected frame tree')
   q=f.get('rotationQuaternionXYZW',[0,0,0,1]);common.transform({'translation':f.get('translationM',[0,0,0]),'rotation':q,'scale':f.get('scale',[1,1,1])});need(len(q)==4 and abs(sum(x*x for x in q)-1)<1e-5,'frame quaternion invalid')
  for ref in v['assetRefs'].values():need(ref is None or ref in ids,'invalid asset ref')
  for group in ['floorSurfaces','doors','wheels','seats','standingRegions','cameraAnchors','gangways','couplers','anchors','freeZones']:
   for obj in v[group]:need(obj['frameId'] in frames,'unknown object frame')
  exterior=ids[v['assetRefs']['exterior']];interior=ids[v['assetRefs']['interior']]
  need(v['floorHeightM']==v['doorSillHeightM']==.95,'floor/sill contract');need(v['headroomM']>=2.05,'headroom contract')
  for d in v['doors']:
   need(d['doorFrameId'] in frames,'door frame missing');need(d['closedTransform']['parentFrameId']==d['openTransform']['parentFrameId']==frames[d['doorFrameId']]['parentFrameId'],'door transform frame mismatch');need(d['openingWidthM']>=1.2 and d['openingHeightM']>=2,'door dimensions');need(np.linalg.norm(d['outwardNormal'])>0,'zero door outward normal')
   need(close(frames[d['doorFrameId']]['translationM'],d['closedTransform']['translationM'],1e-6),'rest frame mismatch')
   need(d['carId']==vid,'door car mismatch');need(d['sweptBoundsM']['frameId']=='vehicle','swept frame')
   poly=np.array(d['openingPolygonM']);need(close(np.ptp(poly,axis=0)[[1,2]],[d['openingHeightM'],d['openingWidthM']],1e-6),'door polygon dimensions')
  for s in v['floorSurfaces']:
   verts=np.array(s['verticesM']);idx=s['indices'];need(len(idx)%3==0 and all(0<=i<len(verts) for i in idx),'floor index bounds')
   for a,b,c in np.array(idx).reshape(-1,3):need(np.cross(verts[b]-verts[a],verts[c]-verts[a])[1]>0,'floor winding must +Y')
  for group,key in [('standingRegions','polygonM'),('freeZones','polygonM'),('gangways','walkablePolygonM')]:
   for item in v[group]:
    p=np.array(item[key]);need(polygon_simple(p),'self-intersecting polygon');need(len(p)>=3 and np.max(abs(p[:,1]-p[0,1]))<1e-5,'polygon nonplanar');q=p[:,[0,2]];need(abs(sum(q[(i+1)%len(q),0]*q[i,1]-q[(i+1)%len(q),1]*q[i,0] for i in range(len(q))))>1e-6,'zero polygon area')
  for w in v['wheels']:need(np.linalg.norm(w['spinAxis'])>0 and w['radiusM']>0,'wheel axis/radius invalid');need(w['semanticRole']=='steel-rail-wheel' and w['material']=='metro-steel-metal','rail wheel material role')
  for s in v['seats']:
   q=s['facingQuaternionXYZW'];need(len(q)==4 and abs(sum(x*x for x in q)-1)<1e-5,'seat quaternion invalid')
  for c in v['lodCapabilities']:
   need(all(isinstance(c[k],bool) for k in ['doorsAnimated','passengerCapable','openingsPreserved']),'capability type')
   if c['level']==2:need(not any(c[k] for k in ['doorsAnimated','passengerCapable','openingsPreserved']),'coarse LOD capability conflict')
  if not deep:continue
  g0=geometry(root/exterior['lods'][0]['file']);gi=geometry(root/interior['lods'][0]['file']);nodes={**g0['nodes'],**gi['nodes']}
  for anchor in v['anchors']:
   need(anchor['nodeId'] in nodes,'missing anchor node '+anchor['nodeId']);need(close(nodes[anchor['nodeId']]['position'],anchor['positionM']),'anchor position mismatch')
  for d in v['doors']:
   need(d['nodeId'] in g0['nodes'],'missing door node');need(close(g0['nodes'][d['nodeId']]['position'],d['closedTransform']['translationM']),'door node rest mismatch')
  for w in v['wheels']:
   ni=g0['nodes'][w['nodeId']]['node'];names={g0['doc']['materials'][p['material']]['name'] for p in g0['doc']['meshes'][ni['mesh']]['primitives']};need(names=={'metro-steel-metal'},'actual wheel primitive material role')
   need(w['nodeId'] in nodes,'missing wheel');need(close(nodes[w['nodeId']]['position'],w['centerM']),'wheel center mismatch');need(abs(w['centerM'][1]-w['radiusM'])<1e-5,'rail contact mismatch')
  for b in v['bogies']:
   need(close(nodes[b['nodeId']]['position'],b['centerM']),'bogie center mismatch');ni=g0['nodes'][b['nodeId']+'-frame']['node'];names={g0['doc']['materials'][p['material']]['name'] for p in g0['doc']['meshes'][ni['mesh']]['primitives']};need(names=={'metro-steel-metal'},'actual bogie primitive material role')
  for c in v['collision']['primitives']:
   need(c['frameId'] in frames and c['nodeId'] in nodes,'collision references invalid')
   if c['id']=='continuous-floor':
    tri=gi['triangles'][gi['names']==c['nodeId']].reshape(-1,3);need(close(tri.min(axis=0),c['boundsM']['min']) and close(tri.max(axis=0),c['boundsM']['max']),'floor collision/visible bounds mismatch')
   elif c['id'].startswith('seat-'):
    tri=gi['triangles'][gi['names']==c['nodeId']].reshape(-1,3);need(np.all(tri.min(axis=0)>=np.array(c['boundsM']['min'])-.002) and np.all(tri.max(axis=0)<=np.array(c['boundsM']['max'])+.002),'seat collision does not contain visible mesh')
  for f in frames.values():
   if f['frameId'] in nodes:need(close(nodes[f['frameId']]['position'],f['translationM']),'numeric frame/GLB node mismatch')
  for s in v['seats']:
   need(s['nodeId'] in nodes,'missing seat mesh');need(s['cameraEyePointM'][1]>s['pelvisPointM'][1],'seat eye datum');hits=ray(gi,[s['pelvisPointM'][0],1.43,s['pelvisPointM'][2]],[0,-1,0]);need(hits and abs(hits[0][0]-.03)<.005,'seat pelvis/cushion mismatch')
  # Floor meshes measured by downward rays at actual triangle centroids + vertices-inset.
  floor_samples=0
  for s in v['floorSurfaces']:
   gg=g0 if s.get('resource')=='exterior' else gi
   for ids3 in np.array(s['indices']).reshape(-1,3):
    p=np.mean(np.array(s['verticesM'])[ids3],axis=0);hits=ray(gg,p+[0,.02,0],[0,-1,0]);need(hits and abs(hits[0][0]-.02)<.002,'actual floor/threshold mismatch');floor_samples+=1
  for lod in exterior['lods']:
   cap=v['lodCapabilities'][lod['level']];need(all(isinstance(cap[k],bool) for k in ['doorsAnimated','passengerCapable','openingsPreserved']),'capability booleans')
   budget=[8000,2000,400][lod['level']];need(lod['triangles']<=budget,'exterior triangle budget');g=geometry(root/lod['file']);need(g['uvPresent'],'missing UV');need(not g['duplicateTriangles'],'duplicate triangles')
   need(close(lod['boundsM']['min'],exterior['boundsM']['min']) and close(lod['boundsM']['max'],exterior['boundsM']['max']),'LOD bounds drift')
   for w in v['wheels']:
    need(close(g['nodes'][w['nodeId']]['position'],w['centerM']),'LOD wheel center drift');tri=g['triangles'][g['names']==w['nodeId']].reshape(-1,3);need(abs(tri[:,1].min())<.002 and abs(tri[:,1].max()-.72)<.002,'actual wheel radius/rail contact drift')
   if lod['level']==2:
    need(not cap['passengerCapable'] and not cap['openingsPreserved'] and not cap['doorsAnimated'],'closed LOD2 claims boarding');continue
   goo=geometry(root/lod['file'],overrides(v));inter=geometry(root/interior['lods'][min(lod['level'],1)]['file']);allopen=combine(goo,inter);allclosed=combine(g,inter);door_samples=0
   for d in v['doors'][::2]:
    sign=d['outwardNormal'][0];z=d['boardingPointM'][2]
    for y in [.952,1.02,1.50,2.0,2.76,2.998]:
     for dz in [-.698,-.60,0,.60,.698]:
      hits=ray(allopen,[sign*1.7,y,z+dz],[-sign,0,0],max_t=1.7);need(not hits,f'open door blocked {vid} LOD{lod["level"]} {d["doorId"]} {y}/{dz}: {hits[:1]}');door_samples+=1
    hits=ray(allclosed,[sign*1.7,1.5,z+.20],[-sign,0,0],max_t=.7);need(hits,'closed door not solid')
   # Free aisle/head capsule samples: 1.81m adult with 0.48m shoulder footprint.
   heads=0
   for z in np.linspace(-8.2,8.2,42):
    for x in [-.55,0,.55]:
     hits=ray(allopen,[x,.951,z],[0,1,0],max_t=2.049);need(not hits,f'headroom/aisle obstructed {x}/{z}: {hits[:1]}');heads+=1
   # Explicit 1.75/1.81m human capsule probes: 0.48m body diameter and 0.24m head diameter.
   # Spheres sample the vertical capsule spine; closest point is tested against real GLB triangles.
   capsule_samples=0;feet=[[0,.95,float(z)] for z in np.linspace(-8.0,8.0,12)]
   for d in v['doors'][::2]:
    for x in [d['outwardNormal'][0]*1.55,d['outwardNormal'][0]*.80,0]:feet.append([x,.95,d['boardingPointM'][2]])
   for p in feet:
    for height in [1.75,1.81]:
     for y,radius in [(height-.12,.12),(.48,.24),(.95,.24),(height-.36,.24)]:
      need(distance_to_triangles(allopen,[p[0],p[1]+y,p[2]])>=radius-.001,'human capsule mesh intersection');capsule_samples+=1
   # Declared empty wheelchair/bike zones checked below head-height.
   for zone in v['freeZones']:
    p=np.array(zone['polygonM']);lo=p.min(axis=0);hi=p.max(axis=0)
    for x in np.linspace(lo[0]+.05,hi[0]-.05,5):
     for z in np.linspace(lo[2]+.05,hi[2]-.05,6):need(not ray(allopen,[x,.951,z],[0,1,0],max_t=1.80),'free zone obstruction')
   # Door movement clears stationary body after plug-out stage; finite sampled leaf corner positions inside sweep.
   for d in v['doors']:
    sw=d['sweptBoundsM'];a=np.array(d['closedTransform']['translationM']);b=np.array(d['openTransform']['translationM']);lo=np.array(d['leafBoundsLocalM']['min']);hi=np.array(d['leafBoundsLocalM']['max'])
    for t in np.linspace(0,1,21):
     p=np.array(overrides(v,float(t))[d['nodeId']]['translation']);need(np.all(p+lo>=np.array(sw['min'])-1e-6) and np.all(p+hi<=np.array(sw['max'])+1e-6),'door escapes swept bounds')
     if t>=.5:
      sign=d['outwardNormal'][0];inner=p[0]-sign*.0275;need(abs(inner)>1.34,'sliding leaf intersects stationary shell plane')
   # Ray sweep of sampled real leaf surface points against stationary exported triangles.
   static=combine(g,inter);moving=tuple(d['nodeId'] for d in v['doors']);sweep_rays=0
   for d in v['doors']:
    tri=g['triangles'][g['names']==d['nodeId']];pts=np.unique(tri.reshape(-1,3).round(6),axis=0);a=np.array(d['closedTransform']['translationM']);b=np.array(d['openTransform']['translationM']);plug=np.array([b[0]-a[0],0,0]);slide=np.array([0,0,b[2]-a[2]])
    for delta,offset in [(plug,np.zeros(3)),(slide,plug)]:
     length=float(np.linalg.norm(delta));direction=delta/length
     for p in pts[::2]:
      p=p*.9998+pts.mean(axis=0)*.0002 # 0.2mm inset: boundary contact at floor/header is legal.
      need(not ray(static,p+offset+direction*.0001,direction,exclude=moving,max_t=length-.0002),'door motion intersects stationary actual mesh');sweep_rays+=1
   for gang in v['gangways']:
    e=gang['outwardNormal'][2]
    for x in [-.50,0,.50]:
     for y in [1.05,2.0,2.95]:need(not ray(allopen,[x,y,e*8.2],[0,0,e],max_t=.6),'gangway opening obstructed')
   results.append({'vehicleId':vid,'lod':lod['level'],'doorRaySamples':door_samples,'aisleHeadroomRays':heads,'floorTriangleCentroidChecks':floor_samples,'doorMotionSamplesPerLeaf':21,'actualLeafSurfaceSweepRays':sweep_rays,'humanCapsuleSphereTriangleTests':capsule_samples,'status':'pass'})
  for lod in interior['lods']:
   need(lod['triangles']<=[12000,3000][lod['level']],'interior triangle budget');need(lod['primitives']<=8,'static interior draw budget');doc,_=common.read_glb(root/lod['file']);need(doc['extras']['staticBatching']['renderPrimitiveCount']==lod['primitives'],'static batching primitive count')
 # Recompute composed train bounds using each explicit car transform once.
 points=[];byvehicle={v['vehicleId']:v for v in m['vehicles']}
 for car in m['composition']['cars']:
  need(car['vehicleId'] in byvehicle,'unknown consist vehicle');bb=ids[byvehicle[car['vehicleId']]['assetRefs']['exterior']]['boundsM'];mat=common.transform({'translation':car['translationM'],'rotation':car['rotationQuaternionXYZW']})
  for x in [bb['min'][0],bb['max'][0]]:
   for y in [bb['min'][1],bb['max'][1]]:
    for z in [bb['min'][2],bb['max'][2]]:points.append(common.point(mat,[x,y,z]))
 bb=m['composition']['actualBoundsM'];need(close(np.min(points,axis=0),bb['min'],.002) and close(np.max(points,axis=0),bb['max'],.002),'composed train bounds mismatch');need(bb['size'][2]+2*m['composition']['stoppingToleranceEachEndM']<=m['composition']['requiredPlatformLengthM']+.002,'platform length undersized')
 return results

def negative_tests(m):
 cases=[]
 def test(name,edit):
  x=copy.deepcopy(m);edit(x)
  try:validate_manifest(x,deep=False)
  except (ValueError,KeyError,TypeError):cases.append({'test':name,'status':'pass','outcome':'rejected'});return
  raise ValueError('negative test accepted: '+name)
 test('missing exterior asset',lambda x:x['vehicles'][0]['assetRefs'].update(exterior='missing'))
 test('frame cycle',lambda x:x['vehicles'][0]['frames'][1].update(parentFrameId=x['vehicles'][0]['frames'][1]['frameId']))
 test('reversed floor winding',lambda x:x['vehicles'][0]['floorSurfaces'][0].update(indices=[0,1,2,0,2,3]))
 test('wrong door parent',lambda x:x['vehicles'][0]['doors'][0]['openTransform'].update(parentFrameId='wrong'))
 test('undersized door',lambda x:x['vehicles'][0]['doors'][0].update(openingWidthM=.9))
 test('seat unknown frame',lambda x:x['vehicles'][0]['seats'][0].update(frameId='missing'))
 test('nonfinite metadata',lambda x:x['vehicles'][0].update(floorHeightM=float('nan')))
 test('zero normal',lambda x:x['vehicles'][0]['doors'][0].update(outwardNormal=[0,0,0]))
 test('rubber tire role on rail wheel',lambda x:x['vehicles'][0]['wheels'][0].update(material='metro-rubber'))
 test('coarse LOD boarding claim',lambda x:x['vehicles'][0]['lodCapabilities'][2].update(passengerCapable=True))
 test('nonunit seat quaternion',lambda x:x['vehicles'][0]['seats'][0].update(facingQuaternionXYZW=[0,0,0,0]))
 test('nonunit quaternion',lambda x:x['vehicles'][0]['frames'][1].update(rotationQuaternionXYZW=[0,0,0,2]))
 return cases

def main():
 m=json.loads((ROOT/'manifest.json').read_text());c=common.validate(ROOT);r=validate_manifest(m);n=negative_tests(m)
 report={'status':'pass','checks':{'commonPackaging':'pass','finiteGeometryAndNormalizedNormals':'pass','triangleWindingMatchesNormals':'pass','uv':'pass','losslessStaticInteriorBatchRangesAndZeroDrawAnchors':'pass','duplicateExactTriangles':'pass','frameTreeAndActualNodeAnchors':'pass','actualDoorOpenClosedRaySections':'pass','actualFloorWindingAndHeight':'pass','actualAisleHeadroomAndFreeZones':'pass','human175And181CapsuleProbes':'pass','seatPelvisCushionAndCameraAnchors':'pass','doorTwoStageSweepEnvelope':'pass','collisionReferencesAndVisibleFloorSeatBounds':'pass','actualWheelRadiusAndContact':'pass','steelRailWheelAndBogieMaterialPrimitives':'pass','staticGangwayOpenings':'pass','lodBudgetsAndDatums':'pass'},'geometryTests':r,'negativeTests':n,'geometryAttributes':{'POSITION':'finite','NORMAL':'unit and winding aligned','TEXCOORD_0':'present on every primitive','TANGENT':'not emitted; no normal texture or tangent-space shader in delivered material'},'scopeLimits':['CPU uses actual GLB triangles and sampled section rays, not a certified continuous collision solver.','Exact duplicate triangle check does not certify absence of every partial coplanar overlap.','Inter-car telescoping envelope is conservative metadata; moving traversal remains disabled.','WebGL transparency sorting, dynamic collision, passenger attachment and D06 not run.'],'runtimeChecks':{'status':'not_run','integrationStatus':'runtime_pending_webgl'}}
 (ROOT/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');(ROOT/'qa/common-validation.json').write_text(json.dumps(c,indent=2)+'\n');print(json.dumps({'status':'pass','geometryCases':len(r),'negativeTests':len(n)}))
if __name__=='__main__':main()
