"""Compact Cycles CPU evidence from actual delivered GLBs, never source meshes."""
import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent

def xyz(p):return(p[0],-p[2],p[1])
def mat(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.7;return m

def cube(name,c,d,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(c));o=bpy.context.object;o.name=name;o.dimensions=(d[0],d[2],d[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o

def sphere(name,c,d,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=xyz(c));o=bpy.context.object;o.name=name;o.scale=(d[0]/2,d[2]/2,d[1]/2);o.data.materials.append(m);return o

def human(x,z,h,m):
 f=h/1.8
 for dx in [-.105,.105]:cube('QA-human-leg',(x+dx*f,.47*f,z),(.15*f,.94*f,.18*f),m)
 cube('QA-human-torso',(x,1.21*f,z),(.44*f,.56*f,.23*f),m)
 for dx in [-.30,.30]:cube('QA-human-arm',(x+dx*f,1.13*f,z),(.12*f,.63*f,.14*f),m)
 sphere('QA-human-head',(x,1.665*f,z),(.25*f,.27*f,.25*f),m)

def look(o,target):o.rotation_euler=(Vector(xyz(target))-o.location).to_track_quat('-Z','Y').to_euler()

def setup(aid,levels,condition):
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=640;s.render.resolution_y=420;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX'
 for i,lod in enumerate(levels):
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(HERE/'exports'/f'{aid}.lod{lod}.glb'));offset=(i-(len(levels)-1)/2)*2.6
  for o in set(bpy.data.objects)-before:
   if o.parent is None:o.location.x+=offset
 m=mat('QA-ground',(.35,.38,.40));cube('QA-ground',(0,-.04,0),(40,.08,40),m);h1=mat('QA-human-175',(.30,.21,.12));h2=mat('QA-human-181',(.26,.28,.31));human(2.05+len(levels)*.30,2.9,1.75,h1);human(1.35+len(levels)*.30,3.7,1.81,h2)
 black=mat('QA-ruler',(.025,.028,.03));white=mat('QA-ruler-mark',(.85,.88,.9));x=-1.45-(len(levels)-1)*1.3;cube('QA-one-metre-ruler',(x,.5,2.8),(.04,1,.04),black)
 for i in range(11):cube('QA-ruler-tick',(x+.05,i*.1,2.8),(.14 if i%5==0 else .08,.013,.045),white)
 world=bpy.data.worlds.new('QA-offline-lighting');s.world=world;world.use_nodes=True;bg=world.node_tree.nodes['Background']
 params={'sunny':((.65,.76,.90),.55,(1,.94,.85),3.0),'overcast':((.73,.79,.88),.65,(.85,.92,1),1.2),'dusk':((.26,.34,.52),.35,(1,.47,.21),2.3),'night':((.09,.14,.24),.16,(.50,.69,1),.5)};wc,ws,lc,energy=params[condition];bg.inputs['Color'].default_value=(*wc,1);bg.inputs['Strength'].default_value=ws
 ld=bpy.data.lights.new('QA-sun','SUN');lo=bpy.data.objects.new('QA-sun',ld);s.collection.objects.link(lo);lo.rotation_euler=(math.radians(28),math.radians(-25),math.radians(-25));ld.energy=energy;ld.color=lc;ld.angle=.10 if condition=='sunny' else .7
 fill=bpy.data.lights.new('QA-softbox','AREA');ob=bpy.data.objects.new('QA-softbox',fill);s.collection.objects.link(ob);ob.location=xyz((3,5,4));look(ob,(0,.7,0));fill.energy=80 if condition!='night' else 40;fill.shape='DISK';fill.size=5
 camera=bpy.data.cameras.new('QA-camera');cam=bpy.data.objects.new('QA-camera',camera);s.collection.objects.link(cam);s.camera=cam;camera.type='ORTHO';camera.ortho_scale=7.8 if len(levels)==1 else 10.3
 return s,cam
records=[]
for aid in ['traffic-sedan','traffic-suv']:
 for view,pos in [('front',(0,2.6,10)),('side',(10,4.0,0)),('rear',(0,2.6,-10)),('top',(.001,12,.001))]:
  s,cam=setup(aid,[0],'sunny');cam.location=xyz(pos);look(cam,(.35,.7,.45));name=f'{aid}-{view}.png';s.render.filepath=str(HERE/'qa/previews'/name);bpy.ops.render.render(write_still=True);records.append({'file':'qa/previews/'+name,'assetId':aid,'lods':[0],'view':view,'light':'sunny'})
 for levels in [[0,1],[1,2]]:
  s,cam=setup(aid,levels,'sunny');cam.location=xyz((7,5,9));look(cam,(.3,.7,.5));name=f'{aid}-lod{levels[0]}-lod{levels[1]}.png';s.render.filepath=str(HERE/'qa/previews'/name);bpy.ops.render.render(write_still=True);records.append({'file':'qa/previews/'+name,'assetId':aid,'lods':levels,'view':'same-view-pair','light':'sunny','leftLod':levels[0],'rightLod':levels[1]})
 for cond in ['sunny','overcast','dusk','night']:
  s,cam=setup(aid,[0],cond);cam.location=xyz((6,3.8,8));look(cam,(.35,.8,.45));name=f'{aid}-{cond}.png';s.render.filepath=str(HERE/'qa/previews'/name);bpy.ops.render.render(write_still=True);records.append({'file':'qa/previews/'+name,'assetId':aid,'lods':[0],'view':'three-quarter','light':cond})
for record in records:
 p=HERE/record['file'];record['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();record['bytes']=p.stat().st_size
(HERE/'qa/preview-index.json').write_text(json.dumps({'status':'rendered_pending_visual_review','engine':'Cycles','device':'CPU','threads':2,'samples':24,'resolution':[640,420],'source':'actual delivered GLB imported into blank scene per image','inputGlbSha256':{str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE/'exports').glob('*.glb'))},'qaReferences':{'rulerM':1,'humanHeightsM':[1.75,1.81],'runtimeExported':False},'lighting':'offline research only; not city weather, WebGL, or GPU acceptance','images':records},indent=2)+'\n');print('CAR_PREVIEWS_RENDERED')
