"""Actual GLB reimport CPU preview and animated bounds sampling."""
import bpy,sys,math,json,hashlib,importlib.util
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('preview',ROOT.parent/'city-life-pedestrians/render_previews.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
IDS=['commuter','raincoat','runner','tote'];report=[]
for pose,frame in [('idle',1),('walk',7),('sit',13),('guide',13)]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 for i,name in enumerate(IDS):
  file=ROOT/'exports'/('pedestrian-'+name+'.glb');before=set(bpy.data.objects);actions=set(bpy.data.actions)
  bpy.ops.import_scene.gltf(filepath=str(file));new=set(bpy.data.objects)-before;rig=next(o for o in new if o.type=='ARMATURE');mesh=next(o for o in new if o.type=='MESH')
  action=next(a for a in set(bpy.data.actions)-actions if a.name.startswith(pose+'_'))
  rig.animation_data.action=action
  for tr in rig.animation_data.nla_tracks:tr.mute=True
  bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
  dg=bpy.context.evaluated_depsgraph_get();ev=mesh.evaluated_get(dg);me=ev.to_mesh();pts=[ev.matrix_world@v.co for v in me.vertices];ev.to_mesh_clear()
  bounds={'min':[min(v[k] for v in pts) for k in range(3)],'max':[max(v[k] for v in pts) for k in range(3)]}
  report.append({'file':str(file.relative_to(ROOT)),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'pose':pose,'frame':frame,'blenderZUpBounds':bounds})
  for o in new:
   if o.parent is None:o.location.x+=i*1.15
  if pose=='sit':
   mat=p.material('QA-seat',(.38,.42,.46));p.box('QA-reference-seat',(i*1.15,.0,.38),(.5,.48,.08),mat)
  p.label(name,(i*1.15,-.8,.015),.12)
 scene=p.setup(5.6,(1.72,0,.90));scene.render.resolution_x=1100;scene.render.resolution_y=660;scene.cycles.samples=16
 scene.render.filepath=str(ROOT/'qa/previews'/(pose+'.png'));bpy.ops.render.render(write_still=True)
(ROOT/'qa/preview-evidence.json').write_text(json.dumps({'renderer':'Blender Cycles CPU','source':'actual exported GLB reimport','runtimeWebGL':'not_run','samples':report},indent=2)+'\n')
