"""Source-preserving exporter: opens existing independent sources, never regenerates them.
All edited objects/materials are checked; unsupported shader edits fail closed.
"""
import bpy, sys, json, argparse, shutil, importlib.util, hashlib, subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(sp);sp.loader.exec_module(contract)
IDS=['cedar-bench','heritage-lamp','transit-shelter','arterial-lamp-8m','garbage-bin','fire-hydrant','bicycle-rack','bollard']
CAPS={'cedar-bench':([1000,200],[192*1024,48*1024]),'heritage-lamp':([1500,300],[256*1024,64*1024]),'transit-shelter':([3000,600],[512*1024,128*1024]),'arterial-lamp-8m':([1500,300],[256*1024,64*1024])}

def graph_check(mat):
    assert mat and mat.use_nodes and mat.get('semantic_role') in ['wood','metal','glass','diffuser'],'missing recognized semantic material role'
    ns=mat.node_tree.nodes;assert len(ns)==2 and {n.type for n in ns}=={'OUTPUT_MATERIAL','BSDF_PRINCIPLED'},'Unsupported edited shader graph: bake or implement explicit preservation before export'
    bs=next(n for n in ns if n.type=='BSDF_PRINCIPLED');out=next(n for n in ns if n.type=='OUTPUT_MATERIAL')
    assert len(mat.node_tree.links)==1 and out.inputs['Surface'].links[0].from_node==bs and not any(n.mute for n in ns),'unsupported shader wiring'
    allowed={'Base Color','Roughness','Metallic','Alpha','Emission Color','Emission Strength'}
    ref=bpy.data.materials.new('_graph_reference');ref.use_nodes=True;r=ref.node_tree.nodes.get('Principled BSDF')
    for s,rs in zip(bs.inputs,r.inputs):
        if not hasattr(s,'default_value') or s.name in allowed:continue
        a=s.default_value;b=rs.default_value
        if hasattr(a,'__len__'):assert all(abs(x-y)<1e-6 for x,y in zip(a,b)),'Unsupported edited shader socket '+s.name
        else:assert abs(a-b)<1e-6,'Unsupported edited shader socket '+s.name
    bpy.data.materials.remove(ref)

def export_one(source,out):
    before=contract.digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene
    assert s.unit_settings.scale_length==1 and s.unit_settings.system=='METRIC'
    original=list(s.objects);assert original and all(o.type in ['MESH','CURVE'] and not o.animation_data and not o.parent for o in original)
    for o in original:
        assert all(abs(v-1)<1e-5 for v in o.scale),'Apply authoring scale before export'
        assert o.get('semantic_role') in ['wood','metal','glass','diffuser']
        assert len(o.data.materials)==1,'one semantic material per editable part'
        graph_check(o.data.materials[0])
        assert o.type=='CURVE' or o.data.uv_layers.active,'editable UV missing'
    # Work only on in-memory copies; evaluated modifiers/curves exported, source not resaved.
    bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=original[0];bpy.ops.object.convert(target='MESH')
    for o in s.objects:
        if not o.data.uv_layers.active:
            uv=o.data.uv_layers.new(name='UVMap')
            for li,l in enumerate(o.data.loops):
                v=o.matrix_world@o.data.vertices[l.vertex_index].co;uv.data[li].uv=(v.x,v.z)
    for role in ['metal','wood','glass','diffuser']:
        obs=[o for o in s.objects if o.get('semantic_role')==role]
        if not obs:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();o=bpy.context.object;o.name=role;o['semantic_role']=role
    for o in s.objects:
        bpy.context.view_layer.objects.active=o
        m=o.modifiers.new('Export triangulation','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action='SELECT')
    out.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    assert before==contract.digest(source),'source changed';return contract.measure_glb(out)

def write_manifest(out,records):
    base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=HERE).decode().strip();assets=[]
    for aid in IDS:
        lods=[]
        for level in [0,1]:
            stem=f'{aid}.lod{level}';r=records[stem];src='source/'+stem+'.blend';file='exports/'+stem+'.glb'
            lods.append({'level':level,'source':src,'sourceSha256':contract.digest(out/src),'file':file,'sha256':contract.digest(out/file),**{k:r[k] for k in ['boundsM','triangles','vertices','primitives','bytes','geometryBytes','embeddedImageBytes']}})
        bounds=lods[0]['boundsM'];caps=CAPS.get(aid,([1000,200],[192*1024,48*1024]));roles=records[aid+'.lod0']['materialNames'];lo=bounds['min'];hi=bounds['max']
        collision={'kind':'individual-component-aabb','file':'qa/collision-proxies.json','assetId':aid,'note':'Per-component source-derived boxes, never a shelter/rack full solid bounding box; candidate broadphase only.'}
        clear={'pedestrianPassageOutsideFootprintM':1.8,'doorwayApproachExclusionM':1.5,'parkedCarDoorSweepExclusionM':.9,'thresholdSlopeMaxM':.14,'datumSampleCountMinimum':3,'certification':'Representative game-clearance goals, not a legal accessibility certification.'}
        anchors=[{'id':'ground-datum','positionM':[0,0,0]}]
        if aid=='cedar-bench':clear.update(seatCenterHeightM=.48,seatTopHeightM=.509,frontSeatApproachDepthM=.9);anchors += [{'id':'seat-center','positionM':[0,.509,0]}]
        if aid=='transit-shelter':
            clear.update(minimumHeadroomM=2.59,entryWidthM=4.095,standingBoxM={'min':[-1.15,0,-.18],'max':[1.15,2.45,.22]},pedestrianRoute='Retain 1.8 m external front corridor; shelter bench/timetable zone is not a through corridor.')
            anchors += [{'id':'entry-center','positionM':[0,0,.34]},{'id':'shelter-seat','positionM':[.25,.509,-.69]}]
        if aid=='bicycle-rack':clear['bicycleParkingEnvelopeM']={'min':[-1.10,0,-.70],'max':[1.10,1.20,.70]}
        footprint=[[lo[0],lo[2]],[hi[0],lo[2]],[hi[0],hi[2]],[lo[0],hi[2]]]
        targets={'cedar-bench':[2.02,.9854,.70],'heritage-lamp':[2.13,4.49,.47],'transit-shelter':[4.56,2.82,1.86],'arterial-lamp-8m':[1.91,8,.34],'garbage-bin':[.58,.97,.58],'fire-hydrant':[.55,.854,.41],'bicycle-rack':[.97,.84,.17],'bollard':[.19,.90,.19]}
        dims=dict(zip(['width','height','depth'],targets[aid]))
        if aid=='cedar-bench':dims['width']=2.02;dims['seatCenterHeight']=.48
        if aid=='heritage-lamp':dims['height']=4.49
        if aid=='transit-shelter':dims.update(width=4.56,height=2.82,depth=1.86)
        if aid=='arterial-lamp-8m':dims['height']=8.0
        a={'id':aid,'taskId':'F01' if aid in IDS[:4] else 'F02','variant':aid,'kind':'street-furniture','source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':bounds,'expectedDimensionsM':dims,'dimensionToleranceM':.02,'dimensionBasis':'Existing streetscape generator contract; source dimensions preserved with added bench ground-contact shoes.' if aid in IDS[:3] else 'New original representative design target, not a measured or official manufactured model.','pivot':{'positionM':[0,0,0],'meaning':'Original front-post frame retained for shelter; center ground frame for other props.'},'attachmentDatum':{'kind':'ground','planeY':0,'minimumGroundSamplePoints':3,'scale':[1,1,1]},'frontAxis':'+Z','materialBindings':[{'material':role,'node':role,'role':role,'surfaceId':{'wood':'cedar','metal':'painted-metal','glass':'dedicated-glass','diffuser':'visual-diffuser'}[role],'maps':{},'bindingMode':'Untextured semantic PBR placeholder; future consumer may bind shared library after UV and color review','uvUnits':'one repeat per authored metre; not auto-scaled to current catalog period','alphaMode':'BLEND' if role=='glass' else 'OPAQUE','doubleSided':role=='glass','pointLight':False} for role in roles],'textureMode':'role-placeholders-no-maps','textureCost':{'geometryBytes':sum(l['geometryBytes'] for l in lods),'embeddedImageBytes':0,'glbTotalBytes':sum(l['bytes'] for l in lods),'uniqueTexelBytesWithMips':0,'gpuResidency':'not measured'},'lodPolicy':{'levels':[0,1],'triangleCaps':caps[0],'geometryByteCaps':caps[1],'suggestedDistanceM':[30,100],'activation':'Source-selected near-view replacement only, projected-size tuning pending','keepScale':[1,1,1]},'clearance':clear,'collision':collision,'anchors':anchors,'placementCompatibility':{'footprintPolygonXZ':footprint,'sourceSelection':'placement-proposal.json','noRandomPopulationIncrease':True,'noWorldXyzExceptions':True,'sourceMeasuredFurnitureLocation':False,'nonuniformScaleAllowed':False,'rejectionRules':['doorway polygon or approach intersection','pedestrian corridor narrower than 1.8 m','car-door sweep overlap','road/rail surface overlap','terrain samples differ by >0.14 m','missing stable source key or permission to add population']},'intendedConsumer':['lib/city/environment.ts:roadDecorations / lamps (proposed only)','future source-selected furniture placement adapter'],'offlineChecks':{'status':'not_run','evidence':['qa/validation.json','qa/blender-audit.json','qa/source-roundtrip.json','qa/artist-edit.json','qa/preview-index.json']},'runtimeChecks':{'status':'not_run','state':'runtime_pending_webgl','required':['source population and authoritative placement','terrain datum and sidewalk collision','shared role material binding','glass sorting','LOD silhouette/pop','four city lighting conditions','cache/dispose/instancing/draw calls','GPU frame time and residency']}}
        assets.append(a)
    manifest={'schemaVersion':1,'packageId':'street-furniture-expansion','version':'1.0.0','baseRevision':base,'status':'offline_partial','runtimeStatus':'runtime_pending_webgl','units':'metres','coordinateSystem':{'authoringUp':'+Z','gltfUp':'+Y','frontAxis':'+Z','conversion':'Blender (x,y,z) -> glTF (x,z,-y) exactly once; no loader rotation'},'provenance':{'credit':'Based on Vancouver Living Atlas by YiTaChen','source':'https://github.com/YiTaChen/vancouver-living-atlas','license':'Vancouver Living Atlas Noncommercial Research and Attribution 1.0','legacyGenerator':'tools/assets/streetscape/generate_streetscape.py','legacyGeneratorSha256':contract.digest(HERE.parent/'streetscape/generate_streetscape.py'),'derivation':'AST imports only legacy bench/lamp/shelter functions. Lower tessellation, role placeholders, generic sign, ground shoes and handcrafted simplified LOD1. Five new props are original representative geometry. No downloaded meshes/images.','blenderVersion':bpy.app.version_string,'buildSha256':contract.digest(HERE/'build.py'),'exporterSha256':contract.digest(HERE/'export.py')},'reexportCommand':'blender -b -t 2 --python-exit-code 1 --python tools/assets/street-furniture-expansion/export.py -- --source tools/assets/street-furniture-expansion/source --output /tmp/street-furniture-reexport','validationCommand':'python3 tools/assets/street-furniture-expansion/validate.py','assets':assets,'textures':[]}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

def run(source,out):
    assert not out.exists(),'Refuse overwrite; output must be a fresh directory'
    assert not out.is_relative_to(source) and not source.is_relative_to(out),'source/output overlap'
    (out/'source').mkdir(parents=True);records={}
    for aid in IDS:
        for level in [0,1]:
            stem=f'{aid}.lod{level}';src=source/(stem+'.blend');shutil.copy2(src,out/'source'/src.name);records[stem]=export_one(src,out/'exports'/(stem+'.glb'))
    write_manifest(out,records);return records

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);run(a.source.resolve(),a.output.resolve())
