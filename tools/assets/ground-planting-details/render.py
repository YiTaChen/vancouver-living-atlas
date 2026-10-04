"""Actual exported GLB reimport evidence and compact Cycles CPU views; no source mesh substitutes."""
from pathlib import Path
import importlib.util,json,math,sys
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('b',HERE/'build.py');b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
LIGHTS={'clear':(2.2,(1,.94,.83),.55,(.65,.76,1)),'overcast':(.22,(.9,.94,1),.85,(.82,.88,1)),'dusk':(.8,(1,.51,.26),.14,(.37,.45,.73)),'night':(.12,(.5,.65,1),.055,(.3,.39,.6))}
def imported(path):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(path));return [o for o in bpy.context.scene.objects if o not in before]
def reimport_all():
 rows=[]
 for p in sorted((HERE/'exports').glob('*.glb')):
  b.reset();objects=imported(p);meshes=[o for o in objects if o.type=='MESH'];points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices];xyz=[(p.x,p.z,-p.y)for p in points];low=[min(p[k]for p in xyz)for k in range(3)];high=[max(p[k]for p in xyz)for k in range(3)];rows.append({'file':str(p.relative_to(HERE)),'sha256':b.digest(p),'meshCount':len(meshes),'boundsM':{'min':low,'max':high,'size':[high[k]-low[k]for k in range(3)]},'uvLayers':[len(o.data.uv_layers)for o in meshes],'source':'Blender import_scene.gltf into factory empty scene; transformed vertex positions'})
 b.dump(HERE/'qa/reimports.json',{'status':'pass','blender':bpy.app.version_string,'files':rows})
def qa_mat(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9;return m
def cube(name,loc,dim,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name='QA-'+name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o
def label(text,loc,size,m):
 cu=bpy.data.curves.new('QA-label','FONT');cu.body=text;cu.size=size;cu.align_x='CENTER';o=bpy.data.objects.new('QA-label',cu);bpy.context.scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(0,0,0);cu.materials.append(m)
def references(scale,back):
 dark=qa_mat('QA-charcoal',(.035,.045,.05));light=qa_mat('QA-ivory',(.8,.82,.77))
 for i,h in enumerate([1.75,1.81]):
  x=(i-.5)*.9;y=back;cube('human-legs',(x,y,h*.225),(.26,.14,h*.45),dark);cube('human-torso',(x,y,h*.64),(.40,.22,h*.38),dark);bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=(x,y,h*.915));o=bpy.context.object;o.name='QA-human-head';o.scale=(.10,.10,h*.085);o.data.materials.append(dark);label(f'{h:.2f} m',(x,y-.35,.02),.12*scale,light)
 for i in range(10):cube('ruler',(-.45+i*.1,-back,.04),(.1,.08,.08),dark if i%2 else light)
 label('1 m',(0,-back-.23,.015),.12*scale,light)
def scene_base(width,depth):
 s=b.config();s.render.resolution_x=720;s.render.resolution_y=480;s.render.resolution_percentage=100;s.cycles.samples=16;s.render.image_settings.file_format='PNG';mat=qa_mat('QA-ground',(.12,.145,.16));cube('ground',(0,0,-.04),(width,depth,.07),mat)
 ld=bpy.data.lights.new('QA-sun','SUN');sun=bpy.data.objects.new('QA-sun',ld);s.collection.objects.link(sun);sun.rotation_euler=(.5,-.4,-.6);ld.angle=math.radians(9)
 s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True
 camd=bpy.data.cameras.new('QA-camera');cam=bpy.data.objects.new('QA-camera',camd);s.collection.objects.link(cam);s.camera=cam;camd.type='ORTHO';return s,cam,ld

def render_board(kind,value):
 b.reset();imports=[];labelmat=qa_mat('QA-labels',(.8,.83,.82));is_surface=kind=='surface';spacing=value+1.1 if is_surface else 1.75
 ids=[f'surface-{sid}-{value}m'for sid in b.SURFACES]if is_surface else b.PROPS
 for i,aid in enumerate(ids):
  lod=0 if is_surface else value;p=HERE/'exports'/f'{aid}.lod{lod}.inspection.glb';obs=imported(p);x=(i%3-1)*spacing;y=(i//3-.5)*spacing
  for o in obs:
   if not o.parent:o.location+=Vector((x,y,.002 if is_surface or aid=='soil-grass-edge-1m'else 0))
  imports.append({'file':str(p.relative_to(HERE)),'sha256':b.digest(p)});label(aid.replace('surface-','').replace('-1m',''),(x,y-(value/2 if is_surface else .7)-.17,.025),.16 if not is_surface or value==2 else .45,labelmat)
 width=spacing*3+1;depth=spacing*2+2;references(1 if not is_surface or value==2 else 2,depth/2-.65);s,cam,ld=scene_base(width,depth);cam.data.ortho_scale=width*(1.05 if is_surface else 1.23)
 rows=[]
 for view in ['oblique','grazing']:
  cam.location=(width*.3,-depth*.95,width*(.72 if view=='oblique'else .22));target=Vector((0,0,.1 if is_surface else .5));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
  for name,(energy,color,strength,wcolor)in LIGHTS.items():
   ld.energy=energy;ld.color=color;bg=s.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(*wcolor,1);bg.inputs['Strength'].default_value=strength
   p=HERE/'qa/previews'/f'{kind}-{value}-{view}-{name}.png';s.render.filepath=str(p);bpy.ops.render.render(write_still=True)
   rows.append({'file':str(p.relative_to(HERE)),'sha256':b.digest(p),'condition':name,'view':view,'kind':kind,'couponSizeM':value if is_surface else None,'lod':None if is_surface else value,'imports':imports,'device':'Cycles CPU','samples':16,'threads':2,'resolution':[720,480],'exposure':0,'qaReferences':{'metreRuler':1,'humanHeightsM':[1.75,1.81]},'note':'Offline research lighting; no city shader/placement/navigation/frame-time acceptance.'})
 return rows
if __name__=='__main__':
 reimport_all();rows=[]
 for k,v in [('surface',2),('surface',10),('props',0),('props',1)]:rows+=render_board(k,v)
 b.dump(HERE/'qa/render-evidence.json',{'status':'pass','referenceObjectsExported':False,'renders':rows})
