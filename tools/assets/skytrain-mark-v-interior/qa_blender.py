"""CPU rendering and reopen/edit/reexport checks against delivered GLB bytes."""
import argparse,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));from export import export_loaded
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def cv(p):return (p[0],-p[2],p[1])
def source_checks():
 report=[]
 with tempfile.TemporaryDirectory(prefix='mark-v-qa-') as td:
  for p in sorted((HERE/'source').glob('*.blend')):
   before=sha(p);bpy.ops.wm.open_mainfile(filepath=str(p));meshes=sum(o.type=='MESH' for o in bpy.data.objects);modifiers=sum(len(o.modifiers) for o in bpy.data.objects)
   out=Path(td)/(p.stem+'.glb');export_loaded(out);delivered=HERE/'exports'/out.name
   a=C.measure_glb(out);b=C.measure_glb(delivered)
   for key in ['boundsM','triangles','vertices','primitives']:assert a[key]==b[key],key
   assert before==sha(p)
   report.append({'source':str(p.relative_to(HERE)),'sha256':before,'editableObjects':meshes,'editableModifiers':modifiers,'geometryEquivalent':True,'binaryIdentical':sha(out)==sha(delivered),'sourceUnchanged':True})
  p=HERE/'source/mark-v-a-car-interior.lod0.blend';before=sha(p);bpy.ops.wm.open_mainfile(filepath=str(p));ob=bpy.data.objects['seat-observation-sculpted-upholstery'];ob.location.z+=.012;ob['editProbe']='raised upholstery 12 mm'
  edited=Path(td)/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);bpy.ops.wm.open_mainfile(filepath=str(edited));assert abs(bpy.data.objects['seat-observation-sculpted-upholstery'].location.z-.012)<1e-6
  export_loaded(Path(td)/'edited.glb');d=json.loads((Path(td)/'edited.components.json').read_text());d0=json.loads((HERE/'exports/mark-v-a-car-interior.lod0.components.json').read_text())
  def r(doc):return next(x for n in doc['batches'] for x in n['ranges'] if x['componentId']=='seat-observation-sculpted-upholstery')
  assert abs(r(d)['boundsM']['max'][1]-r(d0)['boundsM']['max'][1]-.012)<1e-5
  assert sha(p)==before
 (HERE/'qa/source-reexport-validation.json').write_text(json.dumps({'status':'pass','blender':bpy.app.version_string,'sourceChecks':report,'editSaveReopenReexportProbe':{'status':'pass','deltaM':.012,'originalSourceUnchanged':True},'runtime':'not_run'},indent=2)+'\n')

def setup(lod):
 bpy.ops.wm.read_factory_settings(use_empty=True);path=HERE/f'exports/mark-v-a-car-interior.lod{lod}.glb';bpy.ops.import_scene.gltf(filepath=str(path));s=bpy.context.scene
 s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=96;s.cycles.use_denoising=False;s.cycles.adaptive_threshold=.012;s.cycles.max_bounces=8;s.cycles.diffuse_bounces=4;s.cycles.glossy_bounces=4;s.cycles.transparent_max_bounces=8
 s.render.threads_mode='FIXED';s.render.threads=8;s.render.resolution_x=960;s.render.resolution_y=640;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=-.8
 s.world=bpy.data.worlds.new('Neutral daylight QA');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.84,.89,1,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.55
 def area(n,c,t,energy,size):
  d=bpy.data.lights.new(n,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(n,d);s.collection.objects.link(o);o.location=cv(c);o.rotation_euler=(Vector(cv(t))-o.location).to_track_quat('-Z','Y').to_euler()
 for side in [-1,1]:
  for z in [-6.5,-2.5,2.5,6.5]:area('QA daylight through glazing',(side*3.8,2.7,z),(0,1,z),180,3.3)
 for z in [-6,-3,0,3,6]:area('QA soft ceiling bounce',(0,2.22,z),(0,.4,z),45,1.7)
 area('QA forward daylight',(0,2.0,10),(0,1,5),150,3)
 return path

def render(name,eye,target,lens=23,lod=0):
 path=setup(lod);s=bpy.context.scene;d=bpy.data.cameras.new('Human-eye QA camera');o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=cv(eye);o.rotation_euler=(Vector(cv(target))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;d.clip_start=.035;d.clip_end=65;s.camera=o;s.render.filepath=str(HERE/'qa/previews'/(name+'.png'));bpy.ops.render.render(write_still=True)
 r={'file':name+'.png','sha256':sha(s.render.filepath),'inputGLB':str(path.relative_to(HERE)),'inputSha256':sha(path),'renderer':'Cycles CPU','blender':bpy.app.version_string,'samples':96,'denoising':'unavailable in installed Blender build; high-sample adaptive CPU rendering','resolution':[s.render.resolution_x,s.render.resolution_y],'eyeM':eye,'targetM':target,'lensMm':lens,'lighting':'QA-only neutral daylight and interior bounce; no emitted asset light','geometryRemoved':False,'materialOverrides':False,'runtimeWebGL':False}
 index=HERE/'qa/previews/index.json';rows=json.loads(index.read_text())['renders'] if index.exists() else [];rows=[x for x in rows if x['file']!=r['file']]+[r];index.write_text(json.dumps({'status':'rendered_pending_pixel_review','renders':rows},indent=2)+'\n');print('PREVIEW_READY',s.render.filepath,flush=True)

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--sources',action='store_true');ap.add_argument('--view',choices=['aisle','detail','front','gangway','lod1','all'],default='aisle');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if a.sources:source_checks()
 else:
  views={'aisle':('01-aisle-toward-gangway',[.25,1.65,4.03],[.0,1.2,-7.8],22,0),'detail':('02-seats-door-detail',[-.15,1.57,-.36],[.93,.95,-2.50],25,0),'front':('03-observation-salon',[.16,1.65,5.20],[0,1.12,7.58],22,0),'gangway':('04-gangway-return',[.0,1.65,-9.20],[.0,1.10,-7.30],18,0),'lod1':('05-aisle-lod1',[.25,1.65,4.03],[.0,1.2,-7.8],22,1)}
  for k in views if a.view=='all' else [a.view]:render(*views[k])
