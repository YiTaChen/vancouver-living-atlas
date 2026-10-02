"""Safely export edited saved source without regenerating/saving it.
blender -b -t 2 --python tools/assets/vegetation_ground/export_from_source.py -- --output /tmp/vegetation-edited
"""
from pathlib import Path
import argparse, json, struct, hashlib
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parent

def patch_glb(path,ground=False):
    data=path.read_bytes();n=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+n])
    for mat in doc.get('materials',[]):
        if mat.get('name')=='Foliage_RGBA_Cutout_candidate':mat.update(alphaMode='MASK',alphaCutoff=.4,doubleSided=True)
    if ground:
        for sampler in doc.get('samplers',[]):sampler.update(wrapS=33071,wrapT=10497)
    raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);tail=data[20+n:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(tail))+struct.pack('<II',len(raw),0x4e4f534a)+raw+tail)

def graph_check(mat):
    """Conservative contract: edited images/meshes supported, unsupported graphs fail."""
    assert mat.use_nodes, f'{mat.name}: nodes required'
    nt=mat.node_tree;allowed={'BSDF_PRINCIPLED','OUTPUT_MATERIAL','TEX_IMAGE','NORMAL_MAP','SEPARATE_COLOR'}
    assert all(n.type in allowed for n in nt.nodes),f'{mat.name}: unsupported node; bake custom graph explicitly before export'
    bs=[n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'];out=[n for n in nt.nodes if n.type=='OUTPUT_MATERIAL'];assert len(bs)==len(out)==1;bs=bs[0]
    def source(socket,kind):
        assert len(socket.links)==1,f'{mat.name}/{socket.name}: expected one source link'
        node=socket.links[0].from_node;assert node.type==kind,f'{mat.name}/{socket.name}: unsupported source';return node
    assert source(out[0].inputs['Surface'],'BSDF_PRINCIPLED')==bs
    assert not out[0].inputs['Displacement'].is_linked and not out[0].inputs['Volume'].is_linked
    tex=source(bs.inputs['Base Color'],'TEX_IMAGE')
    assert tex.image.colorspace_settings.name=='sRGB',f'{mat.name}: base image must be sRGB'
    assert not tex.inputs['Vector'].is_linked,f'{mat.name}: custom UV graph unsupported'
    if mat.name=='Foliage_RGBA_Cutout_candidate':
        assert source(bs.inputs['Alpha'],'TEX_IMAGE')==tex
        assert bs.inputs['Alpha'].links[0].from_socket.name=='Alpha',f'{mat.name}: coverage requires texture Alpha output'
        assert abs(mat.alpha_threshold-.4)<1e-6 and not mat.use_backface_culling,f'{mat.name}: required cutout .4/double-sided contract changed'
        assert not bs.inputs['Normal'].is_linked and not bs.inputs['Roughness'].is_linked
    else:
        assert not bs.inputs['Alpha'].is_linked and bs.inputs['Alpha'].default_value==1
        normal=source(bs.inputs['Normal'],'NORMAL_MAP');normal_image=source(normal.inputs['Color'],'TEX_IMAGE')
        assert normal.space=='TANGENT',f'{mat.name}: tangent normal space required'
        assert normal_image.image.colorspace_settings.name=='Non-Color',f'{mat.name}: normal image must be Non-Color'
        sep=source(bs.inputs['Roughness'],'SEPARATE_COLOR');assert source(bs.inputs['Metallic'],'SEPARATE_COLOR')==sep;orm_image=source(sep.inputs[0],'TEX_IMAGE')
        assert orm_image.image.colorspace_settings.name=='Non-Color',f'{mat.name}: ORM image must be Non-Color'
    for node in nt.nodes:
        if node.type=='TEX_IMAGE':
            assert node.image and node.image.size[0]>0 and max(node.image.size)<=1024,f'{mat.name}: missing/oversized image'
            assert node.image.packed_file,f'{mat.name}: pack changed images before export'
            assert not node.inputs['Vector'].is_linked,f'{mat.name}: custom mapping graph unsupported'
    # Fail on shader roles which glTF may approximate or silently omit.
    unsupported=['Transmission Weight','Coat Weight','Sheen Weight','Subsurface Weight','Anisotropic IOR Level','Anisotropic']
    for key in unsupported:
        if key in bs.inputs:assert not bs.inputs[key].is_linked and bs.inputs[key].default_value==0,f'{mat.name}: unsupported {key}'
    assert not bs.inputs['Emission Color'].is_linked and not bs.inputs['Emission Strength'].is_linked and (bs.inputs['Emission Strength'].default_value==0 or all(v==0 for v in bs.inputs['Emission Color'].default_value[:3])),f'{mat.name}: emission unsupported'
    if 'Weight' in bs.inputs: assert not bs.inputs['Weight'].is_linked and bs.inputs['Weight'].default_value==1

def export_saved(source,output):
    source=Path(source).resolve();output=Path(output).resolve();assert output!=source.parent,'Do not export over source folder'
    before=hashlib.sha256(source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(source))
    groups=[c for c in bpy.data.collections if c.get('delivery_asset',False)]
    assert len(groups)==15,'Expected 15 named delivery collections; no automatic hidden asset selection'
    output.mkdir(parents=True,exist_ok=True);report=[]
    for c in sorted(groups,key=lambda x:x.name):
        objs=list(c.objects);assert objs and all(o.type=='MESH' for o in objs)
        for o in objs:
            assert 'display_offset' in o,f'{o.name}: missing authoring display offset'
            assert not o.modifiers,f'{o.name}: apply geometry modifiers explicitly before export'
            assert not o.animation_data and not o.parent,f'{o.name}: unsupported animation/parent'
            assert o.data.uv_layers.active,f'{o.name}: missing UV'
            for mat in o.data.materials:graph_check(mat)
        bpy.ops.object.select_all(action='DESELECT');saved=[]
        try:
            for o in objs:
                saved.append(o.location.copy());o.location-=Vector(o['display_offset']);o.select_set(True)
            bpy.context.view_layer.objects.active=objs[0];path=output/(c.name+'.glb')
            bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_extras=True,export_yup=True,export_attributes=True)
            patch_glb(path,ground=c.name.startswith('soil_grass_slope'))
            report.append({'asset':c.name,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
        finally:
            for o,loc in zip(objs,saved):o.location=loc
    after=hashlib.sha256(source.read_bytes()).hexdigest();assert before==after,'Source unexpectedly modified'
    result={'status':'pass','sourceSHA256':before,'sourceUnchanged':True,'assets':report}
    (output/'export-report.json').write_text(json.dumps(result,indent=2)+'\n');return result

def main():
    import sys
    p=argparse.ArgumentParser();p.add_argument('--source',default=str(ROOT/'source/vegetation_ground.blend'));p.add_argument('--output',required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);print(json.dumps(export_saved(a.source,a.output),indent=2))
if __name__=='__main__':main()
