"""Reproduce pose trials without changing sources, exports or original Roadster.
blender -b -t 2 --python-exit-code 1 --python tools/assets/citizen-character-variants/probe_driver_fit.py -- --out /tmp/citizen-driver-studies
Requires simplify.mjs first. Results are diagnostics, never acceptance by count alone.
"""
import bpy,sys,json,subprocess,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from build import reset,driver,export_source,TEMP
p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
assert not out.is_relative_to(ROOT),'Use a scratch output directory, not canonical package sources'
parameters=[(.53,1.2),(.48,1.2),(.50,.7),(.48,1.6),(.44,.8),(.70,0),(.72,0),(.74,0),(.72,.25)]
report=[]
for i,(forward,outward)in enumerate(parameters):
 sc,rig,mesh=reset(TEMP/'citizen.lod0.glb');driver(rig,mesh,forward,outward);mesh['exportRuntime']=True;source=out/f'trial-{i}.blend';assert not source.exists(),'Refusing to replace previous studies';bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True);glb=out/f'trial-{i}.glb';export_source(source,glb);result=out/f'result-{i}.json';subprocess.run(['node',str(ROOT/'check_driver_fit.mjs'),str(glb),str(result)],check=True,stdout=subprocess.DEVNULL)
 r=json.loads(result.read_text());report.append({'trial':i,'footForwardLocalM':forward,'kneeOutwardParameter':outward,'source':source.name,'glb':glb.name,'fit':r})
(out/'driver-trials.json').write_text(json.dumps(report,indent=2)+'\n');print('Completed nine measured pose studies; comfortable fit remains a visual and cabin design decision.')
