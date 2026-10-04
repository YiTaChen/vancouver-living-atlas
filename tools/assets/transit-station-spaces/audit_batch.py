"""Compare every exported static component to fresh unbatched source geometry."""
import copy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from contract import C,dump
from batch_static import normal,vector

def matrices(doc):
 result={}
 def walk(i,parent):
  node=doc['nodes'][i];m=C.matmul(parent,C.transform(node));result[i]=m
  for child in node.get('children',[]):walk(child,m)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 return result

def audit(before,after):
 old,ob=C.read_glb(before);new,nb=C.read_glb(after);assert C.digest(before)==new['extras']['staticBatching']['unbatchedGLBSha256'];world=matrices(old);newworld=matrices(new)
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
 return {'file':after.name,'status':'pass','unbatchedSha256':C.digest(before),'batchedSha256':C.digest(after),'unbatchedPrimitives':b['primitives'],'batchedPrimitives':a['primitives'],'materialRoles':len(roles),'unbatchedBytes':b['bytes'],'batchedBytes':a['bytes'],'trianglesUnchanged':a['triangles'],'verticesUnchanged':a['vertices'],'allOriginalNodeTransformsPreserved':True,'componentRanges':components}

if __name__=='__main__':
 before=Path(sys.argv[1]);results=[audit(before/f.name,f) for f in sorted((ROOT/'exports').glob('*.glb'))];platform=next(r for r in results if r['file']=='platform-edge-2m.lod0.glb');report={'status':'pass','method':'Fresh unbatched source GLB and actual batched binary per-component attributes, indices, materials and named-node transforms; no geometric simplification','results':results,'platform37ModulePrimitiveSubmissionProposal':{'before':37*platform['unbatchedPrimitives'],'after':37*platform['batchedPrimitives'],'moduleCount':37,'instancingEnabled':False,'gpuDrawsMeasured':False},'originalSourceFilesUnmodified':True};dump('qa/static-batching.json',report);print([(r['file'],r['unbatchedPrimitives'],r['batchedPrimitives']) for r in results])
