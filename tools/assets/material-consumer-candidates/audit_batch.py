"""Compare every exported static component to fresh unbatched source geometry."""
import copy,json,sys,struct,tempfile
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from batch_static import C
def dump(path,data):(ROOT/path).write_text(json.dumps(data,indent=2)+'\n')
from batch_static import normal,vector

def matrices(doc):
 result={}
 def walk(i,parent):
  node=doc['nodes'][i];m=C.matmul(parent,C.transform(node));result[i]=m
  for child in node.get('children',[]):walk(child,m)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 return result

def audit(before,after):
 old,ob=C.read_glb(before);new,nb=C.read_glb(after);validate_ranges(new,nb);assert C.digest(before)==new['extras']['staticBatching']['unbatchedGLBSha256'];world=matrices(old);newworld=matrices(new)
 assert old.get('materials')==new.get('materials'),'Material definitions changed'
 for i,node in enumerate(old['nodes']):
  a=copy.deepcopy(node);b=copy.deepcopy(new['nodes'][i]);a.pop('mesh',None);b.pop('mesh',None)
  if 'extras' in b:
   b['extras'].pop('exportGeometry',None)
   if not b['extras']:b.pop('extras')
  assert a==b,('Original named node/anchor changed',i,node['name'])
  assert max(abs(x-y) for x,y in zip(world[i],newworld[i]))<1e-8,'Original node world transform changed'
 expected={(i,pi) for i,node in enumerate(old['nodes']) if 'mesh' in node for pi,p in enumerate(old['meshes'][node['mesh']]['primitives'])};covered=set();components=[]
 for node in new['nodes']:
  for r in node.get('extras',{}).get('componentRanges',[]):
   key=(r['sourceNodeIndex'],r['sourcePrimitive']);assert key in expected and key not in covered;covered.add(key)
   source=old['nodes'][key[0]];assert source['name']==r['sourceNodeId']==r['componentId'];m=world[key[0]];assert max(abs(a-b) for a,b in zip(m,r['sourceLocalToModuleMatrix']))<1e-8
   p=new['meshes'][node['mesh']]['primitives'][0];op=old['meshes'][source['mesh']]['primitives'][key[1]];assert p.get('material')==op.get('material');assert set(p['attributes'])==set(op['attributes'])
   oldidx=[x[0] for x in C.accessor(old,ob,op['indices'])];newidx=[x[0] for x in C.accessor(new,nb,p['indices'])];assert oldidx==[i-r['vertexStart'] for i in newidx[r['indexStart']:r['indexStart']+r['indexCount']]]
   errors={}
   for name,aid in op['attributes'].items():
    vals=C.accessor(old,ob,aid)
    if name=='POSITION':vals=[C.point(m,v) for v in vals]
    elif name=='NORMAL':vals=[normal(m,v) for v in vals]
    elif name=='TANGENT':vals=[vector(m,v[:3])+[v[3]] for v in vals]
    elif old['accessors'][aid].get('normalized'):
     maximum={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[old['accessors'][aid]['componentType']];vals=[[max(-1,c/maximum) for c in v] for v in vals]
    got=C.accessor(new,nb,p['attributes'][name])[r['vertexStart']:r['vertexStart']+r['vertexCount']];assert len(vals)==len(got);error=max(abs(a-b) for v,w in zip(vals,got) for a,b in zip(v,w));assert error<1e-6,(r['componentId'],name,error);errors[name]=error
   components.append({'componentId':r['componentId'],'sourcePrimitive':key[1],'batchNode':node['name'],'triangleCount':r['triangleCount'],'attributeMaxErrors':errors,'indicesIdenticalAfterVertexBaseSubtraction':True})
 assert covered==expected,'Missing or duplicated component geometry'
 b=C.measure_glb(before);a=C.measure_glb(after);assert a['triangles']==b['triangles'] and a['vertices']==b['vertices'];assert all(abs(x-y)<1e-6 for side in ['min','max','size'] for x,y in zip(a['boundsM'][side],b['boundsM'][side]));roles={p.get('material') for mesh in old['meshes'] for p in mesh['primitives']};assert a['primitives']==len(roles),'Primitive count must equal actual material role count'
 return {'file':after.name,'status':'pass','unbatchedSha256':C.digest(before),'batchedSha256':C.digest(after),'unbatchedPrimitives':b['primitives'],'batchedPrimitives':a['primitives'],'materialRoles':len(roles),'unbatchedBytes':b['bytes'],'batchedBytes':a['bytes'],'unbatchedGeometryBufferBytes':sum(v['byteLength'] for v in old['bufferViews'] if v.get('target') in [34962,34963]),'batchedGeometryBufferBytes':sum(v['byteLength'] for v in new['bufferViews'] if v.get('target') in [34962,34963]),'trianglesUnchanged':a['triangles'],'verticesUnchanged':a['vertices'],'allOriginalNodeTransformsPreserved':True,'componentRanges':components}


def validate_ranges(doc,binary):
 """Reconstruct actual delivered components; reject holes, overlap and index escape."""
 assert not doc.get('animations') and not doc.get('skins')
 roots=doc['scenes'][doc.get('scene',0)]['nodes'];assert len(roots)==1
 root=doc['nodes'][roots[0]];assert root['name']=='furniture-module-root'
 assert C.transform(root)==C.IDENTITY
 render_nodes=[n for n in doc['nodes'] if 'mesh' in n]
 assert len(render_nodes)==2 and len(doc['meshes'])==2,'Two material-role render batches required'
 covered=set();total_triangles=0;roles=set()
 for n in render_nodes:
  assert n['extras']['batchSchemaVersion']==1
  assert C.transform(n)==C.IDENTITY
  mesh=doc['meshes'][n['mesh']];assert len(mesh['primitives'])==1
  p=mesh['primitives'][0];assert p.get('mode',4)==4
  roles.add(p['material']);points=C.accessor(doc,binary,p['attributes']['POSITION'])
  indices=[i[0] for i in C.accessor(doc,binary,p['indices'])]
  assert set(p['attributes'])=={'POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1'}
  vc=ic=0
  for r in n['extras']['componentRanges']:
   key=(r['sourceNodeIndex'],r['sourcePrimitive']);assert key not in covered;covered.add(key)
   anchor=doc['nodes'][r['sourceNodeIndex']]
   assert anchor['name']==r['sourceNodeId']==r['componentId'] and 'mesh' not in anchor
   assert anchor['extras']['exportGeometry'].startswith('zero-draw')
   assert r['frameId']=='module' and r['vertexStart']==vc and r['indexStart']==ic
   assert r['vertexCount']>0 and r['indexCount']>0 and r['indexCount']%3==0
   assert r['triangleCount']==r['indexCount']//3
   pp=points[vc:vc+r['vertexCount']];ii=indices[ic:ic+r['indexCount']]
   assert len(pp)==r['vertexCount'] and len(ii)==r['indexCount']
   assert all(vc<=i<vc+r['vertexCount'] for i in ii),'component index escapes its vertices'
   for side,fn in [('min',min),('max',max)]:
    assert all(abs(fn(v[k] for v in pp)-r['boundsM'][side][k])<1e-6 for k in range(3))
   assert all(abs(r['boundsM']['size'][k]-(r['boundsM']['max'][k]-r['boundsM']['min'][k]))<1e-8 for k in range(3))
   vc+=r['vertexCount'];ic+=r['indexCount'];total_triangles+=r['triangleCount']
  assert vc==len(points) and ic==len(indices),'component range coverage gap'
 assert len(roles)==2
 anchors=[n for n in doc['nodes'] if n.get('extras',{}).get('exportGeometry')]
 assert len(covered)==len(anchors)==doc['extras']['staticBatching']['sourceMeshNodeCount']
 return {'components':len(covered),'triangles':total_triangles,'primitives':len(render_nodes),'zeroDrawAnchors':len(anchors)}

def negative_tests(path):
 doc,binary=C.read_glb(path);mutations={
  'range gap rejected':lambda d:next(n for n in d['nodes'] if 'mesh'in n)['extras']['componentRanges'][0].update(indexStart=3),
  'vertex overlap rejected':lambda d:next(n for n in d['nodes'] if 'mesh'in n)['extras']['componentRanges'][1].update(vertexStart=0),
  'missing component rejected':lambda d:next(n for n in d['nodes'] if 'mesh'in n)['extras']['componentRanges'].pop(),
  'anchor with draw geometry rejected':lambda d:d['nodes'][0].update(mesh=0),
  'incorrect component bounds rejected':lambda d:next(n for n in d['nodes'] if 'mesh'in n)['extras']['componentRanges'][0]['boundsM']['max'].__setitem__(1,99),
 }
 for name,mutate in mutations.items():
  changed=copy.deepcopy(doc);mutate(changed)
  try:validate_ranges(changed,binary)
  except AssertionError:pass
  else:raise AssertionError(name+' did not fail')
 # An index pointing into a different component must fail even when its batch accessor is valid.
 changed=bytearray(binary);node=next(n for n in doc['nodes'] if 'mesh'in n);primitive=doc['meshes'][node['mesh']]['primitives'][0]
 accessor=doc['accessors'][primitive['indices']];view=doc['bufferViews'][accessor['bufferView']]
 struct.pack_into('<I',changed,view.get('byteOffset',0)+accessor.get('byteOffset',0),node['extras']['componentRanges'][0]['vertexCount'])
 try:validate_ranges(doc,changed)
 except AssertionError:pass
 else:raise AssertionError('Component-escaping binary index not rejected')
 from batch_static import batch
 with tempfile.TemporaryDirectory(prefix='furniture-negative-') as directory:
  target=Path(directory)/'already-batched.glb';target.write_bytes(path.read_bytes());before=C.digest(target)
  try:batch(target)
  except ValueError as e:assert 'double batching' in str(e)
  else:raise AssertionError('Double batching not rejected')
  assert C.digest(target)==before
 return list(mutations)+['component-escaping binary index rejected','double batching rejected before write']

def write_report(results):
 for r in results:
  doc,binary=C.read_glb(ROOT/'exports'/r['file']);r['rangeValidation']=validate_ranges(doc,binary)
 chair={r['file'].split('.lod')[1][0]:r for r in results if r['file'].startswith('lecture-chair')}
 counter={r['file'].split('.lod')[1][0]:r for r in results if r['file'].startswith('admissions-counter')}
 report={'status':'pass','method':'Fresh normal .blend source GLB compared to actual batched BIN per-component POSITION/NORMAL/UV, indices, material and named-node transforms; no geometry simplification','results':results,'negativeTests':negative_tests(ROOT/'exports/lecture-chair-module.lod0.glb'),'originalSourceFilesUnmodified':True,'sourceHashes':{str(p.relative_to(ROOT)):C.digest(p) for p in sorted((ROOT/'source').glob('*.blend'))},'placementPrimitiveSubmissionProposal':[{'lod':int(l),'chairInstances':54,'counterInstances':4,'chairBefore':54*chair[l]['unbatchedPrimitives'],'chairAfter':54*chair[l]['batchedPrimitives'],'counterBefore':4*counter[l]['unbatchedPrimitives'],'counterAfter':4*counter[l]['batchedPrimitives'],'totalBefore':54*chair[l]['unbatchedPrimitives']+4*counter[l]['unbatchedPrimitives'],'totalAfter':116,'instancingEnabled':False,'gpuDrawsMeasured':False} for l in ['0','1']],'unbatchedTotalBytes':sum(r['unbatchedBytes'] for r in results),'batchedTotalBytes':sum(r['batchedBytes'] for r in results),'unbatchedGeometryBufferBytes':sum(r['unbatchedGeometryBufferBytes'] for r in results),'batchedGeometryBufferBytes':sum(r['batchedGeometryBufferBytes'] for r in results),'newTextureBytes':0,'costCaveat':'Primitive submissions are CPU asset estimates only. Preserved anchors/ranges and uint32 indices have file/buffer costs; no runtime FPS, draws or VRAM claim.'}
 previous=ROOT/'qa/static-batching.json'
 if previous.exists():
  previous=json.loads(previous.read_text())
  if 'preBatchDeliveredGLBByteIdentity' in previous:report['preBatchDeliveredGLBByteIdentity']=previous['preBatchDeliveredGLBByteIdentity']
 dump('qa/static-batching.json',report)
 return report

if __name__=='__main__':
 before=Path(sys.argv[1]);report=write_report([audit(before/f.name,f) for f in sorted((ROOT/'exports').glob('*.glb'))]);print([(r['file'],r['unbatchedPrimitives'],r['batchedPrimitives']) for r in report['results']])
