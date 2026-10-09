"""Open edited source .blend without regeneration; preserve artist changes."""
import bpy,sys,argparse,json,hashlib,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('atlas_existing_export',ROOT.parent/'boardable-metro/export.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
# The existing exporter batches via its local reusable implementation and never invokes generation.
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--source',type=Path);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 if a.output.resolve() in [(ROOT/'source').resolve(),(ROOT/'exports').resolve()]:raise ValueError('Use a separate reexport directory')
 sources=[a.source] if a.source else sorted((ROOT/'source').glob('*.blend'));r=[module.export_source(s,a.output/(s.stem+'.glb')) for s in sources];(a.output/'source-export-report.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'sources':r},indent=2)+'\n')
