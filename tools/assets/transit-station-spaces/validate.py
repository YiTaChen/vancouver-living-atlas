"""CPU transformed-GLB, local frame, dependency, clearance and research-layout checks."""
import json,math,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from contract import ROOT,C,dump

def need(v,s):
 if not v:raise AssertionError(s)
def near(a,b,e=1e-5):return len(a)==len(b) and all(abs(x-y)<=e for x,y in zip(a,b))
def boxpoly(p):return ([min(a[k] for a in p) for k in range(3)],[max(a[k] for a in p) for k in range(3)])
def contains(poly,p):
 lo,hi=boxpoly(poly);return all(lo[k]-1e-6<=p[k]<=hi[k]+1e-6 for k in (0,1,2))
def overlapping(a,b):
 al,ah=boxpoly(a);bl,bh=boxpoly(b);return all(min(ah[k],bh[k])-max(al[k],bl[k])>1e-6 for k in (0,2))
def stored_glb_bounds(path, pose):
 doc,binary=C.read_glb(path);points=[];outer=C.transform({'translation':pose['translationM'],'rotation':pose['rotationQuaternionXYZW'],'scale':pose['scale']})
 def walk(i,parent):
  node=doc['nodes'][i];matrix=C.matmul(parent,C.transform(node))
  if 'mesh' in node:
   for primitive in doc['meshes'][node['mesh']]['primitives']:
    points.extend(C.point(matrix,p) for p in C.accessor(doc,binary,primitive['attributes']['POSITION']))
  for child in node.get('children',[]):walk(child,matrix)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,outer)
 need(points,'stored deck has actual geometry')
 return {'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]}
def stored_contact_checks(layout, levels=(0,1)):
 checks=[];inputs={}
 for stop in layout['stops']:
  floor=stop['floorHeightM']
  for alignment in stop['doorAlignmentPoints']:
   deck=alignment['thresholdDeck']
   for level in levels:
    name='exports/'+deck['assetId']+'.lod'+str(level)+'.glb';path=ROOT/name;inputs[name]=C.digest(path);b=stored_glb_bounds(path,deck['retractedTransform']);error=b['min'][1]-floor
    need(abs(error)<1e-6,'stored deck must contact research floor: '+deck['instanceId'])
    need(all(contains(stop['floorPolygonM'],[x,floor,z]) for x in [b['min'][0],b['max'][0]] for z in [b['min'][2],b['max'][2]]),'stored deck footprint supported')
    checks.append({'stopId':stop['stopId'],'instanceId':deck['instanceId'],'lod':level,'actualTransformedBoundsM':b,'floorHeightM':floor,'bottomHeightM':b['min'][1],'contactErrorM':error,'support':'research floor, no hidden holder','status':'pass'})
 return {'status':'pass','method':'actual GLB POSITION accessors with scene node and stored pose transforms applied once; both LODs','layoutSha256':C.digest(ROOT/'station-layout.json'),'inputGlbHashes':inputs,'checks':checks,'runtimeActivation':False}

def check_layout(layout):
 stored_contact_checks(layout,levels=(0,))
 results=[];bus=json.loads((ROOT.parent/'boardable-bus/manifest.json').read_text());metro=json.loads((ROOT.parent/'boardable-metro/manifest.json').read_text());shelter=json.loads((ROOT.parent/'street-furniture-expansion/manifest.json').read_text());b=bus['vehicles'][0];s=next(a for a in shelter['assets'] if a['id']=='transit-shelter')
 for stop in layout['stops']:
  f=stop['localFrame'];q=f['rotationQuaternionXYZW'];need(abs(sum(v*v for v in q)-1)<1e-7,'frame quaternion normalized');need(f['scale']==[1,1,1],'unit frame scale');need(stop['geographicPlacement']['status']=='unresolved' and stop['geographicPlacement']['worldTransform'] is None,'no fabricated world placement');need(stop['sourceStopId'] is None and stop['provenance']['realServiceOrRoute'] is False,'no service identity invented');need(stop['boardingGameplayEnabled'] is False,'offline layout not gameplay enabled')
  need(stop['floorTriangulation']['indices']==[0,2,1,0,3,2] and stop['floorTriangulation']['normal']==[0,1,0],'explicit upward walk-surface winding')
  floor=stop['floorHeightM'];need(all(abs(p[1]-floor)<1e-8 for p in stop['floorPolygonM']),'floor polygon Y');need(stop['pedestrianCorridor']['clearWidthM']>=1.8,'through corridor 1.8m')
  for w in stop['waitingPolygons']:
   need(all(contains(stop['floorPolygonM'],p) for p in w['polygonM']),'waiting within support');need(not overlapping(w['polygonM'],stop['pedestrianCorridor']['polygonM']),'waiting excludes through corridor')
  for entry in stop['entryConnections']:
   need(entry['targetWalkSurfaceId'] is None and entry['status']=='unresolved-world-connection','entry not invented');need(contains(stop['floorPolygonM'],entry['localPointM']),'entry contacts local floor');need(entry.get('undergroundConnection',False) is False,'no underground connection')
  for d in stop['doorAlignmentPoints']:
   deck=d['thresholdDeck'];need(not deck['enabled'],'deck runtime gated');need(contains(stop['floorPolygonM'],deck['stationBearingPointM']),'deck station endpoint supported');need(deck['vehicleBearingPointM'][0]>d['doorSillPointM'][0]+.1,'deck extends onto actual interior support');need(deck['clearWidthM']<=d['openingWidthM']-.1,'deck narrower than full open doorway');need(deck['maximumGrade']<=.0751,'deck shallow taper');need(deck['maximumRiseM']==.015,'deck 15mm rise');need(len(deck['walkableSurfacePolygonsM'])==3,'deck three continuous top panels');need(deck['deployedTransform']['scale']==[1,1,1] and deck['retractedTransform']['scale']==[1,1,1],'deck unit scale poses');storage=next(e for e in stop['exclusions'] if e['id']==deck['instanceId']+'-storage');need(not overlapping(storage['polygonM'],stop['pedestrianCorridor']['polygonM']),'stored deck outside main corridor')
  if stop['kind']=='bus-stop':
   need(abs(floor-b['floorSegments'][0]['heightM'])<1e-8,'bus floor metadata current')
   for d in stop['doorAlignmentPoints']:
    a=next(a for a in b['anchors'] if a['anchorId']==d['vehicleAnchorId']);need(near(a['pointM'],d['stationPointM']),'bus anchor current');need(contains(stop['floorPolygonM'],d['stationPointM']),'bus boarding point supported');need(abs(d['doorSillPointM'][0]-d['platformEdgePointM'][0]-.25)<1e-8,'bus explicit gap');need(not d['thresholdDeck']['enabled'],'bridge research not silently activated')
   inst=next(i for i in stop['instances'] if i['assetId']=='transit-shelter');need(inst['packageId']=='street-furniture-expansion' and inst['referenceOnly'],'shelter dependency not duplicated');need(s['boundsM']['size'][0]>4,'full shelter dimensions retained');need(not overlapping(next(x['polygonM'] for x in stop['exclusions'] if x['id']=='shelter-footprint'),stop['pedestrianCorridor']['polygonM']),'shelter outside through corridor')
   # Door sweep's most outward X is -1.417m, edge is -1.5m: 83mm static separation.
   sep=min(d['sweptBoundsM']['min'][0]-(-1.5) for d in b['doors']);need(sep>=.08,'bus open-door sweep avoids research island');results.append({'stopId':stop['stopId'],'status':'pass','doorAlignmentCount':len(stop['doorAlignmentPoints']),'doorSweepEdgeClearanceM':sep,'floorHeightM':floor,'thresholdGapM':.25})
  else:
   c=metro['composition'];need(3<=stop['platformWidthM']<=5,'platform width');need(stop['platformLengthM']>=c['actualLengthM']+2*stop['stoppingToleranceEachEndM'],'whole consist plus stopping tolerance');need(abs(stop['actualMarginEachEndM']-(stop['platformLengthM']-c['actualLengthM'])/2)<1e-8,'stopping margin computed');need(len(stop['doorAlignmentPoints'])==12,'all four cars, three right openings')
   for d in stop['doorAlignmentPoints']:
    car=next(x for x in c['cars'] if x['carId']==d['carId']);v=next(x for x in metro['vehicles'] if x['vehicleId']==car['vehicleId']);a=next(a for a in v['anchors'] if a['nodeId']==d['vehicleAnchorId']);p=[a['positionM'][k]+car['translationM'][k] for k in range(3)];need(near(p,d['stationPointM']),'metro composed anchor current');need(abs(floor-v['floorHeightM'])<1e-8,'metro floor matched');need(contains(stop['floorPolygonM'],p),'metro boarding point supported');need(all(contains(stop['floorPolygonM'],p) for p in d['approachPolygonM']),'door approach supported');need(abs(d['doorSillPointM'][0]-d['platformEdgePointM'][0]-.22)<1e-8,'metro explicit gap')
   tiles=[i for i in stop['instances'] if i['assetId']=='platform-edge-2m'];need(len(tiles)==37,'37 unscaled platform tiles');need([t['translationM'][2] for t in tiles]==list(range(-36,37,2)),'continuous 74m tile seams');need(all(t['translationM'][0]==-3.5 and t['translationM'][1]==0 and t['scale']==[1,1,1] for t in tiles),'rail datum tile placement');need(not overlapping(next(e['polygonM'] for e in stop['exclusions'] if e['id']=='guidance-sign-footprint'),stop['pedestrianCorridor']['polygonM']),'guidance sign outside corridor');sep=min(d['sweptBoundsM']['min'][0]+1.5 for v in metro['vehicles'] for d in v['doors'] if d['side']=='right');need(sep>=.04,'metro open-door sweep clear of platform');results.append({'stopId':stop['stopId'],'status':'pass','doorAlignmentCount':12,'wholeConsistLengthM':c['actualLengthM'],'platformLengthM':74,'endMarginM':1.25,'doorSweepEdgeClearanceM':sep,'floorHeightM':floor,'thresholdGapM':.22})
 return results

def validate():
 m=json.loads((ROOT/'manifest.json').read_text());common=C.validate(ROOT);layout=json.loads((ROOT/'station-layout.json').read_text());checks=check_layout(layout)
 for a in m['assets']:
  for l in a['lods']:
   need(near(l['boundsM']['size'],a['expectedDimensionsM'],a['dimensionToleranceM']),a['id']+' dimensions');need(l['triangles']<=(1000 if l['level']==0 else 200),'B-PROP geometry budget');need(l['bytes']<=(192 if l['level']==0 else 48)*1024,'B-PROP bytes');need(l['sourceBytes']<20*1024**2,'source compact');need(l['embeddedImageBytes']==0,'no duplicated maps');need(all(abs(x-y)<.02 for x,y in zip(l['boundsM']['size'],a['boundsM']['size'])),'LOD envelopes');doc,_=C.read_glb(ROOT/l['file']);need(l['primitives']==len({p.get('material') for mesh in doc['meshes'] for p in mesh['primitives']}),'static primitive count equals actual material roles');need(all(not doc.get(k) for k in ['animations','skins']),'static module batching only');need(len(doc['scenes'][doc.get('scene',0)]['nodes'])==1 and doc['nodes'][doc['scenes'][doc.get('scene',0)]['nodes'][0]]['name']=='station-module-root','one movable module actor root');need(not any(n.get('name','').startswith('qa-') for n in doc['nodes']),'QA geometry excluded')
 # Negative controls prove layout validator is not an unconditional success marker.
 import copy
 mutations=[('short-platform',lambda v:v['stops'][2].update(platformLengthM=72)),('wrong-floor',lambda v:v['stops'][2].update(floorHeightM=.91)),('shift-door',lambda v:v['stops'][2]['doorAlignmentPoints'][0]['stationPointM'].__setitem__(2,99)),('false-world-placement',lambda v:v['stops'][0]['geographicPlacement'].update(status='placed')),('undersize-corridor',lambda v:v['stops'][0]['pedestrianCorridor'].update(clearWidthM=1.2)),('nonunit-frame',lambda v:v['stops'][1]['localFrame'].update(scale=[2,2,2])),('old-hovering-bus-storage',lambda v:v['stops'][0]['doorAlignmentPoints'][0]['thresholdDeck']['retractedTransform']['translationM'].__setitem__(1,.36+.55)),('old-hovering-metro-storage',lambda v:v['stops'][2]['doorAlignmentPoints'][0]['thresholdDeck']['retractedTransform']['translationM'].__setitem__(1,.95+.55)),('sunken-stored-deck',lambda v:v['stops'][0]['doorAlignmentPoints'][0]['thresholdDeck']['retractedTransform']['translationM'].__setitem__(1,.84))];negative=[]
 for name,mutate in mutations:
  v=copy.deepcopy(layout);mutate(v)
  try:check_layout(v)
  except AssertionError as e:negative.append({'case':name,'status':'rejected-as-expected','reason':str(e)})
  else:raise AssertionError('negative control accepted: '+name)
 stored=stored_contact_checks(layout);dump('qa/stored-contact-validation.json',stored)
 report={'status':'pass','scope':'offline CPU packaging, geometry dimensions/budgets, source-derived local frame/alignment/clearance and negative controls','commonContract':'pass','assetLodCount':len(common['results']),'deployedThresholdDecks':16,'thresholdTopRiseM':.015,'thresholdTaperGrade':.075,'storedContactChecks':len(stored['checks']),'maximumStoredContactErrorM':max(abs(r['contactErrorM']) for r in stored['checks']),'layoutChecks':checks,'negativeControls':negative,'runtimeChecks':'not_run','remaining':'real stop IDs, geographic/walk/rail attachment, threshold deployment motion/state gating and WebGL acceptance pending'};dump('qa/validation.json',report);dump('qa/common-validation.json',common);return report
if __name__=='__main__':print(json.dumps(validate(),indent=2))
