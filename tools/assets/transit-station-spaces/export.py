"""Source-preserving export only. Does not invoke generators or replace .blend files."""
import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import IDS,ROOT,export_source
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--unbatched',action='store_true',help='Audit-only raw export; production defaults to lossless semantic batching');p.add_argument('--source-root',type=Path,default=ROOT/'source');a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for aid in IDS:
 for l in range(2):export_source(a.source_root/f'{aid}.lod{l}.blend',a.output/f'{aid}.lod{l}.glb',batch_static=not a.unbatched)
