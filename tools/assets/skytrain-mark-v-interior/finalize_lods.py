"""Preserve master geometry; fix passenger-facing UVs and tighten runtime LOD caps."""
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
for p in sorted((HERE/'source').glob('*.blend')):
 bpy.ops.wm.open_mainfile(filepath=str(p));lod=0 if '.lod0.' in p.name else (1 if '.lod1.' in p.name else None)
 for ob in list(bpy.data.objects):
  if ob.type!='MESH':continue
  # Sign fronts originally face the outside; flip texture U for passenger readability.
  if ob.get('semantic_role')=='information' and not ob.get('passenger_uv_fixed'):
   for uv in ob.data.uv_layers.active.data:uv.uv.x=1-uv.uv.x
   ob['passenger_uv_fixed']=True
  if lod is None:continue
  n=ob.name
  if (lod==0 and any(n.startswith(s) for s in ['gangway-pleat','door-jamb-seal','yellow-window-safety-line','bridge-tread-strip','LCD-indicator'])) or (lod==1 and any(n.startswith(s) for s in ['door-jamb-seal','door-center-seam','wall-pillar','upper-wall-header','bicycle-strap','leaning-pad-support','bicycle-leaning-rail'])):
   bpy.data.objects.remove(ob,do_unlink=True);continue
  for mod in list(ob.modifiers):
   if mod.type=='DECIMATE' and n not in ['floor-slab','gangway-bridge']:
    if lod==0:mod.ratio*=.84
    elif 'sculpted-upholstery' not in n:mod.ratio*=.8
  # Triangulation before decimation is necessary for single-face glass polygons.
  ds=[m for m in ob.modifiers if m.type=='DECIMATE']
  if ds and len(ob.data.polygons)<4:
   tr=ob.modifiers.new('Triangulate n-gon for LOD reducer','TRIANGULATE');bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_move_up(modifier=tr.name)
 if lod==1:
  for m in bpy.data.materials:
   if not m.use_nodes:continue
   for n in m.node_tree.nodes:
    if n.type!='TEX_IMAGE' or not n.image:continue
    old=n.image;file=HERE/'textures'/('lod1-'+Path(old.filepath).name)
    # Files made from the original PNGs by Pillow outside Blender (no reference pixels).
    if file.exists():n.image=bpy.data.images.load(str(file),check_existing=True);n.image.pack()
 bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
