"""Re-export editable sources without regenerating or modifying authoring geometry."""
import bpy,sys,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'exports');a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);a.output.mkdir(parents=True,exist_ok=True)
for source in sorted((ROOT/'source').glob('*.blend')):
 bpy.ops.wm.open_mainfile(filepath=str(source))
 bpy.ops.object.select_all(action='DESELECT')
 for o in bpy.context.scene.objects:
  if o.type in ('MESH','ARMATURE'):o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(a.output/(source.stem+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_nla_strips=True,export_skins=True,export_all_influences=False,export_normals=True,export_texcoords=False,export_extras=True,export_cameras=False,export_lights=False)
