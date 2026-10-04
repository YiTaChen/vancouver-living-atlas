"""Reopen editable sources, export without rebuild, reimport and test real GLB surfaces."""
import hashlib,json,sys,tempfile
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import ROOT,IDS,clean,export_source,xyz
from contract import C,dump

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def top_at(x,z):
 scene=bpy.context.scene;hit,p,n,i,o,m=scene.ray_cast(bpy.context.evaluated_depsgraph_get(),Vector(xyz([x,5,z])),Vector((0,0,-1)),distance=10);assert hit;return p.z
records=[]
with tempfile.TemporaryDirectory(prefix='station-source-audit-') as d:
 tmp=Path(d)
 for aid in IDS:
  for lod in (0,1):
   src=ROOT/'source'/f'{aid}.lod{lod}.blend';before=digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert meshes and all(o.data.uv_layers for o in meshes);assert all(len(o.data.vertices)>0 for o in meshes);mods=sum(len(o.modifiers) for o in meshes);assert not any(o.type in ['CAMERA','LIGHT'] for o in bpy.context.scene.objects);out=tmp/f'{aid}.lod{lod}.glb';export_source(src,out);assert digest(src)==before
   orig=C.measure_glb(ROOT/'exports'/out.name);r=C.measure_glb(out);assert r['triangles']==orig['triangles'];assert all(abs(a-b)<1e-6 for a,b in zip(r['boundsM']['size'],orig['boundsM']['size']))
   clean();bpy.ops.import_scene.gltf(filepath=str(out));bpy.context.view_layer.update();surface=[]
   if aid=='platform-edge-2m':
    for x,z in [(-1.9,0),(0,0),(1.1,.8),(1.65,.3),(1.95,-.8)]:
     h=top_at(x,z);assert abs(h-.95)<=.006;surface.append({'x':x,'z':z,'measuredTopY':h,'nominalFloorY':.95})
   if aid in ['bus-threshold-deck','metro-threshold-deck']:
    x0,x1=(-.5,.45) if aid=='bus-threshold-deck' else (-.48,.42)
    for x,expected in [(x0+.001,.000075),(x0+.10,.0075),(0,.015),(x1-.1,.0075),(x1-.001,.000075)]:
     h=top_at(x,0);assert abs(h-expected)<.0002,(aid,x,h,expected);surface.append({'x':x,'z':0,'measuredTopY':h,'expectedY':expected})
   if aid=='station-guidance-sign':
    # 1.81m human capsule proxy plus .15m overhead clearance under clear opening.
    for x in [-.5,0,.5]:
     hit,*_=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),Vector(xyz([x,1.96,.5])),Vector(xyz([0,0,-1])),distance=1);assert not hit,'passage blocked'
   manifest=json.loads((ROOT/'manifest.json').read_text());a=next(a for a in manifest['assets'] if a['id']==aid)
   for an in a['anchors']:
    o=bpy.data.objects[an['id']];v=o.matrix_world.translation;p=[v.x,v.z,-v.y];assert all(abs(x-y)<1e-5 for x,y in zip(p,an['pointM'])),(aid,an['id'],p)
   records.append({'assetId':aid,'lod':lod,'status':'pass','editableMeshObjects':len(meshes),'editableModifiers':mods,'uvMeshes':len(meshes),'sourceUnchanged':True,'sourceSha256':before,'exportSha256':C.digest(ROOT/'exports'/out.name),'reexportGeometryMatches':True,'actualGlbReimported':True,'surfaceRays':surface})
 # Surgical vertex + node material edits saved to separate source, then exported via same path.
 src=ROOT/'source/bus-stop-pole.lod0.blend';before=digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));o=bpy.data.objects['stop-sign-frame'];v=max(o.data.vertices,key=lambda v:v.co.x);old=v.co.x;v.co.x+=.04;o['editProof']='source-vertex-plus-material';newcolor=[.115,.48,.62,1];bpy.data.materials['sign-face'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=newcolor;edited=tmp/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);out=tmp/'edited.glb';export_source(edited,out);r=C.measure_glb(out);orig=C.measure_glb(ROOT/'exports/bus-stop-pole.lod0.glb');assert r['boundsM']['max'][0]>orig['boundsM']['max'][0]+.02;doc,_=C.read_glb(out);mat=next(m for m in doc['materials'] if m['name']=='sign-face');assert all(abs(x-y)<1e-6 for x,y in zip(mat['pbrMetallicRoughness']['baseColorFactor'],newcolor));assert digest(src)==before
 proof={'status':'pass','method':'Copy original .blend in temporary directory; change one sign-frame mesh vertex +.04m X and sign-face Principled base color; save; source-preserving export; inspect actual GLB accessor bounds and material factor. Production source/export unchanged.','assetId':'bus-stop-pole','sourceHashUnchanged':True,'vertexXBefore':old,'vertexXAfter':old+.04,'baselineMaxX':orig['boundsM']['max'][0],'editedMaxX':r['boundsM']['max'][0],'editedMaterialFactor':mat['pbrMetallicRoughness']['baseColorFactor'],'generatorInvoked':False};dump('qa/source-edit-proof.json',proof)
dump('qa/blender-validation.json',{'status':'pass','environment':{'Blender':bpy.app.version_string,'device':'CPU','threads':2},'sourceRoundtrip':records,'humanCapsuleHeightsM':[1.75,1.81],'scaleReferenceM':1,'runtimeChecks':'not_run'})
