"""Drape only affected legacy path triangles onto the finalized beach mesh.
Keep source IDs/XY. Preserve old triangle height at profile boundaries, blend
out the legacy 1.5m lift over 8m, and clip wet-side geometry to the shared land.
"""
exec(open(__file__.replace('prepare-paths.py','prepare.py')).read().split('# The original 32m tessellation')[0])
doc=read(HERE/'beach-coast.json');V=doc['profilePositions'];tris=[Polygon([(V[i+j],V[i+j+2]) for j in [0,3,6]]) for i in range(0,len(V),9)];tree=STRtree(tris)
def plane3(p):
 a,b,c=p;inv=1/((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))
 def at(x,z):
  u=((x-a[0])*(c[2]-a[2])-(z-a[2])*(c[0]-a[0]))*inv;v=((b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]))*inv
  return a[1]+u*(b[1]-a[1])+v*(c[1]-a[1])
 return at
planes=[plane3([V[i+j:i+j+3] for j in [0,3,6]]) for i in range(0,len(V),9)]
out=[];ids=[];insideCount=0
def emit(g,raw):
 for p in parts(g,'Polygon'):
  if p.area<1e-8:continue
  for t in constrained_delaunay_triangles(p).geoms:
   ps=list(t.exterior.coords)[:3]
   if (ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0])>0:ps[1],ps[2]=ps[2],ps[1]
   for x,z in ps:out.extend([float(x),raw(x,z),float(z)])
for f in read(APP/'public/data/paths.geojson')['features']:
 g=transform(xz,shape(f['geometry']));width=f['properties'].get('width') or 2.5
 if not g.buffer(width/2).intersects(domain):continue
 ids.append(int(f['properties'].get('sourceId',f['properties']['id'])))
 for l in parts(g,'LineString'):
  ps=list(l.coords)
  for a,b in zip(ps,ps[1:]):
   n=math.hypot(b[0]-a[0],b[1]-a[1]);steps=max(1,math.ceil(n/25));nx=(b[1]-a[1])/n*width/2;nz=-(b[0]-a[0])/n*width/2
   for j in range(steps):
    u=j/steps;v=(j+1)/steps;x=a[0]+(b[0]-a[0])*u;z=a[1]+(b[1]-a[1])*u;xx=a[0]+(b[0]-a[0])*v;zz=a[1]+(b[1]-a[1])*v
    corners=[(x-nx,z-nz),(x+nx,z+nz),(xx+nx,zz+nz),(xx-nx,zz-nz)]
    for js in [[0,1,2],[0,2,3]]:
     p=[corners[k] for k in js];t=Polygon(p);old=plane3([[q[0],dem(*q)+1.5,q[1]] for q in p]);emit(t.difference(domain),old)
     for k in tree.query(t):
      cut=t.intersection(tris[k]).intersection(dry)
      if cut.is_empty:continue
      ground=planes[k]
      def height(x,z):
       w=min(1,domain.boundary.distance(Point(x,z))/8);w=w*w*(3-2*w)
       return max(ground(x,z)+.025,old(x,z)*(1-w)+(ground(x,z)+.025)*w)
      emit(cut,height);insideCount+=1
out=np.asarray(out,dtype=np.float32).astype(float).reshape(-1,3,3)
areas=(out[:,1,0]-out[:,0,0])*(out[:,2,2]-out[:,0,2])-(out[:,1,2]-out[:,0,2])*(out[:,2,0]-out[:,0,0])
out=out[np.abs(areas)>1e-9];areas=areas[np.abs(areas)>1e-9];out[areas>0]=out[areas>0][:,[0,2,1],:]
out=out.ravel().tolist();doc['pathPositions']=out;doc['replacementPathIds']=ids
for f in ['public/data/paths.geojson']:doc['sourceHashes'][f]=hashlib.sha256((APP/f).read_bytes()).hexdigest()
doc['statistics']['replacementPathIds']=len(ids);doc['statistics']['replacementPathTriangles']=len(out)//9
(HERE/'beach-coast.json').write_text(json.dumps(doc,separators=(',',':')))
print(json.dumps({'pathIds':len(ids),'triangles':len(out)//9,'profileCuts':insideCount}))
