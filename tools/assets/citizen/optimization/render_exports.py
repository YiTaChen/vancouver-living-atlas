"""Render fresh re-imports of final round-trip GLBs, studio comes from baseline blend."""
import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
for name in ['lod0','lod1','lod2']:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/citizen-reference.blend'))
 for o in list(bpy.context.scene.objects):
  if o.type in ['MESH','ARMATURE']:bpy.data.objects.remove(o,do_unlink=True)
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'glb'/f'citizen-{name}.glb'))
 sc=bpy.context.scene;sc.render.fps=30;rig=next(o for o in sc.objects if o.type=='ARMATURE')
 rig.animation_data.action=None
 for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
 for view,loc,clip,seconds in [('front',(2,-5,2),'idle',0),('run-back',(-2,5,1.9),'run',.6206667),('walk',(2,-5,2),'walk',.2)]:
  rig.animation_data.action=next(a for a in bpy.data.actions if a.name.startswith(clip));frame=seconds*30;sc.frame_set(int(frame),subframe=frame%1);sc.camera.location=loc;sc.camera.rotation_euler=(Vector((0,0,.92))-sc.camera.location).to_track_quat('-Z','Y').to_euler();sc.render.filepath=str(ROOT/'qa'/f'{name}-{view}.png');bpy.ops.render.render(write_still=True)
