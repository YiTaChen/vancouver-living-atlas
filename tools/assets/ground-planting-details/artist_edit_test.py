"""Reopen/reexport all sources, and prove mesh/UV/material artist edits survive the real exporter."""
from pathlib import Path
import importlib.util,json,shutil,struct,tempfile
import bpy
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('exporter',HERE/'export.py');e=importlib.util.module_from_spec(sp);sp.loader.exec_module(e);b=e.b
sp=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
root=Path(tempfile.mkdtemp(prefix='ground-artist-proof-'));original={p.name:b.digest(p)for p in (HERE/'source').glob('*.blend')};roundtrip=e.run(HERE/'source',root/'unchanged')
unchanged={str(p.relative_to(HERE)):b.digest(p)==b.digest(root/'unchanged'/p.relative_to(HERE))for p in (HERE/'exports').glob('*.glb')};b.need(all(unchanged.values()),'source roundtrip not byte-identical')
proof=[]
for aid in ['curb-straight-1m','planter-trough','perennial-rosette']:
 src=HERE/'source'/f'{aid}.lod0.blend';d=root/aid;d.mkdir();p=d/src.name;shutil.copy2(src,p);bpy.ops.wm.open_mainfile(filepath=str(p),use_scripts=False);o=next(o for o in bpy.context.scene.objects if o.type=='MESH');o.data.vertices[0].co.x+=.011;o.data.uv_layers['UVMap'].data[0].uv.x+=.03;mat=o.data.materials[0];mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.72;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True);before=b.digest(p);r=e.export_one(p,root/'edited'/aid);after=b.digest(p)
 a,aa=c.read_glb(HERE/'exports'/f'{aid}.lod0.glb');z,zz=c.read_glb(root/'edited'/aid/'exports'/f'{aid}.lod0.glb')
 def attr(doc,blob,k):return [v for mesh in doc['meshes']for pr in mesh['primitives']for v in c.accessor(doc,blob,pr['attributes'][k])]
 geometry=attr(a,aa,'POSITION')!=attr(z,zz,'POSITION');uv=attr(a,aa,'TEXCOORD_0')!=attr(z,zz,'TEXCOORD_0');rough=any(abs(m['pbrMetallicRoughness']['roughnessFactor']-.72)<1e-5 for m in z['materials']);b.need(geometry and uv and rough and before==after,'artist edit lost')
 proof.append({'assetId':aid,'originalSourceUnchanged':b.digest(src)==original[src.name],'editedSourcePreserved':before==after,'meshDeltaSurvived':geometry,'uvDeltaSurvived':uv,'roughnessDeltaSurvived':rough,'editedSourceSha256':before,'outputSha256':b.digest(root/'edited'/aid/'exports'/f'{aid}.lod0.glb')})
# Unsupported procedural graph must fail loudly rather than quietly erase edits.
bpy.ops.wm.open_mainfile(filepath=str(HERE/'source/curb-straight-1m.lod0.blend'),use_scripts=False);m=next(m for m in bpy.data.materials if m.name=='role-concrete');m.node_tree.nodes.new('ShaderNodeTexNoise');bad=root/'unsupported.lod0.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad),compress=True)
try:e.export_one(bad,root/'unsupported');raise AssertionError('unsupported node accepted')
except ValueError as ex:negative=str(ex)
b.need(all(b.digest(HERE/'source'/name)==h for name,h in original.items()),'original sources changed')
b.dump(HERE/'qa/artist-edit-proof.json',{'status':'pass','blender':bpy.app.version_string,'allOriginalSourcesUnchanged':True,'roundtripGLBs':unchanged,'edits':proof,'unsupportedGraphRejected':negative,'limits':'Role-only model sources support editable mesh, UV, transforms and opaque Principled values. Shared inspection image bindings are an explicit review override; sand master is rebaked separately.'})
print('ARTIST PROOF PASS')
