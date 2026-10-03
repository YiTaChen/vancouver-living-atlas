"""Reopen all true sources; reimport deliverables and prove editable-source export safety."""
import bpy,json,sys,math,importlib.util,tempfile
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));import export as exporter
spec=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)
SPECS=json.loads((HERE/'specs.json').read_text())
def bounds(objects):
 points=[o.matrix_world@v.co for o in objects for v in o.data.vertices];ps=[(p.x,p.z,-p.y) for p in points]
 return {'min':[min(p[k] for p in ps) for k in range(3)],'max':[max(p[k] for p in ps) for k in range(3)]}
records=[]
for aid,s in SPECS.items():
 for level in range(3):
  stem=f'{aid}.lod{level}';src=HERE/'source'/(stem+'.blend');glb=HERE/'exports'/(stem+'.glb');sha=exporter.digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));assert bpy.context.scene.get('source_kind')=='original-editable-authoring'
  assert all(o.type=='MESH' and o.data.uv_layers.active for o in bpy.context.scene.objects)
  assert any(len(p.vertices)>3 for o in bpy.context.scene.objects for p in o.data.polygons),'authored mesh edit topology retained'
  for source_object in bpy.context.scene.objects:
   if source_object.name.startswith('hub-') and not source_object.name.startswith('hub-center-'):assert source_object.data.materials[0].name=='paint','metal hubs cannot use glazing material'
  source_mesh_count=len(bpy.context.scene.objects);source_nodes=sum(len(m.node_tree.nodes) for m in bpy.data.materials if m.use_nodes)
  with tempfile.TemporaryDirectory(prefix='traffic-roundtrip-') as tmp:
   out=Path(tmp)/(stem+'.glb');exporter.export_one(src,out);actual=contract.measure_glb(glb);again=contract.measure_glb(out)
   for key in ('triangles','vertices','primitives','boundsM'):assert actual[key]==again[key],(stem,key)
  assert sha==exporter.digest(src)
  bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));bpy.context.view_layer.update();obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];b=bounds(obs)
  for edge in ['min','max']:
   for k in range(3):assert abs(b[edge][k]-actual['boundsM'][edge][k])<1e-5
  wheels=[]
  for o in bpy.context.scene.objects:
   if not o.name.startswith('wheel-'):continue
   center=o.matrix_world.translation;c=[center.x,center.z,-center.y]
   if o.type=='MESH':points=[o.matrix_world@v.co for v in o.data.vertices]
   else:
    owner=bpy.data.objects['trim'];points=[owner.matrix_world@v.co for v in owner.data.vertices];points=[p for p in points if abs(p.x-center.x)<.111 and abs(p.y-center.y)<=s['radius']+.001 and abs(p.z-center.z)<=s['radius']+.001];assert len(points)>=12
   r=max(math.hypot(p.z-center.z,p.y-center.y) for p in points)
   assert abs(r-s['radius'])<1e-5 and abs(c[1]-r)<1e-5 and abs(abs(c[2])-s['wheelbase']/2)<1e-5
   wheels.append({'node':o.name,'centerM':c,'radiusM':r,'contactY':c[1]-r,'anchorOnly':o.type=='EMPTY'})
  assert len(wheels)==4
  records.append({'assetId':aid,'lod':level,'sourceReopened':True,'editableMeshes':source_mesh_count,'materialNodes':source_nodes,'sourceSha256':sha,'sourceUnchanged':True,'preservingReexportEquivalent':True,'glbReimportBoundsM':b,'wheels':wheels})
# Deliberately edit a copied .blend, then reopen it through the actual exporter.
with tempfile.TemporaryDirectory(prefix='traffic-edit-proof-') as tmp:
 tmp=Path(tmp);original=HERE/'source/traffic-sedan.lod0.blend';before=exporter.digest(original);bpy.ops.wm.open_mainfile(filepath=str(original));body=bpy.data.objects['body-shell'];v=body.data.vertices[44];v.co.x+=.017;v.co.z+=.009;expected=list(v.co);body.data.uv_layers.active.data[0].uv.x+=.073;expected_uv=list(body.data.uv_layers.active.data[0].uv)
 paint=bpy.data.materials['paint'];paint.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.33,.52,.18,1);paint.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.43
 edited=tmp/'artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);edited_sha=exporter.digest(edited);out=tmp/'artist-edit.glb';exporter.export_one(edited,out);doc,binary=contract.read_glb(out)
 exported_paint=next(m for m in doc['materials'] if m['name']=='paint')['pbrMetallicRoughness'];assert all(abs(a-b)<1e-6 for a,b in zip(exported_paint['baseColorFactor'],[.33,.52,.18,1]));assert abs(exported_paint['roughnessFactor']-.43)<1e-6
 node=next(n for n in doc['nodes'] if n.get('name')=='body-shell');pr=doc['meshes'][node['mesh']]['primitives'][0];uvs=contract.accessor(doc,binary,pr['attributes']['TEXCOORD_0']);assert any(abs(u-expected_uv[0])<1e-5 and abs(v-(1-expected_uv[1]))<1e-5 for u,v in uvs)
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out));body=bpy.data.objects['body-shell'];assert min((v.co-Vector(expected)).length for v in body.data.vertices)<1e-5
 assert exporter.digest(edited)==edited_sha and exporter.digest(original)==before
 bpy.ops.wm.open_mainfile(filepath=str(edited));mat=bpy.data.materials['paint'];mat.node_tree.nodes.new('ShaderNodeTexNoise');denied=False
 try:exporter.graph_check(mat)
 except AssertionError:denied=True
 assert denied,'unsupported graph must fail loudly, never silently reset artist nodes'
 proof={'status':'pass','editedCopyReopened':True,'originalSourceUnchanged':True,'editedSourceUnchangedDuringExport':True,'meshDeltaPreservedM':[.017,0,.009],'uvEditPreserved':True,'paintColorPreserved':[.33,.52,.18,1],'roughnessPreserved':.43,'unsupportedGraphRejected':True,'originalSourceSha256':before,'editedSourceSha256':edited_sha,'editedGlbSha256':exporter.digest(out),'proofFiles':'temporary copies deliberately excluded; reproducible with this script'}
(HERE/'qa/blender-audit.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'device':'CPU','threads':2,'results':records},indent=2)+'\n');(HERE/'qa/source-edit-preservation.json').write_text(json.dumps(proof,indent=2)+'\n');print('CAR_BLENDER_AUDIT_PASSED')
