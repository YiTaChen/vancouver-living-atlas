"""Actual exported GLB reimport -> CPU Cycles daylight evidence, not WebGL acceptance."""
import bpy,json,sys,math,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));from build import xyz,material
layout=json.loads((ROOT/'station-layout.json').read_text());results=[]
for s in layout['stations']:
 sid=s['stationId'];bpy.ops.wm.read_factory_settings(use_empty=True);path=ROOT/'exports'/f'{sid}.glb';bpy.ops.import_scene.gltf(filepath=str(path));imported=list(bpy.context.scene.objects);hidden=[]
 for o in imported:
  if o.get('semanticRole') in ['removable-roof','wall']:
   o.hide_render=True;hidden.append(o.name)
 # Human reference at an actual platform waiting point, 1.81m floor-to-top.
 feet=s['platforms'][0]['doorAlignmentPoints'][0]['stationWaitingPointM']
 for name,p,sz in [('human-body',[feet[0],feet[1]+.95,feet[2]],[.43,.68,.2]),('human-leg1',[feet[0]-.11,feet[1]+.37,feet[2]],[.14,.74,.15]),('human-leg2',[feet[0]+.11,feet[1]+.37,feet[2]],[.14,.74,.15]),('human-head',[feet[0],feet[1]+1.635,feet[2]],[.24,.35,.23])]:
  bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name='qa-'+name;o.dimensions=(sz[0],sz[2],sz[1]);o.data.materials.append(material('expo'))
 points=[o.matrix_world@Vector(v) for o in imported if o.type=='MESH' for v in o.bound_box];lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)];target=Vector([(a+b)/2 for a,b in zip(lo,hi)]);span=max(hi[i]-lo[i] for i in range(3));scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=20;scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.resolution_x=1100;scene.render.resolution_y=700;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('qa-daylight');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.73,.81,.91,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8;scene.view_settings.view_transform='AgX'
 bpy.ops.object.light_add(type='SUN',location=(0,0,60));sun=bpy.context.object;sun.data.energy=2;sun.data.angle=.5;sun.rotation_euler=(.3,-.5,-.5)
 bpy.ops.object.camera_add(location=target+Vector([span*.8,span*.95,span*.72]));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=span*1.35;scene.camera=cam
 # Reimport cutaway explicitly removes only removable roofs/back wall from this review.
 scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;out=ROOT/'qa/previews'/f'{sid}-cutaway.png';scene.render.filepath=str(out);bpy.ops.render.render(write_still=True)
 results.append({'stationId':sid,'file':str(out.relative_to(ROOT)),'sourceGlb':str(path.relative_to(ROOT)),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'renderer':'Blender Cycles CPU','samples':20,'view':'orthographic daylight cutaway','hiddenOnlyInPreview':hidden,'humanHeightM':1.81,'runtimeAcceptance':False})
 # Eye-level platform view retains imported source geometry except removable roof for light.
 p=s['platforms'][0];door=p['doorAlignmentPoints'][len(p['doorAlignmentPoints'])//2];f=door['stationWaitingPointM'];trackdir=p['stopPosition']['approachDirection'];eye=Vector(xyz([f[0]-trackdir[0]*12,f[1]+1.65,f[2]-trackdir[2]*12]));look=Vector(xyz([f[0]+trackdir[0]*15,f[1]+1.65,f[2]+trackdir[2]*15]));cam.location=eye;cam.rotation_euler=(look-eye).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.lens=25;scene.render.resolution_x=960;scene.render.resolution_y=600;out2=ROOT/'qa/previews'/f'{sid}-platform.png';scene.render.filepath=str(out2);bpy.ops.render.render(write_still=True);results.append({**results[-1],'file':str(out2.relative_to(ROOT)),'view':'platform eye-height 1.65m'})
(ROOT/'qa/previews/index.json').write_text(json.dumps({'status':'rendered','actualGLBReimport':True,'runtimeWebgl':'not_run','images':results},indent=2)+'\n')
