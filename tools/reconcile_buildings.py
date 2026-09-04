"""Reconcile public City roof parts and OSM explicit vertical solids.
Uses explicit outline/part topology, vertical interval unions and geometric
subtraction. No arbitrary tallest-building selection or random footprints.
"""
import json, math, collections, hashlib
from pathlib import Path
from shapely.geometry import shape,mapping,Polygon,MultiPolygon
from shapely.affinity import affine_transform
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely import make_valid,set_precision
import numpy as np
from scipy.spatial import cKDTree
P=Path(__file__).parent
FX,FY=72600.,111320.
def metric(g):return affine_transform(g,[FX,0,0,FY,123.128*FX,-49.286*FY])
def geographic(g):return affine_transform(g,[1/FX,0,0,1/FY,-123.128,49.286])
def read(n):return json.loads((P/n).read_text())['features']
def clean(g):
 if not g.is_valid:g=make_valid(g)
 if g.is_empty:return Polygon()
 if g.geom_type=='GeometryCollection':g=unary_union([a for a in g.geoms if a.geom_type in ['Polygon','MultiPolygon']])
 return set_precision(g,.005)
def polygons(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g] if g.area>=.1 else []
 return [p for p in g.geoms if p.geom_type=='Polygon' and p.area>=.1]
def rr(v):
 if isinstance(v,float):return round(v,8)
 if isinstance(v,(list,tuple)):return [rr(x) for x in v]
 if isinstance(v,dict):return {k:rr(x) for k,x in v.items()}
 return v
def feature(g,p):return {'type':'Feature','geometry':rr(mapping(geographic(g))),'properties':p}
def write(n,fs):
 (P/n).write_text(json.dumps({'type':'FeatureCollection','bbox':[-123.165,49.267,-123.095,49.315],'features':fs},separators=(',',':')))
city=read('buildings.geojson');cgs=[clean(metric(shape(f['geometry']))) for f in city]
allf=read('buildings-osm-all.geojson');og={f['properties']['id']:clean(metric(shape(f['geometry']))) for f in allf};byid={f['properties']['id']:f for f in allf}
# Independently authored landmarks replace these source footprint envelopes.
exdefs={'Science World':['osm-37084312'],'BC Place':['osm-24705904'],'Canada Place':['osm-223635729'],'Harbour Centre':['osm-1371268997','osm-143682595'],'Vancouver House':['osm-742009401','osm-1092241825']}
ex=[]
for name,ids in exdefs.items():
 g=clean(unary_union([og[i] for i in ids]).buffer(2,join_style='mitre'))
 ex.append(feature(g,{'name':name,'sourceIds':ids,'bufferM':2,'areaM2':round(g.area,2),'purpose':'Reserved for original procedural landmark model','source':'OpenStreetMap'}))
write('landmarks-excluded.geojson',ex)
exunion=clean(unary_union([metric(shape(f['geometry'])) for f in ex]))
parts=[f for f in allf if f['properties']['part']];pg=[og[f['properties']['id']] for f in parts];pt=STRtree(pg)
full=[f for f in allf if not f['properties']['part']];fg=[og[f['properties']['id']] for f in full];ft=STRtree(fg)
explicit=[];removedparents=[];invalid=[];excludedosm=[];parentof={}
for f in allf:
 p=f['properties'];id=p['id'];g=og[id];height=p['height']
 if height is None:continue
 if height<=p['minHeight'] or height<=0:
  invalid.append({'id':id,'height':height,'minHeight':p['minHeight']});continue
 if g.is_empty or g.area<.1:continue
 if exunion.covers(g.centroid) or g.intersection(exunion).area/g.area>.5:
  excludedosm.append(id);continue
 g=clean(g.difference(exunion))
 if g.is_empty:continue
 # Assign parent from all footprints; explicit and non-explicit parent names
 # and shared ground elevation are kept, even when a parent envelope is dropped.
 if p['part']:
  options=[int(i) for i in ft.query(g) if g.intersection(fg[i]).area/g.area>.7]
  if options:parentof[id]=full[min(options,key=lambda i:fg[i].area)]['properties']['id']
 else:parentof[id]=id
 if not p['part']:
  indices=[int(i) for i in pt.query(g) if pg[i].area>.1 and pg[i].intersection(g).area/pg[i].area>.7]
  covered=unary_union([pg[i] for i in indices]).intersection(g).area/g.area if indices else 0
  if covered>=.70:
   removedparents.append({'id':id,'name':p['name'],'height':height,'partsCoverage':round(covered,5),'partIds':[parts[i]['properties']['id'] for i in indices]});continue
 explicit.append({'g':g,'p':p})
# Build components where declared parent is shared or explicit solids overlap.
# Ground is shared within each structure so rotating, stacked tower parts align.
n=len(explicit);union=list(range(n))
def root(i):
 while union[i]!=i:union[i]=union[union[i]];i=union[i]
 return i
def merge(i,j):
 a,b=root(i),root(j)
 if a!=b:union[b]=a
parents={}
for i,e in enumerate(explicit):
 par=parentof.get(e['p']['id'])
 if par:
  if par in parents:merge(i,parents[par])
  else:parents[par]=i
geoms=[e['g'] for e in explicit];tree=STRtree(geoms)
for i,g in enumerate(geoms):
 for j in tree.query(g):
  if j>i and g.intersection(geoms[j]).area>.05:merge(i,int(j))
components=collections.defaultdict(list)
for i in range(n):components[root(i)].append(i)
# City LiDAR base elevations provide local measured terrain constraints.
ctree=STRtree(cgs);centers=np.array([[g.centroid.x,g.centroid.y] for g in cgs]);kt=cKDTree(centers)
def localbase(g):
 ix=[int(i) for i in ctree.query(g.buffer(8)) if cgs[i].intersects(g.buffer(8))]
 if len(ix)<3:
  ds,ii=kt.query([g.centroid.x,g.centroid.y],k=6);ix=list(map(int,ii))
 vals=[]
 for i in ix:
  distance=g.distance(cgs[i]);overlap=g.intersection(cgs[i]).area
  weight=(1+min(overlap,500))/(1+distance)**2
  vals.append((float(city[i]['properties']['base']),weight))
 vals.sort();half=sum(w for _,w in vals)/2;acc=0
 for v,w in vals:
  acc+=w
  if acc>=half:return round(v,2)
 return round(vals[0][0],2)
alias={'osm-91998136':'Living Shangri-La','osm-362187535':'Paradox Vancouver','osm-91998089':'One Wall Centre'}
osmout=[];structures=[]
for ci,indices in enumerate(components.values()):
 es=[explicit[i] for i in indices];envelope=clean(unary_union([e['g'] for e in es]));base=localbase(envelope)
 parentids=sorted(set(parentof.get(e['p']['id'],e['p']['id']) for e in es))
 names=[alias.get(i) or byid[i]['properties'].get('name') for i in parentids if i in byid]
 names=[v for v in names if v];name=' / '.join(dict.fromkeys(names)) or next((e['p'].get('name') for e in es if e['p'].get('name')),None)
 bounds=sorted(set([e['p']['minHeight'] for e in es]+[e['p']['height'] for e in es]))
 sid='osm-structure-'+str(ci)
 slabs=[]
 for lo,hi in zip(bounds,bounds[1:]):
  if hi-lo<.01:continue
  active=[e for e in es if e['p']['minHeight']<hi and e['p']['height']>lo]
  if not active:continue
  geom=clean(unary_union([e['g'] for e in active]))
  if geom.is_empty:continue
  ids=sorted(e['p']['id'] for e in active)
  # Same footprint in consecutive elevation intervals is one continuous solid.
  if slabs and slabs[-1]['hi']==lo and geom.equals(slabs[-1]['g']):
   slabs[-1]['hi']=hi;slabs[-1]['ids']=sorted(set(slabs[-1]['ids']+ids))
  else:slabs.append({'g':geom,'lo':lo,'hi':hi,'ids':ids})
 for j,s in enumerate(slabs):
  top_sources=[e for e in es if e['p']['height']==s['hi']]
  roof=next((e['p'].get('roof') for e in top_sources if e['p'].get('roof')),None)
  props={'id':sid+'-'+str(j),'name':name,'height':round(s['hi'],3),'minHeight':round(s['lo'],3),'base':base,'roof':roof,'source':'OpenStreetMap','sourceIds':s['ids'],'structureId':sid,'baseSource':'City of Vancouver 2009 nearby measured base elevation','reconciliation':'union of declared vertical parts'}
  osmout.append({'g':s['g'],'p':props})
 structures.append({'id':sid,'name':name,'sourceIds':[e['p']['id'] for e in es],'parentIds':parentids,'base':base,'minHeight':min(bounds),'height':max(bounds),'slabs':len(slabs),'g':envelope})
# Grounded modern structures replace old geometry. Elevated-only components
# (roof caps, overhangs) are handled separately through 3D interval subtraction.
grounded=clean(unary_union([s['g'] for s in structures if s['minHeight']<=.01]))
replace=clean(unary_union([grounded,exunion]))
replaceparts=polygons(replace);rtree=STRtree(replaceparts)
print('OSM vertical union prepared',len(osmout),'slabs in',len(structures),'structures',flush=True)
retained=[];cityremoved=[];cityclipped=[]
for i,(f,g) in enumerate(zip(city,cgs)):
 p=dict(f['properties']);p['minHeight']=0;p.setdefault('name',None)
 localparts=[replaceparts[int(k)] for k in rtree.query(g)]
 localreplace=unary_union(localparts) if localparts else Polygon()
 overlap=g.intersection(localreplace).area/g.area
 if localreplace.covers(g.centroid) or overlap>=.50:
  cityremoved.append(p['id']);continue
 remainder=clean(g.difference(localreplace))
 if remainder.area<3:cityremoved.append(p['id']);continue
 if overlap>.00001:cityclipped.append(p['id'])
 retained.append({'g':remainder,'p':p})
# Clip residual City vertical intervals against explicit OSM volumes. This
# preserves the support below elevated-only parts while eliminating duplicate
# occupied volume; no fictitious upper story is inferred.
ogs=[e['g'] for e in osmout];otree=STRtree(ogs)
citysolids=[];verticalcuts=0
for e in retained:
 g,p=e['g'],e['p'];lo=p['base'];hi=lo+p['height']
 conflict=[]
 for j in otree.query(g):
  op=osmout[j]['p'];ol=op['base']+op['minHeight'];oh=op['base']+op['height']
  if max(lo,ol)<min(hi,oh)-.01 and g.intersection(ogs[j]).area>.001:conflict.append((int(j),ol,oh))
 if not conflict:citysolids.append(e);continue
 verticalcuts+=1
 bounds=sorted(set([lo,hi]+[max(lo,ol) for _,ol,_ in conflict]+[min(hi,oh) for _,_,oh in conflict]))
 for k,(a,b) in enumerate(zip(bounds,bounds[1:])):
  overlapgeoms=[ogs[j] for j,ol,oh in conflict if ol<b and oh>a]
  remain=clean(g.difference(unary_union(overlapgeoms))) if overlapgeoms else g
  if remain.area<3 or b-a<.01:continue
  cp=dict(p);cp['id']=str(p['id'])+'-cut'+str(k);cp['minHeight']=round(a-p['base'],3);cp['height']=round(b-p['base'],3);cp['reconciliation']='City solid clipped against elevated OSM part'
  citysolids.append({'g':remain,'p':cp})
print('City reconciliation prepared',len(citysolids),'solids; validating serialized file',flush=True)
combined=citysolids+osmout
write('buildings-combined.geojson',[feature(e['g'],e['p']) for e in combined])
write('buildings-modern-reconciled.geojson',[feature(e['g'],e['p']) for e in osmout])
write('buildings-structure-envelopes.geojson',[feature(s['g'],{k:v for k,v in s.items() if k!='g'}) for s in structures])
# Quantitative geometry and volumetric QA. Source outputs are checked after
# coordinate serialization, not only against intermediate geometries.
final=read('buildings-combined.geojson');gg=[metric(shape(f['geometry'])) for f in final];tt=STRtree(gg)
invalidout=[];overlaps=[];landmark_overlaps=[];total_intersection_area=0;total_volume=0
for i,g in enumerate(gg):
 p=final[i]['properties'];lo=p['base']+p.get('minHeight',0);hi=p['base']+p['height']
 if not g.is_valid or g.area<=0 or hi<=lo:invalidout.append(p['id'])
 a=g.intersection(exunion).area
 if a>.1:landmark_overlaps.append({'id':p['id'],'area':a})
 for j in tt.query(g):
  if j<=i:continue
  q=final[j]['properties'];dz=min(hi,q['base']+q['height'])-max(lo,q['base']+q.get('minHeight',0))
  if dz<=.001:continue
  a=g.intersection(gg[j]).area
  if a>.1:
   overlaps.append({'a':p['id'],'b':q['id'],'area':round(a,4),'volume':round(a*dz,4)});total_intersection_area+=a;total_volume+=a*dz
report={'inputCityParts':len(city),'inputOsmExplicitParts':sum(f['properties']['height'] is not None for f in allf),'discardedRedundantOsmParents':len(removedparents),'invalidOsmIntervals':invalid,'osmPartsExcludedForLandmarks':len(excludedosm),'validOsmSolidsBeforeUnion':len(explicit),'osmStructures':len(structures),'reconciledOsmSlabs':len(osmout),'cityPartsRemoved':len(cityremoved),'cityPartsFootprintClipped':len(cityclipped),'cityPartsWithVerticalCuts':verticalcuts,'outputCitySolids':len(citysolids),'outputCombined':len(combined),'invalidOutputCount':len(invalidout),'volumetricOverlapPairsAbovePoint1M2':len(overlaps),'volumetricOverlapAreaM2':round(total_intersection_area,4),'volumetricOverlapM3':round(total_volume,4),'landmarkOverlapPairsAbovePoint1M2':len(landmark_overlaps),'largestVolumetricOverlaps':sorted(overlaps,key=lambda a:a['volume'],reverse=True)[:30],'landmarkOverlaps':landmark_overlaps[:20],'removedParents':removedparents,'excludedLandmarks':[f['properties'] for f in ex],'skylineStructures':[{k:v for k,v in s.items() if k!='g'}|{'centroid':list(geographic(s['g']).centroid.coords)[0]} for s in structures if s['height']>=130]}
(P/'reconciliation-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['removedParents','excludedLandmarks','skylineStructures','largestVolumetricOverlaps','landmarkOverlaps']},indent=2))
print('largest overlaps',report['largestVolumetricOverlaps'][:3]);print('landmark overlaps',report['landmarkOverlaps'][:3])
