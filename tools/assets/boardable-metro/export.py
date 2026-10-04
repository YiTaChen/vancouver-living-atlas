"""Source-preserving export: open user-edited .blend, never call generation code."""
import argparse,sys,json,hashlib
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parent

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def export_source(source,out,batch_interior=True):
 before=digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.scene.frame_set(1)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_yup=True,export_apply=True,export_animations=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 if batch_interior and 'interior' in source.stem:
  sys.path.insert(0,str(ROOT));from batch_static import batch
  batch(out)
 assert digest(source)==before,'Source modified during export'
 return {'source':str(source.name),'sourceSha256':before,'output':out.name,'outputSha256':digest(out),'sourceUnchanged':True}
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--output',required=True,type=Path);ap.add_argument('--source',type=Path);ap.add_argument('--unbatched',action='store_true',help='QA-only raw export for exact batching comparison');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 if a.output.resolve() in [(ROOT/'source').resolve(),(ROOT/'exports').resolve()]:raise ValueError('Reexport into a new output directory; inspect before adoption')
 sources=[a.source] if a.source else sorted((ROOT/'source').glob('*.blend'))
 result=[export_source(p,a.output/(p.stem+'.glb'),batch_interior=not a.unbatched) for p in sources]
 (a.output/'source-export-report.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'sources':result},indent=2)+'\n')
