"""Preserve exact planar support surfaces in the reduced cabin LOD."""
from pathlib import Path
import sys,bpy
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));from export import export_loaded
p=HERE/'source/mark-v-a-car-interior.lod1.blend';bpy.ops.wm.open_mainfile(filepath=str(p))
for name in ['floor-slab','gangway-bridge']:
 ob=bpy.data.objects[name]
 for mod in list(ob.modifiers):
  if mod.type=='DECIMATE':ob.modifiers.remove(mod)
 ob['lod_triangle_target']=12;ob['preserve_planar_support']=True
bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True);export_loaded(HERE/'exports/mark-v-a-car-interior.lod1.glb')
