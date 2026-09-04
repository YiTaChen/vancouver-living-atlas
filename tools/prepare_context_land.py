"""Build an OSM regional land mask using coastline land-left orientation."""
import argparse
import json,math,collections
from pathlib import Path
from shapely.geometry import LineString,box,Point,mapping,Polygon
from shapely.affinity import affine_transform
from shapely.ops import unary_union,polygonize
from shapely.strtree import STRtree
from shapely import make_valid
ap=argparse.ArgumentParser(description='Create regional land mask from directed OSM coastlines.')
ap.add_argument('--coastline',type=Path,required=True,help='Raw Overpass coastline way geometry JSON')
ap.add_argument('--out-dir',type=Path,required=True)
ap.add_argument('--source-date',help='Override source date; default is raw OSM database timestamp date')
args=ap.parse_args()
P=args.out_dir.resolve();P.mkdir(parents=True,exist_ok=True)
BBOX=[-123.26,49.22,-122.97,49.44];FX,FY=72600.,111320.
def metric(g):return affine_transform(g,[FX,0,0,FY,123.128*FX,-49.286*FY])
def geographic(g):return affine_transform(g,[1/FX,0,0,1/FY,-123.128,49.286])
def rounded(v):
 if isinstance(v,float):return round(v,7)
 if isinstance(v,(list,tuple)):return [rounded(x) for x in v]
 if isinstance(v,dict):return {k:rounded(x) for k,x in v.items()}
 return v
B=metric(box(*BBOX));rawdoc=json.loads(args.coastline.read_text());raw=rawdoc['elements']
lines=[]
for e in raw:
 c=[(a['lon'],a['lat']) for a in e.get('geometry',[])]
 if len(c)<2:continue
 g=metric(LineString(c)).intersection(B)
 if g.is_empty:continue
 for l in list(g.geoms) if hasattr(g,'geoms') else [g]:
  if l.geom_type=='LineString' and l.length>0:lines.append(l)
# Union/noding uses unmodified coordinates, preserving inter-way endpoint joins.
polys=list(polygonize(unary_union(lines+[B.boundary])))
tree=STRtree(polys);left=collections.defaultdict(float);right=collections.defaultdict(float)
for line in lines:
 c=list(line.coords)
 for a,b in zip(c,c[1:]):
  dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
  if length<.1:continue
  mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2;offset=min(1.,length*.1)
  lp=Point(mx-dy/length*offset,my+dx/length*offset);rp=Point(mx+dy/length*offset,my-dx/length*offset)
  for point,score in [(lp,left),(rp,right)]:
   for idx in tree.query(point):
    if polys[idx].contains(point):score[int(idx)]+=length
landids=[i for i in range(len(polys)) if left[i]>right[i]]
# Simplify only the closed polygons to keep all topology and retain exact bbox
# edges. This trims coastal detail smaller than ~15m for the context layer.
land=unary_union([polys[i] for i in landids]);simple=land.simplify(15,preserve_topology=True).intersection(B)
if not simple.is_valid:simple=make_valid(simple)
result={'type':'FeatureCollection','bbox':BBOX,'features':[{'type':'Feature','properties':{'name':'Vancouver regional land','source':'OpenStreetMap contributors','license':'ODbL-1.0','sourceDate':args.source_date or rawdoc.get('osm3s',{}).get('timestamp_osm_base','unknown').split('T')[0],'simplificationMetres':15,'method':'Clipped source coastlines polygonized with study boundary; land selected from OSM land-left direction.'},'geometry':rounded(mapping(geographic(simple)))}]}
(P/'context-land.geojson').write_text(json.dumps(result,separators=(',',':')))
checks={'Downtown':[-123.128,49.286],'Science World shore':[-123.1026,49.2735],'Stanley Park':[-123.148,49.304],'Kitsilano':[-123.15,49.265],'Point Grey':[-123.22,49.265],'North Vancouver':[-123.077,49.319],'West Vancouver inland':[-123.170,49.34],'North Shore mountains':[-123.13,49.40],'English Bay water':[-123.19,49.29],'Burrard Inlet water':[-123.105,49.306],'False Creek water':[-123.118,49.272],'Coal Harbour water':[-123.128,49.2932]}
checkresult={n:simple.covers(metric(Point(p))) for n,p in checks.items()}
report={'bbox':BBOX,'inputWays':len(raw),'clippedLines':len(lines),'polygonizedCells':len(polys),'landCells':len(landids),'coastlineLengthMetres':sum(l.length for l in lines),'landAreaKm2':simple.area/1e6,'geometries':len(simple.geoms) if hasattr(simple,'geoms') else 1,'pointChecks':checkresult,'classification': [{'cell':i,'areaM2':round(p.area,1),'leftVoteM':round(left[i],1),'rightVoteM':round(right[i],1),'land':i in landids} for i,p in enumerate(polys)]}
(P/'context-land-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
# Local diagnostic image, including named samples and core study boundary.
from PIL import Image,ImageDraw
im=Image.new('RGB',(1250,1400),'#6ba6c0');draw=ImageDraw.Draw(im)
def xy(c):return ((c[0]-BBOX[0])/(BBOX[2]-BBOX[0])*1250,(BBOX[3]-c[1])/(BBOX[3]-BBOX[1])*1400)
geo=geographic(simple)
for p in list(geo.geoms) if hasattr(geo,'geoms') else [geo]:
 draw.polygon([xy(q) for q in p.exterior.coords],fill='#a0b484')
 for ring in p.interiors:draw.polygon([xy(q) for q in ring.coords],fill='#6ba6c0')
core=[(-123.165,49.267),(-123.095,49.267),(-123.095,49.315),(-123.165,49.315),(-123.165,49.267)]
draw.line([xy(c) for c in core],fill='#fff7cc',width=3)
for name,p in checks.items():
 x,y=xy(p);draw.ellipse((x-3,y-3,x+3,y+3),fill='#a72422');draw.text((x+5,y),name,fill='#203440')
im.save(P/'context-land-qa.png')
