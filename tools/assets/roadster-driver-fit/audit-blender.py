"""Real source reopening, immutable re-export and edits on temporary copies."""
import bpy,json,sys,tempfile,importlib.util
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import export as exporter
spec=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
records=[]
for lod in range(3):
 stem=f'roadster-cockpit-local.lod{lod}';src=HERE/'source'/(stem+'.blend');glb=HERE/'exports'/(stem+'.glb');before=exporter.digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));sc=bpy.context.scene;assert sc['source_kind']=='original-editable-authoring';assert all(o.type=='MESH' and o.data.uv_layers.active for o in sc.objects);quads=sum(len(p.vertices)==4 for o in sc.objects for p in o.data.polygons);assert quads>0
 with tempfile.TemporaryDirectory(prefix='roadster-fit-roundtrip-')as tmp:
  out=Path(tmp)/(stem+'.glb');exporter.export_one(src,out);expected=contract.measure_glb(glb);actual=contract.measure_glb(out)
  for k in ['triangles','vertices','primitives','boundsM']:assert actual[k]==expected[k],k
 assert before==exporter.digest(src);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));bpy.context.view_layer.update();pts=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=='MESH'for v in o.data.vertices];b={'min':[min((p.x,p.z,-p.y)[k]for p in pts)for k in range(3)],'max':[max((p.x,p.z,-p.y)[k]for p in pts)for k in range(3)]}
 for edge in ['min','max']:
  for k in range(3):assert abs(b[edge][k]-expected['boundsM'][edge][k])<1e-5
 records.append({'lod':lod,'sourceReopened':True,'sourceSha256':before,'sourceUnchanged':True,'reexportEquivalent':True,'editableQuads':quads,'reimportBoundsM':b})
with tempfile.TemporaryDirectory(prefix='roadster-fit-edit-proof-')as tmp:
 tmp=Path(tmp);src=HERE/'source/roadster-cockpit-local.lod0.blend';before=exporter.digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));ob=bpy.data.objects['dashboard-driver-clearance-header'];ob.data.vertices[0].co.x+=.011;expected=ob.data.vertices[0].co.copy();ob.data.uv_layers.active.data[0].uv.x+=.073;expectedUV=list(ob.data.uv_layers.active.data[0].uv);mat=bpy.data.materials['cockpit-dark'];bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.07,.09,.13,1);bs.inputs['Roughness'].default_value=.43;edited=tmp/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);esh=exporter.digest(edited);out=tmp/'edited.glb';exporter.export_one(edited,out);doc,blob=contract.read_glb(out);pbr=next(m for m in doc['materials']if m['name']=='cockpit-dark')['pbrMetallicRoughness'];assert abs(pbr['roughnessFactor']-.43)<1e-6;assert all(abs(a-b)<1e-6 for a,b in zip(pbr['baseColorFactor'],[.07,.09,.13,1]));node=next(n for n in doc['nodes']if n.get('name')=='dashboard-driver-clearance-header');pr=doc['meshes'][node['mesh']]['primitives'][0];uvs=contract.accessor(doc,blob,pr['attributes']['TEXCOORD_0']);assert any(abs(u-expectedUV[0])<1e-5 and abs(v-(1-expectedUV[1]))<1e-5 for u,v in uvs);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out));ob=bpy.data.objects['dashboard-driver-clearance-header'];assert min((v.co-expected).length for v in ob.data.vertices)<1e-5;assert exporter.digest(src)==before and exporter.digest(edited)==esh
 bpy.ops.wm.open_mainfile(filepath=str(edited));m=bpy.data.materials['cockpit-dark'];m.node_tree.nodes.new('ShaderNodeTexNoise');denied=False
 try:exporter.check_material(m)
 except AssertionError:denied=True
 assert denied
 proof={'status':'pass','meshEditM':.011,'uvEdit':.073,'materialColorAndRoughnessPreserved':True,'originalSourceUnchanged':True,'editedSourceUnchanged':True,'unsupportedGraphRejected':True,'proofCopies':'temporary; reproducible from this audit'}
(HERE/'qa/blender-audit.json').write_text(json.dumps({'status':'pass','blender':bpy.app.version_string,'device':'CPU','threads':2,'results':records},indent=2)+'\n');(HERE/'qa/source-edit-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print('BLENDER_AUDIT_PASS')
