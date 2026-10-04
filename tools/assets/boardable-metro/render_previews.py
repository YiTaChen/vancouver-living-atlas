"""Only actual exported GLBs are imported; Cycles CPU, 640px, 8 samples, 2 threads."""
import bpy,math,sys,json,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import vehicle,common
OUT=ROOT/'qa/previews';OUT.mkdir(exist_ok=True)
repair='--repair-framing' in sys.argv
interior_only='--interior-only' in sys.argv
records=json.loads((ROOT/'qa/render-report.json').read_text())['renders'] if repair or interior_only else []
def B(p):return Vector((p[0],-p[2],p[1]))
def setup(variant='lead',lod=0,interior=False,opened=False,condition='clear',section=False):
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=8;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=640;s.render.resolution_y=400;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False
 s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True
 col,strength={'clear':((.68,.79,.91),.7),'overcast':((.67,.71,.76),.8),'dusk':((.19,.23,.36),.28),'night':((.03,.05,.10),.09)}[condition];s.world.node_tree.nodes['Background'].inputs[0].default_value=(*col,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=strength
 sun=bpy.data.lights.new('QA-sun','SUN');sun.energy={'clear':2,'overcast':.35,'dusk':.65,'night':.08}[condition];sun.angle=.15;obj=bpy.data.objects.new('QA-sun',sun);bpy.context.collection.objects.link(obj);obj.rotation_euler=(.45,-.5,-.6)
 if condition=='dusk':sun.color=(1,.52,.25)
 path=ROOT/'exports'/f'expo-metro-{variant}-exterior.lod{lod}.glb';bpy.ops.import_scene.gltf(filepath=str(path));inputs=[str(path.relative_to(ROOT))]
 if interior:
  p=ROOT/'exports'/f'expo-metro-shared-interior.lod{min(lod,1)}.glb';bpy.ops.import_scene.gltf(filepath=str(p));inputs.append(str(p.relative_to(ROOT)))
 if opened:
  for d in vehicle(variant)['doors']:bpy.data.objects[d['nodeId']].location=B(d['openTransform']['translationM'])
 if section:
  for obj in list(s.objects):
   if obj.type!='MESH':continue
   matrix=obj.matrix_world.copy();mesh=obj.data;mesh.transform(matrix);obj.parent=None;obj.matrix_world.identity();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,0),plane_no=(1,0,0),clear_inner=True);bm.to_mesh(mesh);bm.free()
 # QA ground and cabin light are never exported.
 mat=bpy.data.materials.new('QA-ground');mat.diffuse_color=(.28,.31,.32,1)
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));bpy.context.object.name='QA-ground';bpy.context.object.data.materials.append(mat)
 if interior:
  for z in [-6,0,6]:
   light=bpy.data.lights.new('QA-interior-softbox','AREA');light.energy=70 if condition=='night' else 110;light.shape='RECTANGLE';light.size=1.6;light.size_y=4;o=bpy.data.objects.new('QA-interior-softbox',light);bpy.context.collection.objects.link(o);o.location=B([0,3.075,z])
 s.view_settings.view_transform='AgX';return inputs

def render(name,eye,target,ortho=None,inputs=None,condition='clear',note=''):
 global records
 if interior_only and not any('interior' in p for p in inputs):return
 if repair and not (('-lod' in name and any(name.endswith('-'+v) for v in ['front','rear','top'])) or name.endswith('-scale-reference')):return
 records=[r for r in records if r['file']!='previews/'+name+'.png']
 s=bpy.context.scene;cam=bpy.data.cameras.new('QA-camera');obj=bpy.data.objects.new('QA-camera',cam);bpy.context.collection.objects.link(obj);obj.location=B(eye);direction=B(target)-obj.location;obj.rotation_euler=direction.to_track_quat('-Z','Y').to_euler();s.camera=obj
 if ortho:cam.type='ORTHO';cam.ortho_scale=ortho
 else:cam.lens=18;cam.sensor_width=36
 cam.clip_start=.025;cam.clip_end=300;s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);records.append({'file':'previews/'+name+'.png','inputs':inputs,'sourceGlbSha256':{p:common.digest(ROOT/p) for p in inputs},'condition':condition,'cameraGlTFM':eye,'targetGlTFM':target,'orthoScale':ortho,'renderer':'Cycles','device':'CPU','samples':8,'resolution':[640,400],'threads':2,'note':note});bpy.data.objects.remove(obj,do_unlink=True)

def references():
 m=bpy.data.materials.new('QA-human');m.diffuse_color=(.8,.28,.07,1)
 for i,h in enumerate([1.75,1.81]):
  x=-2.1-i*.68;z=-5.5
  for p,size in [([x,.95+h*.575,z],[.33,h*.45,.24]),([x-.085,.95+h*.175,z],[.12,h*.35,.16]),([x+.085,.95+h*.175,z],[.12,h*.35,.16]),([x-.20,.95+h*.59,z],[.07,h*.38,.16]),([x+.20,.95+h*.59,z],[.07,h*.38,.16]),([x,.95+h*.9,z],[.23,h*.2,.23])]:
   bpy.ops.mesh.primitive_cube_add(size=1,location=B(p));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);o.data.materials.append(m)
 bpy.ops.mesh.primitive_cube_add(size=1,location=B([-2.6,.90,-5.5]));o=bpy.context.object;o.dimensions=(2,.0+3,.10)
 for i in range(10):
  bpy.ops.mesh.primitive_cube_add(size=1,location=B([-3.5,.95+.05+i*.1,-5.5]));o=bpy.context.object;o.dimensions=(.06,.06,.1);o.data.materials.append(m if i%2 else bpy.data.materials['QA-ground'])

for variant in ['lead','middle','tail']:
 for lod in range(3):
  inputs=setup(variant,lod)
  for view,eye,target,scale in [('front',[0,2.0,22],[0,1.65,0],6.4),('side',[-22,5,0],[0,1.65,0],19.5),('rear',[0,2.0,-22],[0,1.65,0],6.4),('top',[0,25,.001],[0,0,0],30.4)]:render(f'{variant}-lod{lod}-{view}',eye,target,scale,inputs)
 for condition in ['clear','overcast','dusk','night']:
  inputs=setup(variant,0,True,condition=condition);render(f'{variant}-{condition}',[-14,8,15],[0,1.7,0],20,inputs,condition)
 for opened in [False,True]:
  inputs=setup(variant,0,True,opened);render(f'{variant}-doors-'+('open' if opened else 'closed'),[-5.2,2.4,-5.5],[0,1.8,-5.5],5.2,inputs,note='Paired door local transforms applied from manifest; static train.')
 inputs=setup(variant,0,True,True);render(f'{variant}-aisle',[0,2.5,-8.0],[0,2.1,8.0],None,inputs)
 inputs=setup(variant,0,True,True,section=True);render(f'{variant}-section',[-11,7,10],[0,1.6,0],19,inputs,note='Longitudinal bisection of reimported GLB at X=0; no authored substitute mesh.')
 inputs=setup(variant,0,True,True)
 for d in vehicle(variant)['doors'][::2]:
  sign=d['outwardNormal'][0];z=d['boardingPointM'][2];render(f'{variant}-entry-'+d['openingId'],[sign*2.2,2.55,z],[0,2.0,z],None,inputs)
 for seat in vehicle(variant)['seats']:
  p=seat['cameraEyePointM'];render(f'{variant}-'+seat['seatId']+'-eye',p,[-p[0],1.9,p[2]+.15],None,inputs,note='Camera exactly at metadata seat eye; pelvis is a separate anchor.')
 inputs=setup(variant,0,True,True);references();render(f'{variant}-scale-reference',[-8,4.5,-2.8],[-1.6,1.75,-5.5],6,inputs,note='QA-only 1m ruler and 1.75m/1.81m figures stand on reference platform Y=.95.')
# Shared detailed/intermediate cabin LOD pair, same seat/aisle perspective.
for lod in [0,1]:
 inputs=setup('middle',lod,True,True);render(f'interior-lod{lod}-aisle',[0,2.5,-8],[0,2.1,8],None,inputs)
(ROOT/'qa/render-report.json').write_text(json.dumps({'status':'rendered','renderer':'Cycles CPU','blenderVersion':bpy.app.version_string,'samples':8,'threads':2,'renders':records,'runtimeWeatherMatch':False},indent=2)+'\n')
