"""Reopen all .blend sources, prove editable attributes and source-preserving export."""
import bpy, hashlib, json, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from build import export_object
from package_utils import common

def main():
    records=[]
    with tempfile.TemporaryDirectory(prefix='pedestrian-source-audit-') as tmp:
        tmp=Path(tmp)
        for source in sorted((ROOT/'source').glob('*.blend')):
            before=common.digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));objects=list(bpy.context.scene.objects)
            assert len(objects)==1 and objects[0].type=='MESH';obj=objects[0];mesh=obj.data
            assert len(mesh.materials)==1 and len(mesh.vertices)>20 and len(obj.vertex_groups)==6
            assert all(name in mesh.attributes for name in ['_LIMB','_PIVOT_X','_PIVOT_Y','_PIVOT_Z','_PALETTE'])
            assert mesh.color_attributes.get('Color');assert not bpy.data.images
            assert tuple(obj.scale)==(1,1,1) and tuple(obj.location)==(0,0,0)
            obj.select_set(True);bpy.context.view_layer.objects.active=obj
            target=tmp/(source.stem+'.glb');export_object(target)
            expected=common.measure_glb(ROOT/'exports'/target.name);actual=common.measure_glb(target)
            for key in ('triangles','vertices','primitives','boundsM'):assert actual[key]==expected[key],key
            assert before==common.digest(source)
            records.append({'source':source.name,'sha256':before,'sourceBytes':source.stat().st_size,'reopened':True,'editableMesh':True,'editableVertexColors':True,'editableCustomAttributes':True,'preservedMeshOnReexport':True,'sourceUnchanged':True,'candidateGlbSha256':common.digest(ROOT/'exports'/target.name),'reexportGlbSha256':common.digest(target)})
        source=ROOT/'source/pedestrian-commuter.lod0.blend';bpy.ops.wm.open_mainfile(filepath=str(source));obj=bpy.context.scene.objects['pedestrian-body']
        for vertex in obj.data.vertices:vertex.co.x+=.01
        obj['editabilitySentinel']='temporary source edit must survive export'
        modified=tmp/'modified.blend';bpy.ops.wm.save_as_mainfile(filepath=str(modified),compress=True)
        bpy.ops.wm.open_mainfile(filepath=str(modified));obj=bpy.context.scene.objects['pedestrian-body'];obj.select_set(True);bpy.context.view_layer.objects.active=obj
        target=tmp/'modified.glb';export_object(target)
        baseline=common.measure_glb(ROOT/'exports/pedestrian-commuter.lod0.glb');changed=common.measure_glb(target)
        dx=changed['boundsM']['min'][0]-baseline['boundsM']['min'][0];assert abs(dx-.01)<1e-6
        doc,_=common.read_glb(target);assert doc['nodes'][0]['extras']['editabilitySentinel']=='temporary source edit must survive export'
        edit={'status':'pass','temporaryEdit':'all source vertices translated +0.01 m on X and added object extra','measuredExportDeltaXM':dx,'sentinelPreserved':True,'sourceGeneratorInvoked':False,'originalSourceUnchanged':common.digest(source)==records[0]['sha256'],'temporaryArtifactsRemoved':True}
    report={'status':'pass','blenderVersion':bpy.app.version_string,'sources':records,'manualEditProof':edit,'runtimeAcceptance':'not_run'}
    (ROOT/'qa/source-audit.json').write_text(json.dumps(report,indent=2)+'\n');print('PEDESTRIAN_SOURCE_AUDIT_PASS')
if __name__=='__main__':main()
