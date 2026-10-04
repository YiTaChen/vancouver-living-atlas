"""Lossless static furniture-module draw batching with exact component provenance.

Adapted from this repository's boardable-bus/batch_static.py; no dependency edits.

Runs on a fresh, ordinary Blender GLB. Artist .blend objects are never changed.
All original nodes survive as zero-draw anchors. Each material batch records exact
vertex/index ranges for each source node; validators recover component triangles
from the delivered binary ranges rather than trusting recorded bounds alone.
"""
import copy,importlib.util,json,math,struct,sys
sys.dont_write_bytecode = True
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('common_batch',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)

def need(ok,message):
 if not ok:raise ValueError(message)
def normal(m,v):
 # Cofactor matrix = determinant * inverse-transpose, then normalize.
 a,b,c=m[0],m[4],m[8];d,e,f=m[1],m[5],m[9];g,h,i=m[2],m[6],m[10]
 co=[[e*i-f*h,f*g-d*i,d*h-e*g],[c*h-b*i,a*i-c*g,b*g-a*h],[b*f-c*e,c*d-a*f,a*e-b*d]]
 q=[sum(row[k]*v[k] for k in range(3)) for row in co];length=math.sqrt(sum(x*x for x in q));need(length>1e-12,'singular normal transform');return [x/length for x in q]
def vector(m,v):
 q=[sum(m[k*4+r]*v[k] for k in range(3)) for r in range(3)];length=math.sqrt(sum(x*x for x in q));return [x/length for x in q]
def bounds(points):
 lo=[min(v[k] for v in points) for k in range(3)];hi=[max(v[k] for v in points) for k in range(3)];return {'min':lo,'max':hi,'size':[b-a for a,b in zip(lo,hi)]}
def batch(path):
 path=Path(path);source_sha=C.digest(path);old,raw=C.read_glb(path)
 need(not old.get('animations') and not old.get('skins'),'Only static, unskinned furniture modules can be batched')
 need(not any(n.get('extras',{}).get('componentRanges') for n in old['nodes']),'Refuse double batching')
 roots=list(old['scenes'][old.get('scene',0)]['nodes']);need(roots,'module scene roots required')
 groups={};covered=[]
 def walk(index,parent):
  node=old['nodes'][index];matrix=C.matmul(parent,C.transform(node))
  determinant=matrix[0]*(matrix[5]*matrix[10]-matrix[9]*matrix[6])-matrix[4]*(matrix[1]*matrix[10]-matrix[9]*matrix[2])+matrix[8]*(matrix[1]*matrix[6]-matrix[5]*matrix[2])
  need(determinant>1e-12,'Refuse singular/reflected transforms; positive-scale static furniture required')
  if 'mesh'in node:
   mesh=old['meshes'][node['mesh']]
   for pi,p in enumerate(mesh['primitives']):
    need(p.get('mode',4)==4 and not p.get('targets') and not p.get('extensions'),'ordinary static triangles required')
    attrs=p['attributes'];signature=tuple(sorted(attrs));material=p.get('material',-1);key=(material,signature)
    g=groups.setdefault(key,{'attributes':{k:[] for k in signature},'indices':[],'ranges':[],'material':material})
    first=len(g['attributes']['POSITION']);start=len(g['indices']);rows={k:C.accessor(old,raw,a) for k,a in attrs.items()}
    need(not any(k.startswith(('JOINTS','WEIGHTS')) for k in rows),'skinned attribute is not static')
    points=[C.point(matrix,v) for v in rows['POSITION']]
    for k,values in rows.items():
     if k=='POSITION':values=points
     elif k=='NORMAL':values=[normal(matrix,v) for v in values]
     elif k=='TANGENT':values=[vector(matrix,v[:3])+[v[3]] for v in values]
     else:
      accessor=old['accessors'][attrs[k]]
      if accessor.get('normalized'):
       maximum={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[accessor['componentType']]
       values=[[max(-1,c/maximum) for c in row] for row in values]
     g['attributes'][k].extend(values)
    indices=[a[0] for a in C.accessor(old,raw,p['indices'])] if 'indices'in p else list(range(len(points)))
    g['indices'].extend(first+i for i in indices)
    g['ranges'].append({'componentId':node['name'],'sourceNodeId':node['name'],'sourceNodeIndex':index,'sourcePrimitive':pi,'frameId':'module','vertexStart':first,'vertexCount':len(points),'indexStart':start,'indexCount':len(indices),'triangleCount':len(indices)//3,'sourceLocalToModuleMatrix':matrix,'boundsM':bounds(points)})
    covered.append(node['name'])
  for child in node.get('children',[]):walk(child,matrix)
 for root_node in roots:walk(root_node,C.IDENTITY)
 doc=copy.deepcopy(old);doc['accessors']=[];doc['bufferViews']=[];doc['meshes']=[];binary=bytearray()
 # One identity actor root retains original object/anchor transforms exactly.
 root=len(doc['nodes']);doc['nodes'].append({'name':'furniture-module-root','children':roots,'extras':{'frameId':'module','staticModuleActor':True}});doc['scenes'][doc.get('scene',0)]['nodes']=[root]
 def append_view(payload,target=None):
  while len(binary)%4:binary.append(0)
  start=len(binary);binary.extend(payload);v={'buffer':0,'byteOffset':start,'byteLength':len(payload)}
  if target:v['target']=target
  doc['bufferViews'].append(v);return len(doc['bufferViews'])-1
 def append_accessor(rows,kind='VEC3',component=5126,target=34962,position=False):
  fmt='f' if component==5126 else 'I';flat=[x for row in rows for x in row];view=append_view(struct.pack('<'+fmt*len(flat),*flat),target)
  acc={'bufferView':view,'componentType':component,'count':len(rows),'type':kind}
  if position:acc['min']=[min(row[k] for row in rows) for k in range(3)];acc['max']=[max(row[k] for row in rows) for k in range(3)]
  doc['accessors'].append(acc);return len(doc['accessors'])-1
 # Preserve image payloads if artists later add ordinary embedded maps.
 for im,old_im in zip(doc.get('images',[]),old.get('images',[])):
  if 'bufferView'in old_im:
   bv=old['bufferViews'][old_im['bufferView']];start=bv.get('byteOffset',0);im['bufferView']=append_view(raw[start:start+bv['byteLength']])
 for node in doc['nodes']:
  if 'mesh'in node:
   del node['mesh'];node.setdefault('extras',{})['exportGeometry']='zero-draw component anchor; see static material batch ranges'
 for ordinal,((material,signature),g) in enumerate(groups.items()):
  name=('furniture-batch-'+doc['materials'][material]['name'] if material>=0 else 'furniture-batch-unassigned')+'-'+str(ordinal)
  attrs={k:append_accessor(g['attributes'][k],{2:'VEC2',3:'VEC3',4:'VEC4'}[len(g['attributes'][k][0])],position=k=='POSITION') for k in signature}
  indices=append_accessor([(i,) for i in g['indices']],'SCALAR',5125,34963)
  primitive={'attributes':attrs,'indices':indices,'mode':4}
  if material>=0:primitive['material']=material
  doc['meshes'].append({'name':name,'primitives':[primitive]});node={'name':name,'mesh':len(doc['meshes'])-1,'extras':{'semantic_role':doc['materials'][material].get('extras',{}).get('surface_id',doc['materials'][material]['name']),'frameId':'module','batchSchemaVersion':1,'componentRanges':g['ranges']}}
  doc['nodes'].append(node);doc['nodes'][root].setdefault('children',[]).append(len(doc['nodes'])-1)
 doc.setdefault('extras',{})['staticBatching']={'schemaVersion':1,'method':'material-and-attribute signature batching, actual GLB binary geometry preserved','unbatchedGLBSha256':source_sha,'sourceMeshNodeCount':len(set(covered)),'renderPrimitiveCount':len(groups),'componentRanges':'Each batch node extras.componentRanges addresses its single primitive indices and vertices; all source nodes remain zero-draw anchors.'}
 doc['buffers']=[{'byteLength':len(binary)}];jsonbytes=json.dumps(doc,separators=(',',':')).encode();jsonbytes+=b' '*((-len(jsonbytes))%4);binary+=b'\0'*((-len(binary))%4)
 result=struct.pack('<4sII',b'glTF',2,12+8+len(jsonbytes)+8+len(binary))+struct.pack('<I4s',len(jsonbytes),b'JSON')+jsonbytes+struct.pack('<I4s',len(binary),b'BIN\0')+binary
 path.write_bytes(result);return doc['extras']['staticBatching']
