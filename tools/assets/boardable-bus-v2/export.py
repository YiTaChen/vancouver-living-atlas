"""Open editable artist sources and export; never rebuild or overwrite sources."""
import argparse, importlib.util, sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('bus_static_batch',HERE.parent/'boardable-bus/batch_static.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
def export_loaded(path,batched=True):
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_extras=True,export_animations=False,export_lights=False,export_cameras=False)
 if batched:B.batch(path)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 for p in sorted(a.source.glob('*.blend')):
  bpy.ops.wm.open_mainfile(filepath=str(p.resolve()));export_loaded(a.output/(p.stem+'.glb'))
if __name__=='__main__':main()
