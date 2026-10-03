"""Blender regression: unchanged re-bake, artist tint preservation, shader guard.
All work is isolated in temporary folders; repository sources are read-only.
"""
from pathlib import Path
import importlib.util
import json
import shutil
import tempfile
from types import SimpleNamespace
import bpy
import numpy as np
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('roof_build',HERE/'build.py'); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def main():
    original_hashes={p.name:b.digest(p) for p in (HERE/'source').glob('*.blend')}
    with tempfile.TemporaryDirectory(prefix='roof-source-proof-') as folder:
        work=Path(folder); baseline=work/'roundtrip'
        b.run(SimpleNamespace(output=baseline,from_source=HERE/'source',defaults=False,render=False))
        map_names=[p.name for p in (HERE/'exports/textures').glob('*.png')]
        exact={name:b.digest(HERE/'exports/textures'/name)==b.digest(baseline/'exports/textures'/name) for name in map_names}
        b.require(all(exact.values()),'Unchanged source bake is not deterministic')
        phase_source=work/'phase-shifted'; shutil.copytree(HERE/'source',phase_source)
        for sid,_,_ in b.SURFACES:
            path=phase_source/f'{sid}.lod0.blend'; bpy.ops.wm.open_mainfile(filepath=str(path),use_scripts=False)
            mat=next(m for m in bpy.data.materials if m.get('surface_id')==sid); nt=mat.node_tree
            uv=next(n for n in nt.nodes if n.type=='UVMAP'); targets=[link.to_socket for link in uv.outputs[0].links]
            shift=nt.nodes.new('ShaderNodeVectorMath'); shift.operation='ADD'; shift.inputs[1].default_value=(2,2,0)
            nt.links.new(uv.outputs[0],shift.inputs[0])
            for socket in targets: nt.links.new(shift.outputs[0],socket)
            bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        phase_output=work/'phase-result'; b.run(SimpleNamespace(output=phase_output,from_source=phase_source,defaults=False,render=False))
        phase_stats={}
        for name in map_names:
            images=[bpy.data.images.load(str(folder/'exports/textures'/name),check_existing=False) for folder in [baseline,phase_output]]
            arrays=[]
            for im in images:
                im.colorspace_settings.name='Non-Color'; arr=np.empty(256*256*4,dtype=np.float32); im.pixels.foreach_get(arr); arrays.append(arr*255)
            delta=np.abs(arrays[0]-arrays[1]); phase_stats[name]={'maximumDelta8bit':float(delta.max()),'meanDelta8bit':float(delta.mean())}
            b.require(float(delta.max())<=3.01 and float(delta.mean())<.05,'2m phase shift changed material')
            for im in images: bpy.data.images.remove(im)
        edited_source=work/'artist-edited'; shutil.copytree(HERE/'source',edited_source)
        target=edited_source/'roof-mineral-grain.lod0.blend'; bpy.ops.wm.open_mainfile(filepath=str(target),use_scripts=False)
        mat=next(m for m in bpy.data.materials if m.get('surface_id')=='roof-mineral-grain')
        tint=mat.node_tree.nodes['EDIT_BASE_TINT (linear from existing sRGB palette)']; before=list(tint.outputs[0].default_value)
        tint.outputs[0].default_value=(before[0]*.8,before[1]*.8,before[2]*.8,1)
        bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
        edited_hash=b.digest(target); output=work/'edited-result'
        b.run(SimpleNamespace(output=output,from_source=edited_source,defaults=False,render=False))
        changed={name:b.digest(baseline/'exports/textures'/name)!=b.digest(output/'exports/textures'/name) for name in map_names}
        b.require(changed=={name:name=='roof-mineral-grain-color.png' for name in map_names},'Artist tint edit isolation failed')
        b.require(b.digest(target)==edited_hash,'Artist input overwritten')
        bpy.ops.wm.open_mainfile(filepath=str(target),use_scripts=False)
        mat=next(m for m in bpy.data.materials if m.get('surface_id')=='roof-mineral-grain')
        mat.node_tree.nodes['ROOF_PBR'].inputs['Coat Weight'].default_value=.2
        reject=''
        try: b.bake.principled(mat)
        except ValueError as error: reject=str(error)
        b.require('Coat Weight' in reject,'Unsupported coat did not fail closed')
        b.require(original_hashes=={p.name:b.digest(p) for p in (HERE/'source').glob('*.blend')},'Repository source changed')
        report={'status':'pass','blender':bpy.app.version_string,'device':'CPU','threads':2,
                'sourceHashes':original_hashes,'unchangedRuntimeMapHashMatches':exact,
                'periodicityRebake':{'status':'pass','method':'Insert UV vector shift (2m,2m,0) upstream of every procedural coordinate; re-bake both complete surfaces from saved shifted Blender sources. Compare runtime pixels to unshifted re-bake.','maps':phase_stats,'toleranceMaximum8bit':3,'toleranceMean8bit':.05},
                'artistEdit':{'source':'roof-mineral-grain.lod0.blend','node':'EDIT_BASE_TINT (linear from existing sRGB palette)','operation':'RGB linear factor 0.8','inputSourceHashBeforeExport':edited_hash,'inputSourceHashAfterExport':b.digest(target),'changedMaps':changed,'expected':'Only mineral base color changes; normal, ORM and membrane maps remain exact.'},
                'unsupportedCoatRejected':reject,'sourceInputsUnchanged':True,
                'temporaryOutputPolicy':'Full scratch bakes removed after hash evidence was recorded. No defaults were regenerated.'}
        b.dump(HERE/'qa/source-edit-test.json',report)
        print(json.dumps(report,indent=2))
if __name__=='__main__': main()
