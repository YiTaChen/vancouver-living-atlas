"""Real Blender regression: export saved artist edits, don't regenerate defaults.

Run after rendering, since it starts sequential Blender CPU processes. Reports
read-only full roundtrip, changed geometry/UV/PBR preservation, unsupported shader
rejection and same-directory overwrite rejection. Only temporary sources edited.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('roof_validation',HERE/'validate.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)

def run(script,args):
    return subprocess.run(['blender','--background','--factory-startup','--threads','2','--python-exit-code','1','--python',str(script),'--',*map(str,args)],capture_output=True,text=True)

def signature(path):
    d,b=v.c.read_glb(path);positions=set();uv=set()
    for mesh in d['meshes']:
        for p in mesh['primitives']:
            positions.update(tuple(round(x,5) for x in q) for q in v.c.accessor(d,b,p['attributes']['POSITION']))
            uv.update(tuple(round(x,5) for x in q) for q in v.c.accessor(d,b,p['attributes']['TEXCOORD_0']))
    return {'positions':sorted(positions),'uv':sorted(uv),'materials':{m['name']:m['pbrMetallicRoughness'] for m in d['materials']}}

EDIT_SCRIPT=r'''
import bpy,json,sys
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]);out=Path(sys.argv[sys.argv.index('--')+2]);results={}
for level in [0,1]:
 path=root/f'hvac-compact-single.lod{level}.blend';bpy.ops.wm.open_mainfile(filepath=str(path))
 ob=bpy.data.objects['body-shell']
 for vert in ob.data.vertices:vert.co.x+=.011
 for loop in ob.data.uv_layers['UVMap'].data:loop.uv.x+=.0625
 mat=bpy.data.materials['shared-metal-housing'];mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.38,.44,.41,1)
 mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.57
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();positions=set();uv=set()
 for obj in bpy.context.scene.objects:
  evaluated=obj.evaluated_get(dg);me=evaluated.to_mesh()
  for vert in me.vertices:
   p=obj.matrix_world@vert.co;positions.add(tuple(round(x,5) for x in (p.x,p.z,-p.y)))
  for loop in me.uv_layers['UVMap'].data:uv.add(tuple(round(x,5) for x in (loop.uv.x,1-loop.uv.y)))
  evaluated.to_mesh_clear()
 results[str(level)]={'positions':sorted(positions),'uv':sorted(uv)}
 bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
out.write_text(json.dumps(results))
'''
BAD_SCRIPT=r'''
import bpy,sys
from pathlib import Path
p=Path(sys.argv[sys.argv.index('--')+1]);bpy.ops.wm.open_mainfile(filepath=str(p));bpy.data.materials['shared-metal-housing'].node_tree.nodes.new('ShaderNodeMath');bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
'''

def main():
    p=argparse.ArgumentParser();p.add_argument('--report',type=Path,default=HERE/'qa/source-roundtrip.json');a=p.parse_args()
    before={p.name:v.c.digest(p) for p in (HERE/'source').glob('*.blend')};start=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='rooftop-source-safety-') as tmp:
        t=Path(tmp);roundtrip=t/'roundtrip';result=run(HERE/'export.py',['--source',HERE/'source','--output',roundtrip])
        assert result.returncode==0,result.stdout+result.stderr
        equality=[]
        for p in (HERE/'exports').glob('*.glb'):
            other=roundtrip/'exports'/p.name
            assert signature(p)==signature(other),'roundtrip geometry/UV/PBR changed'
            equality.append({'file':p.name,'sourceSha256':before[p.name.replace('.glb','.blend')],'originalSha256':v.c.digest(p),'reexportSha256':v.c.digest(other),'byteIdentical':v.c.digest(p)==v.c.digest(other),'geometryUvPbrEqual':True})
        v.validate(roundtrip)
        edits=t/'edited-sources';shutil.copytree(HERE/'source',edits);edit_script=t/'edit.py';edit_script.write_text(EDIT_SCRIPT);expected=t/'expected.json'
        result=run(edit_script,[edits,expected]);assert result.returncode==0,result.stdout+result.stderr
        edited_before={p.name:v.c.digest(p) for p in edits.glob('*.blend')};output=t/'edited-export';result=run(HERE/'export.py',['--source',edits,'--output',output]);assert result.returncode==0,result.stdout+result.stderr
        expect=json.loads(expected.read_text());edited=[]
        for level in [0,1]:
            stem=f'hvac-compact-single.lod{level}';sig=signature(output/'exports'/(stem+'.glb'));original=signature(HERE/'exports'/(stem+'.glb'))
            assert [list(x) for x in sig['positions']]==expect[str(level)]['positions'],'artist geometry lost'
            assert [list(x) for x in sig['uv']]==expect[str(level)]['uv'],'artist UV lost'
            assert sig['positions']!=original['positions'] and sig['uv']!=original['uv'],'edit did not change output'
            mat=sig['materials']['shared-metal-housing'];assert max(abs(x-y) for x,y in zip(mat['baseColorFactor'],[.38,.44,.41,1]))<1e-5
            assert abs(mat['roughnessFactor']-.57)<1e-5,'artist Principled value lost'
            edited.append({'lod':level,'geometryOffsetM':.011,'sourceUvUOffset':.0625,'baseColorLinear':[.38,.44,.41,1],'roughness':.57,'geometryUvPbrPreserved':True})
        assert all(v.c.digest(p)==edited_before[p.name] for p in edits.glob('*.blend')),'edited sources changed by export'
        unsupported=t/'unsupported-source';shutil.copytree(HERE/'source',unsupported);bad_script=t/'bad.py';bad_script.write_text(BAD_SCRIPT);bad=unsupported/'hvac-compact-single.lod0.blend'
        result=run(bad_script,[bad]);assert result.returncode==0,result.stdout+result.stderr
        bad_before=v.c.digest(bad);result=run(HERE/'export.py',['--source',unsupported,'--output',t/'unsupported-output'])
        assert result.returncode!=0 and 'unsupported edited material graph' in result.stdout+result.stderr,'shader edit must fail instead of reverting'
        assert v.c.digest(bad)==bad_before
        result=run(HERE/'export.py',['--source',HERE/'source','--output',HERE])
        assert result.returncode!=0 and 'Output must be a fresh directory' in result.stdout+result.stderr,'overwrite must be refused'
    assert all(v.c.digest(p)==before[p.name] for p in (HERE/'source').glob('*.blend')),'original source changed'
    report={'status':'pass','sourceEditsPreserved':True,'sourceHashesUnchanged':True,'roundtrip':equality,'editedSourceCases':edited,'unsupportedMaterialEdit':'rejected without source mutation','sourceOutputOverwrite':'rejected without source mutation','seconds':round(time.monotonic()-start,3),'scope':'Real Blender reopen/reexport; temporary edited sources only; no WebGL'}
    a.report.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
