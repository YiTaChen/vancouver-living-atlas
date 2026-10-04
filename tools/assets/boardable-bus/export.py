"""Source-preserving exporter: opens existing artist .blend; never runs build.py."""
import argparse,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent

def export_loaded(path,batch_interior=True):
 bpy.context.scene.frame_set(1)
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_extras=True,export_animations=True,export_animation_mode='ACTIONS',export_current_frame=False,export_lights=False,export_cameras=False,export_keep_originals=False)

 # Static interiors keep all editable source objects; batching changes only this exported GLB.
 if batch_interior and bpy.context.scene.get('asset')=='city-bus-12m-interior':
  sys.path.insert(0,str(HERE));from batch_static import batch
  batch(path)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 for p in sorted(a.source.glob('*.blend')):
  bpy.ops.wm.open_mainfile(filepath=str(p.resolve()));export_loaded(a.output/(p.stem+'.glb'))
if __name__=='__main__':main()
