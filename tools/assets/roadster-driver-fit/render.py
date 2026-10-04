"""Real GLB reimport cutaways and local-module LOD evidence, Cycles CPU only.
All visibility cuts are QA-only and enumerated in render-evidence.json.
"""
import bpy,json,sys,hashlib,math
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2];OUT=HERE/'qa/previews';ARGS=sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else [];records=json.loads((HERE/'qa/render-evidence.json').read_text())if ARGS and (HERE/'qa/render-evidence.json').exists()else []
def material(name,c):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);return m
def reset():
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.fps=30;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24;s.cycles.use_denoising=False;s.cycles.max_bounces=4;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_percentage=100;s.view_settings.view_transform='AgX';s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB';s.world=bpy.data.worlds.new('QA world');s.world.use_nodes=True;return s
def lighting(s,condition):
 cfg={'sunny':((.65,.75,.85),.45,[((-3,-4,5),700,(1,.92,.82)),((3,1,4),500,(.8,.87,1))]),'overcast':((.74,.79,.84),.8,[((0,-2,6),650,(.84,.91,1))]),'dusk':((.22,.27,.40),.22,[((-3,-2,2),470,(1,.5,.23)),((2,3,4),300,(.4,.56,1))]),'night':((.035,.045,.085),.12,[((-2,-2,3),260,(.82,.9,1)),((2,3,2),220,(1,.63,.35))])}
 c,p,ls=cfg[condition];bg=s.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(*c,1);bg.inputs[1].default_value=p
 for i,(loc,power,col)in enumerate(ls):
  d=bpy.data.lights.new('QA light '+str(i),'AREA');d.energy=power;d.color=col;d.shape='DISK';d.size=3;o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.8))-o.location).to_track_quat('-Z','Y').to_euler()
def add(path,driver=False,offset=(0,0,0)):
 before=set(bpy.data.objects);actions=set(bpy.data.actions);bpy.ops.import_scene.gltf(filepath=str(path));obs=list(set(bpy.data.objects)-before)
 if driver:
  rig=next(o for o in obs if o.type=='ARMATURE');rig.animation_data.action=None
  for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
  imported_actions=list(set(bpy.data.actions)-actions)
  rig.animation_data.action=next(a for a in imported_actions if a.name.startswith('driver-seated')and any(f.data_path.startswith('pose.bones[')for f in a.fcurves))
  for ob in obs:
   if ob.type=='MESH'and ob.data.shape_keys and ob.data.shape_keys.animation_data:
    keys=ob.data.shape_keys;keys.animation_data.action=None
    for track in list(keys.animation_data.nla_tracks):keys.animation_data.nla_tracks.remove(track)
    for key in keys.key_blocks:key.value=0
    keys.animation_data.action=next(a for a in imported_actions if a.name.startswith('driver-seated')and any(f.data_path.startswith('key_blocks[')for f in a.fcurves))
  rig.location=Vector((.44,.06,0));bpy.context.scene.frame_set(15);bpy.context.view_layer.update()
  grips=[ob.data.shape_keys.key_blocks.get('DriverGrip')for ob in obs if ob.type=='MESH'and ob.data.shape_keys and ob.data.shape_keys.key_blocks.get('DriverGrip')]
  assert grips and all(abs(key.value-1)<1e-6 for key in grips),'Rendered DriverGrip must match actual exported seated clip weight1'
  fit=json.loads((HERE/'qa/driver-fit-lod0.json').read_text());assert fit['geometryContactStatus']=='pass'and fit['sourceHumanSha256']==hashlib.sha256(Path(path).read_bytes()).hexdigest(),'Render requires current passing morph-aware fit proof'
  deps=bpy.context.evaluated_depsgraph_get();points=[]
  for ob in obs:
   if ob.type=='MESH'and any(mod.type=='ARMATURE'and mod.object==rig for mod in ob.modifiers):
    ev=ob.evaluated_get(deps);points.extend(ev.matrix_world@v.co for v in ev.data.vertices)
  actual={'min':[min((p.x,p.z,-p.y)[k]for p in points)for k in range(3)],'max':[max((p.x,p.z,-p.y)[k]for p in points)for k in range(3)]}
  assert all(abs(actual[edge][k]-fit['posedBoundsM'][edge][k])<1e-4 for edge in ['min','max']for k in range(3)),('Blender/Three evaluated pose mismatch',actual,fit['posedBoundsM'])
  bpy.context.scene['driverPosedBoundsGltf']=json.dumps(actual)


 elif any(offset):
  for o in obs:
   if not o.parent:o.location+=Vector(offset)
 bpy.context.view_layer.update();return obs
def camera(s,loc,target,scale,w=800,h=560):
 d=bpy.data.cameras.new('QA camera');o=bpy.data.objects.new('QA camera',d);s.collection.objects.link(o);s.camera=o;o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=scale;s.render.resolution_x=w;s.render.resolution_y=h

def render(s,name,files,info):
 s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);records[:]=[r for r in records if r['file']!='qa/previews/'+name+'.png'];records.append({'camera':{'locationBlenderM':list(s.camera.location),'rotationEulerRad':list(s.camera.rotation_euler),'orthographicScaleM':s.camera.data.ortho_scale},'posedDriverBoundsGltf':json.loads(s['driverPosedBoundsGltf'])if s.get('driverPosedBoundsGltf')else None,'sampledMorphWeights':[{'mesh':o.name,'DriverGrip':o.data.shape_keys.key_blocks['DriverGrip'].value}for o in s.objects if o.type=='MESH'and o.data.shape_keys and o.data.shape_keys.key_blocks.get('DriverGrip')],'file':'qa/previews/'+name+'.png','renderer':'Cycles','device':'CPU','threads':2,'samples':24,'resolution':[s.render.resolution_x,s.render.resolution_y],'inputs':[{'file':str(p.relative_to(REPO)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in files],**info});(HERE/'qa/render-evidence.json').write_text(json.dumps(records,indent=2)+'\n')
car=HERE/'qa/candidate.semantic-inspection.glb';human=HERE.parent/'citizen-character-variants/exports/driver-roadster-fit.lod0.glb';module=HERE/'exports/roadster-cockpit-local.lod0.glb'
for view,loc,target,scale in ([] if '--module-only'in ARGS else [('full',(4,-5,3.0),(0,0,.7),5.3),('side',(4,-.15,1.25),(.44,-.18,.98),2.0),('support',(-3,.85,1.2),(.44,-.0,.96),1.18),('hands',(.44,-3,1.55),(.44,-.34,1.0),.80),('footwell',(2,-2,1.3),(.44,-.56,.68),1.18)]):
 requested=next((a.split('=',1)[1].split(',')for a in ARGS if a.startswith('--views=')),None)
 if requested and view not in requested:continue
 s=reset();obs=add(car);removed=[]
 if view!='full':
  keep=('driver-seat-','cabin-floor/','center-console/','dashboard-','driver-floor-','steering-')
  for o in obs:
   if o.type=='MESH' and not o.name.startswith(keep):removed.append(o.name);o.hide_render=True
  if view=='support':
   for o in obs:
    if o.type=='MESH' and (o.name.startswith(('dashboard-','steering-','driver-seat-bolster-','center-console/'))):o.hide_render=True;removed.append(o.name)
 add(human,True);lighting(s,'sunny');camera(s,loc,target,scale);render(s,'driver-'+view,[car,human],{'lighting':'sunny','clip':'driver-seated','seconds':.5,'scale':[1,1,1],'qaOnlyHiddenNodes':removed})
for light in ([] if '--driver-only'in ARGS else ['sunny','overcast','dusk','night']):
 s=reset();files=[]
 for lod,x in enumerate([-1.8,0,1.8]):
  p=HERE/'exports'/f'roadster-cockpit-local.lod{lod}.glb';files.append(p);add(p,offset=(x,0,0))
 lighting(s,light);camera(s,(3,-5,3.5),(.2,-.1,.68),5.8,960,480);render(s,'module-lods-'+light,files,{'lighting':light,'leftToRightLods':[0,1,2],'axis':'Blender +Z up from glTF Y-up import'})
print('RENDERED_COCKPIT_9_VIEWS')
