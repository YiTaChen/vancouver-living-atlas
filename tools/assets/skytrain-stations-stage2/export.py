"""Re-export editable .blend files, preserving floor and anchor nodes. Run through Blender."""
import bpy,sys,json,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--output',default=str(ROOT/'exports'));p.add_argument('--station');a=p.parse_args(args);OUT=Path(a.output);OUT.mkdir(parents=True,exist_ok=True)
rows=[]
for src in sorted((ROOT/'source').glob('*.blend')):
 if a.station and src.stem!=a.station:continue
 bpy.ops.wm.open_mainfile(filepath=str(src));source_meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];groups={}
 for o in source_meshes:
  if o.get('semanticRole') in ['floor','threshold']:continue
  key=(o.get('semanticRole','static'),o.data.materials[0].name)
  groups.setdefault(key,[]).append(o)
 for key,obs in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in obs:o.select_set(True)
  bpy.context.view_layer.objects.active=obs[0];components=[o.name for o in obs];bpy.ops.object.join();o=bpy.context.object;o.name='batch-'+key[0]+'-'+key[1];o['componentIds']=components;o['semanticRole']=key[0]
 path=OUT/(src.stem+'.glb');bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_apply=True)
 rows.append({'stationId':src.stem,'sourceMeshCount':len(source_meshes),'exportMeshCount':len([o for o in bpy.context.scene.objects if o.type=='MESH']),'source':'source/'+src.name,'file':path.name})
if OUT==ROOT/'exports':(ROOT/'qa/export-batching.json').write_text(json.dumps(rows,indent=2)+'\n')
