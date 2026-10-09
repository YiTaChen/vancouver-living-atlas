"""Reopen/re-export editable derivative sources; CPU render ACTUAL reduced GLBs."""
import argparse,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from export import export_loaded
sys.path.insert(0,str(HERE.parent/'runtime-candidate'));from geometry import C,load
MASTER=HERE.parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cv(p):return (p[0],-p[2],p[1])
def uv(p):return [p[0],p[2],-p[1]]
def imported_bounds():
 pts=[uv(o.matrix_world@v.co) for o in bpy.context.scene.objects if o.type=='MESH' for v in o.data.vertices];return {s:[f(p[k] for p in pts) for k in range(3)] for s,f in [('min',min),('max',max)]}
def sources():
 checks=[];quality_sources={p:sha(p) for p in (HERE/'source').glob('*.blend')};masters={str(p):sha(p) for folder in ['source','exports'] for p in (MASTER/folder).glob('*') if p.suffix in ['.blend','.glb']}
 with tempfile.TemporaryDirectory(prefix='bus-runtime-source-qa-') as temp:
  td=Path(temp)
  for p in sorted((HERE/'source').glob('*.blend')):
   before=sha(p);bpy.ops.wm.open_mainfile(filepath=str(p));mesh_count=sum(o.type=='MESH' for o in bpy.context.scene.objects);mods=sum(len(o.modifiers) for o in bpy.context.scene.objects);out=td/(p.stem+'.glb');export_loaded(out);actual=HERE/'exports'/out.name
   need=sha(out)==sha(actual);assert need,'Reexport must reproduce final GLB bytes';assert sha(out.with_suffix('.components.json'))==sha(actual.with_suffix('.components.json')),'Sidecar reexport mismatch';assert sha(p)==before
   bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(actual));bpy.context.view_layer.update();bounds=imported_bounds();measured=C.measure_glb(actual)
   assert all(abs(bounds[s][k]-measured['boundsM'][s][k])<1e-5 for s in ['min','max'] for k in range(3));assert not any(o.type in ['LIGHT','CAMERA'] for o in bpy.context.scene.objects)
   checks.append({'source':'source/'+p.name,'sha256':before,'editableMeshObjects':mesh_count,'editableModifiers':mods,'sourceUnchanged':True,'reexportBinaryIdentical':True,'sidecarBinaryIdentical':True,'deliveredGLBReimport':'pass','boundsM':bounds,'sourceBytes':p.stat().st_size})
  p=HERE/'source/city-bus-12m-interior-v2-closeup.lod0.blend';bpy.ops.wm.open_mainfile(filepath=str(p));o=bpy.data.objects['seat-01-cushion']
  for v in o.data.vertices:v.co.z+=.012
  save=td/'artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(save),compress=True);bpy.ops.wm.open_mainfile(filepath=str(save));out=td/'artist-edit.glb';export_loaded(out);scene,_,_=load(out);assert abs(max(p[1] for p in scene['seat-01-cushion']['points'])-(1.13+.012))<2e-5
 assert all(sha(Path(p))==h for p,h in masters.items()),'Detailed master changed'
 assert all(sha(p)==h for p,h in quality_sources.items()),'Quality source changed during saved-copy edit probe'
 (HERE/'qa/blender-validation.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'scope':'Offline source reopen/reexport and actual quality GLB import','sourceChecks':checks,'artistEditProbe':{'status':'pass','component':'seat-01-cushion','offsetM':.012,'savedCopyReopened':True,'masterAndCandidateSourcesUnchanged':True},'originalMasterRoot':'..','detailedMasterHashes':{str(Path(p).relative_to(MASTER)):h for p,h in masters.items()},'WebGL':'not_run'},indent=2)+'\n')

if __name__=='__main__':sources()
