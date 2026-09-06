"""Offline exact topology preparation. Original code; Shapely/numpy build tools only.
Run export-base.mjs first. No writes outside this script's directory.
"""
import json,math,hashlib
from pathlib import Path
import numpy as np
from shapely import constrained_delaunay_triangles
from shapely.geometry import shape,mapping,Polygon,box,LineString,Point
from shapely.ops import transform,unary_union
from shapely.strtree import STRtree
SCRIPT=Path(__file__).resolve().parent;APP=SCRIPT.parents[1];PRE=SCRIPT/'inputs';HERE=APP/'work/beach-build';HERE.mkdir(parents=True,exist_ok=True)
read=lambda p:json.loads(p.read_text())
MX=111320*math.cos(math.radians(49.286))
def xz(x,y,z=None):return ((np.asarray(x)+123.128)*MX,(49.286-np.asarray(y))*111320)
def ll(x,z,y=None):return (np.asarray(x)/MX-123.128,49.286-np.asarray(z)/111320)
def parts(g,kind):
 if g.is_empty:return []
 if g.geom_type==kind:return [g]
 return [q for c in getattr(g,'geoms',[]) for q in parts(c,kind)]
fixture=read(PRE/'beach-fixtures.json');domain=unary_union([shape({'type':'MultiPolygon','coordinates':b['profilePolygons']}) for b in fixture['beaches']]);dry=unary_union([shape({'type':'MultiPolygon','coordinates':b['dryPolygons']}) for b in fixture['beaches']]);wet=domain.difference(dry)
rem=unary_union([transform(xz,shape(f['geometry'])) for f in read(PRE/'shore-reconciliation.geojson')['features'] if f['properties']['role']=='remove-old-foreshore'])
landDoc=read(PRE/'optional-reconciled-land.geojson');land=unary_union([transform(xz,shape(f['geometry'])) for f in landDoc['features']])
terrain=read(APP/'public/data/terrain.json');B=terrain['bounds'];W=terrain['width'];H=terrain['height'];Y=np.asarray(terrain['heights']).reshape(H,W)
def dem(x,z):
 lon,lat=ll(x,z);u=np.clip((lon-B[0])/(B[2]-B[0])*(W-1),0,W-1);v=np.clip((B[3]-lat)/(B[3]-B[1])*(H-1),0,H-1);i=min(W-2,int(u));j=min(H-2,int(v));a=u-i;b=v-j
 return max(1.2,float((Y[j,i]*(1-a)+Y[j,i+1]*a)*(1-b)+(Y[j+1,i]*(1-a)+Y[j+1,i+1]*a)*b))
def planar(p):
 ys=[dem(*q) for q in p];a,b,c=p;inv=1/((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
 def at(x,z):
  u=((x-a[0])*(c[1]-a[1])-(z-a[1])*(c[0]-a[0]))*inv;v=((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]))*inv
  return ys[0]+u*(ys[1]-ys[0])+v*(ys[2]-ys[0])
 return at
# The original 32m tessellation is preserved outside touched source triangles.
# Each affected triangle supplies its original planar height at cut vertices:
# inserted vertices on untouched neighbouring edges cannot create height cracks.
base=read(HERE/'base-terrain.json');replace=[];outside=[];profile=[];covered=[];audit=[]
def emit(g,out,raw):
 for p in parts(g,'Polygon'):
  if p.area<1e-8:continue
  for tri in constrained_delaunay_triangles(p).geoms:
   coords=list(tri.exterior.coords)[:3]
   if ((coords[1][0]-coords[0][0])*(coords[2][1]-coords[0][1])-(coords[1][1]-coords[0][1])*(coords[2][0]-coords[0][0]))>0:coords[1],coords[2]=coords[2],coords[1]
   for x,z in coords:out.extend([float(x),raw(x,z),float(z)])
def gridparts(g,step=4):
 if g.is_empty:return
 x0,z0,x1,z1=g.bounds
 for x in range(math.floor(x0/step)*step,math.ceil(x1/step)*step,step):
  for z in range(math.floor(z0/step)*step,math.ceil(z1/step)*step,step):
   q=g.intersection(box(x,z,x+step,z+step))
   if not q.is_empty:yield q
for rec in base:
 p=Polygon(rec['p'])
 if not p.intersects(rem) and not p.intersects(domain):continue
 replace.append(rec['key']);raw=planar(rec['p']);inside=p.intersection(domain)
 if inside.area>1e-8:
  covered.append(inside)
  # Split both sides of the profile seam with the same grid and original
  # source-triangle edges. Dry/wet split forces MHWS to be a geometry edge.
  for q in gridparts(p):
   emit(q.difference(rem).difference(domain),outside,raw)
   emit(q.intersection(dry),profile,raw)
   emit(q.intersection(wet),profile,raw)
 else:emit(p.difference(rem),outside,raw)
missing=domain.difference(unary_union(covered))
for q in gridparts(missing):
 emit(q.intersection(dry),profile,dem);emit(q.intersection(wet),profile,dem)
# Reconcile the grey/rock ribbon against the same source coast. Existing 2002
# shore is removed only where it touches the actual complete mismatch, then
# replaced by the corresponding reconciled boundary. No rectangle seam.
shore=read(APP/'public/data/shoreline.geojson');features=[];trimZone=rem.buffer(5)
for f in shore['features']:
 g=transform(xz,shape(f['geometry']));g=g.difference(trimZone).difference(domain.buffer(5))
 for line in parts(g,'LineString'):features.append({'type':'Feature','properties':dict(f['properties']),'geometry':mapping(transform(ll,line))})
newShore=land.boundary.intersection(rem.buffer(.001)).difference(domain.buffer(5))
for line in parts(newShore,'LineString'):
 if line.length>.1:features.append({'type':'Feature','properties':{'source':'City/OSM reconciled coastline','class':'coast'},'geometry':mapping(transform(ll,line))})
# Old sand overlays must not leave dry, raised islands in the removed foreshore.
overlays=[]
for f in read(APP/'public/data/context.geojson')['features']:
 if f['properties'].get('class')!='beach':continue
 if f['properties'].get('name') in ['Second Beach','Third Beach']:continue
 g=transform(xz,shape(f['geometry']))
 if g.intersects(rem):g=g.intersection(land)
 for poly in parts(g,'Polygon'):overlays.append({'type':'Feature','properties':f['properties'],'geometry':mapping(transform(ll,poly))})
# Source intersections make the chosen broad boundary inspectable.
old=unary_union([transform(xz,shape(f['geometry'])) for f in read(APP/'public/data/land.geojson')['features']]);joins=old.boundary.intersection(land.boundary).intersection(rem.boundary)
sourceFiles=['public/data/land.geojson','public/data/terrain.json','public/data/shoreline.geojson','public/data/context.geojson']
doc={'version':1,'sourceHashes':{p:hashlib.sha256((APP/p).read_bytes()).hexdigest() for p in sourceFiles},'land':landDoc,'fixtures':fixture,'replaceTriangles':replace,'outsidePositions':outside,'profilePositions':profile,'shoreline':{'type':'FeatureCollection','features':features},'beachOverlays':{'type':'FeatureCollection','features':overlays},'statistics':{'removedM2':rem.area,'domainM2':domain.area,'oldTriangles':len(base),'replacedTriangles':len(replace),'outsideTriangles':len(outside)//9,'profileTriangles':len(profile)//9,'offshoreOutsideOriginalMeshM2':missing.area}}
(HERE/'beach-coast.raw.json').write_text(json.dumps(doc,separators=(',',':')))
# Independent GEOS oracle for all index/collision tests.
checks=[]
for b in fixture['beaches']:
 d=shape({'type':'MultiPolygon','coordinates':b['profilePolygons']});x0,z0,x1,z1=d.bounds
 for x in range(math.floor(x0),math.ceil(x1),6):
  for z in range(math.floor(z0),math.ceil(z1),6):
   pt=Point(x,z)
   if d.contains(pt):checks.append([x,z,land.contains(pt),dry.contains(pt)])
(HERE/'independent-checks.json').write_text(json.dumps(checks,separators=(',',':')))
print(json.dumps(doc['statistics'],indent=2))
