"""Actual exported GLB reimports; compact Cycles CPU 2-thread evidence."""
import bpy,sys,json,math,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[2];OUT=ROOT/'qa/previews';OUT.mkdir(exist_ok=True)
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [];QUICK='--quick'in ARGS
FIT_ONLY='--driver-fit-only'in ARGS
POLICE_ONLY='--police-only'in ARGS
DRIVER_ONLY='--driver-only'in ARGS
NATURAL_ONLY='--natural-driver-fit-only'in ARGS
BASELINE_ONLY='--baseline-only'in ARGS
RESUME='--resume'in ARGS
KINDS=['driver-roadster-fit']if NATURAL_ONLY else (['police']if POLICE_ONLY else (['driver']if DRIVER_ONLY else (['citizen','police','driver']if BASELINE_ONLY else ['citizen','police','driver','driver-roadster-fit'])))
records=json.loads((ROOT/'qa/render-evidence.json').read_text()) if (FIT_ONLY or POLICE_ONLY or DRIVER_ONLY or NATURAL_ONLY or BASELINE_ONLY or RESUME) and (ROOT/'qa/render-evidence.json').exists() else []

def mat(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8;return m

def reset():
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.render.fps=30;sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=32;sc.cycles.use_denoising=False;sc.cycles.max_bounces=4;sc.render.threads_mode='FIXED';sc.render.threads=2;sc.render.resolution_percentage=100;sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGB';sc.world=bpy.data.worlds.new('Offline studio world');sc.world.use_nodes=True
 bpy.ops.mesh.primitive_plane_add(size=200);ob=bpy.context.object;ob.name='QA-only-ground';ob.location.z=-.008;ob.data.materials.append(mat('QA floor',(.20,.23,.25)))
 return sc

def lighting(sc,condition):
 for o in list(sc.objects):
  if o.type=='LIGHT':bpy.data.objects.remove(o,do_unlink=True)
 cfg={'sunny':((.65,.75,.85),.45,[((-3,-4,5),850,(1,.92,.82)),((3,1,4),650,(.8,.87,1))]),'overcast':((.74,.79,.84),.8,[((0,-2,6),550,(.84,.91,1))]),'dusk':((.22,.27,.40),.22,[((-3,-2,2),430,(1,.5,.23)),((2,3,4),270,(.4,.56,1))]),'night':((.035,.045,.085),.12,[((-2,-2,3),170,(.82,.9,1)),((2,3,2),150,(1,.63,.35))])}
 color,power,ls=cfg[condition];bg=sc.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(*color,1);bg.inputs[1].default_value=power
 for i,(loc,pow,col) in enumerate(ls):
  data=bpy.data.lights.new('QA-'+condition+str(i),'AREA');data.energy=pow;data.color=col;data.shape='DISK';data.size=4;ob=bpy.data.objects.new(data.name,data);sc.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=(Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()

def add(path,offset=(0,0,0),clip='idle',seconds=0):
 before=set(bpy.data.objects);beforeactions=set(bpy.data.actions);bpy.ops.import_scene.gltf(filepath=str(path));obs=list(set(bpy.data.objects)-before);rig=next((o for o in obs if o.type=='ARMATURE'),None)
 if rig:
  rig.animation_data.action=None
  for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
  actions=list(set(bpy.data.actions)-beforeactions);action=next((a for a in actions if a.name.startswith(clip)and any(f.data_path.startswith('pose.bones[')for f in a.fcurves)),None)
  if action:rig.animation_data.action=action
  for ob in obs:
   if ob.type=='MESH'and ob.data.shape_keys and ob.data.shape_keys.animation_data:
    keys=ob.data.shape_keys;keys.animation_data.action=None
    for t in list(keys.animation_data.nla_tracks):keys.animation_data.nla_tracks.remove(t)
    for key in keys.key_blocks:key.value=0
    ka=next((a for a in actions if a.name.startswith(clip)and any(f.data_path.startswith('key_blocks[')for f in a.fcurves)),None)
    if ka:keys.animation_data.action=ka
  rig.location+=Vector(offset)
  frame=seconds*30;bpy.context.scene.frame_set(int(frame),subframe=frame%1)
 bpy.context.view_layer.update();return obs,rig

def camera(sc,loc,target,scale=2.2,width=512,height=640):
 d=bpy.data.cameras.new('QA camera');o=bpy.data.objects.new('QA camera',d);sc.collection.objects.link(o);sc.camera=o;o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=scale;sc.render.resolution_x=width;sc.render.resolution_y=height

def text(label,loc,size=.07):
 d=bpy.data.curves.new(label,'FONT');d.body=label;d.size=size;d.align_x='CENTER';o=bpy.data.objects.new(label,d);bpy.context.scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(mat('QA text',(.6,.68,.72)))

def references():
 grey=mat('QA scale reference',(.11,.14,.17))
 for x,h in [(-.86,1.75),(.87,1.81)]:
  # Narrow neutral mannequin, exact top height; used for scale only.
  ratio=h/1.81
  shapes=[((x-.041,.20,.43*ratio),(.032,.034,.425*ratio)),((x+.041,.20,.43*ratio),(.032,.034,.425*ratio)),((x,.20,1.12*ratio),(.078,.043,.285*ratio)),((x,.20,1.475*ratio),(.022,.025,.075*ratio)),((x,.20,h-.095*ratio),(.065,.045,.095*ratio)),((x-.105,.20,1.10*ratio),(.025,.025,.29*ratio)),((x+.105,.20,1.10*ratio),(.025,.025,.29*ratio))]
  for loc,scale in shapes:
   bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=loc);ob=bpy.context.object;ob.scale=scale;ob.data.materials.append(grey)
  text(f'{h:.2f} m',(x,-.12,-.11),.06)
 bpy.ops.mesh.primitive_cube_add(size=1,location=(-.56,.18,.5));ob=bpy.context.object;ob.scale=(.016,.016,1);ob.data.materials.append(grey);text('1 m',(-.56,-.12,-.1),.05)

def render(sc,name,files,extra=None):
 if RESUME:
  expected=[{'file':str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in files]
  if (OUT/(name+'.png')).exists()and any(r['file']=='qa/previews/'+name+'.png'and r['inputs']==expected for r in records):
   print('SKIP_FRESH',name,flush=True);return
 morph_state=[{'mesh':o.name,'DriverGrip':o.data.shape_keys.key_blocks['DriverGrip'].value}for o in sc.objects if o.type=='MESH'and o.data.shape_keys and 'DriverGrip'in o.data.shape_keys.key_blocks]
 if any(p.name.startswith('driver-roadster-fit.')for p in files):assert morph_state and all(abs(m['DriverGrip']-1)<1e-6 for m in morph_state),'Rendered corrective does not match exported seated weight1'
 extra=dict(extra or {},morphState=morph_state)
 sc.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);records[:]=[r for r in records if r['file']!='qa/previews/'+name+'.png'];records.append({'file':'qa/previews/'+name+'.png','renderer':'Cycles','device':'CPU','threads':2,'samples':sc.cycles.samples,'resolution':[sc.render.resolution_x,sc.render.resolution_y],'inputs':[{'file':str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in files],**(extra or {})});(ROOT/'qa/render-evidence.json').write_text(json.dumps(records,indent=2));print('RENDERED',name,flush=True)

for kind in ([] if FIT_ONLY else KINDS):
 path=ROOT/'exports'/f'{kind}.lod0.glb'
 for view,loc in [('front',(0,-4,1.05)),('back',(0,4,1.05)),('side',(4,0,1.05))]:
  if QUICK and view!='front':continue
  sc=reset();clip='driver-seated' if kind.startswith('driver') else 'idle';add(path,clip=clip);lighting(sc,'sunny');references();camera(sc,loc,(0,0,.94),2.32,640,640);render(sc,f'{kind}-{view}',[path],{'clip':clip,'phase':0,'lighting':'sunny','scaleReferencesM':[1,1.75,1.81]})
if not QUICK and not FIT_ONLY:
 for kind in KINDS:
  for light in ['sunny','overcast','dusk','night']:
   sc=reset();files=[]
   for lod,x in enumerate([-.80,0,.80]):
    p=ROOT/'exports'/f'{kind}.lod{lod}.glb';files.append(p);add(p,(x,0,0),clip='driver-seated' if kind.startswith('driver') else 'idle');text('LOD '+str(lod),(x,-.23,-.1),.09)
   lighting(sc,light);camera(sc,(0,-4,1.1),(0,0,.91),3.1,960,640);render(sc,f'{kind}-lods-{light}',files,{'lighting':light,'sameViewLods':[0,1,2]})
 for phase in ([] if POLICE_ONLY or DRIVER_ONLY or NATURAL_ONLY else [.70,.775858,.85]):
  sc=reset();files=[]
  specimens=[('OLD LOD2',REPO/'tools/assets/citizen/optimization/glb/citizen-lod2.glb'),('BASELINE',REPO/'public/models/citizen/vancouver-citizen.glb'),('NEW LOD1',ROOT/'exports/citizen.lod1.glb'),('NEW LOD2',ROOT/'exports/citizen.lod2.glb')]
  for (label,p),x in zip(specimens,[-1.2,-.4,.4,1.2]):
   add(p,(x,0,0),clip='run',seconds=phase*.8);files.append(p)
  lighting(sc,'sunny');camera(sc,(0,4,1.14),(0,0,.92),3.4,1280,600);render(sc,'run-back-phase-'+str(phase),files,{'clip':'run','phase':phase,'leftToRight':[s[0] for s in specimens]})
 # Tighter critical waist deformation view; the same metric camera for all LODs.
 for lod in ([] if POLICE_ONLY or DRIVER_ONLY or NATURAL_ONLY else [0,1,2]):
  sc=reset();p=ROOT/'exports'/f'citizen.lod{lod}.glb';add(p,clip='run',seconds=.775858*.8);lighting(sc,'sunny');camera(sc,(0,3,1.00),(0,0,.91),.72,512,512);render(sc,f'citizen-lod{lod}-critical-waist',[p],{'clip':'run','phase':.775858,'lighting':'sunny','camera':'identical posterior waist crop'})
if not QUICK and not POLICE_ONLY and not NATURAL_ONLY:
 car=REPO/'tools/assets/material-consumer-candidates/qa/roadster.candidate.inspection.glb'
 if car.exists():
  for view,loc in [('side',(5,-.3,1.9)),('front',(-3,-4,2.4)),('hands',(.5,-2.2,1.9)),('cutaway',(1.65,-1.4,1.5))]:
   if FIT_ONLY and view!='cutaway':continue
   sc=reset();obs,_=add(car)
   for ob in obs:
    if 'driver-skin' in ob.name or 'driver-clothing'in ob.name or (view=='cutaway' and ('glass'in ob.name or 'paint'in ob.name)):bpy.data.objects.remove(ob,do_unlink=True)
   p=ROOT/'exports/driver.lod0.glb';add(p,(.44,.06,0),clip='driver-seated');lighting(sc,'sunny');camera(sc,loc,(.3,-.10,.89),(1.7 if view=='cutaway' else (4.7 if view!='hands' else 1.2)),900,600);render(sc,'driver-roadster-'+view,[car,p],{'clip':'driver-seated','roadsterScale':[1,1,1],'removedOnly':['roadster/driver-skin','roadster/driver-clothing']+(['paint-role surfaces','glass']if view=='cutaway' else []),'candidateRootTranslationGltf':[.44,0,-.06]})
