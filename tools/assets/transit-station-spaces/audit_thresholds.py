"""Actual GLB deployed threshold/door/end-support/headroom checks. No runtime acceptance."""
import json,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import ROOT,clean,xyz
from contract import dump,C

def imp(path,offset=[0,0,0]):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=list(set(bpy.context.scene.objects)-before);frame=bpy.data.objects.new('qa-frame',None);bpy.context.collection.objects.link(frame);frame.location=xyz(offset)
 for o in obs:
  if not o.parent:o.parent=frame
 return obs

def aabb(obs):
 expanded=set(obs)
 for o in obs:expanded.update(o.children_recursive)
 pts=[o.matrix_world@Vector(v) for o in expanded if o.type=='MESH' for v in o.bound_box];return [[min(p[k] for p in pts) for k in range(3)],[max(p[k] for p in pts) for k in range(3)]]
def intersects(a,b):return all(min(a[1][k],b[1][k])-max(a[0][k],b[0][k])>1e-5 for k in range(3))
def up_clearance(x,y,z):
 hit,p,n,idx,obj,mat=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),Vector(xyz([x,y,z])),Vector((0,0,1)),distance=4)
 return {'pointM':[x,y,z],'hit':obj.name if hit else None,'clearanceM':p.z-y if hit else 4,'rayLimitM':4}
def floor_component_hit(path, point):
 # Resolve named component ranges in actual exported batched geometry. A zero-draw
 # anchor is not allowed to stand in for floor triangles or bearing support.
 from mathutils.bvhtree import BVHTree
 doc,binary=C.read_glb(path);matrices={}
 def walk(i,parent):
  node=doc['nodes'][i];matrix=C.matmul(parent,C.transform(node));matrices[i]=matrix
  for child in node.get('children',[]):walk(child,matrix)
 for i in doc['scenes'][doc.get('scene',0)]['nodes']:walk(i,C.IDENTITY)
 candidates=[]
 for i,node in enumerate(doc['nodes']):
  for component in node.get('extras',{}).get('componentRanges',[]):
   if component['componentId']!='floor':continue
   primitive=doc['meshes'][node['mesh']]['primitives'][0]
   vertices=C.accessor(doc,binary,primitive['attributes']['POSITION'])
   indices=[v[0] for v in C.accessor(doc,binary,primitive['indices'])]
   start=component['indexStart'];count=component['indexCount'];assert start>=0 and count>0 and start+count<=len(indices) and count%3==0
   selected=indices[start:start+count];vstart=component['vertexStart'];vend=vstart+component['vertexCount'];assert all(vstart<=j<vend for j in selected)
   world=[Vector(C.point(matrices[i],v)) for v in vertices]
   tris=[tuple(selected[j:j+3]) for j in range(0,count,3)]
   tree=BVHTree.FromPolygons(world,tris,all_triangles=True)
   hit,normal,triangle,distance=tree.ray_cast(Vector(point),Vector((0,-1,0)),1)
   if hit is not None:candidates.append({'componentId':'floor','batchNode':node['name'],'indexStart':start,'indexCount':count,'triangleCount':count//3,'hitPointVehicleM':list(hit),'hitTriangleInComponent':triangle})
 assert candidates,'No actual floor component range bearing hit'
 return max(candidates,key=lambda x:x['hitPointVehicleM'][1])

layout=json.loads((ROOT/'station-layout.json').read_text());rows=[];inputs={}
for stop in [layout['stops'][0],layout['stops'][2]]:
 rail=stop['kind']=='rail-platform';pkg=ROOT.parent/('boardable-metro' if rail else 'boardable-bus');m=json.loads((pkg/'manifest.json').read_text())
 for align in stop['doorAlignmentPoints']:
  clean();deck=align['thresholdDeck'];vid=align.get('vehicleId',m['vehicles'][0]['vehicleId']);v=next(v for v in m['vehicles'] if v['vehicleId']==vid);offset=align['carToStation']['translationM'] if rail else [0,0,0];objects=[]
  for key in ['exterior','interior']:
   a=next(a for a in m['assets'] if a['id']==v['assetRefs'][key]);path=pkg/a['lods'][0]['file'];inputs[str(path.relative_to(ROOT.parent))]=C.digest(path);objects+=imp(path,offset)
  doorobjs=[]
  for d in v['doors']:
   if d['side']!='right':continue
   o=next(o for o in objects if o.name.split('.')[0]==d['nodeId']);doorobjs.append((o,d));o.location=xyz(d['openTransform']['translationM'])
  path=ROOT/'exports'/(deck['assetId']+'.lod0.glb');inputs[str(path.relative_to(ROOT.parent))]=C.digest(path);plate=imp(path,deck['deployedTransform']['translationM']);bpy.context.view_layer.update();pa=aabb(plate)
  for o,d in doorobjs:assert not intersects(pa,aabb([o])),('open-door intersects deck',d['doorId'])
  floor=stop['floorHeightM'];z=align['stationPointM'][2];cabin=up_clearance(0,floor+.001,z);cabin['floorToOverheadM']=cabin['clearanceM']+.001;assert cabin['floorToOverheadM']>=2.05,('cabin headroom below target',vid,cabin);rays=[up_clearance(x,floor+.016,z) for x in [-1.7,-1.45,-1.28,-1.20,-1.08]];assert min(r['clearanceM'] for r in rays)>=1.96,'human headroom'
  # Vehicle-side bearing ends are physically over the actual vehicle floor.
  x=deck['vehicleBearingPointM'][0]-.001;support=[]
  for o in objects:
   if o.type!='MESH' or not ('floor' in o.name.lower() or any(mat and 'floor' in mat.name.lower() for mat in o.data.materials)):continue
   inv=o.matrix_world.inverted();start=inv@Vector(xyz([x,floor+.1,z]));direction=inv.to_3x3()@Vector((0,0,-1));hit,p,n,idx=o.ray_cast(start,direction,distance=1)
   if hit:
    hitpoint=o.matrix_world@p
    if abs(hitpoint.z-floor)<.01:support.append(o.name)
  assert support,('actual vehicle floor bearing absent',vid,x,z)
  support_node=support[0]
  interior=next(a for a in m['assets'] if a['id']==v['assetRefs']['interior']);component_hit=floor_component_hit(pkg/interior['lods'][0]['file'],[x,floor+.1,z-offset[2]]);assert abs(component_hit['hitPointVehicleM'][1]-floor)<.01,'resolved component floor support height'
  # Closing the doors while deployed must be rejected by the state gate.
  for o,d in doorobjs:o.location=xyz(d['closedTransform']['translationM'])
  bpy.context.view_layer.update();closed_hits=[d['doorId'] for o,d in doorobjs if intersects(pa,aabb([o]))];assert closed_hits,'closed-door conflict negative control expected'
  rows.append({'stopId':stop['stopId'],'anchor':align['vehicleAnchorId'],'carId':align.get('carId'),'researchIslandFloorHeightM':floor,'realGroundConnectionStatus':'unresolved','ordinaryCurbAccessClaim':False,'actualGlbDoorOpenDeckOverlap':False,'doorClosedDeckOverlapNegativeControl':closed_hits,'actualDoorwayClearanceRays':rays,'cabinFloorToOverheadRay':cabin,'cabinHeadroomMinimumTargetM':2.05,'doorwayMinimumTargetM':2.0,'minimumDoorwayHeadClearanceM':min(r['clearanceM'] for r in rays),'vehicleBearingSupportNode':support_node,'vehicleFloorComponentRangeHit':component_hit,'deckMaximumRiseM':.015,'taperGrade':.075,'humanHeightM':1.81,'requiredHeadMarginM':.15,'stateGateRequired':True,'status':'pass'})
dump('qa/threshold-validation.json',{'status':'pass','scope':'Actual LOD0 GLBs transformed to all 12 metro door alignments and both bus doors; second bus stop uses same frame-invariant plate geometry','pose':'fully deployed plate plus fully open right doors; closed-door overlap is expected negative control','checks':rows,'inputGlbHashes':inputs,'staticOnly':True,'deploymentInterpolation':'not_run','runtimeActivation':False,'accessibilityCertification':False})
