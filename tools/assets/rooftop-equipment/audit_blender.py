"""Independent source opening and actual GLB reimport measurement/ray checks."""
import argparse
import importlib.util
import json
from pathlib import Path
import platform
import sys
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('source_export',HERE/'export.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)

def bounds(objects):
    pts=[ob.matrix_world@v.co for ob in objects if ob.type=='MESH' for v in ob.data.vertices]
    # Convert imported Blender geometry back to glTF coordinates for independent comparison.
    pts=[(p.x,p.z,-p.y) for p in pts]
    lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
    return {'min':lo,'max':hi,'size':[hi[k]-lo[k] for k in range(3)]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    root=args.root.resolve();m=json.loads((root/'manifest.json').read_text());records=[]
    for a,spec in zip(m['assets'],e.CAT['assets']):
        for lod in a['lods']:
            source=root/lod['source'];before=e.contract.digest(source)
            bpy.ops.wm.open_mainfile(filepath=str(source));e.material_audit()
            scene=bpy.context.scene;obs=list(scene.objects)
            assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
            assert all(o.type=='MESH' and tuple(o.scale)==(1,1,1) and tuple(o.location)==(0,0,0) for o in obs)
            assert scene['asset_id']==a['id'] and scene['lod']==lod['level']
            assert all(o['component_id']==o.name and o['asset_id']==a['id'] for o in obs)
            assert all('UVMap' in o.data.uv_layers and len(o.data.materials)==1 for o in obs)
            names=[o.name for o in obs]
            if lod['level']==0:
                assert 'louvre-recess' in names and 'service-pipe' in names and 'fan-grille-x-00' in names
                assert any(mod.type=='BEVEL' for o in obs for mod in o.modifiers),'editable bevel retained'
            # Evaluated source triangle count is separate from the CPU GLB reader.
            dg=bpy.context.evaluated_depsgraph_get();triangles=0
            for o in obs:
                me=o.evaluated_get(dg).to_mesh();me.calc_loop_triangles();triangles+=len(me.loop_triangles);o.evaluated_get(dg).to_mesh_clear()
            assert triangles==lod['triangles'],(triangles,lod['triangles'])
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=str(root/lod['file']))
            imported=list(bpy.context.scene.objects);actual=bounds(imported)
            assert len(imported)==1 and imported[0].name=='body-shell' and imported[0].type=='MESH'
            for side in ['min','max','size']:
                assert all(abs(actual[side][k]-lod['boundsM'][side][k])<1e-5 for k in range(3)),('reimport bounds',a['id'])
            raychecks={}
            if lod['level']==0:
                w,h,d=spec['dimensionsM'];dg=bpy.context.evaluated_depsgraph_get()
                centres=[0] if spec['fans']==1 else [-w*.22,w*.22]
                for i,x in enumerate(centres):
                    hit,loc,*_=bpy.context.scene.ray_cast(dg,Vector((x+.12,.09+.13,h+1)),Vector((0,0,-1)))
                    assert hit and loc.z<h-.05,('fan opening ray',a['id'],loc.z)
                    raychecks['fan-%02d-recess-depthM'%i]=h-loc.z
                front=-(d-.28)/2
                hit,loc,*_=bpy.context.scene.ray_cast(dg,Vector((0,front-1,h*.3+.06)),Vector((0,1,0)))
                assert hit and loc.y>front-.025,('louvre groove ray',a['id'],loc.y,front)
                raychecks['louvre-frame-to-groove-depthM']=loc.y-(front-.069)
                assert raychecks['louvre-frame-to-groove-depthM']>.04
            assert before==e.contract.digest(source),'source modified by audit'
            records.append({'assetId':a['id'],'lod':lod['level'],'status':'pass','sourceComponents':names,'sourceTriangles':triangles,'reimportBoundsM':actual,'rayChecks':raychecks,'sourceHashUnchanged':True})
    args.report.write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'device':'CPU geometry/rays','platform':platform.platform(),'records':records},indent=2)+'\n')
    print('ROOFTOP_BLENDER_AUDIT_PASSED')
if __name__=='__main__':main()
