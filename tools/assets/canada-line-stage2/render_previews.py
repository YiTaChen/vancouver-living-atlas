"""Cycles CPU views of reimported delivered GLBs; QA rigs are never shipped."""
import bpy,sys,json,math,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import common,vehicle
OUT=ROOT/'qa/previews';OUT.mkdir(exist_ok=True);consist_only='--consist-only' in sys.argv;records=json.loads((ROOT/'qa/render-report.json').read_text())['renders'] if consist_only else []
def B(p):return Vector((p[0],-p[2],p[1]))
def setup(lod=0,interior=True,opened=False,section=False,consist=False):
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=800;s.render.resolution_y=480;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.63,.70,.80,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.7
 sun=bpy.data.lights.new('QA-daylight','SUN');sun.energy=2;sun.angle=.18;o=bpy.data.objects.new('QA-daylight',sun);bpy.context.collection.objects.link(o);o.rotation_euler=(.5,-.4,-.6)
 paths=[ROOT/'exports'/f'canada-line-endcar-exterior.lod{lod}.glb']
 if interior:paths.append(ROOT/'exports'/f'canada-line-shared-interior.lod{min(lod,1)}.glb')
 for p in paths:bpy.ops.import_scene.gltf(filepath=str(p))
 if opened:
  for d in vehicle()['doors']:bpy.data.objects[d['nodeId']].location=B(d['openTransform']['translationM'])
 if consist:
  roots=[o for o in s.objects if o.parent is None and o.type=='EMPTY']
  for root in roots:root.location=B([0,0,10.5])
  first=set(s.objects)
  for p in paths:bpy.ops.import_scene.gltf(filepath=str(p))
  for root in set(s.objects)-first:
   if root.parent is None:root.location=B([0,0,-10.5]);root.rotation_mode='XYZ';root.rotation_euler=(0,0,math.pi)
 if section:
  for obj in list(s.objects):
   if obj.type!='MESH':continue
   matrix=obj.matrix_world.copy();mesh=obj.data;mesh.transform(matrix);obj.parent=None;obj.matrix_world.identity();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,0),plane_no=(1,0,0),clear_inner=True);bm.to_mesh(mesh);bm.free()
 mat=bpy.data.materials.new('QA-ground');mat.diffuse_color=(.22,.26,.29,1);bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.015));bpy.context.object.name='QA-ground';bpy.context.object.data.materials.append(mat)
 if interior:
  for z in [-7,-2,3,8]:
   light=bpy.data.lights.new('QA-interior-softbox','AREA');light.energy=140;light.shape='RECTANGLE';light.size=1.4;light.size_y=4;o=bpy.data.objects.new('QA-interior-softbox',light);bpy.context.collection.objects.link(o);o.location=B([0,3.42,z])
 s.view_settings.view_transform='AgX';return [str(p.relative_to(ROOT)) for p in paths]
def person():
 mat=bpy.data.materials.new('QA-human-1.80m');mat.diffuse_color=(.83,.30,.06,1)
 for p,d in [([-1.83,2.1,0],[.30,.65,.22]),([-1.91,1.43,0],[.12,.66,.17]),([-1.75,1.43,0],[.12,.66,.17]),([-1.83,2.77,0],[.22,.26,.22]),([-2.04,2.1,0],[.08,.65,.18]),([-1.62,2.1,0],[.08,.65,.18])]:
  bpy.ops.mesh.primitive_cube_add(size=1,location=B(p));o=bpy.context.object;o.dimensions=(d[0],d[2],d[1]);o.data.materials.append(mat)
 bpy.ops.mesh.primitive_cube_add(size=1,location=B([-2,1.05,0]));o=bpy.context.object;o.dimensions=(1.0,3,.10);o.data.materials.append(mat)
def render(name,inputs,eye,target,ortho=None,note=''):
 s=bpy.context.scene;cam=bpy.data.cameras.new('QA-camera');obj=bpy.data.objects.new('QA-camera',cam);bpy.context.collection.objects.link(obj);obj.location=B(eye);obj.rotation_euler=(B(target)-obj.location).to_track_quat('-Z','Y').to_euler();s.camera=obj;cam.clip_start=.025;cam.clip_end=350;cam.lens=20
 if ortho:cam.type='ORTHO';cam.ortho_scale=ortho
 s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);records[:]=[r for r in records if r['file']!='previews/'+name+'.png'];records.append({'file':'previews/'+name+'.png','sourceGlbSha256':{p:common.digest(ROOT/p) for p in inputs},'renderer':'Cycles','device':'CPU','samples':32,'resolution':[800,480],'cameraGlTFM':eye,'targetGlTFM':target,'orthoScale':ortho,'note':note})
inputs=setup(consist=True);render('two-car-consist',inputs,[-30,12,37],[0,1.8,0],48,'Two independent car transforms; car02 yaw pi. Runtime articulation not implemented.')
if consist_only:
 (ROOT/'qa/render-report.json').write_text(json.dumps({'status':'rendered','blenderVersion':bpy.app.version_string,'runtimeWebGL':'not_run','renders':records},indent=2)+'\n');sys.exit(0)
for lod in [0,1,2]:
 inputs=setup(lod=lod,interior=False);render(f'exterior-lod{lod}',inputs,[-19,8,19],[0,1.8,0],24)
inputs=setup();render('observation-front',inputs,[0,2.4,16],[0,2.1,9.4],4.7)
inputs=setup(opened=True);render('interior-aisle',inputs,[0,2.72,-9.7],[0,2.30,8.5],None,'Camera in actual car-local aisle; ceiling and cantilevered seats visible.')
inputs=setup(opened=True,section=True);render('longitudinal-section',inputs,[-17,8,17],[0,2,0],24,'CPU bisect of actual GLB at x=0 for inspection only.')
for opened in [False,True]:
 inputs=setup(opened=opened);render('door-'+('open' if opened else 'closed'),inputs,[-4.6,2.6,0],[0,2.1,0],4.5,'Actual manifest leaf endpoints applied' if opened else 'Delivered closed rest pose')
inputs=setup(opened=True);person();render('boarding-human-scale',inputs,[-6.5,3.6,4.3],[-1,2.0,0],6.2,'QA-only 1.80m person standing on floor/platform Y1.10')
inputs=setup(opened=True);render('gangway',inputs,[0,2.6,-11.4],[0,2.0,-7.5],None,'Rear opening is real; moving intercar traversal remains disabled.')
(ROOT/'qa/render-report.json').write_text(json.dumps({'status':'rendered','blenderVersion':bpy.app.version_string,'runtimeWebGL':'not_run','renders':records},indent=2)+'\n')
