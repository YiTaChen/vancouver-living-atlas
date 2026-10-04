"""Reopen all native sources; baseline and artist-edit exports in fresh temp dirs."""
import bpy,bmesh,json,hashlib,importlib.util,tempfile,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent

def load(n,p):
 sp=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
ex=load('windows_export',HERE/'export.py');common=load('window_common',HERE.parent/'package-contract/validate.py')
def need(t,m):
 if not t:raise ValueError(m)
def signature(path):
 d,b=common.read_glb(path);out=[]
 for mesh in d['meshes']:
  for p in mesh['primitives']:
   out.append({k:common.accessor(d,b,a) for k,a in p['attributes'].items()});out[-1]['indices']=common.accessor(d,b,p['indices'])
 return out
results=[];proof=[]
with tempfile.TemporaryDirectory(prefix='source-fitted-window-proof-') as temp:
 tmp=Path(temp)
 for path in sorted((HERE/'source').glob('*.blend')):
  original=common.digest(path);bpy.ops.wm.open_mainfile(filepath=str(path));o=next(o for o in bpy.context.scene.objects if o.type=='MESH');scene=bpy.context.scene;bm=bmesh.new();bm.from_mesh(o.data)
  need(all(len(e.link_faces)==2 for e in bm.edges),'source must be watertight ring');need(bm.calc_volume(signed=True)>0,'outward signed volume');euler=len(bm.verts)-len(bm.edges)+len(bm.faces);need(euler==(2 if scene.get('asset_kind')=='paired-window-sill' else 0),'closed section topology');volume=bm.calc_volume(signed=True);bm.free()
  need(all(len(p.vertices)>=3 for p in o.data.polygons),'editable source polygons');need(scene.unit_settings.scale_length==1,'metres');need(len(o.data.uv_layers)==1,'single editable UV');need(len(o.data.materials)==1,'one semantic material')
  source_meta={'assetId':scene['asset_id'],'lod':scene['lod'],'editablePolygonFaces':len(o.data.polygons),'editableQuadFaces':sum(len(p.vertices)==4 for p in o.data.polygons),'meshVertices':len(o.data.vertices)}
  base_export=tmp/(path.stem+'.baseline.glb');ex.export_one(path,base_export);need(signature(base_export)==signature(HERE/'exports'/(path.stem+'.glb')),'baseline reexport geometry/UV/normal/tangent changed')
  results.append({**source_meta,'source':path.name,'sourceSha256':original,'nativeReopened':True,'watertight':True,'signedVolumeM3':volume,'eulerCharacteristic':euler,'sourceScale':[1,1,1],'baselineAttributeAndIndexParity':True})
  # Actual artist edits: move a rear outer corner, alter one UV loop and roughness.
  bpy.ops.wm.open_mainfile(filepath=str(path));o=next(o for o in bpy.context.scene.objects if o.type=='MESH');o.data.vertices[0].co.x+=.003;o.data.update();o.data.uv_layers.active.data[0].uv.x+=.017
  expected=[o.data.vertices[0].co.x,o.data.vertices[0].co.z,-o.data.vertices[0].co.y];edited_uv=list(o.data.uv_layers.active.data[0].uv);bs=o.data.materials[0].node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value+=.02;rough=bs.inputs['Roughness'].default_value
  edited=tmp/(path.stem+'.edited.blend');bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);edited_hash=common.digest(edited);export=tmp/(path.stem+'.edited.glb');ex.export_one(edited,export);need(common.digest(edited)==edited_hash,'edited source rewritten');need(common.digest(path)==original,'original source rewritten')
  d,b=common.read_glb(export);attr=d['meshes'][0]['primitives'][0]['attributes'];pos=common.accessor(d,b,attr['POSITION']);uv=common.accessor(d,b,attr['TEXCOORD_0'])
  need(any(max(abs(q[k]-expected[k]) for k in range(3))<1e-6 for q in pos),'artist geometry edit lost');need(any(abs(q[0]-edited_uv[0])<1e-6 and abs(q[1]-(1-edited_uv[1]))<1e-6 for q in uv),'artist UV edit lost');need(abs(d['materials'][0]['pbrMetallicRoughness']['roughnessFactor']-rough)<1e-6,'artist roughness edit lost');need(signature(export)!=signature(base_export),'artist geometry proof unchanged')
  proof.append({'source':path.name,'originalSourceSha256':original,'editedSourceSha256':edited_hash,'editedGlbSha256':common.digest(export),'vertexEditM':[.003,0,0],'uvEditU':.017,'roughnessEdit':.02,'expectedEditedVertexGltfM':expected,'expectedEditedGltfUV':[edited_uv[0],1-edited_uv[1]],'expectedRoughness':rough,'geometryPreserved':True,'uvPreserved':True,'materialFactorPreserved':True,'originalAndEditedSourcesUnchangedByExport':True})
 # Unsupported material nodes are rejected, not silently discarded.
 p=next((HERE/'source').glob('*.blend'));bpy.ops.wm.open_mainfile(filepath=str(p));next(o for o in bpy.context.scene.objects if o.type=='MESH').data.materials[0].node_tree.nodes.new('ShaderNodeTexNoise');bad=tmp/'unsupported.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad),compress=True)
 try:ex.export_one(bad,tmp/'unsupported.glb')
 except ValueError as e:rejected=str(e)
 else:raise ValueError('unsupported material accepted')
(HERE/'qa/blender-audit.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'results':results},indent=2)+'\n')
(HERE/'qa/source-edit-preservation.json').write_text(json.dumps({'status':'pass','method':'actual native Blender edits, save/reopen, ordinary glTF export and independent accessor/material comparison','results':proof,'unsupportedMaterialNodeRejected':rejected,'temporaryProofFiles':'not packaged; repeat this audit to regenerate','limitation':'single mesh with explicit quads and supported opaque Principled factors; arbitrary nodes/modifiers are rejected, never silently rebuilt'},indent=2)+'\n')
print('AUDITED_NATIVE_SOURCES_AND_ARTIST_EDITS',len(results))
