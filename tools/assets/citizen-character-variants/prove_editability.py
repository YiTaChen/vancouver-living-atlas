"""Artist-style edit of saved source, save/reopen/export, with independent output checks."""
import bpy,json,sys,hashlib,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from build import export_source;from glb_io import read_glb
TEMP=Path('/tmp/atlas-citizen-artist-edit');TEMP.mkdir(exist_ok=True)
source=ROOT/'source/police.lod0.blend';original=hashlib.sha256(source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(source));mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH');slot=next(i for i,m in enumerate(mesh.data.materials)if m.name=='police-original-badge-brass');ids=set(v for p in mesh.data.polygons if p.material_index==slot for v in p.vertices);assert ids
# Move only chest badge 8 mm higher; cap badge remains untouched. The mutable
# source mesh is edited directly, no regeneration/reduction pipeline is invoked.
changed=[i for i in ids if mesh.data.vertices[i].co.z<1.5];before={i:list(mesh.data.vertices[i].co)for i in changed}
for i in changed:mesh.data.vertices[i].co.z+=.008
mat=next(m for m in mesh.data.materials if m.name=='police-uniform-clothing-only');node=mat.node_tree.nodes['Principled BSDF'];old=list(node.inputs['Base Color'].default_value);node.inputs['Base Color'].default_value=(.035,.045,.080,1)
modified=TEMP/'police-artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(modified),compress=True);bpy.ops.wm.open_mainfile(filepath=str(modified));check=next(o for o in bpy.context.scene.objects if o.type=='MESH');assert all(abs(check.data.vertices[i].co.z-before[i][2]-.008)<1e-6 for i in changed)
output=TEMP/'police-artist-edit.glb';export_source(modified,output);d,b=read_glb(output);uniform=next(m for m in d['materials']if m['name']=='police-uniform-clothing-only');color=uniform['pbrMetallicRoughness']['baseColorFactor'];assert all(abs(a-b)<1e-6 for a,b in zip(color,[.035,.045,.080,1]));bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.scene.render.fps=30;bpy.ops.import_scene.gltf(filepath=str(output));badge=next(m for m in bpy.data.materials if m.name=='police-original-badge-brass');meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];zs=[]
for ob in meshes:
 for p in ob.data.polygons:
  if len(ob.data.materials)>p.material_index and ob.data.materials[p.material_index]==badge:
   for i in p.vertices:
    v=ob.matrix_world@ob.data.vertices[i].co
    if v.z<1.5:zs.append(v.z)
assert zs;expectedmin=min(v[2]for v in before.values())+.008;assert abs(min(zs)-expectedmin)<1e-5,(min(zs),expectedmin);assert hashlib.sha256(source.read_bytes()).hexdigest()==original
result={'status':'pass','method':'Edited saved mesh vertices and Principled material input; saved/reopened .blend; called source-preserving exporter; reimported actual output and measured edit','source':str(source.relative_to(ROOT)),'sourceSha256Before':original,'sourceSha256After':hashlib.sha256(source.read_bytes()).hexdigest(),'modifiedSourceSha256':hashlib.sha256(modified.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'geometryEdit':{'chestBadgeVertices':len(changed),'deltaZBlenderM':.008,'reimportMinZ':min(zs),'expectedMinZ':expectedmin},'materialEdit':{'before':old,'after':color},'scope':'Temporary proof files outside package, canonical sources and outputs untouched'}
(ROOT/'qa/artist-edit-proof.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
