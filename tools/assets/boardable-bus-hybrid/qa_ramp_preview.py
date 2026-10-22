"""Daylight deployed-ramp image from the final saved LOD0 and retained cabin."""
import bpy,importlib.util,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('hybrid_generator',HERE/'build.py');G=importlib.util.module_from_spec(s);s.loader.exec_module(G)
bpy.ops.wm.open_mainfile(filepath=str(HERE/'source/city-bus-12m-exterior.lod0.blend'));G.setup_preview()
old=set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(G.REPO/'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod0.glb'))
imported=set(bpy.context.scene.objects)-old
for name in G.DOOR_IDS:
 o=bpy.data.objects[name];o.animation_data_clear();group,a,b=next(d for d in G.DOORS if d[0] in name)
 sign=-1 if name.endswith('-a') else 1;z=(a+(b-a)/4) if sign<0 else (b-(b-a)/4)
 o.location=G.cv((-1.39,.36,z+sign*((b-a)/2+.045)))
vehicle=bpy.data.objects['vehicle'];vehicle.location.z=-.0762
for name in G.WHEEL_IDS:bpy.data.objects[name].location.z+=.0762
for o in imported:
 if o.parent is None:o.location.z-=.0762
 if o.type=='LIGHT':o.hide_render=True
ramp=bpy.data.objects['boarding-ramp'];ramp.rotation_euler.y=-(math.pi+math.asin((.36-.0762)/1.12))
bpy.context.view_layer.update();G.preview('hybrid-kneel-ramp-deployed.png',(-4.1,1.45,7.1),(-1.08,.55,4.49))
