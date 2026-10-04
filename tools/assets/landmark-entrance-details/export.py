"""B04 source-preserving exporter. Opens saved .blend; never runs build or saves sources."""
import argparse,importlib.util,json,shutil,sys
from pathlib import Path
import bpy,bmesh
HERE=Path(__file__).resolve().parent
CAT=json.loads((HERE/'catalog.json').read_text())
s=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(s);s.loader.exec_module(contract)

def export_one(source,output):
    before=contract.digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene
    assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1,'metre source required'
    obs=list(scene.objects);assert obs and all(o.type=='MESH' for o in obs),'QA/unsupported object in source'
    assert all(o.get('asset_id')==scene['asset_id'] and o.get('lod')==scene['lod'] for o in obs),'source identity'
    mats={s['name']:s for s in CAT['materials']}
    for m in [m for m in bpy.data.materials if m.users]:
        assert m.name in mats and m.use_nodes and m.use_backface_culling,'unknown/transparent role'
        nodes=list(m.node_tree.nodes);bs=[n for n in nodes if n.type=='BSDF_PRINCIPLED'];out=[n for n in nodes if n.type=='OUTPUT_MATERIAL']
        assert len(nodes)==2 and len(bs)==len(out)==1,'unsupported material graph; export must not silently discard authored nodes'
        assert len(m.node_tree.links)==1 and m.node_tree.links[0].from_node==bs[0] and m.node_tree.links[0].to_node==out[0],'unsupported shader graph'
        assert m['semantic_role']==mats[m.name]['role'] and m['surface_id']==mats[m.name]['surfaceId'],'role drift'
        assert bs[0].inputs['Alpha'].default_value==1 and bs[0].inputs['Base Color'].default_value[3]==1,'opaque role required'
    names=[o.name for o in obs];deps=bpy.context.evaluated_depsgraph_get();copies=[]
    for o in obs:
        assert all(abs(v-1)<1e-6 for v in o.scale),'apply source scale first'
        assert 'UVMap' in o.data.uv_layers,'missing metre UV'
        me=bpy.data.meshes.new_from_object(o.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
        ob=bpy.data.objects.new('_export_'+o.name,me);scene.collection.objects.link(ob);ob.matrix_world=o.matrix_world.copy();copies.append(ob)
    for o in obs:bpy.data.objects.remove(o,do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in copies:o.select_set(True)
    bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();merged=bpy.context.object;merged.name=scene['asset_id'];merged['components']=names
    bm=bmesh.new();bm.from_mesh(merged.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(merged.data);bm.free()
    bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    assert before==contract.digest(source),'source mutated'
    return contract.measure_glb(output)

def make_manifest(out,records):
    assets=[]
    for item in CAT['assets']:
        aid=item['id'];lods=[];mat=next(m for m in CAT['materials'] if m['name']==item['material'])
        for level in range(3):
            stem=aid+'.lod%d'%level;src='source/'+stem+'.blend';file='exports/'+stem+'.glb';r=records[stem]
            lods.append({'level':level,'file':file,'source':src,'sourceSha256':contract.digest(out/src),'sha256':contract.digest(out/file),**{k:r[k] for k in ['boundsM','triangles','vertices','primitives','bytes','geometryBytes','embeddedImageBytes']}})
        marine=aid.startswith('marine')
        clearance={'kind':'decorative-only','newWalkableSpace':False}
        if item['kind']=='window-reveal':clearance={'kind':'through-mesh-aperture','rectangleXY':[-1.5,.16,1.5,5.16],'clearDimensionsM':[3,5],'shellCarving':False,'retainedGlass':'existing upper-window glazing behind surround'}
        if marine:clearance={'kind':'existing-visual-recess','halfWidthM':2.55,'springY':3.7,'archRiseM':2.82,'bottomY':.16,'topY':6.52,'projectionMaxM':.24,'transomGrilleStartsY':3.15,'newWalkableSpace':False}
        cost={k:sum(l[k] for l in lods) for k in ['geometryBytes','embeddedImageBytes','bytes']};cost['glbTotalBytes']=cost.pop('bytes');cost['uniqueTexelBytesWithMips']=0
        assets.append({'id':aid,'taskId':'B04','variant':'original-consumer-compatible','kind':item['kind'],'source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':lods[0]['boundsM'],'expectedDimensionsM':item['dimensionsM'],'dimensionToleranceM':.02,'dimensionBasis':item['basis'],
        'pivot':{'positionM':[0,0,0],'frameId':item['datum']},'attachmentDatum':{'kind':item['datum'],'positionM':[0,0,0],'assembly':'assembly-plan.json','note':'Marine baseline threshold=.16; apply thresholdY-.16 once, no bounds recentering' if marine else 'Unscaled attachment in existing station local frame'},'frontAxis':'+Z',
        'materialBindings':[{'material':mat['name'],'role':mat['role'],'surfaceId':mat['surfaceId'],'maps':[],'primitiveMatch':'material name, not tint','physicalTileMeters':[mat['tileMeters']]*2}],
        'textureMode':'shared','textureCost':cost,'lodPolicy':{'levels':[0,1,2],'recommendedDistanceM':[35,90,180],'status':'proposal; city sample required','scale':[1,1,1],'farFallback':'existing procedural shell','familyBudget':'B-HERO, see assembly-plan.json instance-aware costs'},'clearance':clearance,
        'collision':{'kind':'retain-existing','addPrimitives':[],'reason':'Preserve original solidFootprints; Marine remains a viewing recess' if marine else 'Preserve existing station shell, doorway and site obstacle definitions'},'anchors':[{'id':item['datum'],'positionM':[0,0,0]}],
        'placementCompatibility':{'assembly':'assembly-plan.json','frame':'marine facade edge [4,5] tangent/up/outward-normal' if marine else 'Waterfront existing station-local frame','scale':[1,1,1],'selection':'named source-owned component only','worldCoordinateOverrides':False},'intendedConsumer':['lib/city/assets/marine-entry.ts'] if marine else ['lib/city/interiors.ts'],
        'offlineChecks':{'status':'not_run','evidence':['qa/validation.json','qa/blender-audit.json','qa/source-edit-test.json','qa/preview-index.json']},'runtimeChecks':{'status':'not_run','reason':'Offline asset task; no city WebGL integration'}})
    return {'schemaVersion':1,'packageId':CAT['packageId'],'version':'1.0.0','baseRevision':CAT['baseRevision'],'status':'offline_partial','units':'metres','coordinateSystem':{'authoring':'Blender Z-up, -Y front','gltf':'Y-up, +Z front','conversion':'Blender (x,y,z) -> glTF (x,z,-y), exactly once'},'provenance':{'credit':'Based on Vancouver Living Atlas by YiTaChen','repository':'https://github.com/YiTaChen/vancouver-living-atlas','license':CAT['license'],'source':'Original authored analytic meshes, informed by current consumer dimensions. No photograph, external model, copied sculpture or baked photo texture. Decorative interpretation, not surveyed restoration.','blenderVersion':bpy.app.version_string,'generatorSha256':contract.digest(HERE/'build.py'),'exporterSha256':contract.digest(HERE/'export.py')},'reexportCommand':'blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/landmark-entrance-details/export.py -- --source tools/assets/landmark-entrance-details/source --output /tmp/landmark-entrance-reexport','validationCommand':'python3 tools/assets/landmark-entrance-details/validate.py --root tools/assets/landmark-entrance-details','assets':assets,'textures':[],'materialNotes':'Zero new images. Sandstone role can bind existing shared city sandstone once. Marine ceramic/copper remain texture-free shared role materials; retain independent existing glass and night-light consumers.'}

def run(source,out):
    assert not out.exists(),'Fresh export output required';assert out!=source and not out.is_relative_to(source) and not source.is_relative_to(out),'overlapping source/output'
    (out/'source').mkdir(parents=True);(out/'exports').mkdir();records={}
    for a in CAT['assets']:
        for lod in range(3):
            stem=a['id']+'.lod%d'%lod;src=source/(stem+'.blend');shutil.copy2(src,out/'source'/src.name);records[stem]=export_one(src,out/'exports'/(stem+'.glb'))
    (out/'manifest.json').write_text(json.dumps(make_manifest(out,records),indent=2)+'\n');return records

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);run(args.source.resolve(),args.output.resolve());print('B04_SOURCE_PRESERVING_EXPORT_PASSED')
