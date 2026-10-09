"""Show real train, station and bridge GLBs at one representative interface per line."""
import bpy,json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));from build import xyz
L=json.loads((ROOT/'station-layout.json').read_text());rows=[]
def import_at(path,t=[0,0,0],q=[0,0,0,1]):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(path));objs=list(set(bpy.context.scene.objects)-before);root=bpy.data.objects.new('qa-placement',None);bpy.context.collection.objects.link(root)
 for o in objs:
  if o.parent is None:o.parent=root
 root.location=xyz(t);x,y,z,w=q;root.rotation_mode='QUATERNION';root.rotation_quaternion=(w,x,-z,y);return objs
for line,sid,pkg in [('canada','vancouver-city-centre','canada-line-stage2'),('expo','main-street-science-world','boardable-metro')]:
 s=next(s for s in L['stations'] if s['stationId']==sid);p=s['platforms'][0];d=p['doorAlignmentPoints'][0];bridge=next(b for b in s['thresholdBridges'] if b['instanceId']==d['thresholdBridgeId']);bpy.ops.wm.read_factory_settings(use_empty=True);station=ROOT/'exports'/f'{sid}.glb';obs=import_at(station);deck=next(o for o in obs if o.name==bridge['nodeId']);sources=[station]
 for o in obs:
  if o.get('semanticRole') in ['removable-roof','wall']:o.hide_render=True
 m=json.loads((ROOT.parent/pkg/'manifest.json').read_text());v=m['vehicles'][0];car=d['carPoseInConsist'];pos=[p['stopPosition']['translationM'][k]+car['translationM'][k] for k in range(3)];carobs=[]
 for role in ['exterior','interior']:
  a=next(a for a in m['assets'] if a['id']==v['assetRefs'][role]);f=ROOT.parent/pkg/a['lods'][0]['file'];sources.append(f);carobs+=import_at(f,pos,car['rotationQuaternionXYZW'])
 for door in v['doors']:
  if door['side']==d['carLocalSide']:
   o=next(o for o in carobs if o.name==door['nodeId']);o.location=xyz(door['openTransform']['translationM'])
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.resolution_x=800;scene.render.resolution_y=560;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('qa-day');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[1].default_value=.9;scene.view_settings.view_transform='AgX';bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=2;bpy.context.object.rotation_euler=(.4,-.7,.4)
 side=1 if d['consistLocalSillPointM'][0]>0 else -1;x,y,z=d['platformEdgePointM'];target=Vector(xyz([x-side*.10,y+.04,z]));bpy.ops.object.camera_add(location=xyz([x+side*2.0,y+1.65,z+1.8]));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.6;scene.camera=cam
 bpy.ops.object.light_add(type='AREA',location=xyz([x+side*1.2,y+3.0,z+.6]));fill=bpy.context.object;fill.name='qa-only-doorway-softbox';fill.data.energy=650;fill.data.shape='DISK';fill.data.size=3;fill.rotation_euler=(target-fill.location).to_track_quat('-Z','Y').to_euler()
 for pose in ['stored','deployed']:
  t=bridge[pose+'Transform'];deck.location=xyz(t['translationM']);qx,qy,qz,qw=t['rotationQuaternionXYZW'];deck.rotation_mode='QUATERNION';deck.rotation_quaternion=(qw,qx,-qz,qy);out=ROOT/'qa/previews'/f'{line}-bridge-{pose}.png';scene.render.filepath=str(out);scene.render.image_settings.file_format='PNG';bpy.ops.render.render(write_still=True);rows.append({'line':line,'pose':pose,'file':str(out.relative_to(ROOT)),'actualGlbSources':[{'path':str(f.relative_to(ROOT.parent)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sources],'stationBridgeInstance':bridge['instanceId'],'doors':'paired side fully open for both evidence views','renderer':'Blender Cycles CPU','qaOnlyLighting':'650W 3m doorway softbox; not in export','runtimeAcceptance':False})
(ROOT/'qa/previews/threshold-index.json').write_text(json.dumps({'status':'rendered','images':rows},indent=2)+'\n')
