"""Save matching editable LODs/GLBs from the exact decoded synchronous payload.

Used for the tyre-only repair: non-rubber encoded geometry remains unchanged.
No reference hero is opened or modified, and no decimation or rendering occurs.
"""
import array
import base64
import json
from pathlib import Path
import sys

import bpy

PACKAGE = Path(__file__).resolve().parent
sys.path.insert(0,str(PACKAGE))
import build as producer
from emissive_export import finalize_glb


def decode(part):
    values=[]
    for key,kind in [('positions','h'),('normals','b'),('colors','B'),('indices','H')]:
        value=array.array(kind)
        value.frombytes(base64.b64decode(part[key]))
        values.append(list(value))
    return values


def main():
    data_path=PACKAGE/'exports/tesla-roadster-detailed-data.json'
    data=json.loads(data_path.read_text())
    manifest_path=PACKAGE/'manifest.json'
    manifest=json.loads(manifest_path.read_text())
    bounds=json.loads((PACKAGE/'qa/decimation-bounds.json').read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for quality,level in [('high',0),('medium',1),('low',2)]:
        producer.clear_scene()
        nodes={}
        for node in data['rig']['nodes']:
            obj=bpy.data.objects.new(node['id'],None)
            bpy.context.collection.objects.link(obj)
            obj.location=node['position']
            if node['parent']:
                obj.parent=nodes[node['parent']]
            nodes[node['id']]=obj
        for part in data['lods'][quality]['parts']:
            name=part['assembly']+':'+part['role']
            obj=bpy.data.objects.new(name,bpy.data.meshes.new(name+':empty'))
            bpy.context.collection.objects.link(obj)
            obj.parent=nodes[part['assembly']]
            obj['assembly']=part['assembly']
            obj['semantic_role']=part['role']
            obj['single_outward_glazing']=part['role']=='glass'
            obj['source_bounds_min']=bounds[quality][name]['sourceLocalMin']
            obj['source_bounds_max']=bounds[quality][name]['sourceLocalMax']
            if part['role']=='rubber':
                obj['controlled_tyre_profile']='Closed donor-width profile, continuous .3505m tread crest, .1mm quantization allowance'
            producer.replace_with_decoded(obj,decode(part))
        scene=bpy.context.scene
        scene.unit_settings.system='METRIC'
        scene['asset_contract']='tesla-roadster-2026-quantized-v1'
        scene['axes']=data['axes']
        scene['quality']=quality
        scene['triangle_count']=data['lods'][quality]['triangles']
        scene['controlled_tyre_profile']=json.dumps(data['source']['controlledTyres'])
        source=PACKAGE/'source'/f'tesla-roadster-2026.lod{level}.blend'
        exported=PACKAGE/'exports'/f'tesla-roadster-2026.lod{level}.glb'
        bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
        bpy.ops.export_scene.gltf(filepath=str(exported),export_format='GLB',export_yup=False,
            export_apply=False,export_materials='EXPORT',export_normals=True,
            export_animations=False,export_extras=True,export_cameras=False,export_lights=False)
        finalize_glb(exported)
        lod=next(lod for lod in manifest['assets'][0]['lods'] if lod['level']==level)
        lod.update({'triangles':data['lods'][quality]['triangles'],
            'primitives':len(data['lods'][quality]['parts']),
            'bytes':exported.stat().st_size,'sha256':producer.hash_file(exported),
            'sourceBytes':source.stat().st_size,'sourceSha256':producer.hash_file(source)})
        print('REEXPORTED',quality,lod['triangles'],lod['primitives'],flush=True)
    manifest['runtimeData'].update({'bytes':data_path.stat().st_size,
                                    'sha256':producer.hash_file(data_path)})
    ports=manifest['source']['portAnchors']
    manifest['source']={**data['source'],'portAnchors':ports}
    manifest['authoringSource']={'file':'build.py','bytes':(PACKAGE/'build.py').stat().st_size,
                                'sha256':producer.hash_file(PACKAGE/'build.py')}
    manifest['auxiliarySources']=[{'file':name,'bytes':(PACKAGE/name).stat().st_size,
                                  'sha256':producer.hash_file(PACKAGE/name)}
                                  for name in ['emissive_export.py','controlled_tires.py','reexport_data.py']]
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    print('DONE',manifest['runtimeData']['sha256'],flush=True)


if __name__=='__main__':
    main()
