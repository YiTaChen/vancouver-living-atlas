"""Reopen all editable sources, reimport all delivered GLBs, and verify source-preserving export with real artist-like edits."""
import importlib.util,json,math,os,platform,sys,tempfile
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('exporter',HERE/'export.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)
m=json.loads((HERE/'manifest.json').read_text());records=[];reexport_temp=tempfile.TemporaryDirectory(prefix='b04-reexport-');reexport_dir=Path(reexport_temp.name)
for a in m['assets']:
    for l in a['lods']:
        src=HERE/l['source'];before=e.contract.digest(src);bpy.ops.wm.open_mainfile(filepath=str(src))
        obs=list(bpy.context.scene.objects);assert obs and all(o.type=='MESH' for o in obs);assert bpy.context.scene['asset_id']==a['id'];assert bpy.context.scene['lod']==l['level']
        assert all('UVMap' in o.data.uv_layers and len(o.data.materials)==1 for o in obs);assert all(all(abs(x-1)<1e-6 for x in o.scale) for o in obs)
        assert not list(bpy.data.images);components=len(obs)
        roundtrip=reexport_dir/(a['id']+'.lod%d.glb'%l['level']);e.export_one(src,roundtrip)
        assert e.contract.digest(roundtrip)==l['sha256'],'source-preserving full re-export differs from delivery'
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(HERE/l['file']))
        pts=[];tris=0
        for ob in bpy.context.scene.objects:
            assert ob.type=='MESH';assert ob.matrix_world.determinant()>0;ob.data.calc_loop_triangles();tris+=len(ob.data.loop_triangles)
            for v in ob.data.vertices:
                p=ob.matrix_world@v.co;pts.append((p.x,p.z,-p.y))
        bounds={'min':[min(p[k] for p in pts) for k in range(3)],'max':[max(p[k] for p in pts) for k in range(3)]};bounds['size']=[bounds['max'][k]-bounds['min'][k] for k in range(3)]
        assert tris==l['triangles']
        for side in bounds:
            assert all(abs(x-y)<1e-4 for x,y in zip(bounds[side],l['boundsM'][side])),('Blender reimport bounds',a['id'])
        assert before==e.contract.digest(src)
        records.append({'assetId':a['id'],'level':l['level'],'sourceSha256':before,'glbSha256':l['sha256'],'editableComponents':components,'triangles':tris,'reimportedBoundsM':bounds,'sourcePreservingReexport':'pass','reexportSha256':e.contract.digest(roundtrip),'sourceReopened':'pass','actualGLBReimport':'pass','appliedScale':'pass','UV':'pass'})

reexport_temp.cleanup()

# Isolated artist-edit test: geometry + UV + Principled value, not regenerated defaults.
with tempfile.TemporaryDirectory(prefix='b04-edit-') as td:
    td=Path(td);source=HERE/'source/waterfront-capital.lod0.blend';before=e.contract.digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source));ob=bpy.data.objects['capital-abacus']
    for v in ob.data.vertices:
        if v.co.x>.79:v.co.x+=.013
    target_uv=list(ob.data.uv_layers.active.data[0].uv);target_uv[0]+=.075;ob.data.uv_layers.active.data[0].uv=target_uv
    mat=ob.data.materials[0];mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.52
    bpy.context.preferences.filepaths.save_version=0;edit=td/'artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edit),compress=True);editsha=e.contract.digest(edit)
    glb=td/'artist-edit.glb';r=e.export_one(edit,glb);d,b=e.contract.read_glb(glb)
    assert abs(r['boundsM']['max'][0]-.813)<1e-5
    assert abs(d['materials'][0]['pbrMetallicRoughness']['roughnessFactor']-.52)<1e-5
    uv=[]
    for mesh in d['meshes']:
        for p in mesh['primitives']:uv+=e.contract.accessor(d,b,p['attributes']['TEXCOORD_0'])
    # Standard glTF exporter flips V once relative to Blender UV.
    assert any(abs(p[0]-target_uv[0])<1e-5 and abs(p[1]-(1-target_uv[1]))<1e-5 for p in uv),'authored UV edit lost'
    assert editsha==e.contract.digest(edit) and before==e.contract.digest(source)
    result={'status':'pass','changes':{'geometry':'capital abacus +X face moved .013 m','UV':'one author UV U +.075 preserved after standard glTF V flip','material':'roughness .79 -> .52 preserved'},'originalSourceUnchanged':True,'editedSourceUnchangedByExporter':True,'originalSourceSha256':before,'editedSourceSha256':editsha,'editedExportSha256':e.contract.digest(glb),'measuredMaxXM':r['boundsM']['max'][0],'sourceRegenerationUsed':False}
    (HERE/'qa/source-edit-test.json').write_text(json.dumps(result,indent=2)+'\n')
report={'status':'pass','blenderVersion':bpy.app.version_string,'platform':platform.platform(),'cpu':platform.processor() or platform.machine(),'threads':2,'sourceAndReimportChecks':records,'sourceEditsPreserved':True}
(HERE/'qa/blender-audit.json').write_text(json.dumps(report,indent=2)+'\n');print('B04_BLENDER_REOPEN_REIMPORT_AND_EDIT_TEST_PASSED')
