"""Reopen .blend, re-export, reimport delivered GLBs; render daylight CPU evidence."""
import argparse, hashlib, importlib.util, json, math, sys, tempfile
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from export import export_loaded
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cv(p):return (p[0],-p[2],p[1])
def uv(p):return [p[0],p[2],-p[1]]
def bounds():
 ps=[uv(o.matrix_world@v.co) for o in bpy.context.scene.objects if o.type=='MESH' for v in o.data.vertices]
 return {s:[f(p[k] for p in ps) for k in range(3)] for s,f in [('min',min),('max',max)]}
def sources():
 out=[];reimports=[]
 with tempfile.TemporaryDirectory(prefix='bus-v2-qa-') as td:
  for p in sorted((HERE/'source').glob('*.blend')):
   before=sha(p);bpy.ops.wm.open_mainfile(filepath=str(p));count=sum(o.type=='MESH' for o in bpy.data.objects);mods=sum(len(o.modifiers) for o in bpy.data.objects)
   ex=Path(td)/(p.stem+'.glb');export_loaded(ex);actual=HERE/'exports'/ex.name
   mr=C.measure_glb(ex);delivered=C.measure_glb(actual)
   for k in ['triangles','vertices','primitives','boundsM']:assert mr[k]==delivered[k],('reexport',k)
   assert sha(p)==before
   out.append({'source':'source/'+p.name,'sourceSha256':before,'editableMeshObjects':count,'editableModifiers':mods,'geometryEquivalent':True,'binaryIdentical':sha(ex)==sha(actual),'sourceUnchanged':True})
   bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(actual));bpy.context.view_layer.update();r=bounds()
   assert all(abs(r[s][k]-delivered['boundsM'][s][k])<1e-5 for s in ['min','max'] for k in range(3))
   assert not any(o.type in ['LIGHT','CAMERA'] for o in bpy.context.scene.objects)
   reimports.append({'file':'exports/'+actual.name,'sha256':sha(actual),'boundsM':r,'status':'pass','exportedCamerasAndLights':0})
  originals={p:sha(p) for p in (HERE/'source').glob('*.blend')}
  p=HERE/'source/city-bus-12m-interior-v2.lod0.blend';bpy.ops.wm.open_mainfile(filepath=str(p));ob=bpy.data.objects['seat-01-cushion']
  for v in ob.data.vertices:v.co.z+=.012
  ob['artist_edit_probe']='cushion raised 12 mm'
  save=Path(td)/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(save),compress=True);bpy.ops.wm.open_mainfile(filepath=str(save));ex=Path(td)/'edited.glb';export_loaded(ex)
  d,b=C.read_glb(ex);r=next(r for n in d['nodes'] for r in n.get('extras',{}).get('componentRanges',[]) if r['componentId']=='seat-01-cushion')
  assert abs(r['boundsM']['max'][1]-(.68+.45+.012))<1e-5
  assert any(n.get('extras',{}).get('artist_edit_probe') for n in d['nodes'])
  assert all(sha(p)==digest for p,digest in originals.items()),'Artist edit probe changed original source'
 report={'status':'pass','blenderVersion':bpy.app.version_string,'scope':'editable-source reopening, geometry-preserving reexport, delivered GLB reimport; no WebGL','sourceChecks':out,'reimports':reimports,'editPreservationProbe':{'status':'pass','component':'seat-01-cushion','deltaM':.012,'originalsUnchanged':True,'savedCopyReopened':True,'extrasPreserved':True}}
 (HERE/'qa/blender-validation.json').write_text(json.dumps(report,indent=2)+'\n')

def setup(lod=0,cut=False,exterior=True):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 paths=[HERE/f'exports/city-bus-12m-interior-v2.lod{lod}.glb']
 if exterior:paths.append(HERE.parent/f'boardable-bus/exports/city-bus-12m-exterior.lod{lod}.glb')
 for p in paths:bpy.ops.import_scene.gltf(filepath=str(p))
 # Exact open transforms from the unchanged exterior package; QA pose only.
 old=json.loads((HERE.parent/'boardable-bus/manifest.json').read_text())
 for d in old['vehicles'][0]['doors']:
  o=bpy.data.objects.get(d['nodeId'])
  if o:o.animation_data_clear();o.location=cv(d['openTransform']['translationM'])
 if cut:
  for o in list(bpy.context.scene.objects):
   if o.type!='MESH':continue
   bm=bmesh.new();bm.from_mesh(o.data)
   fs=[f for f in bm.faces if all((o.matrix_world@v.co).z>2.22 for v in f.verts)]
   bmesh.ops.delete(bm,geom=fs,context='FACES');bm.to_mesh(o.data);bm.free()
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=48;s.cycles.use_denoising=False;s.cycles.use_adaptive_sampling=True;s.cycles.adaptive_threshold=.03;s.render.threads_mode='FIXED';s.render.threads=8;s.cycles.max_bounces=4;s.cycles.diffuse_bounces=2;s.cycles.glossy_bounces=2;s.cycles.sample_clamp_indirect=3
 s.render.resolution_x=1024;s.render.resolution_y=683;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False;s.view_settings.view_transform='AgX';s.view_settings.exposure=0
 s.world=bpy.data.worlds.new('Daytime QA world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.74,.82,1,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.85
 for side in [-1,1]:
  for z in [-4,0,4]:
   d=bpy.data.lights.new('QA daylight window bounce','AREA');d.energy=220;d.shape='DISK';d.size=3;o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=cv((side*3.5,3,z));o.rotation_euler=(Vector(cv((0,1.5,z)))-o.location).to_track_quat('-Z','Y').to_euler()
 if cut:
  d=bpy.data.lights.new('QA daylight overhead','AREA');d.energy=700;d.size=9;o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=(0,0,8)
 return paths
RENDERS=[]
def render(name,eye,target,lens=22,ortho=None,lod=0,cut=False,exterior=True):
 paths=setup(lod,cut,exterior);s=bpy.context.scene;d=bpy.data.cameras.new('QA camera');o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=cv(eye);o.rotation_euler=(Vector(cv(target))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;d.clip_start=.03;d.clip_end=60
 if ortho:d.type='ORTHO';d.ortho_scale=ortho
 s.camera=o;s.render.filepath=str(HERE/'qa/previews'/(name+'.png'));bpy.ops.render.render(write_still=True)
 RENDERS.append({'file':name+'.png','sha256':sha(Path(s.render.filepath)),'renderer':'Cycles CPU','samples':48,'resolution':[1024,683],'lighting':'daytime QA only','colorManagement':'AgX','exposure':0,'denoising':False,'maximumBounces':4,'adaptiveThreshold':.03,'actualGLBInputs':[{'file':str(p.relative_to(HERE.parent)),'sha256':sha(p)} for p in paths],'eyeVehicleM':eye,'targetVehicleM':target,'qaOnlyCeilingCut':cut,'runtimeOrWebGL':False})
 print('BUS_V2_RENDER_DONE',name,flush=True)
def previews(quick=False):
 render('front-lowfloor-looking-front',[0,1.80,.15],[.10,1.40,4.90],lens=18)
 render('front-priority-overview',[0,1.87,4.12],[0,1.03,.65],lens=20)
 render('front-looking-rear-lod0',[0,1.87,4.40],[0,1.53,-4.65],lens=20)
 render('rear-looking-front-lod0',[0,2.03,-4.77],[0,1.52,4.8],lens=20)
 if not quick:
  render('wheelchair-and-rear-door',[-.04,1.72,1.10],[-.85,1.15,-.7],lens=19)
  render('front-door-driver',[-2.0,1.65,4.275],[.50,1.35,4.85],lens=23)
  render('rear-steps-detail',[0,1.48,-.55],[0,1.03,-3.7],lens=22)
  render('cutaway-layout',[8.2,8.8,11.0],[0,1.0,.1],ortho=14,cut=True,exterior=False)
  render('front-looking-rear-lod1',[0,1.87,4.40],[0,1.53,-4.65],lens=20,lod=1)
 (HERE/'qa/previews/index.json').write_text(json.dumps({'status':'rendered_awaiting_visual_review','scope':'actual GLB CPU daylight renders, not runtime acceptance','renders':RENDERS},indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--previews-only',action='store_true');p.add_argument('--sources-only',action='store_true');p.add_argument('--quick',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if not a.previews_only:sources()
 if not a.sources_only:previews(a.quick)
