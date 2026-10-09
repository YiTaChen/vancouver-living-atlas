"""Conservative triangle-AABB sampled pose sweep, actual GLBs with paired-side doors open."""
import json,sys,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));import audit_thresholds as T
C=T.C;need=T.need

def hit(a,b,eps=1e-5):return all(a[1][k]>b[0][k]+eps and b[1][k]>a[0][k]+eps for k in range(3))
def quat_lerp(a,b,t):
 dot=sum(x*y for x,y in zip(a,b))
 if dot<0:b=[-v for v in b];dot=-dot
 if dot>.9995:q=[a[i]+(b[i]-a[i])*t for i in range(4)]
 else:
  theta=math.acos(max(-1,min(1,dot)));q=[(a[i]*math.sin((1-t)*theta)+b[i]*math.sin(t*theta))/math.sin(theta) for i in range(4)]
 norm=math.sqrt(sum(v*v for v in q));return [v/norm for v in q]
def pose_points(points,p):
 m=C.transform({'translation':p['translationM'],'rotation':p['rotationQuaternionXYZW']});return [C.point(m,v) for v in points]
vehicles={};station_cache={};rows=[];sourcehashes=dict(T.refs)
for s in T.L['stations']:
 sid=s['stationId'];tris=T.triangles(ROOT/'exports'/f'{sid}.glb');stationtris=[(n,t) for n,t in tris if not n.startswith('bridge-')]
 for bridge in s['thresholdBridges']:
  p=next(p for p in s['platforms'] if any(d['id']==bridge['pairedDoorAlignmentId'] for d in p['doorAlignmentPoints']));d=next(d for d in p['doorAlignmentPoints'] if d['id']==bridge['pairedDoorAlignmentId']);line=p['lineId'];m=T.vehiclecache[line][0];car=m['composition']['cars'][d['carIndex']];v=next(v for v in m['vehicles'] if v['vehicleId']==car['vehicleId']);side=d['carLocalSide'];key=(line,v['vehicleId'],side)
  if key not in vehicles:
   pkg=ROOT.parent/('canada-line-stage2' if line=='canada' else 'boardable-metro');poses={q['nodeId']:{'translation':q['openTransform']['translationM'],'rotation':q['openTransform'].get('rotationQuaternionXYZW',[0,0,0,1])} for q in v['doors'] if q['side']==side};t=[]
   for role in ['exterior','interior']:
    a=next(a for a in m['assets'] if a['id']==v['assetRefs'][role]);path=pkg/a['lods'][0]['file'];t+=T.triangles(path,poses);sourcehashes[str(path.relative_to(ROOT.parent))]=C.digest(path)
   vehicles[key]=[(n,T.bbox(vs)) for n,vs in t]
  q=p['stopPosition']['rotationQuaternionXYZW'];yaw=math.degrees(2*math.atan2(q[1],q[3]));root=p['stopPosition']['translationM'];flip=car['rotationQuaternionXYZW'][1]!=0;cz=car['translationM'][2]
  def carpoint(pt):
   x,y,z=T.inv(pt,root,yaw);return [-x if flip else x,y,-(z-cz) if flip else z-cz]
  if p['platformId'] not in station_cache:station_cache[p['platformId']]=[(n,T.bbox([T.inv(pt,root,yaw) for pt in vs])) for n,vs in stationtris]
  points=[v for _,vs in T.actualbridge[line] for v in vs];poses=[bridge['storedTransform']]+bridge['sequence'];samples=[]
  for start,end in zip(poses,poses[1:]):
   for i in range(9):
    t=i/8;pose={'translationM':[start['translationM'][k]*(1-t)+end['translationM'][k]*t for k in range(3)],'rotationQuaternionXYZW':quat_lerp(start['rotationQuaternionXYZW'],end['rotationQuaternionXYZW'],t)};wp=pose_points(points,pose);samples.append((T.bbox([T.inv(pt,root,yaw) for pt in wp]),T.bbox([carpoint(pt) for pt in wp])))
  def union(boxes):return [[min(b[0][k] for b in boxes) for k in range(3)],[max(b[1][k] for b in boxes) for k in range(3)]]
  sb=union([b[0] for b in samples]);vb=union([b[1] for b in samples]);sc=[(n,b) for n,b in station_cache[p['platformId']] if hit(sb,b)];vc=[(n,b) for n,b in vehicles[key] if hit(vb,b)]
  for i,(st,ve) in enumerate(samples):
   for name,bb in sc:need(not hit(st,bb),f'bridge/static-station collision {bridge["instanceId"]} sample{i} {name}')
   for name,bb in vc:need(not hit(ve,bb),f'bridge/full-open-train collision {bridge["instanceId"]} sample{i} {name}')
  stored_car=T.bbox([carpoint(pt) for pt in pose_points(points,bridge['storedTransform'])]);relevant=[x for x in v['doors'] if x['side']==side and abs((x['openingPolygonM'][0][2]+x['openingPolygonM'][1][2])/2-d['carLocalDoorZ'])<.01]
  for leaf in relevant:
   b=leaf['sweptBoundsM'];need(not hit(stored_car,[b['min'],b['max']]),'stored plate inside paired-leaf sweep')
  rows.append({'instanceId':bridge['instanceId'],'sampledPoseCount':len(samples),'actualStaticStationTriangleCandidates':len(sc),'actualFullyOpenTrainTriangleCandidates':len(vc),'storedPairedLeafSweptVolumes':'clear','sampledDeploymentAndReverseRetraction':'clear; bottom-floor bearing contacts allowed, no positive-volume slab overlap','maxRiseM':.015})
# Sensitivity checks for the collision predicate and deliberate transformed slab penetration.
fixtures=[('penetration',hit([[-1,-.1,-1],[1,.1,1]],[[-2,0,-2],[2,0,2]])),('contact-not-penetration',not hit([[-1,0,-1],[1,.1,1]],[[-2,0,-2],[2,0,2]])),('separation',not hit([[1.65,-.26,-.65],[1.69,-.02,.65]],[[1.7,-.3,-40],[8,0,40]]))];need(all(v for _,v in fixtures),'sweep collision fixture failed')
r={'status':'pass','scope':'conservative AABB of each real GLB triangle against each sampled actual tapered bridge mesh AABB; touching support surfaces allowed; no continuous-time proof','instances':len(rows),'sampledPoseCount':sum(x['sampledPoseCount'] for x in rows),'samplesPerStage':9,'sourceHashes':sourcehashes,'checks':rows,'predicateFixtures':[{'name':n,'status':'pass'} for n,_ in fixtures],'runtimeContinuousMotionAndInterlocks':'not_run'};(ROOT/'qa/threshold-sweep-validation.json').write_text(json.dumps(r,indent=2)+'\n');print('sweep pass',r['instances'],r['sampledPoseCount'])
