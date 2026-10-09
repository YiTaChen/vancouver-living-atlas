"""Source reopen/reexport/reimport + controlled edit proof, Blender CPU."""
import bpy,sys,json,tempfile,importlib.util,shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import common
spec=importlib.util.spec_from_file_location('source_exporter',ROOT/'export.py');ex=importlib.util.module_from_spec(spec);spec.loader.exec_module(ex)
records=[]
with tempfile.TemporaryDirectory(prefix='canada-source-audit-') as work:
 tmp=Path(work)
 for source in sorted((ROOT/'source').glob('*.blend')):
  out=tmp/(source.stem+'.glb');r=ex.module.export_source(source,out);delivered=ROOT/'exports'/out.name;r['deliveredSha256']=common.digest(delivered);r['byteIdentical']=r['outputSha256']==r['deliveredSha256'];a=common.measure_glb(out);b=common.measure_glb(delivered)
  for key in ['triangles','vertices','primitives']:assert a[key]==b[key]
  for key in ['min','max','size']:assert max(abs(x-y) for x,y in zip(a['boundsM'][key],b['boundsM'][key]))<1e-5
  bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out));deps=bpy.context.evaluated_depsgraph_get();points=[]
  for obj in bpy.context.scene.objects:
   if obj.type=='MESH':
    ev=obj.evaluated_get(deps);points.extend(ev.matrix_world@Vector(p) for p in ev.bound_box)
  lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)];r['reimportBoundsM']={'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]};r['status']='pass';records.append(r)
 source=ROOT/'source/canada-line-endcar-exterior.lod0.blend';before=common.digest(source);edit=tmp/'edited.blend';shutil.copy2(source,edit);bpy.ops.wm.open_mainfile(filepath=str(edit));obj=bpy.data.objects['body-shell'];obj.scale.x=1.03;bpy.ops.wm.save_as_mainfile(filepath=str(edit),compress=True);out=tmp/'edited.glb';ex.module.export_source(edit,out);orig=common.measure_glb(ROOT/'exports/canada-line-endcar-exterior.lod0.glb');changed=common.measure_glb(out);assert changed['boundsM']['size'][0]>orig['boundsM']['size'][0]+.05;assert common.digest(source)==before
 editproof={'status':'pass','operation':'Temporary copy of source; scale body-shell X1.03; save source; exporter opens edited blend without generation','originalWidthM':orig['boundsM']['size'][0],'editedWidthM':changed['boundsM']['size'][0],'canonicalSourceUnchanged':True,'canonicalSourceSha256':before}
(ROOT/'qa/source-roundtrip.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'device':'CPU','sources':records,'editProof':editproof},indent=2)+'\n')
