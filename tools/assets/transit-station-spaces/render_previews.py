"""Small Cycles CPU evidence from actual exported GLBs; never runtime/browser QA."""
import json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import ROOT,IDS,clean,xyz,box,cyl,COLORS
from contract import C,dump
OUT=ROOT/'qa/previews';OUT.mkdir(exist_ok=True)
COLORS.update({'qa-human':(.29,.40,.46,1),'qa-scale':(.81,.11,.055,1),'qa-ground':(.43,.46,.44,1),'qa-rail':(.15,.17,.18,1)})
rows=[]
REQUESTED=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
OLD_ROWS=json.loads((OUT/'index.json').read_text())['images'] if REQUESTED and (OUT/'index.json').exists() else []
def import_asset(path,p=[0,0,0],yaw=0,doors=None,rotation=None):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=list(set(bpy.context.scene.objects)-before);root=bpy.data.objects.new('qa-import-frame',None);bpy.context.collection.objects.link(root)
 for o in obs:
  if o.parent is None:o.parent=root
 if doors:
  for d in doors:
   for o in obs:
    if o.name==d['nodeId'] or o.name.startswith(d['nodeId']+'.'):o.location=xyz(d['openTransform']['translationM'])
 root.location=xyz(p)
 if rotation is None:root.rotation_euler.z=yaw
 else:
  x,y,z,w=rotation;root.rotation_mode='QUATERNION';root.rotation_quaternion=(w,x,-z,y)
 return obs

def human(x,z,h=1.81,y=0):
 # QA-only schematic human with 46cm shoulders, exact overall reference height.
 box('qa-human-torso',(x,y+h*.60,z),(.40,h*.30,.20),'qa-human',.03)
 for sx in [-1,1]:
  box('qa-human-leg',(x+sx*.105,y+h*.245,z),(.13,h*.49,.16),'qa-human',.02)
  box('qa-human-arm',(x+sx*.245,y+h*.59,z),(.09,h*.32,.11),'qa-human',.02)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=h*.08,location=xyz([x,y+h*.92,z]));o=bpy.context.object;o.name='qa-human-head';from build import mat;o.data.materials.append(mat('qa-human'))
def ruler(x,z,y=0):
 box('qa-one-metre-ruler',(x,y+.5,z),(.035,1,.035),'qa-scale')
 for h in [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1]:box('qa-ruler-tick',(x+.04,y+h,z),(.11,.009,.035),'qa-scale')
def label(text,p,size=.23):
 bpy.ops.object.text_add(location=xyz(p));o=bpy.context.object;o.name='qa-label';o.data.body=text;o.data.size=size;o.data.extrude=0;o.rotation_euler=(math.pi/2,0,0);from build import mat;o.data.materials.append(mat('qa-rail'))
def setup(mode,cam,target,scale,res=(800,460)):
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=res[0];s.render.resolution_y=res[1];s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.world=bpy.data.worlds.new('qa-world');s.world.use_nodes=True
 vals={'sunny':(.7,2.0,(1,.91,.76)),'overcast':(.9,.55,(.84,.90,1)),'dusk':(.27,1.3,(1,.53,.25)),'night':(.09,.2,(.30,.43,.70))};world,sun,color=vals[mode];s.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.8,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=world
 bpy.ops.object.light_add(type='SUN',location=xyz([12,16,8]));l=bpy.context.object;l.name='qa-key';l.data.energy=sun;l.data.angle=.16 if mode=='sunny' else .7;l.data.color=color;l.rotation_euler=(math.radians(24),math.radians(-35),math.radians(25))
 for p,power,size,col in [([-5,7,8],450 if mode!='night' else 300,8,(.75,.85,1)),([8,5,-5],250 if mode!='night' else 180,6,(1,.89,.72))]:
  bpy.ops.object.light_add(type='AREA',location=xyz(p));l=bpy.context.object;l.name='qa-fill';l.data.energy=power;l.data.size=size;l.data.color=col;l.rotation_euler=(Vector(xyz(target))-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=xyz(cam));c=bpy.context.object;c.name='qa-camera';c.rotation_euler=(Vector(xyz(target))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=scale;s.camera=c

def render(name,mode,cam,target,scale,sources,lod=None,res=(800,460)):
 if REQUESTED and name not in REQUESTED:return
 setup(mode,cam,target,scale,res);s=bpy.context.scene;s.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True);rows.append({'file':name,'lighting':mode,'lod':lod,'renderer':'Cycles CPU','samples':32,'actualGlbSources':[{'path':str(p.relative_to(ROOT.parent)),'sha256':C.digest(p)} for p in sources],'qaReferences':{'rulerM':1,'humanHeightsM':[1.75,1.81]},'notBrowserAcceptance':True})
for lod in [0,1]:
 for mode in ['sunny','overcast','dusk','night']:
  clean();sources=[]
  for aid,x in zip(IDS,[-3.7,0,4.2]):
   p=ROOT/'exports'/f'{aid}.lod{lod}.glb';sources.append(p);import_asset(p,[x,0,0])
  for aid,x in [('bus-threshold-deck',-1.0),('metro-threshold-deck',1.2)]:
   p=ROOT/'exports'/f'{aid}.lod{lod}.glb';sources.append(p);import_asset(p,[x,.02,3.2])
  box('qa-ground',(0,-.05,0),(200,.1,200),'qa-ground');human(-1.1,2.05,1.75);human(.05,2.05,1.81);ruler(-2.5,2.05);label('1 m',[-2.85,.05,2.2]);label('1.75 / 1.81 m',[-1.50,.035,2.8]);render(f'modules-lod{lod}-{mode}.png',mode,[10,7.5,13],[.2,1,0],12.5,sources,lod)
# Local bus island composition references the shelter and bus actual GLBs.
layout=json.loads((ROOT/'station-layout.json').read_text());stop=layout['stops'][0];bus=json.loads((ROOT.parent/'boardable-bus/manifest.json').read_text());b=bus['vehicles'][0]
clean();sources=[]
for a in bus['assets']:
 p=ROOT.parent/'boardable-bus'/a['lods'][0]['file'];sources.append(p);import_asset(p,doors=b['doors'] if 'exterior' in a['id'] else None)
for i in stop['instances']:
 pkg=ROOT.parent/i['packageId'];p=pkg/'exports'/f"{i['assetId']}.lod0.glb";sources.append(p);import_asset(p,i['translationM'],math.pi/2)
for d in stop['doorAlignmentPoints']:
 deck=d['thresholdDeck'];p=ROOT/'exports'/(deck['assetId']+'.lod0.glb');sources.append(p);import_asset(p,deck['deployedTransform']['translationM'])
box('qa-ground',(0,-.05,0),(200,.1,200),'qa-ground');box('qa-descriptor-island',(-3.95,.18,0),(4.9,.36,14),'concrete');human(-2.55,4.275,1.81,.36);human(-3.8,2.2,1.75,.36);ruler(-3.7,4.8,.36);render('bus-island-alignment.png','sunny',[-14,11,15],[-2,1,0],20,sources)
render('bus-threshold-deployed.png','overcast',[-5.3,3.0,2.0],[-1.4,1.2,4.2],5.0,sources,res=(800,500))
# Full 74m research platform and 71.5m four-car consist, exact car transforms.
metro=json.loads((ROOT.parent/'boardable-metro/manifest.json').read_text());stop=layout['stops'][2];clean();sources=[]
for i in stop['instances']:
 p=ROOT/'exports'/f"{i['assetId']}.lod1.glb";sources.append(p);import_asset(p,i['translationM'],math.pi/2 if i['assetId']=='station-guidance-sign' else 0)
for car in metro['composition']['cars']:
 v=next(v for v in metro['vehicles'] if v['vehicleId']==car['vehicleId']);a=next(a for a in metro['assets'] if a['id']==v['assetRefs']['exterior']);p=ROOT.parent/'boardable-metro'/a['lods'][1]['file'];sources.append(p);import_asset(p,car['translationM'],doors=[d for d in v['doors'] if d['side']=='right'])
 a=next(a for a in metro['assets'] if a['id']==v['assetRefs']['interior']);p=ROOT.parent/'boardable-metro'/a['lods'][1]['file'];sources.append(p);import_asset(p,car['translationM'])
for d in stop['doorAlignmentPoints']:
 deck=d['thresholdDeck'];p=ROOT/'exports'/(deck['assetId']+'.lod0.glb');sources.append(p);import_asset(p,deck['deployedTransform']['translationM'])
box('qa-ground',(0,-.05,0),(250,.1,250),'qa-ground')
for x in [-.7175,.7175]:box('qa-rail',(x,.025,0),(.08,.05,81),'qa-rail')
human(-2.6,32.35,1.81,.95);human(-2.6,30.9,1.75,.95);ruler(-3.7,32,.95);render('four-car-platform-74m.png','overcast',[-65,48,57],[-1.5,1,0],84,list(dict.fromkeys(sources)),res=(1100,500))
# Close near-end view demonstrates scale and top-of-platform, using same imported output.
render('platform-human-scale.png','sunny',[-14,8,42],[-1.9,1.7,29],17,list(dict.fromkeys(sources)),res=(800,500))
render('metro-threshold-deployed.png','overcast',[-5.7,3.8,35.0],[-1.55,1.7,32.35],5.2,list(dict.fromkeys(sources)),res=(800,500))
# Stored poses: preserve the actual corrected Y and rotation, with QA-only X/Z
# offsets so both research floor levels can be inspected side by side.
clean();storage_sources=[]
for stop,x in [(layout['stops'][0],-1.0),(layout['stops'][2],1.0)]:
 deck=stop['doorAlignmentPoints'][0]['thresholdDeck'];t=deck['retractedTransform'];p=ROOT/'exports'/(deck['assetId']+'.lod0.glb');storage_sources.append(p)
 import_asset(p,[x,t['translationM'][1],0],rotation=t['rotationQuaternionXYZW'])
 floor=stop['floorHeightM'];box('qa-research-support',(x,floor/2,0),(.8,floor,1.5),'concrete');label(('BUS .36m' if stop['kind']=='bus-stop' else 'RAIL .95m'),[x-.65,.03,1.15],.16)
box('qa-ground',(0,-.05,0),(100,.1,100),'qa-ground');human(-2.3,0,1.75);human(2.4,0,1.81);ruler(-.1,1.8)
render('stored-deck-contact.png','overcast',[7,4.7,8],[0,1,0],7.5,storage_sources,res=(800,480))
if REQUESTED:rows=[r for r in OLD_ROWS if r['file'] not in REQUESTED]+rows
dump('qa/previews/index.json',{'status':'rendered','renderer':'Blender 4.3.2 Cycles CPU','scope':'Actual GLB reimport evidence; local research only. Ground, island descriptors, schematic rail, people, ruler and lighting are QA-only.','lightingConditions':['sunny','overcast','dusk','night'],'imageCount':len(rows),'images':rows})
