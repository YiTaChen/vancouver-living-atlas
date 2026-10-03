"""Read saved editable .blend files without rebuilding or resaving; export to a fresh destination.
Packed artist-edited images are kept by content hash. Standard GLB geometry references shared external PNGs.
"""
import argparse, hashlib, importlib.util, json, shutil, struct, sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(sp);sp.loader.exec_module(contract)
SPECIES=['maple','alder','douglas-fir','western-redcedar']

def graph_check(mat):
    assert mat.use_nodes and mat.name in ['bark-opaque','foliage-straight-alpha','foliage-solid-interior'],'unknown material role'
    nt=mat.node_tree;allowed={'BSDF_PRINCIPLED','OUTPUT_MATERIAL','TEX_IMAGE','NORMAL_MAP','SEPARATE_COLOR'}
    assert all(n.type in allowed and not n.mute for n in nt.nodes),'unsupported edited material node'
    bs=[n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'];out=[n for n in nt.nodes if n.type=='OUTPUT_MATERIAL'];assert len(bs)==len(out)==1
    bs=bs[0];out=out[0]
    assert len(out.inputs['Surface'].links)==1 and out.inputs['Surface'].links[0].from_node==bs
    assert not out.inputs['Displacement'].is_linked and not out.inputs['Volume'].is_linked
    permitted={'Base Color','Metallic','Roughness','Normal','Alpha'}
    ref=bpy.data.materials.new('_reference');ref.use_nodes=True;rb=ref.node_tree.nodes.get('Principled BSDF')
    for socket,reference_socket in zip(bs.inputs,rb.inputs):
        if socket.name in permitted:continue
        assert not socket.is_linked,'unsupported linked shader socket '+socket.name
        if not hasattr(socket,'default_value'):continue
        actual=socket.default_value
        default=reference_socket.default_value
        if hasattr(actual,'__len__'):assert all(abs(a-b)<1e-6 for a,b in zip(actual,default)),socket.name
        else:assert abs(actual-default)<1e-6,socket.name
    bpy.data.materials.remove(ref)
    def link(socket,kind):
        assert len(socket.links)==1 and socket.links[0].from_node.type==kind,'unsupported material link '+socket.name
        return socket.links[0].from_node
    for n in nt.nodes:
        if n.type=='TEX_IMAGE':
            assert n.image and n.image.packed_file and max(n.image.size)<=1024,'pack supported PNG before export'
            assert not n.inputs['Vector'].is_linked,'custom UV nodes need an explicit bake'
    if mat.name=='foliage-solid-interior':
        assert len(nt.nodes)==2 and len(nt.links)==1,'unsupported core graph'
        assert bs.inputs['Alpha'].default_value==1 and not bs.inputs['Alpha'].is_linked
    else:
        t=link(bs.inputs['Base Color'],'TEX_IMAGE');assert t.image.colorspace_settings.name=='sRGB'
        if mat.name=='foliage-straight-alpha':
            assert link(bs.inputs['Alpha'],'TEX_IMAGE')==t and bs.inputs['Alpha'].links[0].from_socket.name=='Alpha'
            assert abs(mat.alpha_threshold-.4)<1e-6 and not mat.use_backface_culling,'straight MASK .4 double-sided required'
            assert len(nt.nodes)==3 and len(nt.links)==3,'unsupported foliage graph'
        else:
            assert not bs.inputs['Alpha'].is_linked and bs.inputs['Alpha'].default_value==1
            n=link(bs.inputs['Normal'],'NORMAL_MAP');assert n.space=='TANGENT';ni=link(n.inputs['Color'],'TEX_IMAGE');assert ni.image.colorspace_settings.name=='Non-Color'
            sep=link(bs.inputs['Roughness'],'SEPARATE_COLOR');assert link(bs.inputs['Metallic'],'SEPARATE_COLOR')==sep;assert bs.inputs['Roughness'].links[0].from_socket.name=='Green' and bs.inputs['Metallic'].links[0].from_socket.name=='Blue'
            assert link(sep.inputs[0],'TEX_IMAGE').image.colorspace_settings.name=='Non-Color'
            assert len(nt.nodes)==7 and len(nt.links)==7,'unsupported bark graph'


def externalize(path):
    doc,binary=contract.read_glb(path);image_views=set()
    known={contract.digest(p):p.name for root in [HERE.parent/'vegetation_ground/maps',HERE/'source/textures'] for p in root.glob('*.png')}
    known[contract.digest(HERE.parent/'vegetation_ground/maps/leaf_atlas_rgba.png')]='leaf_atlas_rgba.png'
    texture_dir=path.parent/'textures';texture_dir.mkdir(exist_ok=True)
    for im in doc.get('images',[]):
        idx=im.pop('bufferView');image_views.add(idx);view=doc['bufferViews'][idx];start=view.get('byteOffset',0);raw=binary[start:start+view['byteLength']];sha=hashlib.sha256(raw).hexdigest();name=known.get(sha,'edited-'+sha[:24]+'.png')
        assert raw.startswith(b'\x89PNG\r\n\x1a\n'),'PNG export required';target=texture_dir/name
        if target.exists():assert target.read_bytes()==raw,'texture name collision'
        else:target.write_bytes(raw)
        im.pop('mimeType',None);im['uri']='textures/'+name
    new=bytearray();views=[];mapping={}
    for i,v in enumerate(doc['bufferViews']):
        if i in image_views:continue
        new.extend(b'\0'*((-len(new))%4));vv=dict(v);a=v.get('byteOffset',0);vv['byteOffset']=len(new);new.extend(binary[a:a+v['byteLength']]);mapping[i]=len(views);views.append(vv)
    for a in doc.get('accessors',[]):a['bufferView']=mapping[a['bufferView']]
    doc['bufferViews']=views;doc['buffers'][0]['byteLength']=len(new)
    for m in doc.get('materials',[]):
        if m['name']=='foliage-straight-alpha':m.update(alphaMode='MASK',alphaCutoff=.4,doubleSided=True)
        else:m['alphaMode']='OPAQUE';m['doubleSided']=False
    j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);new.extend(b'\0'*((-len(new))%4))
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(new))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(new),b'BIN\0')+new)


def export_one(source,out):
    before=contract.digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene
    assert s.unit_settings.scale_length==1 and s.unit_settings.system=='METRIC'
    obs=list(s.objects);assert obs and all(o.type=='MESH' and not o.animation_data for o in obs)
    assert all(o.get('semantic_role') in ['trunk','branches','foliage-core','foliage-cards'] for o in obs)
    for ob in obs:
        assert ob.data.uv_layers.active and not ob.parent,'UV and unparented meshes required'
        for mat in ob.data.materials:graph_check(mat)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
    externalize(out);assert before==contract.digest(source),'saved source changed';return contract.measure_glb(out)


def manifest(out,records,base):
    assets=[]
    for species in SPECIES:
        aid='mature-'+species;lods=[]
        for level in range(3):
            stem=f'{aid}.lod{level}';r=records[stem];src='source/'+stem+'.blend';file='exports/'+stem+'.glb'
            lods.append({'level':level,'source':src,'sourceSha256':contract.digest(out/src),'file':file,'sha256':contract.digest(out/file),**{k:r[k] for k in ['boundsM','triangles','vertices','primitives','bytes','geometryBytes','embeddedImageBytes']}})
        bindings=[{'node':'trunk','material':'bark-opaque','role':'trunk','surfaceId':'vegetation-ground-bark','maps':{'baseColor':'textures/bark_basecolor.png','normal':'textures/bark_normal.png','orm':'textures/bark_orm.png'},'channels':{'normal':'OpenGL +Y, linear','orm':'R=1, G=roughness, B=0, linear'},'physicalTileM':[.8,1.6],'runtimeUvScale':'Multiply bark UV by sourceHeightM/templateHeightM per instance after physical template scaling. Keep leaf atlas UV unchanged; do not clone textures per height.'}, {'node':'branches','material':'bark-opaque','role':'branches','surfaceId':'vegetation-ground-bark','sameAs':'trunk'}, {'node':'foliage-cards','material':'foliage-straight-alpha','role':'foliage-cutout','surfaceId':'vegetation-ground-leaf-straight-rgba','maps':{'baseColorAlpha':'textures/leaf_atlas_rgba.png'},'channels':{'rgb':'sRGB unassociated color','alpha':'linear coverage'},'alphaMode':'MASK','alphaCutoff':.4,'doubleSided':True,'atlasCell':SPECIES.index(species)}, {'node':'foliage-core','material':'foliage-solid-interior','role':'foliage-solid','surfaceId':'species-solid-crown-interior','maps':{},'alphaMode':'OPAQUE','solidLogic':'Standard opaque material, identical color/depth/shadow coverage; no legacy RGB decoder or aSolid patch.'}]
        assets.append({'id':aid,'taskId':'B03','variant':species,'kind':'mature-tree-template','source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':lods[0]['boundsM'],'expectedDimensionsM':{'height':10,'widthRange':[4.6,4.9],'maximumHorizontalRadius':2.85},'dimensionToleranceM':{'height':.02,'crownEnvelope':.18},'dimensionBasis':'Representative authored crown constrained to current consumer envelope, not surveyed species proportions. Original mature hierarchy, no sprig scaling.','pivot':{'positionM':[0,0,0],'meaning':'ground contact at trunk centre'},'attachmentDatum':{'kind':'terrain-ground','planeY':0},'frontAxis':'+Z','templateHeightM':10,'normalizationMode':'physical-template-source-height-divided-by-template-height','sourceHeightScaling':{'formula':'uniformScale = sourceHeightM / templateHeightM','example':{'sourceHeightM':22.9,'uniformScale':2.29},'preserve':['sourceId','sourceSeed','sourcePosition','sourceHeight','existingPopulation','roadClearance']},'materialBindings':bindings,'textureMode':'external-shared','textureCost':{'geometryBytes':sum(l['geometryBytes'] for l in lods),'embeddedImageBytes':0,'glbTotalBytes':sum(l['bytes'] for l in lods),'uniqueTexelBytesWithMips':6640981.333333333,'newUniqueTexelBytesWithMips':6640981.333333333,'productionResidencyDelta':'not measured; offline source reuse does not establish production residency','accounting':'1024 RGBA leaf + three 256 RGBA bark maps, shared once by SHA. All candidate residency counted; full RGBA8 mip estimate, not PNG download bytes. No mip correction PNGs automatically bound.'},'lodPolicy':{'levels':[0,1,2],'triangleCaps':[8000,2000,240],'geometryByteCaps':[1048576,262144,65536],'recommendedDistanceM':[25,65,150],'mode':'proposal only; city projected-size/LOD acceptance pending','nestedLeafClusters':False,'stableClusterIdSubset':True,'leafCenterPolicy':'LOD1 uses retained cluster IDs with a deterministic crown-envelope adjustment; exact centres are not identical. Main scaffold paths are unchanged.','farFallback':'LOD2 coarse closed crown volumes, no giant leaf billboard'},'clearance':{'minimumClearTrunkHeightM':2.5,'maximumCrownRadiusM':2.85,'preserveExistingRoadClearance':True,'note':'Scale every clearance with sourceHeightM/10; these are representative geometry values, not pruning certification.'},'collision':{'kind':'cylinder-proxy','radiusM':.3,'heightM':2.5,'positionM':[0,0,0],'use':'Optional trunk-only primitive; retain current city tree collision policy.'},'anchors':[{'id':'ground-contact','positionM':[0,0,0]},{'id':'template-top','positionM':[0,10,0]}],'placementCompatibility':{'sourceSpecies':[species],'uniformScalingOnly':True,'sourceSeedRole':'Use stable source seed for species/template choice and yaw; no regenerated placement','forbidden':['multiply physical 10 m template directly by source height','replace municipal height with 10 m','scale the 1.25 m research sprigs into mature trees']},'intendedConsumer':['lib/city/detailed-trees.ts','lib/city/assets/tree-geometry.ts','lib/city/assets/tree-structure.ts','lib/city/tree-road-clearance.ts'],'offlineChecks':{'status':'not_run','evidence':['qa/validation.json','qa/blender-audit.json','qa/source-roundtrip.json','qa/source-edit-safety.json','qa/preview-index.json']},'runtimeChecks':{'status':'not_run','state':'runtime_pending_webgl','required':['source-scale conversion','shared texture/material loading','color/depth parity','shadow silhouette','10/30/65m four-light species matrix','instance pool/collision/clearance','disposal/cache','GPU time/overdraw/memory']}})
    textures=[]
    for p in sorted((out/'exports/textures').glob('*.png')):
        raw=p.read_bytes();w,h=struct.unpack_from('>II',raw,16);textures.append({'id':p.stem.replace('_','-'),'file':str(p.relative_to(out)),'sha256':contract.digest(p),'width':w,'height':h,'bytes':len(raw),'uniqueTexelBytesWithMips':w*h*4*4/3,'reusedFrom':'tools/assets/vegetation_ground/maps/'+p.name,'newUnique':True,'derivation':'256px Lanczos + vector-renormalized normal derivative' if p.name.startswith('bark') else 'exact existing straight-alpha atlas','runtimeDedupKey':'sha256','colorSpace':'sRGB' if 'basecolor' in p.name or 'leaf' in p.name else 'linear'})
    total_texels=sum(t['uniqueTexelBytesWithMips'] for t in textures)
    for asset in assets:
        asset['textureCost']['uniqueTexelBytesWithMips']=total_texels
        asset['textureCost']['newUniqueTexelBytesWithMips']=total_texels
        doc,_=contract.read_glb(out/asset['lods'][0]['file'])
        def uri(texture_info):return doc['images'][doc['textures'][texture_info['index']]['source']]['uri']
        materials={mat['name']:mat for mat in doc['materials']}
        bark=materials['bark-opaque'];foliage=materials['foliage-straight-alpha']
        asset['materialBindings'][0]['maps']={'baseColor':uri(bark['pbrMetallicRoughness']['baseColorTexture']),'normal':uri(bark['normalTexture']),'orm':uri(bark['pbrMetallicRoughness']['metallicRoughnessTexture'])}
        asset['materialBindings'][2]['maps']={'baseColorAlpha':uri(foliage['pbrMetallicRoughness']['baseColorTexture'])}
        for binding in asset['materialBindings']:binding['levels']=[0,1] if binding['node']=='foliage-cards' else [0,1,2]
        if asset['variant'] in ['maple','alder']:
            asset['materialBindings'][3]['levels']=[1,2]
            asset['materialBindings'].append({'node':'foliage-core','material':'foliage-straight-alpha','role':'foliage-inner-cutout','levels':[0],'surfaceId':'vegetation-ground-leaf-straight-rgba','maps':{'baseColorAlpha':uri(foliage['pbrMetallicRoughness']['baseColorTexture'])},'channels':{'rgb':'sRGB unassociated color','alpha':'linear coverage'},'alphaMode':'MASK','alphaCutoff':.4,'doubleSided':True,'solidLogic':'No opaque crown surfaces in broadleaf LOD0; inner and outer leaves share the same coverage.'})
            asset['nearBroadleafRevision']='Version 2: opaque inner blobs replaced by five-plane masked inner leaf clusters; same atlas, explicit material binding per LOD.'
    return {'schemaVersion':1,'packageId':'mature-tree-templates','version':'2.0.0','baseRevision':base,'status':'offline_partial','units':'metres','coordinateSystem':{'authoringUp':'+Z','gltfUp':'+Y','conversion':'Blender (x,y,z) -> glTF (x,z,-y) once; authoring scale applied'},'provenance':{'credit':'Based on Vancouver Living Atlas by YiTaChen','source':'https://github.com/YiTaChen/vancouver-living-atlas','license':'Vancouver Living Atlas Noncommercial Research and Attribution 1.0','geometry':'Original mature branching/crown construction in build.py, no external mesh or sprig geometry reuse.','maps':'Existing original vegetation_ground straight-alpha atlas reused; original bark maps downsampled to 256, normal vectors renormalized. No third-party imagery.','dimensionSources':['docs/AI_AGENT_DEVELOPMENT_BACKLOG.md#B03','lib/city/assets/tree-geometry.ts','lib/city/assets/tree-canopy.ts'],'blenderVersion':bpy.app.version_string,'generatorSha256':contract.digest(HERE/'build.py'),'exporterSha256':contract.digest(HERE/'export.py'),'texturePreprocessSha256':contract.digest(HERE/'prepare_textures.py')},'reexportCommand':'blender -b -t 2 --python-exit-code 1 --python tools/assets/mature-tree-templates/export.py -- --source tools/assets/mature-tree-templates/source --output /tmp/mature-tree-reexport','validationCommand':'python3 tools/assets/mature-tree-templates/validate.py','assets':assets,'textures':textures,'textureBudget':{'newUniqueLimitBytes':8388608,'newUniqueBytesWithMips':sum(t['uniqueTexelBytesWithMips'] for t in textures),'candidateTotalBytesWithMips':sum(t['uniqueTexelBytesWithMips'] for t in textures),'additionalProductionResidencyBytes':'not measured; none of this offline candidate is assumed resident'},'runtimeStatus':'runtime_pending_webgl'}


def run(source,out,base):
    assert not out.exists(),'Refusing overwrite: output must be a fresh directory'
    assert source!=out and not out.is_relative_to(source) and not source.is_relative_to(out),'source/output overlap'
    (out/'source').mkdir(parents=True);(out/'exports').mkdir();records={}
    for species in SPECIES:
        for lod in range(3):
            stem=f'mature-{species}.lod{lod}';src=source/(stem+'.blend');shutil.copy2(src,out/'source'/src.name);records[stem]=export_one(src,out/'exports'/(stem+'.glb'))
    (out/'manifest.json').write_text(json.dumps(manifest(out,records,base),indent=2)+'\n');return records

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--base-revision',default='8b95f013297597845d542463d6ce635105a95c4f');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);run(args.source.resolve(),args.output.resolve(),args.base_revision);print('MATURE_TREE_SOURCE_EXPORT_PASSED')
if __name__=='__main__':main()
