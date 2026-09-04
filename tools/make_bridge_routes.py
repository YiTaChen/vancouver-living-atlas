"""Extract observed bridge road coordinates; no invented street alignment.
Original processing code, MIT. CoV and OSM source geometries retain own licenses.
"""
import json,math,hashlib
from pathlib import Path
from collections import defaultdict
OUT=Path(__file__).parent
CITY=Path('work/geodata/roads.geojson')
OSM=Path('work/geodata/osm-stanley-paths.json')
MX=111320*math.cos(math.radians(49.286));MZ=111320

def dist(a,b):return math.hypot((b[0]-a[0])*MX,(b[1]-a[1])*MZ)
def length(ps):return sum(dist(a,b) for a,b in zip(ps,ps[1:]))
_node_coords=[]
def node(p):
 for q in _node_coords:
  if dist(p,q)<.25:return ','.join(f'{v:.7f}' for v in q)
 _node_coords.append(p)
 return ','.join(f'{v:.7f}' for v in p)
def key(ps):
 a=tuple(tuple(p) for p in ps);b=tuple(reversed(a));return min(a,b)
def bearing(a,b):return round(math.degrees(math.atan2((b[0]-a[0])*MX,(b[1]-a[1])*MZ))%360,3)

data=json.loads(CITY.read_text());features=[];seen=set()
DECK={'burrard':24.,'granville':29.,'cambie':19.,'lions':64.}
TITLE={'burrard':'Burrard Bridge','granville':'Granville Bridge','cambie':'Cambie Bridge','lions':'Lions Gate Bridge'}
SOURCES={
 'cov':{'name':'City of Vancouver Public Streets','url':'https://opendata.vancouver.ca/explore/dataset/public-streets/','license':'Open Government Licence – Vancouver'},
 'osm':{'name':'OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright','license':'ODbL 1.0'},
 'lionsClearance':{'name':'Canadian Society for Civil Engineering: Lions Gate Bridge','url':'https://legacy.csce.ca/en/historic-site/lions-gate-bridge/','fact':'61 m navigation clearance; roadway elevation 64 m is an explicit modelling estimate, not the cited measurement.'},
 'lionsStructure':{'name':'Parks Canada: Lions Gate Bridge National Historic Site','url':'https://www.canada.ca/en/news/archive/2010/05/lions-gate-bridge-national-historic-site.html','fact':'472 m main suspended span; two 187 m side spans; 659 m steel north viaduct.'}
}

def add(kind,role,ps,source,sourceId,width=18,sourceTags=None,name=None):
 if len(ps)<2 or length(ps)<.1:return
 k=(kind,role,key(ps))
 if k in seen:return
 seen.add(k)
 digest=hashlib.sha1(json.dumps(ps,separators=(',',':')).encode()).hexdigest()[:10]
 p={'name':name or TITLE.get(kind,'Stanley Park Causeway'),'kind':kind,'role':role,
    'estimatedDeckM':None if role=='causeway' else DECK[kind],
    'deckHeightStatus':'terrain-following; no absolute bridge deck' if role=='causeway' else 'approximate-model-road-surface-above-water-zero; not surveyed',
    'roadWidthM':width,'widthStatus':'approximate carriageway width; sidewalks/cycle lanes separate',
    'source':source,'sourceId':sourceId,'sourceUrl':SOURCES[source]['url'] if source=='cov' else f'https://www.openstreetmap.org/way/{sourceId}',
    'coordinateStatus':'unaltered source centreline vertices; 7 decimal degree precision',
    'lengthM':round(length(ps),2),'bearingStartToEndDegrees':bearing(ps[0],ps[-1]),
    'startNode':node(ps[0]),'endNode':node(ps[-1])}
 if sourceTags:p['sourceTags']=sourceTags
 features.append({'type':'Feature','id':f'{kind}-{role}-{digest}','properties':p,'geometry':{'type':'LineString','coordinates':ps}})

# Only CoV carriageways. Parallel bikeways in roads.geojson are intentionally
# omitted from bridge decks, so they cannot duplicate or widen a carriageway.
for fi,f in enumerate(data['features']):
 p=f['properties'];n=(p.get('name') or '').upper()
 if p.get('source')!='cov-public-streets' or n not in ['BURRARD BRIDGE','GRANVILLE BRIDGE','CAMBIE BRIDGE']:continue
 kind=n.split()[0].lower()
 ls=f['geometry']['coordinates'] if f['geometry']['type']=='MultiLineString' else [f['geometry']['coordinates']]
 for li,line in enumerate(ls):
  ps=[[round(float(x),7),round(float(y),7)] for x,y,*_ in line]
  sid=f'processed-road-{fi}-part-{li}'
  if kind=='burrard':
   # Original CoV vertex split at the straight bridge / curved approaches.
   # It preserves every original coordinate and shares identical end nodes.
   a=next(i for i,v in enumerate(ps) if v==[-123.1331326,49.2767102])
   b=next(i for i,v in enumerate(ps) if v==[-123.1440817,49.2731632])
   add(kind,'approach',ps[:a+1],'cov',sid,18)
   add(kind,'main',ps[a:b+1],'cov',sid,18)
   add(kind,'approach',ps[b:],'cov',sid,18)
  else:
   expected={'granville':{node([-123.1312117,49.2738307]),node([-123.1376785,49.2695378])},
             'cambie':{node([-123.1147688,49.2731581]),node([-123.1148891,49.2695526])}}[kind]
   role='main' if {node(ps[0]),node(ps[-1])}==expected else 'approach'
   add(kind,role,ps,'cov',sid,p.get('width',18))

# Actual current OSM automobile carriageways through Stanley Park; the City
# roads bundle here contains only the similarly named bicycle route.
osm=json.loads(OSM.read_text())
for e in osm['elements']:
 t=e.get('tags',{});g=e.get('geometry',[])
 if not g or t.get('highway') not in ['trunk','trunk_link']:continue
 name=t.get('name')
 if name not in ['Stanley Park Causeway','Lions Gate Bridge']:continue
 ps=[[p['lon'],p['lat']] for p in g]
 tags={k:v for k,v in t.items() if k in ['highway','lanes','oneway','bridge','layer','surface','lanes:reversible']}
 if name=='Lions Gate Bridge':
  add('lions','main',ps,'osm',e['id'],11.5,tags)
 else:
  lanes=int(t.get('lanes',3));add('lions','causeway',ps,'osm',e['id'],round(lanes*3.3+1.4,1),tags,name=name)

# Build shared junction descriptors. Intermediate approach junctions MUST NOT
# independently taper to terrain: that would create steps between ramps.
inc=defaultdict(list)
for f in features:
 p=f['properties']
 for end in ['start','end']:
  inc[(p['kind'],p[end+'Node'])].append((f['id'],p['role'],end))
nodes=[]
for (kind,k),items in inc.items():
 roles={r for _,r,_ in items}
 main='main' in roles
 ground=len(items)==1 and not main
 rule='deck' if main else 'terrain' if ground or roles=={'causeway'} else 'shared-junction'
 nodes.append({'id':kind+':'+k,'kind':kind,'coord':[float(v) for v in k.split(',')],
               'degree':len(items),'heightRule':rule,'estimatedDeckM':DECK[kind] if main else None,
               'features':[i[0] for i in items]})
for f in features:
 p=f['properties']
 for end in ['start','end']:
  items=inc[(p['kind'],p[end+'Node'])];roles={r for _,r,_ in items}
  p[end+'HeightRule']='deck' if 'main' in roles else 'terrain' if len(items)==1 or roles=={'causeway'} else 'shared-junction'
spines=[]
for f in features:
 if f['properties']['role']!='main':continue
 p=f['properties'];ps=f['geometry']['coordinates']
 spines.append({'kind':p['kind'],'featureId':f['id'],'start':ps[0],'end':ps[-1],'bearingDegrees':p['bearingStartToEndDegrees'],'lengthM':p['lengthM'],'estimatedDeckM':p['estimatedDeckM']})

out={'type':'FeatureCollection','name':'Vancouver measured bridge and causeway routes','schemaVersion':1,
 'sources':SOURCES,'notes':[
 'Coordinates are existing observed CoV/OSM map geometry, not copied finished 3D assets. Original processing code is MIT; source geometries retain listed open-data licenses.',
 'Shared topology nodes cluster endpoints within 0.25 m (one CoV Granville join differs by 2.3 cm). Feature geometry vertices remain unaltered. One disconnected Granville lower approach fragment is clipped at the southern study edge, so no missing connection is invented.',
 'All estimatedDeckM fields are model estimates above a common water-zero. They are not authoritative engineering deck survey values. Lions 64 m derives approximately from cited 61 m clearance plus structure depth.',
 'Main marks the measured principal bridge spine, not necessarily the suspended centre span. Lions main includes the north viaduct. Do not place its two suspension towers symmetrically about the full spine midpoint.',
 'Render causeway against terrain with a small roadway offset. OSM bridge=yes segments along causeway are short local overpasses; preserve their tags when improving grade separation.',
 'Approach termini at a main spine inherit main deck height. Taper at actual terminal ground nodes. Keep identical heights at shared-junction nodes across all connected features; do not reset each segment end to terrain.',
 'To obtain a consistent ramp profile, treat main nodes as fixed deck values and terminal nodes as sampled terrain; solve shared-junction heights by distance-weighted interpolation through the approach graph, then interpolate within each LineString.',
 'Only vehicle carriageways included. Parallel CoV bikeway lines intentionally omitted to avoid duplicate bridge ribbons. Add sidewalks/cycle lanes consistently beside the generated deck.',
 'The Lions north endpoint is outside the downtown terrain extraction in some builds; clip only at the actual study boundary if needed, never rotate or shift its centreline.'
 ],'mainSpines':spines,'structuralReferences':{'lions':{'mainSuspendedSpanM':472,'sideSpanM':187,'northViaductM':659,'source':'lionsStructure'}},'nodes':nodes,'features':features}
(OUT/'bridge-routes.json').write_text(json.dumps(out,separators=(',',':')))
assert {s['kind'] for s in spines}=={'burrard','granville','cambie','lions'}
assert sum(f['properties']['role']=='causeway' for f in features)>=15
assert all(len(f['geometry']['coordinates'])>=2 for f in features)
print(json.dumps({'features':len(features),'nodes':len(nodes),'spines':spines,'bytes':(OUT/'bridge-routes.json').stat().st_size},indent=2))
