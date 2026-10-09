"""Create bounded artist-editable LODs from the untouched high-detail master.
Uses per-component decimation modifiers, removing only named secondary fittings.
Not invoked by re-export. Master preserves all original detailed geometry.
"""
import bpy,math,sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
MASTER=HERE/'source/mark-v-a-car-study.blend'
if not MASTER.exists():
 bpy.ops.wm.open_mainfile(filepath=str(HERE/'source/mark-v-a-car-interior.lod0.blend'));bpy.ops.wm.save_as_mainfile(filepath=str(MASTER),compress=True)
# Broad panels, portals and seats remain; tiny screws, slots, texture-scale stitches and cameras can drop.
DROP=['underseat-vent-slit','ceiling-fastener','clamp-screw','window-latch','roof-mount-foot','speaker-grille','camera-white-mount','camera-dome','intercom-grille-slat','strap-hanger','open-grab-loop']
for lod in [0,1]:
 bpy.ops.wm.open_mainfile(filepath=str(MASTER));removed=[]
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH':continue
  n=ob.name
  skip=any(n.startswith(p) for p in DROP) or '-rear-seam' in n
  if lod==1:skip=skip or any(s in n for s in ['-support-','-base','-pedestal','-crossmember','-integral-grip','-clamp','collar','intercom','leaning-pad-wall','ceiling-speaker','roof-drop-mount','bridge-tread','gangway-pleat','top-opening-window','yellow-window','light-recess','longitudinal-vent','LCD-indicator','-clear-label','window-hold-on','bicycle-area-sign','console-instrument','front-windscreen-seal'])
  if skip:removed.append(n);bpy.data.objects.remove(ob,do_unlink=True);continue
  # Narrow flat-panel bevels are visual luxuries below this game's cabin budget.
  for mod in list(ob.modifiers):
   if mod.type=='BEVEL':mod.segments=1
  if lod==0:
   if '-sculpted-upholstery' in n:target=114
   elif '-molded-shell' in n:target=76
   elif '-integral-grip' in n:target=36
   elif 'divider-rail' in n:target=44
   elif '-support-' in n:target=14
   elif 'window-' in n or 'door-' in n and ('seal' in n or 'shell' in n):target=40
   elif 'bicycle-sculpted' in n:target=50
   elif 'diffuser' in n or 'ceiling-center' in n or n=='floor-slab':target=12
   elif ob.get('semantic_role')=='rail':target=16
   elif ob.get('semantic_role')=='metal':target=12
   else:target=24
  else:
   if '-sculpted-upholstery' in n:target=28
   elif '-molded-shell' in n:target=12
   elif 'divider-rail' in n:target=14
   elif ob.get('semantic_role')=='rail':target=8
   elif 'window-' in n or 'door-' in n and ('seal' in n or 'shell' in n):target=16
   elif 'bicycle-sculpted' in n:target=16
   elif ob.get('semantic_role')=='glass':target=4
   elif ob.get('semantic_role')=='information':target=2
   else:target=8
  if n in ['floor-slab','gangway-bridge']:target=12
  deps=bpy.context.evaluated_depsgraph_get();ev=ob.evaluated_get(deps);me=ev.to_mesh();me.calc_loop_triangles();tris=len(me.loop_triangles);ev.to_mesh_clear()
  if tris>target:
   mod=ob.modifiers.new(f'Runtime LOD{lod} budget, editable','DECIMATE');mod.ratio=target/tris;mod.use_collapse_triangulate=True
  ob['lod_triangle_target']=target
 # LOD1 embeds inexpensive original downscaled maps; high-detail originals remain in master.
 if lod==1:
  for im in bpy.data.images:
   if im.type!='IMAGE' or not im.has_data:continue
   w,h=im.size;size=256 if 'information' in im.name else 64
   if w>size:im.scale(size,size);im.pack()
 bpy.context.scene['lod']=lod;bpy.context.scene['master_source']='mark-v-a-car-study.blend';bpy.context.scene['optimization']='Editable per-component decimation; secondary fittings omitted; no runtime integration'
 p=HERE/f'source/mark-v-a-car-interior.lod{lod}.blend';bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
 (HERE/f'qa/lod{lod}-omitted-components.json').write_text(json.dumps({'lod':lod,'removed':removed},indent=2)+'\n')
