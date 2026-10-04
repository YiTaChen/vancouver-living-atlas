"""Prove every batched component against freshly source-exported, unbatched GLB accessors."""
import sys,json,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import common
from batch_static import normal,vector

def audit(before,after):
 old,ob=common.read_glb(before);doc,buf=common.read_glb(after);assert common.digest(before)==doc['extras']['staticBatching']['unbatchedGLBSha256'];results=[]
 for n in doc['nodes']:
  rr=n.get('extras',{}).get('componentRanges')
  if not rr:continue
  p=doc['meshes'][n['mesh']]['primitives'][0];newidx=[i[0] for i in common.accessor(doc,buf,p['indices'])]
  for r in rr:
   source=old['nodes'][r['sourceNodeIndex']];assert source['name']==r['sourceNodeId'];op=old['meshes'][source['mesh']]['primitives'][r['sourcePrimitive']];assert op['material']==p['material'];idx=[i[0] for i in common.accessor(old,ob,op['indices'])];assert idx==[i-r['vertexStart'] for i in newidx[r['indexStart']:r['indexStart']+r['indexCount']]];errors={}
   for name,aid in op['attributes'].items():
    vals=common.accessor(old,ob,aid);m=r['sourceLocalToVehicleMatrix']
    if name=='POSITION':vals=[common.point(m,v) for v in vals]
    elif name=='NORMAL':vals=[normal(m,v) for v in vals]
    elif name=='TANGENT':vals=[vector(m,v[:3])+[v[3]] for v in vals]
    got=common.accessor(doc,buf,p['attributes'][name])[r['vertexStart']:r['vertexStart']+r['vertexCount']];error=float(np.max(np.abs(np.array(vals)-np.array(got))));assert error<1e-5,(r['componentId'],name,error);errors[name]=error
   results.append({'componentId':r['componentId'],'sourcePrimitive':r['sourcePrimitive'],'batchNode':n['name'],'triangles':r['triangleCount'],'attributeMaxErrors':errors,'indicesIdenticalAfterVertexBaseSubtraction':True})
 source=common.measure_glb(before);actual=common.measure_glb(after);assert source['triangles']==actual['triangles'] and source['vertices']==actual['vertices'];assert actual['primitives']<=8
 return {'file':after.name,'status':'pass','unbatchedSha256':common.digest(before),'batchedSha256':common.digest(after),'unbatchedPrimitives':source['primitives'],'batchedPrimitives':actual['primitives'],'trianglesUnchanged':actual['triangles'],'verticesUnchanged':actual['vertices'],'componentRanges':results}
if __name__=='__main__':
 before=Path(sys.argv[1]);reports=[audit(before/p.name,p) for p in sorted((ROOT/'exports').glob('*interior*.glb'))];(ROOT/'qa/static-batching.json').write_text(json.dumps({'status':'pass','method':'Per-component actual binary attributes and indices compared to unbatched source GLBs, before batching; material IDs and original zero-draw node transforms preserved.','results':reports},indent=2)+'\n');print([(r['file'],r['unbatchedPrimitives'],r['batchedPrimitives']) for r in reports])
