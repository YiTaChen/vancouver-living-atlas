"""Actual Blender mutation regression: geometry edits survive; unsupported nodes fail.

Only temporary copies are mutated. Canonical source hashes are rechecked.
Run with python3; this test deliberately invokes Blender.
"""
from pathlib import Path
import json
import subprocess
import shutil
import tempfile
import unittest

from validate_architecture_expansion import HERE,ROOT,digest,glb,accessor,validate


def blender(script,*args,check=True):
    result=subprocess.run(['blender','--background','--factory-startup','--threads','2','--python-exit-code','1','--python',str(script),'--',*map(str,args)],capture_output=True,text=True,timeout=180)
    if check and result.returncode:
        raise AssertionError(result.stdout+'\n'+result.stderr)
    return result


class SourceWorkflowTests(unittest.TestCase):
    def test_geometry_edit_preserved_and_unsupported_node_rejected(self):
        manifest=json.loads((HERE/'manifest.json').read_text())
        before={lod['source']:digest(HERE/lod['source']) for a in manifest['assets'] for lod in a['lods']}
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);sources=root/'artist';sources.mkdir()
            # Only the plinth's two LODs receive a 31 mm artist geometry edit.
            script=root/'edit.py'
            script.write_text('''import bpy,sys,shutil,json
from pathlib import Path
source=Path(sys.argv[sys.argv.index('--')+1]); target=Path(sys.argv[-1])
sys.path.insert(0,str(source)); import build_architecture_expansion as kit
manifest=json.loads((source/'manifest.json').read_text())
for asset in manifest['assets']:
 for lod in asset['lods']:
  original=source/lod['source']; dest=target/original.name
  if asset['id']==manifest['assets'][3]['id']:
   bpy.ops.wm.open_mainfile(filepath=str(original))
   for ob in bpy.context.scene.objects:
    for v in ob.data.vertices: v.co.x+=.031
    kit.h.metric_uv(ob)
   bpy.data.libraries.write(str(dest),{bpy.context.scene},path_remap='RELATIVE',compress=True)
  else: shutil.copyfile(original,dest)
''')
            blender(script,HERE,sources)
            artist_hashes={p.name:digest(p) for p in sources.glob('*.blend')}
            output=root/'exported'
            blender(HERE/'build_architecture_expansion.py','--from-source',sources,'--output',output,'--skip-render')
            validate(output)
            exported=json.loads((output/'manifest.json').read_text())
            for l in [0,1]:
                prior=manifest['assets'][3]['lods'][l];after=exported['assets'][3]['lods'][l]
                for side in ['min','max']:
                    self.assertAlmostEqual(after['bounds'][side][0]-prior['bounds'][side][0],.031,places=5)
                self.assertEqual(prior['triangles'],after['triangles'])
                self.assertNotEqual(prior['sha256'],after['sha256'])
            self.assertEqual(artist_hashes,{p.name:digest(p) for p in sources.glob('*.blend')})
            bad=root/'unsupported.py'
            bad.write_text('''import bpy,sys
p=sys.argv[-1]; bpy.ops.wm.open_mainfile(filepath=p)
bpy.context.scene.objects[0].data.materials[0].node_tree.nodes.new('ShaderNodeRGB')
bpy.data.libraries.write(p,{bpy.context.scene},path_remap='RELATIVE',compress=True)
''')
            target=sources/Path(manifest['assets'][3]['lods'][0]['source']).name
            blender(bad,target)
            result=blender(HERE/'build_architecture_expansion.py','--from-source',sources,'--output',root/'rejected','--skip-render',check=False)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('unsupported edited PBR node graph',result.stdout+result.stderr)
            # Refuse source=output even when all data otherwise looks valid.
            result=blender(HERE/'build_architecture_expansion.py','--from-source',HERE/'source','--output',HERE,'--skip-render',check=False)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('output must differ',result.stdout+result.stderr)
        self.assertEqual(before,{path:digest(HERE/path) for path in before})

    def test_modified_shared_material_values_are_rejected(self):
        manifest=json.loads((HERE/'manifest.json').read_text())
        original=HERE/manifest['assets'][0]['lods'][0]['source']
        original_hash=digest(original)
        cases={
            'physical_scale': ("mat.node_tree.nodes['Metres to shared physical repeat'].inputs[1].default_value[0] *= .5", 'physical repeat multiplier'),
            'coat': ("bs.inputs['Coat Weight'].default_value=.5", 'unsupported Principled value'),
            'tint': ("bs.inputs['Base Color'].default_value=(.2,.8,.3,1)", 'unsupported Principled value'),
            'normal_strength': ("next(n for n in mat.node_tree.nodes if n.type=='NORMAL_MAP').inputs['Strength'].default_value=.5", ''),
            'painted_image': ("img=next(n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and '-color' in n.image.name);img.pixels[0]=.987;img.pack()", 'modified shared packed image bytes'),
        }
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name,(mutation,error) in cases.items():
                with self.subTest(mutation=name):
                    sources=root/name/'source';shutil.copytree(HERE/'source',sources)
                    target=sources/original.name
                    script=root/f'{name}.py'
                    script.write_text("import bpy,sys\np=sys.argv[-1];bpy.ops.wm.open_mainfile(filepath=p)\nmat=bpy.context.scene.objects[0].data.materials[0]\nbs=mat.node_tree.nodes.get('Principled BSDF')\n"+mutation+"\nbpy.data.libraries.write(p,{bpy.context.scene},path_remap='RELATIVE',compress=True)\n")
                    blender(script,target)
                    after_edit=digest(target)
                    result=blender(HERE/'build_architecture_expansion.py','--from-source',sources,'--output',root/name/'rejected','--skip-render',check=False)
                    self.assertNotEqual(result.returncode,0,name)
                    if error:self.assertIn(error,result.stdout+result.stderr)
                    self.assertEqual(after_edit,digest(target),'rejected input was changed')
                    self.assertFalse(list((root/name/'rejected'/'assets').glob('*.glb')),'unsupported material produced a misleading export')
        self.assertEqual(original_hash,digest(original))


if __name__=='__main__': unittest.main()
