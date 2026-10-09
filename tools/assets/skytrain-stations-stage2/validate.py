"""Offline positive/negative topology, GLB, source and dimensional validation. No runtime claims."""
import sys,json,copy,math,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('common',ROOT.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
def need(x,msg):
 if not x:raise ValueError(msg)
def inside(p,vs,tol=.025):
 if abs(p[1]-vs[0][1])>tol:return False
 signs=[]
 for a,b in zip(vs,vs[1:]+vs[:1]):signs.append((b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]))
 return all(v>=-tol for v in signs) or all(v<=tol for v in signs)
def cross_y(vs,indices):
 a,b,c=[vs[k] for k in indices[:3]];u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)];return u[2]*v[0]-u[0]*v[2]
def world_nodes(path):
 doc,buf=C.read_glb(path);out={}
 def walk(i,parent):
  n=doc['nodes'][i];m=C.matmul(parent,C.transform(n));points=[]
  if 'mesh' in n:
   for p in doc['meshes'][n['mesh']]['primitives']:points.extend(C.point(m,a) for a in C.accessor(doc,buf,p['attributes']['POSITION']))
  out[n.get('name','')]={'origin':C.point(m,[0,0,0]),'points':points,'extras':n.get('extras',{})}
  for c in n.get('children',[]):walk(c,m)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 return out

def validate_layout(doc,geometry=True):
 C.finite(doc);expected={'waterfront','burrard','granville','stadium-chinatown','main-street-science-world','vancouver-city-centre','yaletown-roundhouse'};ss=doc['stations'];need({s['stationId'] for s in ss}==expected and len(ss)==7,'exact seven stations required');need(doc['rideReady'] is False,'offline only')
 count={'stations':7,'platformStops':0,'surfaces':0,'doorAlignments':0,'stairs':0,'elevators':0,'anchors':0}
 for s in ss:
  sid=s['stationId'];fs={f['surfaceId']:f for f in s['floorSurfaces']};need(len(fs)==len(s['floorSurfaces']),'duplicate surface');need(not s['localToWorld']['worldPlacementReady'],'unsurveyed placement must remain gated');need(not s['runtimeChecks']['readyForBoarding'],'runtime status invalid');nodes=world_nodes(ROOT/'exports'/f'{sid}.glb') if geometry else {}
  for f in fs.values():
   need(cross_y(f['verticesM'],f['indices'])>0,'floor winding');need(f['walkable'],'walkable flag');need(f['frameId']==sid,'floor frame');count['surfaces']+=1
   if geometry:
    need(f['geometryNodeId'] in nodes,'floor node absent');vs=nodes[f['geometryNodeId']]['points'];need(all(any(math.dist(p,q)<.02 for q in vs) for p in f['verticesM']),'floor corners disagree with actual GLB')
   for t in s['trackExclusionVolumes']:
    y=f['verticesM'][0][1]
    if t['minY']<y<t['maxY']:
     # SAT exact convex XZ rectangle intersection, allowing edge touch only.
     a=f['verticesM'];b=t['footprintM'];separated=False
     for shape in [a,b]:
      for p,q in zip(shape,shape[1:]+shape[:1]):
       axis=[q[2]-p[2],p[0]-q[0]];aa=[v[0]*axis[0]+v[2]*axis[1] for v in a];bb=[v[0]*axis[0]+v[2]*axis[1] for v in b]
       if min(max(aa),max(bb))-max(min(aa),min(bb))<.001:separated=True
     need(separated,'walk floor intersects track exclusion: '+sid+'/'+f['surfaceId']+'/'+t['id'])
  graph={k:set() for k in fs}
  for e in s['connections']:
   a,b=e['fromSurfaceId'],e['toSurfaceId'];need(a in fs and b in fs,'missing connection surface');need(inside(e['startPointM'],fs[a]['verticesM']),'connection start not on floor '+e['connectionId']);need(inside(e['endPointM'],fs[b]['verticesM']),'connection end not on floor '+e['connectionId']);graph[a].add(b);graph[b].add(a)
   if e['type']=='walk':need(math.dist(e['startPointM'],e['endPointM'])<=.025,'walk endpoints gap')
   if e['type']=='stairs':need(e['riseM']<=.18 and e['treadRunM']>=.26,'stair step target');count['stairs']+=1
   if e['type']=='elevator':need(e['doorWidthM']>=1,'elevator door target');count['elevators']+=1
  connected=set();todo=[s['entrances'][0]['surfaceId']]
  while todo:
   cur=todo.pop()
   if cur in connected:continue
   connected.add(cur);todo.extend(graph[cur]-connected)
  for e in s['entrances']:need(e['surfaceId'] in connected,'disconnected entrance');need(inside(e['pointM'],fs[e['surfaceId']]['verticesM']),'entrance not on floor')
  for p in s['platforms']:
   count['platformStops']+=1;need(p['surfaceId'] in connected,'disconnected platform');need(p['lengthM']>=p['requiredConsistLengthM']+2*p['stoppingToleranceEachEndM'],'platform too short');can=p['lineId']=='canada';need(p['profileRef']['profileId']==('canada-line-2car-representative-v1' if can else 'expo-metro-17m'),'wrong line profile');need(abs(p['floorHeightM']-p['railHeightM']-p['floorAboveRailM'])<1e-6,'floor rail mismatch');need(abs(p['floorAboveRailM']-(1.1 if can else .95))<1e-6,'wrong train floor');need(len(p['doorAlignmentPoints'])==(6 if can else 12),'door count')
   for d in p['doorAlignmentPoints']:
    count['doorAlignments']+=1;need(abs(d['stationSillPointM'][1]-d['platformEdgePointM'][1])<.02 and abs(d['verticalDifferenceM'])<.02,'door vertical mismatch');need(abs(math.dist(d['stationSillPointM'],d['platformEdgePointM'])-d['horizontalThresholdGapM'])<.02,'door horizontal gap');need(inside(d['platformEdgePointM'],fs[p['surfaceId']]['verticesM']),'door edge off platform');need(inside(d['stationWaitingPointM'],fs[p['surfaceId']]['verticesM']),'door waiting point off platform')
  for a in s['anchors']:
   count['anchors']+=1
   if geometry:need(a['nodeId'] in nodes,'anchor node missing');need(math.dist(a['pointM'],nodes[a['nodeId']]['origin'])<.02,'anchor mismatch with GLB')
 wf=next(s for s in ss if s['stationId']=='waterfront');need(len({p['surfaceId'] for p in wf['platforms']})==2,'Waterfront platforms not independent');need(len({p['floorHeightM'] for p in wf['platforms']})==2,'Waterfront levels not independent');need(wf['transferRoutes'],'Waterfront transfer missing')
 for sid in ['burrard','granville']:
  s=next(s for s in ss if s['stationId']==sid);ys=[p['floorHeightM'] for p in s['platforms']];need(len(set(ys))==2 and max(ys)<0,'stacked platforms required')
 gran=next(s for s in ss if s['stationId']=='granville');bur=next(s for s in ss if s['stationId']=='burrard');need(min(p['floorHeightM'] for p in gran['platforms'])<min(p['floorHeightM'] for p in bur['platforms'])-5,'Granville not deep-distinct')
 stadium=next(s for s in ss if s['stationId']=='stadium-chinatown');need(len(set(e['pointM'][1] for e in stadium['entrances']))==2,'Stadium street levels not distinct');main=next(s for s in ss if s['stationId']=='main-street-science-world');need(all(p['floorHeightM']>5 for p in main['platforms']),'Main not elevated')
 return count

def negative_tests(doc):
 mutations=[('missing station',lambda d:d['stations'].pop()),('false runtime ready',lambda d:d.update(rideReady=True)),('bad winding',lambda d:d['stations'][0]['floorSurfaces'][0].update(indices=[0,2,1,0,3,2])),('short platform',lambda d:d['stations'][0]['platforms'][0].update(lengthM=10)),('wrong profile',lambda d:d['stations'][0]['platforms'][2]['profileRef'].update(profileId='expo-metro-17m')),('door vertical mismatch',lambda d:d['stations'][0]['platforms'][0]['doorAlignmentPoints'][0].update(verticalDifferenceM=.5)),('missing edge',lambda d:d['stations'][0]['connections'].pop(0)),('walk off floor',lambda d:d['stations'][0]['connections'][0].update(startPointM=[999,999,999])),('excessive stair rise',lambda d:d['stations'][0]['connections'][1].update(riseM=2)),('missing glb anchor',lambda d:d['stations'][0]['anchors'][0].update(nodeId='absent-anchor'))]
 out=[]
 for label,mut in mutations:
  v=copy.deepcopy(doc);mut(v)
  try:validate_layout(v,geometry=label=='missing glb anchor')
  except (ValueError,KeyError) as e:out.append({'case':label,'status':'rejected','reason':str(e)})
  else:raise AssertionError('negative fixture accepted: '+label)
 return out
if __name__=='__main__':
 d=json.loads((ROOT/'station-layout.json').read_text());r={'status':'pass','checks':validate_layout(d),'negativeFixtures':negative_tests(d),'runtimeAcceptance':'not_run','sourceClaim':'representative geometry, actual map pixels and GIS inspected; not surveyed'}
 if (ROOT/'manifest.json').exists():r['commonPackageValidation']=C.validate(ROOT)['status']
 (ROOT/'qa/validation.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
