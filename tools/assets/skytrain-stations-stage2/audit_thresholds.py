"""Actual GLB top-face rays and conservative stored AABB clearance for every bridge."""
import json,sys,math,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));from validate import C,need,inside,world_nodes
L=json.loads((ROOT/'station-layout.json').read_text())
def triangles(path,poses=None):
 doc,b=C.read_glb(path);out=[]
 def walk(i,parent):
  n=doc['nodes'][i]
  if poses and n.get('name') in poses:
   n=dict(n);n.pop('matrix',None);n.update(poses[n['name']])
  m=C.matmul(parent,C.transform(n))
  if 'mesh'in n:
   for p in doc['meshes'][n['mesh']]['primitives']:
    vs=[C.point(m,v) for v in C.accessor(doc,b,p['attributes']['POSITION'])];idx=[v[0] for v in C.accessor(doc,b,p['indices'])]
    for j in range(0,len(idx),3):out.append((n.get('name',''),[vs[idx[k]] for k in range(j,j+3)]))
  for child in n.get('children',[]):walk(child,m)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 return out

def top_surfaces(tris,y):
 out=[]
 for name,vs in tris:
  if max(abs(v[1]-y) for v in vs)<.002:
   a,b,c=vs;cy=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
   if cy>1e-8:out.append(vs)
 return out

def inv(p,t,yaw):
 a=math.radians(-yaw);x,y,z=[p[k]-t[k] for k in range(3)];return [x*math.cos(a)+z*math.sin(a),y,-x*math.sin(a)+z*math.cos(a)]
def tr(p,t,yaw):
 a=math.radians(yaw);x,y,z=p;return [t[0]+x*math.cos(a)+z*math.sin(a),t[1]+y,t[2]-x*math.sin(a)+z*math.cos(a)]
def bbox(vs):return [[min(v[i] for v in vs) for i in range(3)],[max(v[i] for v in vs) for i in range(3)]]
def overlap(a,b):return all(min(a[1][k],b[1][k])-max(a[0][k],b[0][k])>1e-5 for k in range(3))
refs={};summary=[];vehiclecache={};actualbridge={}
for line,pkg in [('expo','boardable-metro'),('canada','canada-line-stage2')]:
 m=json.loads((ROOT.parent/pkg/'manifest.json').read_text());v=m['vehicles'][0];tris=[]
 for key in ['exterior','interior']:
  a=next(a for a in m['assets'] if a['id']==v['assetRefs'][key]);path=ROOT.parent/pkg/a['lods'][0]['file'];tris+=triangles(path);refs[str(path.relative_to(ROOT.parent))]=C.digest(path)
 vehiclecache[line]=(m,v,top_surfaces(tris,v['floorHeightM']))
 path=ROOT/'exports'/f'threshold-bridge-{line}.glb';actualbridge[line]=triangles(path);refs[str(path.relative_to(ROOT))]=C.digest(path)
for s in L['stations']:
 glb=ROOT/'exports'/(s['stationId']+'.glb');refs[str(glb.relative_to(ROOT))]=C.digest(glb);snodes=world_nodes(glb);stationtris=triangles(glb)
 for bridge in s['thresholdBridges']:
  p=next(p for p in s['platforms'] if any(d['id']==bridge['pairedDoorAlignmentId'] for d in p['doorAlignmentPoints']));d=next(d for d in p['doorAlignmentPoints'] if d['id']==bridge['pairedDoorAlignmentId']);line=p['lineId'];m,v,vehiclefloor=vehiclecache[line];side=1 if d['consistLocalSillPointM'][0]>0 else -1;root=p['stopPosition']['translationM'];q=p['stopPosition']['rotationQuaternionXYZW'];yaw=math.degrees(2*math.atan2(q[1],q[3]));fy=p['floorAboveRailM'];cz=d['carPoseInConsist']['translationM'][2];z=d['consistLocalSillPointM'][2];carflip=d['carPoseInConsist']['rotationQuaternionXYZW'][1]!=0
  sp=bridge['storedTransform'];node=snodes[bridge['nodeId']];need(math.dist(node['origin'],sp['translationM'])<.002,'stored transform origin');local=[inv(a,root,yaw) for a in node['points']];sb=bbox(local);need(sb[1][1]<=fy-.0199,'stored door clearance');ab=[min(abs(pt[0]) for pt in local),max(abs(pt[0]) for pt in local)];need(ab[0]>m['vehicles'][0]['completeBoundsM']['size'][0]/2+.001,'stored plate overlaps vehicle whole-width envelope');edge=abs(d['platformEdgePointM'][0]-root[0]) if abs(yaw)<1e-8 else abs(inv(d['platformEdgePointM'],root,yaw)[0]);need(ab[1]<edge-.001,'stored plate overlaps platform envelope')
  dep=bridge['deployedTransform'];gtris=[(n,[tr(pt,dep['translationM'],yaw) for pt in vs]) for n,vs in actualbridge[line]];bridgefloor=top_surfaces(gtris,p['floorHeightM']+.015);need(bridgefloor,'actual deployed top face absent');need(all(any(math.dist(v,pt)<.002 for _,tri in gtris for pt in tri) for v in bridge['deployedFloor']['verticesM']),'bridge conditional floor corners disagree with actual module');sfloor=top_surfaces(stationtris,p['floorHeightM']);floorouter=bridge['vehicleFloorOuterXM'];start=floorouter-.015;end=edge+.015;raycount=0
  for zz in [-.60,0,.60]:
   for i in range(21):
    x=side*(start+(end-start)*i/20);point=tr([x,fy,z+zz],root,yaw);carpoint=[-x if carflip else x,fy,-(z+zz-cz) if carflip else z+zz-cz];support=any(inside([point[0],point[1]+.015,point[2]],t,1e-5) for t in bridgefloor) or any(inside(point,t,1e-5) for t in sfloor) or any(inside(carpoint,t,1e-5) for t in vehiclefloor);need(support,'unsupported sampled boarding gap '+bridge['instanceId']);raycount+=1
  # Fully-open leaves translate clear of the 1.30m plate; station bridge must not be enabled during leaf motion.
  relevant=[a for a in v['doors'] if a['side']==d['carLocalSide'] and abs((a['openingPolygonM'][0][2]+a['openingPolygonM'][1][2])/2-d['carLocalDoorZ'])<.01];need(len(relevant)==2,'paired leaf contract')
  for leaf in relevant:
   bounds=leaf['leafBoundsLocalM'];ot=leaf['openTransform']['translationM'];lo=ot[2]+bounds['min'][2];hi=ot[2]+bounds['max'][2];need(hi<d['carLocalDoorZ']-.65 or lo>d['carLocalDoorZ']+.65,'fully-open leaf overlaps bridge width')
  summary.append({'instanceId':bridge['instanceId'],'supportRays':raycount,'support':'actual station + bridge + vehicle GLB vertical support; maximum rise15mm','storedClearance':'inside gap, below sill by >=0.02m, outside complete vehicle X envelope','fullyOpenLeaves':'clear','runtimeMotion':'not_run'})
r={'status':'pass','instanceCount':len(summary),'supportRayCount':sum(r['supportRays'] for r in summary),'sourceHashes':refs,'instances':summary,'activation':'disabled until D06 stopped-door-deployed transaction and dynamic collision acceptance','motionPath':'explicit representative raised-rotate-translate-lower sequence, not swept-motion certified'};(ROOT/'qa/threshold-validation.json').write_text(json.dumps(r,indent=2)+'\n');print(r['status'],r['instanceCount'],r['supportRayCount'])
