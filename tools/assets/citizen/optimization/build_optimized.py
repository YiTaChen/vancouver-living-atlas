"""blender -b -t 4 --python tools/assets/citizen/optimization/build_optimized.py
Reconstruct editable rigged baseline from shipped GLB, generate protected LOD candidates.
No public/runtime files are changed. Blender 4.3.2 tested.
"""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[3];INPUT=REPO/'public/models/citizen/vancouver-citizen.glb'
for d in ['source','glb','textures','qa']:(ROOT/d).mkdir(exist_ok=True)
report={'source':str(INPUT.relative_to(REPO)),'sourceSha256':hashlib.sha256(INPUT.read_bytes()).hexdigest(),'blender':bpy.app.version_string,'assets':[]}
def load():
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.import_scene.gltf(filepath=str(INPUT))
 sc=bpy.context.scene;sc.render.fps=30;sc.unit_settings.system='METRIC'
 rig=next(o for o in sc.objects if o.type=='ARMATURE');mesh=next(o for o in sc.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers))
 rig.animation_data.action=None
 for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
 for a in bpy.data.actions:
  a.name=a.name.split('_CitizenRig')[0];a.use_fake_user=True
  for f in a.fcurves:
   for k in f.keyframe_points:k.co.x*=1.25;k.handle_left.x*=1.25;k.handle_right.x*=1.25
 for p in rig.pose.bones:p.matrix_basis.identity()
 sc.frame_set(0);bpy.context.view_layer.update();return sc,rig,mesh

def studio(sc):
 sc.render.engine='CYCLES';sc.cycles.samples=48;sc.cycles.use_denoising=False
 sc.render.resolution_x=640;sc.render.resolution_y=720;sc.render.resolution_percentage=100
 sc.world=bpy.data.worlds.new('QA world');sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.25,.3,1);sc.world.node_tree.nodes['Background'].inputs[1].default_value=.45
 for name,loc,power in [('Key',(-3,-4,5),650),('Fill',(3,-1,3),380),('Rim',(1,3,4),850)]:
  d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=4;o=bpy.data.objects.new(name,d);sc.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.9))-o.location).to_track_quat('-Z','Y').to_euler()
 d=bpy.data.cameras.new('QA camera');o=bpy.data.objects.new('QA camera',d);sc.collection.objects.link(o);sc.camera=o;d.type='ORTHO';d.ortho_scale=2.08
 sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG'
def render(sc,rig,name):
 for view,loc,action,frame in [('front',(2,-5,2.0),'idle',0),('run-back',(-2,5,1.9),'run',18.62),('walk',(2,-5,2.0),'walk',6)]:
  rig.animation_data.action=bpy.data.actions[action];sc.frame_set(int(frame),subframe=frame%1);sc.camera.location=loc;sc.camera.rotation_euler=(Vector((0,0,.92))-sc.camera.location).to_track_quat('-Z','Y').to_euler();sc.render.filepath=str(ROOT/'qa'/f'{name}-{view}.png');bpy.ops.render.render(write_still=True)
 rig.animation_data.action=None
 for p in rig.pose.bones:p.matrix_basis.identity()
 sc.frame_set(0);bpy.context.view_layer.update()
for name,size,ratio in [('reference',2048,1),('lod0',1024,1),('lod1',1024,.65),('lod2',512,.45)]:
 sc,rig,mesh=load()
 if ratio<1:
  bpy.context.view_layer.objects.active=mesh;mesh.select_set(True)
  # Weld glTF seam duplicates; Blender UV loops retain atlas coordinates.
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=0.000001);bpy.ops.object.mode_set(mode='OBJECT')
  # Separate ONLY the two large continuous shell/denim components. All
  # face, hair, hands, footwear, collar, backpack and accessory topology stays.
  adj=[[] for v in mesh.data.vertices]
  for edge in mesh.data.edges:
   x,y=edge.vertices;adj[x].append(y);adj[y].append(x)
  seen=set();body=set()
  for v in mesh.data.vertices:
   if v.index in seen:continue
   comp={v.index};stack=[v.index];seen.add(v.index)
   while stack:
    for j in adj[stack.pop()]:
     if j not in seen:seen.add(j);comp.add(j);stack.append(j)
   if len(comp)>3000:body.update(comp)
  bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);bpy.context.view_layer.objects.active=mesh
  bpy.context.tool_settings.mesh_select_mode=(True,False,False)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
  for v in mesh.data.vertices:v.select=v.index in body
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT')
  part=next(o for o in bpy.context.selected_objects if o!=mesh);assert len(part.data.vertices)==len(body), (len(part.data.vertices),len(body));bpy.context.view_layer.objects.active=part
  mod=part.modifiers.new('Shell and denim only LOD','DECIMATE');mod.ratio=ratio
  bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name)
  mesh.select_set(True);part.select_set(True);bpy.context.view_layer.objects.active=mesh;bpy.ops.object.join()
  for v in mesh.data.vertices:
   co=mesh.matrix_world@v.co
   # Re-evaluate the original analytic shared pelvis weights after collapse.
   if .835<co.z<.98 and abs(co.x)<.17 and abs(co.y)<.135:
    thigh=max(0,min(1,(.98-co.z)/.19));blend=max(0,min(1,(co.z-.73)/.09));left=blend*(.5+.5*math.tanh(co.x/.045))+(1-blend)*(1 if co.x>=0 else 0)
    for g in mesh.vertex_groups:g.remove([v.index])
    for n,w in {'hips':1-thigh,'thighL':thigh*left,'thighR':thigh*(1-left)}.items():mesh.vertex_groups[n].add([v.index],w,'REPLACE')
   w=[(x.group,x.weight) for x in v.groups];s=sum(x[1] for x in w)
   if s:
    for ix,weight in w:mesh.vertex_groups[ix].add([v.index],weight/s,'REPLACE')
 for im in bpy.data.images:
  if im.size[0] and im.name.startswith('Citizen_'):
   if im.size[0]!=size:im.scale(size,size)
   im.filepath_raw=str(ROOT/'textures'/f'{im.name}-{size}.png');im.file_format='PNG';im.save();im.pack()
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);mesh.select_set(True);bpy.context.view_layer.objects.active=rig
 if name!='reference':bpy.ops.export_scene.gltf(filepath=str(ROOT/'glb'/f'citizen-{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_skins=True,export_yup=True,export_image_format='AUTO',export_apply=False,export_extras=True,export_frame_range=False)
 mesh.data.calc_loop_triangles();item={'id':name,'triangles':len(mesh.data.loop_triangles),'vertices':len(mesh.data.vertices),'bones':len(rig.data.bones),'materials':len(mesh.data.materials),'textureSize':size,'estimatedRgba8MipTextureMiB':3*size*size*4*4/3/1024**2,'glbBytes':(ROOT/'glb'/f'citizen-{name}.glb').stat().st_size if name!='reference' else INPUT.stat().st_size}
 studio(sc);bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'citizen-{name}.blend'),compress=True);render(sc,rig,name)
 report['assets'].append(item);(ROOT/'manifest.json').write_text(json.dumps(report,indent=2));print('ASSET_DONE',item,flush=True)
