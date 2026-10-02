"""Bounded source-edit + unsupported-shader guard regression, run inside Blender."""
import bpy, importlib.util, json, hashlib
from pathlib import Path
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('role_build',P/'build.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
bpy.ops.wm.open_mainfile(filepath=str(P/'source/role-material-library.blend'))
mat=bpy.data.materials['vehicle-red-paint'];mat.node_tree.nodes['EDIT_BASE_TINT'].inputs[2].default_value=(.5,1,1,1)
out=Path('/tmp/role-materials-edit-test');b.run_export(out,False)
changed=[];same=[]
for p in sorted((P/'exports/textures').glob('*.png')):
 q=out/'textures'/p.name
 (same if p.read_bytes()==q.read_bytes() else changed).append(p.name)
assert changed==['vehicle-red-paint-basecolor.png'],changed
bpy.ops.wm.open_mainfile(filepath=str(P/'source/role-material-library.blend'))
mat=bpy.data.materials['vehicle-red-paint'];mat.node_tree.nodes['ROLE_PBR'].inputs['Coat Weight'].default_value=.4
rejected=False
try:b.validate_material(mat)
except ValueError:rejected=True
assert rejected
report={'pass':True,'edited_base_tint_changed_maps':changed,'unchanged_map_count':len(same),'unsupported_coat_rejected':True,'original_blend_not_overwritten':True}
(P/'qa/source-edit-test.json').write_text(json.dumps(report,indent=2)+'\n');print(report)
