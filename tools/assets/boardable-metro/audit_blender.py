"""Reopen every editable source, export without generation, reimport, prove a source edit survives."""
import bpy,sys,json,tempfile,hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from export import export_source
from contract import common

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def measure_import(p):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(p));points=[]
 for obj in bpy.context.scene.objects:
  if obj.type=='MESH':
   for v in obj.data.vertices:
    q=obj.matrix_world@v.co;points.append([q.x,q.z,-q.y])
 lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
 return {'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]}
work=Path(tempfile.mkdtemp(prefix='metro-source-audit-'));out=[];batch_reports=[]
from audit_batch import audit as audit_batch
for source in sorted((ROOT/'source').glob('*.blend')):
 target=work/(source.stem+'.glb');r=export_source(source,target);actual=ROOT/'exports'/target.name;a=common.measure_glb(actual);b=common.measure_glb(target);assert all(abs(a['boundsM'][s][i]-b['boundsM'][s][i])<1e-5 for s in ['min','max','size'] for i in range(3));assert a['triangles']==b['triangles'];bounds=measure_import(actual);assert all(abs(a['boundsM'][s][i]-bounds[s][i])<1e-4 for s in ['min','max','size'] for i in range(3));r.update({'status':'pass','actualDeliveredSha256':digest(actual),'reimportBoundsM':bounds,'triangles':a['triangles'],'sourceBytes':source.stat().st_size,'sourceUnder20MiB':source.stat().st_size<=20*1024*1024});out.append(r)
 if 'interior' in source.stem:
  unbatched=work/('unbatched-'+source.stem+'.glb');export_source(source,unbatched,batch_interior=False);batch_reports.append(audit_batch(unbatched,actual))
source=ROOT/'source/expo-metro-lead-exterior.lod0.blend';before=digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));best=None
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  for v in o.data.vertices:
   z=(o.matrix_world@v.co).z
   if best is None or z>best[0]:best=(z,o,v)
best[2].co.z+=.011
bpy.data.materials['metro-paint'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.123
edited=work/'edited-source.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);editglb=work/'edited.glb';edit=export_source(edited,editglb);measured=common.measure_glb(editglb);baseline=common.measure_glb(ROOT/'exports/expo-metro-lead-exterior.lod0.glb');assert abs(measured['boundsM']['max'][1]-baseline['boundsM']['max'][1]-.011)<1e-4
D,B=common.read_glb(editglb);rough=next(m['pbrMetallicRoughness']['roughnessFactor'] for m in D['materials'] if m['name']=='metro-paint');assert abs(rough-.123)<1e-5;assert digest(source)==before
report={'status':'pass','blenderVersion':bpy.app.version_string,'device':'CPU','threads':2,'sources':out,'editedSourceProof':{'status':'pass','originalSourceUnchanged':True,'originalSourceSha256':before,'editedSourceSha256':digest(edited),'editedExportSha256':digest(editglb),'geometryDeltaYMetres':measured['boundsM']['max'][1]-baseline['boundsM']['max'][1],'materialRoughness':rough,'proof':'A copied source vertex moved +0.011m and material roughness changed to .123; source-preserving exporter retained both changes without executing build.py.'},'workOutputsRetainedOutsidePackage':str(work)}
# Editing a copied interior source must survive the export-only batching path too.
interior_source=ROOT/'source/expo-metro-shared-interior.lod0.blend';ihash=digest(interior_source);bpy.ops.wm.open_mainfile(filepath=str(interior_source))
for vert in bpy.data.objects['floor'].data.vertices:
 if vert.co.z>0:vert.co.z+=.011
bpy.data.materials['metro-floor'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.123
icopy=work/'edited-interior-source.blend';bpy.ops.wm.save_as_mainfile(filepath=str(icopy),compress=True);iglb=work/'edited-interior.glb';export_source(icopy,iglb);dd,bb=common.read_glb(iglb);floor_range=next(r for n in dd['nodes'] for r in n.get('extras',{}).get('componentRanges',[]) if r['componentId']=='floor');rr=next(mat['pbrMetallicRoughness']['roughnessFactor'] for mat in dd['materials'] if mat['name']=='metro-floor');assert abs(floor_range['boundsM']['max'][1]-.961)<1e-5 and abs(rr-.123)<1e-5;assert dd['extras']['staticBatching']['renderPrimitiveCount']==6 and digest(interior_source)==ihash
report['editedInteriorBatchProof']={'status':'pass','originalSourceUnchanged':True,'originalSourceSha256':ihash,'editedSourceSha256':digest(icopy),'editedExportSha256':digest(iglb),'floorTopYMetres':floor_range['boundsM']['max'][1],'floorTopDeltaMetres':floor_range['boundsM']['max'][1]-.95,'materialRoughness':rr,'batchPrimitives':6,'proof':'Editable floor top vertices raised 11mm and metro-floor roughness changed to .123 in a copied source; both persist through actual six-primitive export-only batching.'}
report['staticBatchComparisons']=batch_reports
(ROOT/'qa/static-batching.json').write_text(json.dumps({'status':'pass','method':'Fresh unbatched source export compared to actual delivered batched GLB; exact component index order/material identity and float32 geometry attribute comparison.','results':batch_reports},indent=2)+'\n')
(ROOT/'qa/source-roundtrip.json').write_text(json.dumps(report,indent=2)+'\n')
