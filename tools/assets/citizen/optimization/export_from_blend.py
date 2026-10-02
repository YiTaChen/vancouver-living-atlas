"""blender -b -t 4 --python tools/assets/citizen/optimization/export_from_blend.py
Reopens each committed editable source and writes only its matching candidate.
"""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
for name in ['lod0','lod1','lod2']:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source'/f'citizen-{name}.blend'))
 rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=rig;rig.animation_data.action=None
 for p in rig.pose.bones:p.matrix_basis.identity()
 bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
 bpy.ops.export_scene.gltf(filepath=str(ROOT/'glb'/f'citizen-{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_skins=True,export_yup=True,export_image_format='AUTO',export_apply=False,export_extras=True,export_frame_range=False)
 print('ROUNDTRIP_EXPORTED',name)
