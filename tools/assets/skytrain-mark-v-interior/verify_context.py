"""Validate actual Blender-world triangles of the two-instance QA context.
Uses the same imported GLB and setup transform as the continuity renderer.
This does not establish a C-car profile or moving/passenger runtime support.
"""
import hashlib,json,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from qa_blender import setup
from validate import support_height
path=setup(0,context=True);negative='--negative-quaternion-mode' in sys.argv
if negative:
 neighbor=next(ob for ob in bpy.context.scene.objects if ob.name.startswith('vehicle') and not ob.parent and ob.location.y>10)
 neighbor.rotation_mode='QUATERNION';neighbor.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
low=[-.60,.035,-9.47];high=[.60,2.05,-7.60]
triangles=0;blocked=[];support=[]
for ob in bpy.context.scene.objects:
 if ob.type!='MESH':continue
 me=ob.data;me.calc_loop_triangles()
 points=[]
 for v in me.vertices:
  p=ob.matrix_world@v.co;points.append((float(p.x),float(p.z),float(-p.y)))
 for tri in me.loop_triangles:
  p=[points[i] for i in tri.vertices];triangles+=1
  lo=[min(v[i] for v in p) for i in range(3)];hi=[max(v[i] for v in p) for i in range(3)]
  if all(hi[i]>low[i]+1e-6 and lo[i]<high[i]-1e-6 for i in range(3)):blocked.append(ob.name)
  if hi[1]<=.035 and lo[1]>=-.04:support.append(p)
if negative:
 assert blocked,'Regression failed: unapplied neighbor rotation did not trigger a real triangle obstruction'
 print('NEGATIVE_CONTEXT_ROTATION_REJECTED',len(blocked),sorted(set(blocked)));sys.exit(0)
assert not blocked,('Combined context has an actual cross-passage triangle',sorted(set(blocked)))
heights=[]
for x in [-.55,0,.55]:
 for j in range(129):
  z=-9.46+j*(1.85/128);h=support_height([{'supportTrianglesM':support}],x,z)
  assert h is not None and -.001<=h<=.0035,('Combined context floor gap',x,z,h)
  heights.append(h)
roots=[ob for ob in bpy.context.scene.objects if ob.name.startswith('vehicle') and not ob.parent]
assert len(roots)==2
report={'status':'pass','scope':'Actual world-space triangles from both GLB instances in continuity-render setup; QA context only','rendererScriptSha256':hashlib.sha256((HERE/'qa_blender.py').read_bytes()).hexdigest(),'sourceGLB':str(path.relative_to(HERE)),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'instances':2,'triangles':triangles,'openPrismM':{'min':low,'max':high},'blockingTriangles':len(blocked),'floorSupportProbes':len(heights),'floorHeightRangeM':[min(heights),max(heights)],'bridgeJoinZM':-8.535,'transformsBlender':[{ 'name':ob.name,'matrix':[list(r) for r in ob.matrix_world]} for ob in roots],'blender':bpy.app.version_string,'runtime':'not_run','notCcarReconstruction':True,'notFullConsist':True}
(HERE/'qa/adjacent-context-validation.json').write_text(json.dumps(report,indent=2)+'\n');print('ACTUAL_ADJACENT_CONTEXT_PASS',triangles,len(heights))
