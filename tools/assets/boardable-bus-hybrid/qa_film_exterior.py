"""One matching daylight reference preview; never saves a runtime/source scene."""
import bpy,importlib.util
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('hybrid_generator',HERE/'build.py');G=importlib.util.module_from_spec(s);s.loader.exec_module(G)
bpy.ops.wm.open_mainfile(filepath=str(HERE/'reference/film-bus-upright-reference.blend'))
for o in bpy.context.scene.objects:
 if o.type=='LIGHT':o.hide_render=True
G.setup_preview();scene=bpy.context.scene;camera=scene.camera
camera.location=(13,-10,5.5);camera.rotation_euler=(Vector((.2,0,1.35))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(HERE/'qa/previews/film-reference-daylight-front.png');bpy.ops.render.render(write_still=True)
