"""Compact actual-GLB reimports, Cycles CPU; never runtime/WebGL evidence."""
import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
SPECS=json.loads((HERE/'designs.json').read_text())
SILLS=json.loads((HERE/'sill-designs.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8;return m
def box(name,loc,size,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name='QA-'+name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o
def label(text,loc,size=.09):
 bpy.ops.object.text_add(location=loc,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name='QA-label';o.data.body=text;o.data.size=size;o.data.extrude=0;o.data.materials.append(mat('QA-text',(.12,.15,.18)))
def human(x,height,m):
 # Measurement reference only; dimensions span exactly floor to labelled height.
 box('person-legs',(x,-.18,height*.22),(.22,.14,height*.44),m);box('person-torso',(x,-.18,height*.61),(.38,.18,height*.34),m)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=height*.09,location=(x,-.18,height*.91));bpy.context.object.name='QA-head';bpy.context.object.data.materials.append(m)
 label(f'{height:.2f} m',(x-.23,-.40,-.16),.09)
def area(location,target,power,color,size):
 bpy.ops.object.light_add(type='AREA',location=location);o=bpy.context.object;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
images=[];hashes={}
for aid,d in SPECS.items():
 w=d['openingWidthM']+2*d['sectionM'];h=d['openingHeightM']+2*d['sectionM']
 for lod in [0,1]:
  glb=HERE/'exports'/f'{aid}.lod{lod}.glb';hashes[str(glb.relative_to(HERE))]=sha(glb);sillglb=HERE/'exports'/f'{aid.replace("surround","paired-sill")}.lod{lod}.glb';hashes[str(sillglb.relative_to(HERE))]=sha(sillglb)
  for view,lighting in [('oblique',l) for l in ['clear','overcast','dusk','night']]+[('front','clear'),('rear','clear')]:
   bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));bpy.ops.import_scene.gltf(filepath=str(sillglb));objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==2
   for o in objects:o.location.z+=.13
   floor=mat('QA-floor',(.62,.65,.67));reference=mat('QA-person',(.24,.33,.37));box('floor',(.5,0,-.04),(12,10,.04),floor)
   human(w/2+.65,1.75,reference);human(w/2+1.25,1.81,reference)
   ruler=mat('QA-ruler',(.8,.53,.12));tick=mat('QA-tick',(.12,.14,.16));x=-w/2-.4
   box('one-metre-ruler',(x,-.22,.5),(.06,.04,1),ruler)
   for i in range(11):box('ruler-tick',(x+.035,-.25,i*.1),(.10 if i in [0,5,10] else .065,.015,.008),tick)
   label('1 m',(x-.13,-.29,1.07),.1)
   label(f'{aid} | LOD{lod}',(-w/2,-.45,h+.41),.11)
   label(f'{view} / {lighting} | clear {d["openingWidthM"]:.4f} x {d["openingHeightM"]:.4f} m',(-w/2,-.45,h+.25),.075)
   center=Vector((.35,0,max(h+.13,1.81)/2));camera_offset={'front':(0,-8,.0),'oblique':(3,-8,2.3),'rear':(2.5,8,2)}[view]
   bpy.ops.object.camera_add(location=center+Vector(camera_offset));cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=w+2.35
   scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.cycles.use_denoising=False;scene.render.resolution_x=512;scene.render.resolution_y=352;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.exposure=0
   scene.world=bpy.data.worlds.new('QA-world');scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');params={'clear':(.45,900,(1,.94,.84),4),'overcast':(.5,600,(.88,.94,1),7),'dusk':(.13,420,(1,.49,.22),4),'night':(.035,150,(.8,.9,1),3)};strength,power,color,size=params[lighting];bg.inputs['Color'].default_value=(.66,.75,.86,1);bg.inputs['Strength'].default_value=strength
   area((2,-4,6),center,power,color,size);area((-3,2,4),center,power*.55,(.70,.81,1),5)
   relative=f'qa/previews/{aid}.paired.lod{lod}.{view}.{lighting}.png';scene.render.filepath=str(HERE/relative);bpy.ops.render.render(write_still=True)
   images.append({'assetId':aid,'lod':lod,'view':view,'lighting':lighting,'file':relative,'sha256':sha(HERE/relative),'bytes':(HERE/relative).stat().st_size,'inputGlbSha256':sha(glb),'inputSillGlbSha256':sha(sillglb),'qaSharedRootLiftM':.13,'scaleReferencesM':[1,1.75,1.81],'engine':'Cycles','device':'CPU','resolution':[512,352],'samples':16,'exposure':0})
(HERE/'qa/assembly-preview-index.json').write_text(json.dumps({'status':'pass','scope':'offline optional frame plus new paired sill, illustrative four lights and identical camera/scale paired LODs; not actual city lighting nor WebGL acceptance','inputGlbSha256':hashes,'images':images,'visualReview':{'status':'pending'}},indent=2)+'\n')
print('RENDERED',len(images))
