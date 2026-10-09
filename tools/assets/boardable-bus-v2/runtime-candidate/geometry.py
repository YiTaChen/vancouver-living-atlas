"""Read actual delivered GLB accessors with hash-bound offline component sidecars."""
import importlib.util,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('common_runtime',HERE.parent.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
sp=importlib.util.spec_from_file_location('bus_runtime_geometry',HERE.parent.parent/'boardable-bus/validate.py');G=importlib.util.module_from_spec(sp);sp.loader.exec_module(G)
def need(ok,msg):
 if not ok:raise AssertionError(msg)
def load(path,sidecar=None):
 path=Path(path);doc,raw=C.read_glb(path);sidecar=sidecar or json.loads(path.with_suffix('.components.json').read_text());need(sidecar['glbSha256']==C.digest(path),'component sidecar GLB hash mismatch');out={};render={};visited=set();names=set()
 def walk(i,parent):
  need(i not in visited,'node cycle or repeated hierarchy reference');visited.add(i);n=doc['nodes'][i];mat=C.matmul(parent,C.transform(n));name=n['name'];need(name not in names,'duplicate node name');names.add(name);pts=[];idx=[]
  if 'mesh' in n:
   need(all(abs(a-b)<1e-7 for a,b in zip(mat,C.IDENTITY)),'baked batch or ancestor transform changed');ps=doc['meshes'][n['mesh']]['primitives'];need(len(ps)==1,'single batch primitive');p=ps[0];need(p.get('mode',4)==4,'triangles only');pts=[C.point(mat,v) for v in C.accessor(doc,raw,p['attributes']['POSITION'])];idx=[r[0] for r in C.accessor(doc,raw,p['indices'])];render[name]=(pts,idx)
  out[name]={'node':n,'matrix':mat,'point':C.point(mat,[0,0,0]),'points':[],'triangles':[],'dynamic':None}
  for child in n.get('children',[]):walk(child,mat)
 for root in doc['scenes'][doc.get('scene',0)]['nodes']:walk(root,C.IDENTITY)
 need(visited==set(range(len(doc['nodes']))),'unreachable scene nodes');seen=set();batches=set()
 for batch in sidecar['batches']:
  name=batch['batch'];need(name in render and name not in batches,'missing or duplicate batch');batches.add(name);points,indices=render[name];vs=ix=0
  for r in batch['ranges']:
   n=r['componentId'];need(n not in seen,'duplicate component');seen.add(n);need(r['frameId']=='vehicle','component frame');need(r['vertexStart']==vs and r['indexStart']==ix,'range gap or overlap');vc=r['vertexCount'];ic=r['indexCount'];need(vc>0 and ic>0 and ic%3==0 and r['triangleCount']==ic//3,'range shape');need(vs+vc<=len(points) and ix+ic<=len(indices),'range exceeds actual buffer')
   pp=points[vs:vs+vc];ii=indices[ix:ix+ic];need(all(vs<=j<vs+vc for j in ii),'index escapes component vertex range');tt=[tuple(points[j] for j in ii[k:k+3]) for k in range(0,ic,3)];b=r['boundsM']
   need(G.close(b['min'],[min(p[k] for p in pp) for k in range(3)],2e-5) and G.close(b['max'],[max(p[k] for p in pp) for k in range(3)],2e-5),'recorded component bounds differ from actual geometry')
   mat=r['sourceLocalToVehicleMatrix'];need(len(mat)==16 and r['sourceNodeId']==n,'component identity');source=sidecar['sourceComponentNodes'][n];need(source['name']==n,'source name mismatch')
   out[n]={'node':source,'matrix':mat,'point':C.point(mat,[0,0,0]),'points':pp,'triangles':tt,'dynamic':None,'batchNodeId':name,'batchComponent':True}
   vs+=vc;ix+=ic
  need(vs==len(points) and ix==len(indices),'range coverage incomplete')
 need(batches==set(render),'uncovered draw geometry');need(seen==set(sidecar['sourceComponentNodes']),'uncovered source components');return out,doc,raw

def bounds(obj):
 pts=obj['points'];lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)];return {'min':lo,'max':hi,'size':[hi[k]-lo[k] for k in range(3)]}
