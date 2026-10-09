"""Fail-closed checks on delivered GLB geometry + D04/D05 semantic metadata, CPU only."""
import json,sys,importlib.util,math,copy
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import common,PROFILE,FLOOR,DOOR_Z
spec=importlib.util.spec_from_file_location('atlas_existing_geometry_checks',ROOT.parent/'boardable-metro/validate.py');geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)
need=common.need

def close(a,b,t=.002):return np.max(abs(np.array(a)-np.array(b)))<=t

def door_overrides(v,t=1):
 out={}
 for d in v['doors']:
  a=np.array(d['closedTransform']['translationM']);b=np.array(d['openTransform']['translationM']);p=a.copy();p[0]=a[0]+(b[0]-a[0])*min(2*t,1);p[2]=a[2]+(b[2]-a[2])*max(0,2*t-1);out[d['nodeId']]={'translation':p.tolist(),'rotation':[0,0,0,1],'scale':[1,1,1]}
 return out

def validate_manifest(m,root=ROOT,deep=True):
 common.finite(m);need(m['packageId']=='canada-line-stage2','package identity');need(len(m['vehicles'])==1,'shared endcar identity');v=m['vehicles'][0];need(v['profileId']==PROFILE,'independent Canada profile required');need(v['nominalLengthM']==20.5 and v['nominalBodyWidthM']==3,'Canada dimensions must not inherit Expo');need(v['floorHeightM']==v['doorSillHeightM']==FLOOR,'floor and door sill mismatch');need(v['headroomM']>=2.05,'insufficient headroom');need(len(v['doors'])==12,'six paired doors required')
 assets={a['id']:a for a in m['assets']};need(len(assets)==2,'two lazy-load resource assets');need(all(x is None or x in assets for x in v['assetRefs'].values()),'dangling asset reference');frames={f['frameId']:f for f in v['frames']};need(len(frames)==len(v['frames']),'duplicate frame')
 for f in frames.values():
  seen=set();p=f
  while p['parentFrameId'] is not None:
   need(p['frameId'] not in seen,'frame cycle');seen.add(p['frameId']);need(p['parentFrameId'] in frames,'missing parent');p=frames[p['parentFrameId']]
  need(p['frameId']=='vehicle','disconnected root');common.transform({'translation':f.get('translationM',[0,0,0]),'rotation':f.get('rotationQuaternionXYZW',[0,0,0,1]),'scale':f.get('scale',[1,1,1])})
 for group in ['floorSurfaces','doors','bogies','wheels','seats','standingRegions','cameraAnchors','gangways','couplers','anchors','freeZones']:
  for obj in v[group]:need(obj['frameId'] in frames,'unknown frame')
 for surface in v['floorSurfaces']:
  points=np.array(surface['verticesM']);indices=surface['indices'];need(len(indices)%3==0 and all(0<=i<len(points) for i in indices),'floor indices')
  for a,b,c in np.array(indices).reshape(-1,3):need(np.cross(points[b]-points[a],points[c]-points[a])[1]>0,'floor winding')
 for d in v['doors']:
  need(d['carId']==v['vehicleId'],'door car mismatch');need(d['side'] in ['left','right'],'door side invalid');sign=1 if d['side']=='left' else -1;need(d['outwardNormal']==[sign,0,0],'door normal wrong side');need(d['doorFrameId'] in frames,'missing door frame');need(d['closedTransform']['parentFrameId']==d['openTransform']['parentFrameId']=='vehicle','door parent mismatch');need(close(frames[d['doorFrameId']]['translationM'],d['closedTransform']['translationM']),'door rest frame');need(d['openingWidthM']==1.5 and d['openingHeightM']==2.13,'Canada opening dimensions');p=np.array(d['openingPolygonM']);need(close(np.ptp(p,axis=0)[[1,2]],[d['openingHeightM'],d['openingWidthM']]),'opening polygon mismatch');need(d['animation']['nodeId']==d['nodeId'],'animation target');need(np.linalg.norm(d['outwardNormal'])>0,'zero normal')
 for s in v['seats']:need(abs(sum(x*x for x in s['facingQuaternionXYZW'])-1)<1e-5,'seat quaternion')
 for a in v['lodCapabilities']:
  need(all(type(a[k]) is bool for k in ['doorsAnimated','passengerCapable','openingsPreserved']),'LOD booleans')
  if a['level']==2:need(not any(a[k] for k in ['doorsAnimated','passengerCapable','openingsPreserved']),'closed display LOD passenger capability')
 for g in v['gangways']:need(g['intercarTraversalEnabled'] is False,'unverified moving intercar traversal')
 comp=m['composition'];need(len(comp['cars'])==2 and comp['profileId']==PROFILE,'Canada composition');need(comp['requiredPlatformLengthM']>=comp['actualLengthM']+2*comp['stoppingToleranceEachEndM'],'platform does not cover train and stop tolerance');need(comp['cars'][1]['rotationQuaternionXYZW']==[0,1,0,0],'rear observation orientation');need(m['runtimeChecks']['status']=='not_run','runtime must not claim pass')
 if not deep:return {'status':'pass','scope':'metadata only'}
 results=[];ext=assets[v['assetRefs']['exterior']];inter=assets[v['assetRefs']['interior']]
 for level in [0,1]:
  g=geo.geometry(root/ext['lods'][level]['file']);gi=geo.geometry(root/inter['lods'][level]['file']);open_g=geo.geometry(root/ext['lods'][level]['file'],door_overrides(v));merged=geo.combine(open_g,gi);nodes={**g['nodes'],**gi['nodes']};need(not g['duplicateTriangles'] and not gi['duplicateTriangles'],'duplicate triangle');need(g['uvPresent'] and gi['uvPresent'],'UV absent')
  for a in v['anchors']:need(a['nodeId'] in nodes and close(nodes[a['nodeId']]['position'],a['positionM']),'anchor mismatch '+a['nodeId'])
  for d in v['doors']:need(d['nodeId'] in g['nodes'] and close(g['nodes'][d['nodeId']]['position'],d['closedTransform']['translationM']),'door rest node mismatch')
  for w in v['wheels']:
   need(close(nodes[w['nodeId']]['position'],w['centerM']),'wheel center');need(abs(w['centerM'][1]-w['radiusM'])<1e-5,'wheel rail datum');node=nodes[w['nodeId']]['node'];need({g['doc']['materials'][p['material']]['name'] for p in g['doc']['meshes'][node['mesh']]['primitives']}=={'canada-steel'},'wheel material')
  for c in v['collision']['primitives']:
   need(c['nodeId'] in nodes and c['frameId'] in frames,'collision node missing');lo=np.array(c['boundsM']['min']);hi=np.array(c['boundsM']['max']);need(np.all(hi>lo),'collision bounds inverted')
   if c['id'] in ['floor','ceiling'] or c['id'].startswith('seat-'):
    pts=gi['triangles'][gi['names']==c['nodeId']].reshape(-1,3);need(len(pts)>0,'missing collision component');need(np.all(pts.min(axis=0)>=lo-.002) and np.all(pts.max(axis=0)<=hi+.002),'collision does not cover actual mesh')
  floor_samples=0
  for f in v['floorSurfaces']:
   actual=gi if f['resource']=='interior' else g;p=np.array(f['verticesM'])
   for inds in np.array(f['indices']).reshape(-1,3):
    centroid=p[inds].mean(axis=0);hits=geo.ray(actual,centroid+[0,.03,0],[0,-1,0],max_t=.06);need(hits and abs(hits[0][0]-.03)<.002,'floor metadata not actual geometry');floor_samples+=1
  door_samples=0
  for d in v['doors'][::2]:
   sign=d['outwardNormal'][0];z=d['boardingPointM'][2]
   for y in np.linspace(FLOOR+.05,3.18,6):
    for dz in [-.65,0,.65]:
     hits=geo.ray(merged,[sign*1.8,float(y),z+dz],[-sign,0,0],max_t=.6);need(not hits,'open door obstruction '+str(hits[:1]));door_samples+=1
   for t in np.linspace(0,1,21):
    for leaf in [x for x in v['doors'] if x['openingId']==d['openingId']]:
     p=np.array(door_overrides(v,float(t))[leaf['nodeId']]['translation']);lo=np.array(leaf['leafBoundsLocalM']['min']);hi=np.array(leaf['leafBoundsLocalM']['max']);sw=leaf['sweptBoundsM'];need(np.all(p+lo>=np.array(sw['min'])-1e-6) and np.all(p+hi<=np.array(sw['max'])+1e-6),'door swept bounds too small')
  aisle=0
  for x in [-.60,0,.60]:
   for z in np.linspace(-9.8,9.8,31):need(not geo.ray(merged,[x,FLOOR+.01,float(z)],[0,1,0],max_t=2.05),'aisle headroom obstruction');aisle+=1
  free=0
  for zone in v['freeZones']:
   p=np.array(zone['polygonM']);need(geo.polygon_simple(p),'zone self intersection');lo=p.min(axis=0);hi=p.max(axis=0)
   for x in np.linspace(lo[0]+.04,hi[0]-.04,5):
    for z in np.linspace(lo[2]+.04,hi[2]-.04,5):need(not geo.ray(merged,[float(x),FLOOR+.01,float(z)],[0,1,0],max_t=1.9),'free zone obstructed');free+=1
  for x in [-.57,0,.57]:
   for y in [1.16,2.0,3.17]:need(not geo.ray(merged,[x,y,-10.0],[0,0,-1],max_t=.5),'gangway obstructed')
  sweep_rays=0
  static=geo.combine(g,gi);moving=tuple(d['nodeId'] for d in v['doors'])
  for d in v['doors']:
   pts=np.unique(g['triangles'][g['names']==d['nodeId']].reshape(-1,3).round(6),axis=0);a=np.array(d['closedTransform']['translationM']);b=np.array(d['openTransform']['translationM']);plug=np.array([b[0]-a[0],0,0]);slide=np.array([0,0,b[2]-a[2]])
   for delta,offset in [(plug,np.zeros(3)),(slide,plug)]:
    length=float(np.linalg.norm(delta));direction=delta/length
    for p in pts[::2]:
     p=p*.9998+pts.mean(axis=0)*.0002
     need(not geo.ray(static,p+offset+direction*.0001,direction,exclude=moving,max_t=length-.0002),'door motion intersects stationary mesh');sweep_rays+=1
  human_samples=0
  for d in v['doors'][::2]:
   sign=d['outwardNormal'][0];z=d['boardingPointM'][2]
   for x in np.linspace(1.76,.85,5):
    for y in np.linspace(FLOOR+.23,FLOOR+1.95-.23,5):
     need(geo.distance_to_triangles(merged,[sign*float(x),float(y),z])>=.219,'1.95m human capsule collision');human_samples+=1
  for seat in v['seats']:
   eye=np.array(seat['cameraEyePointM']);need(geo.distance_to_triangles(merged,eye)>.1,'seat eye blocked')
  need(inter['lods'][level]['primitives']<=8,'interior static draw budget');need(inter['lods'][level]['triangles']<=[12000,3000][level],'interior triangle budget');results.append({'lod':level,'floorRaySamples':floor_samples,'openDoorRaySamples':door_samples,'aisleHeadroomSamples':aisle,'freeZoneSamples':free,'doorMotionSamplesPerLeaf':21,'actualLeafSurfaceSweepRays':sweep_rays,'humanCapsuleSphereTriangleTests':human_samples,'status':'pass'})
 # Actual consist bounds, transformed car-local geometry, are independent from old Expo.
 transformed=[]
 for car in comp['cars']:
  mat=common.transform({'translation':car['translationM'],'rotation':car['rotationQuaternionXYZW']});transformed.extend(common.point(mat,p) for p in g['triangles'].reshape(-1,3))
 pts=np.array(transformed);length=float(np.ptp(pts,axis=0)[2]);need(abs(length-comp['actualLengthM'])<.02,'actual consist length mismatch')
 return {'status':'pass','scope':'CPU GLB semantic geometry only; no runtime/GPU acceptance','results':results,'measuredConsistLengthM':length,'runtimeStatus':'runtime_pending_webgl'}
if __name__=='__main__':
 m=json.loads((ROOT/'manifest.json').read_text());r=validate_manifest(m);c=common.validate(ROOT);(ROOT/'qa/validation.json').write_text(json.dumps(r,indent=2)+'\n');(ROOT/'qa/common-validation.json').write_text(json.dumps(c,indent=2)+'\n');print(json.dumps(r,indent=2))
