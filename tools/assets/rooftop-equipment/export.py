"""Source-preserving Blender exporter for rooftop-equipment.

Reads the selected saved .blend files, evaluates editable modifiers into temporary
meshes and merges by existing slots. Never rebuilds geometry, rewrites UVs or saves
source. Writes a separate fresh output directory; unsupported material edits fail.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import bpy
import bmesh

HERE=Path(__file__).resolve().parent
CAT=json.loads((HERE/'catalog.json').read_text())
spec=importlib.util.spec_from_file_location('package_contract',HERE.parent/'package-contract/validate.py')
contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)


def material_audit():
    allowed={s['material']:s for s in CAT['materials']}
    reference=bpy.data.materials.new('_audit_reference');reference.use_nodes=True
    rb=reference.node_tree.nodes.get('Principled BSDF')
    for mat in [m for m in bpy.data.materials if m.users and m!=reference]:
        assert mat.name in allowed,'unknown material role: '+mat.name
        assert mat.use_nodes and mat.use_backface_culling,'opaque PBR/culling required'
        nodes=list(mat.node_tree.nodes);bs=[n for n in nodes if n.type=='BSDF_PRINCIPLED'];outs=[n for n in nodes if n.type=='OUTPUT_MATERIAL']
        assert len(nodes)==2 and len(bs)==len(outs)==1,'unsupported edited material graph'
        assert all(not n.mute for n in nodes),'muted material graph'
        assert len(mat.node_tree.links)==1 and mat.node_tree.links[0].from_node==bs[0] and mat.node_tree.links[0].to_node==outs[0],'unsupported material wiring'
        assert mat['semantic_role']==allowed[mat.name]['role'] and mat['city_surface_id']=='painted-metal','changed material role'
        assert list(mat['physical_tile_metres'])==[.8,.8],'changed physical tile contract'
        for socket, reference_socket in zip(bs[0].inputs,rb.inputs):
            if not hasattr(socket,'default_value') or socket.name in ['Base Color','Roughness','Metallic']:continue
            value=socket.default_value;ref=reference_socket.default_value
            if hasattr(value,'__len__'):assert all(abs(a-b)<1e-6 for a,b in zip(value,ref)),('unsupported socket',socket.name)
            elif isinstance(value,(float,int)):assert abs(value-ref)<1e-6,('unsupported socket',socket.name)
        assert bs[0].inputs['Base Color'].default_value[3]==1,'opaque base alpha'
    bpy.data.materials.remove(reference)


def export_one(source,output):
    before=contract.digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source));material_audit()
    scene=bpy.context.scene
    assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1,'metre source required'
    objects=list(scene.objects)
    assert objects and all(o.type=='MESH' for o in objects),'only authored mesh sources; no QA geometry/cameras/lights'
    assert all(o.get('asset_id')==scene['asset_id'] and o.get('lod')==scene['lod'] for o in objects),'source asset metadata'
    assert all('UVMap' in o.data.uv_layers for o in objects),'source UVs required'
    names=[o.name for o in objects];deps=bpy.context.evaluated_depsgraph_get()
    copies=[]
    for ob in objects:
        assert all(abs(s-1)<1e-6 for s in ob.scale),'applied mesh scale required'
        me=bpy.data.meshes.new_from_object(ob.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
        copy=bpy.data.objects.new('_export_'+ob.name,me);scene.collection.objects.link(copy)
        copy.matrix_world=ob.matrix_world.copy();copies.append(copy)
    for ob in objects:bpy.data.objects.remove(ob,do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in copies:ob.select_set(True)
    bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join()
    merged=bpy.context.object;merged.name='body-shell';merged.data.name='hvac-role-mesh'
    merged['asset_id']=scene['asset_id'];merged['lod']=scene['lod'];merged['component_ids']=names
    bm=bmesh.new();bm.from_mesh(merged.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(merged.data);bm.free()
    # No regenerated UVs, node values or source geometry here.
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,
        export_yup=True,export_apply=False,export_texcoords=True,export_normals=True,
        export_tangents=True,export_materials='EXPORT',export_extras=True,
        export_cameras=False,export_lights=False,export_animations=False)
    assert before==contract.digest(source),'source was changed'
    return contract.measure_glb(output)


def make_manifest(output,source_root,records):
    assets=[]
    for item in CAT['assets']:
        aid=item['id'];w,h,d=item['dimensionsM'];lods=[]
        for level in [0,1]:
            filename=f'{aid}.lod{level}'
            source=f'source/{filename}.blend';file=f'exports/{filename}.glb'
            r=records[filename]
            lods.append({'level':level,'file':file,'sha256':contract.digest(output/file),'source':source,'sourceSha256':contract.digest(output/source),
                **{k:r[k] for k in ['boundsM','triangles','vertices','primitives','bytes','geometryBytes','embeddedImageBytes']},'triangleCap':CAT['budget']['triangles'][level]})
        cost={k:sum(l[k] for l in lods) for k in ['geometryBytes','embeddedImageBytes','bytes']}
        cost['glbTotalBytes']=cost.pop('bytes');cost['uniqueTexelBytesWithMips']=0
        assets.append({'id':aid,'taskId':'B01','variant':item['variant'],'kind':'rooftop-hvac','source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':lods[0]['boundsM'],
            'expectedDimensionsM':item['dimensionsM'],'dimensionToleranceM':.02,'dimensionBasis':CAT['dimensionBasis'],
            'pivot':{'frameId':'asset-root','positionM':[0,0,0],'meaning':'centre of roof-contact curb'},
            'attachmentDatum':{'kind':'roof-contact','axis':'+Y','planeY':0,'minimumY':0},'frontAxis':'+Z',
            'materialBindings':[{'material':s['material'],'role':s['role'],'surfaceId':s['surfaceId'],'maps':[],'primitiveMatch':'material index resolved by material name','physicalTileMeters':[.8,.8]} for s in CAT['materials']],
            'textureMode':'shared','textureCost':cost,
            'lodPolicy':{'levels':[0,1],'recommendedDistanceM':[35,110],'mode':'proposal, sample-measure before activation','farFallback':'existing architecture descriptor boxes; no all-city residency','nearInstanceCaps':{'High':24,'Ultra':48},'pilotCellCap':2},
            'clearance':{'frameId':'asset-root','footprintPolygonXZ':[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],'roofExclusionMarginM':1,'interUnitRadiusM':(w*w+d*d)**.5/2+.8,'serviceFace':'+Z','serviceAccessM':1,'reason':'existing roofBoxFits width/depth +2 m and radius +0.8 m rules retained, not safety-code certification'},
            'collision':{'kind':'box-primitives','frameId':'asset-root','primitives':[{'type':'box','centreM':[0,h/2,0],'sizeM':[w,h,d]}],'use':'optional conservative decorative envelope; no new navigation roof surface'},
            'anchors':[{'id':'roof-contact','frameId':'asset-root','positionM':[0,0,0]},{'id':'service-face','frameId':'asset-root','positionM':[0,h*.49,d/2]}],
            'placementCompatibility':{'profiles':['heritage-brick','lowrise-masonry','midrise-grid','balcony-slab','curtain-wall'],'roofTypes':['flat exposed roof'],'reject':['domestic-cladding','roofEaveHeight defined','part.roof false','polygon holes','higher source parts exclusions'],'legacyNominalFootprintRangeM':{'width':[2.2,3.61],'depth':[1.65,2.45]},'scale':[1,1,1],'selection':'choose fitting fixed-size variant by source seed, do not nonuniformly stretch to descriptor','datumTransform':'translation.y = ground + part.height; do not reuse legacy box-centre offset','fitTest':'roofBoxFits(polygon,x,z,fullWidth+2,fullDepth+2,yaw,part.roofExclusions)','sourceStatus':'representative placement, no measured per-building HVAC data'},
            'intendedConsumer':['lib/city/architecture-plan.ts','lib/city/architecture-details.ts'],
            'offlineChecks':{'status':'not_run','evidence':['qa/validation.json','qa/blender-audit.json','qa/source-roundtrip.json','qa/preview-index.json']},
            'runtimeChecks':{'status':'not_run','reason':'No WebGL city integration performed; asset-only package'}})
    return {'schemaVersion':1,'packageId':'rooftop-equipment','version':'1.0.0','baseRevision':CAT['baseRevision'],'status':'offline_partial','units':'metres',
        'coordinateSystem':{'authoring':{'up':'+Z','front':'-Y'},'gltf':{'up':'+Y','front':'+Z'},'conversion':'Blender (x,y,z) -> glTF (x,z,-y), once by standard exporter'},
        'provenance':{'source':'original procedural authored meshes for Vancouver Living Atlas','credit':'Based on Vancouver Living Atlas by YiTaChen','repository':'https://github.com/YiTaChen/vancouver-living-atlas','license':CAT['license'],'dimensionBasis':CAT['dimensionBasis'],'blenderVersion':bpy.app.version_string,'catalogSha256':contract.digest(HERE/'catalog.json'),'generatorSha256':contract.digest(HERE/'build.py'),'exporterSha256':contract.digest(HERE/'export.py'),'scope':'B01 first asset batch; existing parapet retained via compatibility adapter'},
        'reexportCommand':'blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/rooftop-equipment/export.py -- --source tools/assets/rooftop-equipment/source --output /tmp/rooftop-equipment-reexport',
        'validationCommand':'python3 tools/assets/rooftop-equipment/validate.py --root tools/assets/rooftop-equipment --blender-audit --report tools/assets/rooftop-equipment/qa/validation.json',
        'assets':assets,'textures':[],'materialNotes':'Texture-free role placeholders, no copied image maps. Future consumer may bind existing shared painted-metal once; current role tint is intentional and contains no baked illumination.'}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);src=args.source.resolve();out=args.output.resolve()
    assert not out.exists(),'Output must be a fresh directory; refusing source/output overwrite'
    assert out!=src and not out.is_relative_to(src) and not src.is_relative_to(out),'source/output trees overlap'
    out.mkdir(parents=True);(out/'exports').mkdir();(out/'source').mkdir();records={}
    for item in CAT['assets']:
        for level in [0,1]:
            stem=f'{item["id"]}.lod{level}';source=src/(stem+'.blend')
            shutil.copy2(source,out/'source'/source.name)
            records[stem]=export_one(source,out/'exports'/(stem+'.glb'))
    (out/'manifest.json').write_text(json.dumps(make_manifest(out,src,records),indent=2)+'\n')
    print('ROOFTOP_SOURCE_PRESERVING_EXPORT_PASSED')
if __name__=='__main__':main()
