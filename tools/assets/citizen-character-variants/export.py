"""Source-preserving export: no generator/mesh rebuild; output must be new directory.
blender -b -t 2 --python tools/assets/citizen-character-variants/export.py -- --out /tmp/citizen-reexport
"""
import sys,argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from build import export_source
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--source',type=Path);a=p.parse_args(args);out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
assert out != (ROOT/'exports').resolve(),'Use a fresh output directory; review before replacing candidates.'
report=[]
for source in ([a.source] if a.source else sorted((ROOT/'source').glob('*.blend'))):
 before=hashlib.sha256(source.read_bytes()).hexdigest();target=out/(source.stem+'.glb');assert not target.exists(),'Refusing to overwrite an existing export'
 export_source(source,target);after=hashlib.sha256(source.read_bytes()).hexdigest();assert before==after
 report.append({'source':source.name,'sourceSha256Before':before,'sourceSha256After':after,'outputSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'output':target.name})
(out/'source-preserving-export.json').write_text(json.dumps(report,indent=2)+'\n')
