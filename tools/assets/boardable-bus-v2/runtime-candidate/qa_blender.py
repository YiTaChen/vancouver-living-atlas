"""Reopen/re-export editable derivative sources; CPU render ACTUAL reduced GLBs."""
import argparse,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from export import export_loaded
from geometry import C,load
MASTER=HERE.parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cv(p):return (p[0],-p[2],p[1])
def uv(p):return [p[0],p[2],-p[1]]
def imported_bounds():
 pts=[uv(o.matrix_world@v.co) for o in bpy.context.scene.objects if o.type=='MESH' for v in o.data.vertices];return {s:[f(p[k] for p in pts) for k in range(3)] for s,f in [('min',min),('max',max)]}
def sources():
 checks=[];masters={str(p):sha(p) for folder in ['source','exports'] for p in (MASTER/folder).glob('*') if p.suffix in ['.blend','.glb']}
 with tempfile.TemporaryDirectory(prefix='bus-runtime-source-qa-') as temp:
  td=Path(temp)
  for p in sorted((HERE/'source').glob('*.blend')):
   before=sha(p);bpy.ops.wm.open_mainfile(filepath=str(p));mesh_count=sum(o.type=='MESH' for o in bpy.context.scene.objects);mods=sum(len(o.modifiers) for o in bpy.context.scene.objects);out=td/(p.stem+'.glb');export_loaded(out);actual=HERE/'exports'/out.name
   need=sha(out)==sha(actual);assert need,'Reexport must reproduce final GLB bytes';assert sha(out.with_suffix('.components.json'))==sha(actual.with_suffix('.components.json')),'Sidecar reexport mismatch';assert sha(p)==before
   bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(actual));bpy.context.view_layer.update();bounds=imported_bounds();measured=C.measure_glb(actual)
   assert all(abs(bounds[s][k]-measured['boundsM'][s][k])<1e-5 for s in ['min','max'] for k in range(3));assert not any(o.type in ['LIGHT','CAMERA'] for o in bpy.context.scene.objects)
   checks.append({'source':'source/'+p.name,'sha256':before,'editableMeshObjects':mesh_count,'editableModifiers':mods,'sourceUnchanged':True,'reexportBinaryIdentical':True,'sidecarBinaryIdentical':True,'deliveredGLBReimport':'pass','boundsM':bounds,'sourceBytes':p.stat().st_size})
  p=HERE/'source/city-bus-12m-interior-v2-runtime.lod0.blend';bpy.ops.wm.open_mainfile(filepath=str(p));o=bpy.data.objects['seat-01-cushion']
  for v in o.data.vertices:v.co.z+=.012
  save=td/'artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(save),compress=True);bpy.ops.wm.open_mainfile(filepath=str(save));out=td/'artist-edit.glb';export_loaded(out);scene,_,_=load(out);assert abs(max(p[1] for p in scene['seat-01-cushion']['points'])-(1.13+.012))<2e-5
 assert all(sha(Path(p))==h for p,h in masters.items()),'Detailed master changed'
 (HERE/'qa/blender-validation.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'scope':'Offline source reopen/reexport and actual reduced GLB import','sourceChecks':checks,'artistEditProbe':{'status':'pass','component':'seat-01-cushion','offsetM':.012,'savedCopyReopened':True,'masterAndCandidateSourcesUnchanged':True},'detailedMasterHashes':masters,'WebGL':'not_run'},indent=2)+'\n')

def setup(lod,cut=False,exterior=True):
 bpy.ops.wm.read_factory_settings(use_empty=True);paths=[HERE/f'exports/city-bus-12m-interior-v2-runtime.lod{lod}.glb']
 if exterior:paths.append(MASTER.parent/f'boardable-bus/exports/city-bus-12m-exterior.lod{lod}.glb')
 for p in paths:bpy.ops.import_scene.gltf(filepath=str(p))
 old=json.loads((MASTER.parent/'boardable-bus/manifest.json').read_text())
 for d in old['vehicles'][0]['doors']:
  o=bpy.data.objects.get(d['nodeId'])
  if o:o.animation_data_clear();o.location=cv(d['openTransform']['translationM'])
 if cut:
  for o in list(bpy.context.scene.objects):
   if o.type!='MESH':continue
   bm=bmesh.new();bm.from_mesh(o.data);fs=[f for f in bm.faces if all((o.matrix_world@v.co).z>2.22 for v in f.verts)];bmesh.ops.delete(bm,geom=fs,context='FACES');bm.to_mesh(o.data);bm.free()
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=False;s.cycles.use_adaptive_sampling=True;s.cycles.adaptive_threshold=.03;s.render.threads_mode='FIXED';s.render.threads=6;s.cycles.max_bounces=4;s.cycles.diffuse_bounces=2;s.cycles.glossy_bounces=2;s.cycles.sample_clamp_indirect=3;s.render.resolution_x=896;s.render.resolution_y=598;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False;s.view_settings.view_transform='AgX'
 s.world=bpy.data.worlds.new('Daytime QA world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.74,.82,1,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.85
 for side in [-1,1]:
  for z in [-4,0,4]:
   d=bpy.data.lights.new('QA daylight window bounce','AREA');d.energy=220;d.shape='DISK';d.size=3;o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=cv((side*3.5,3,z));o.rotation_euler=(Vector(cv((0,1.5,z)))-o.location).to_track_quat('-Z','Y').to_euler()
 if cut:
  d=bpy.data.lights.new('QA daylight overhead','AREA');d.energy=700;d.size=9;o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=(0,0,8)
 return paths

def previews():
 index=[]
 shots=[('front-lowfloor-looking-front-lod0',0,[0,1.8,.15],[.10,1.40,4.90],18,None,False,True),('front-priority-overview-lod1',1,[0,1.87,4.12],[0,1.03,.65],20,None,False,True),('cutaway-layout-lod0',0,[8.2,8.8,11.0],[0,1.0,.1],22,14,True,False),('cutaway-layout-lod1',1,[8.2,8.8,11.0],[0,1.0,.1],22,14,True,False)]
 for name,lod,eye,target,lens,ortho,cut,ext in shots:
  paths=setup(lod,cut,ext);s=bpy.context.scene;d=bpy.data.cameras.new('QA camera');o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=cv(eye);o.rotation_euler=(Vector(cv(target))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;d.clip_start=.03;d.clip_end=60
  if ortho:d.type='ORTHO';d.ortho_scale=ortho
  s.camera=o;s.render.filepath=str(HERE/'qa/previews'/(name+'.png'));bpy.ops.render.render(write_still=True)
  index.append({'file':name+'.png','sha256':sha(Path(s.render.filepath)),'renderer':'Cycles CPU','samples':32,'resolution':[896,598],'lod':lod,'actualGLBInputs':[{'file':str(p.relative_to(HERE)) if p.is_relative_to(HERE) else '../../boardable-bus/exports/'+p.name,'sha256':sha(p)} for p in paths],'eyeVehicleM':eye,'targetVehicleM':target,'qaOnlyCeilingCut':cut,'lighting':'daytime QA only, unchanged linear PBR and AgX exposure','WebGL':'not_run'});print('RUNTIME_CANDIDATE_RENDER_DONE',name,flush=True)
  (HERE/'qa/previews/index.json').write_text(json.dumps({'status':'rendered_awaiting_visual_review','scope':'actual reduced GLB reimport, CPU offline only','renders':index},indent=2)+'\n')
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--sources-only',action='store_true');ap.add_argument('--previews-only',action='store_true');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if not a.previews_only:sources()
 if not a.sources_only:previews()
