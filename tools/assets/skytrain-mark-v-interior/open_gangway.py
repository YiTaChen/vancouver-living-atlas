"""One-time, idempotent gangway correction. Re-export never invokes this edit.
Replace door-like flat black bellows with an open, gray accordion surface.
No body, seats, boarding doors, anchors, bridge or runtime contract is changed.
"""
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
VERSION=2
for p in sorted((HERE/'source').glob('*.blend')):
 bpy.ops.wm.open_mainfile(filepath=str(p))
 if bpy.context.scene.get('open_gangway_revision')==VERSION:continue
 lod=1 if '.lod1.' in p.name else (0 if '.lod0.' in p.name else None)
 for ob in list(bpy.data.objects):
  if ob.name.startswith('gangway-pleat'):bpy.data.objects.remove(ob,do_unlink=True)
 sides=sorted((o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('gangway-side-bellows')),key=lambda o:o.name)
 assert len(sides)==2
 for ob in sides:
  side=-1 if sum((ob.matrix_world@v.co).x for v in ob.data.vertices)<0 else 1
  segments=6 if lod==1 else (12 if lod==0 else 24)
  # Zig-zag wall stays outside the same 1.4 m gross opening. Gray flexible
  # folds are intentionally distinct from the black glazing/door seals.
  vs=[]
  for j in range(segments+1):
   z=-7.72-.8*j/segments;x=side*(.7075+(.060 if j%2 else 0))
   for y in [0,2.08]:vs.append(ob.matrix_world.inverted()@Vector((x,-z,y)))
  faces=[(2*j,2*j+1,2*j+3,2*j+2) if side>0 else (2*j+2,2*j+3,2*j+1,2*j) for j in range(segments)]
  me=bpy.data.meshes.new(ob.name+'-open-accordion');me.from_pydata(vs,[],faces);me.update();uv=me.uv_layers.new(name='UVMap')
  for loop in me.loops:
   co=ob.matrix_world@me.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(co.y,co.z)
  ob.data=me;ob.modifiers.clear();ob.data.materials.append(bpy.data.materials['shell']);ob['semantic_role']='shell';ob['gangway_role']='open flexible accordion side; no door leaf';ob['foldSegments']=segments
 ceiling=bpy.data.objects['gangway-ceiling'];ceiling.data.materials.clear();ceiling.data.materials.append(bpy.data.materials['shell']);ceiling['semantic_role']='shell'
 bpy.context.scene['open_gangway_revision']=VERSION
 bpy.context.scene['gangway_design']='Open walkthrough with gray folded flexible sides, overhead lining and level bridge; no door leaf or blocking endwall'
 bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
 print('OPEN_GANGWAY_SOURCE',p.name,flush=True)
