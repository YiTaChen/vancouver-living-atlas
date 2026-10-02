"""Blender regression test for edited-source export and fail-closed shader support."""
from pathlib import Path
import sys,tempfile,json,hashlib
import bpy
R=Path(__file__).resolve().parent
sys.path.insert(0,str(R))
from export_from_source import export_saved,graph_check
from audit_source_roundtrip import decode,arrays

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    source=R/'source/vegetation_ground.blend';original=digest(source)
    before={str(p):digest(p) for p in R.rglob('*') if p.is_file() and p.suffix in ('.blend','.glb','.png')}
    import build_vegetation_ground
    assert before=={str(p):digest(p) for p in R.rglob('*') if p.is_file() and p.suffix in ('.blend','.glb','.png')},'Import modified files'
    with tempfile.TemporaryDirectory(prefix='vegetation-edit-safety-') as t:
        tmp=Path(t);bpy.ops.wm.open_mainfile(filepath=str(source));ob=bpy.data.objects['maple_sprig_lod0_wood'];ob.data.vertices[0].co.x+=.012;ob.location.z+=.125
        edited=tmp/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);saved=digest(edited)
        result=export_saved(edited,tmp/'exports');assert digest(edited)==saved and result['sourceUnchanged']
        d,b=decode(R/'exports/maple_sprig_lod0.glb');e,eb=decode(tmp/'exports/maple_sprig_lod0.glb');assert arrays(d,b)!=arrays(e,eb),'Mesh edit lost';assert d['nodes']!=e['nodes'],'Object translation lost'
        bpy.data.materials['bark'].node_tree.nodes.new('ShaderNodeTexNoise');bad=tmp/'unsupported.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad),compress=True)
        try:export_saved(bad,tmp/'rejected')
        except AssertionError as exc:assert 'unsupported node' in str(exc)
        else:raise AssertionError('Unsupported graph was silently accepted')
    # Bounded shader-semantic negative cases, all on reloaded in-memory source.
    for case in ['object_normal','normal_srgb','orm_srgb','base_noncolor','alpha_from_color','anisotropic']:
        bpy.ops.wm.open_mainfile(filepath=str(source));mat=bpy.data.materials['Foliage_RGBA_Cutout_candidate' if case=='alpha_from_color' else 'bark'];nt=mat.node_tree;bs=nt.nodes.get('Principled BSDF')
        if case=='object_normal':next(n for n in nt.nodes if n.type=='NORMAL_MAP').space='OBJECT'
        elif case in ['normal_srgb','orm_srgb','base_noncolor']:
            needle={'normal_srgb':'normal','orm_srgb':'orm','base_noncolor':'basecolor'}[case]
            next(n.image for n in nt.nodes if n.type=='TEX_IMAGE' and needle in n.image.name).colorspace_settings.name='Non-Color' if case=='base_noncolor' else 'sRGB'
        elif case=='alpha_from_color':nt.links.new(bs.inputs['Base Color'].links[0].from_node.outputs['Color'],bs.inputs['Alpha'])
        elif case=='anisotropic':bs.inputs['Anisotropic'].default_value=.5
        try:graph_check(mat)
        except AssertionError:pass
        else:raise AssertionError('Semantic mutation was silently accepted: '+case)
    assert digest(source)==original
    (R/'export-edit-safety.json').write_text(json.dumps({'status':'pass','checks':['generator module import has no file side effects','edited packed source SHA256 unchanged by export','mesh edit survives export','object translation survives display offset subtraction','unsupported shader node is rejected','canonical source SHA256 unchanged','six semantic negative cases rejected: object-space normals, wrong normal/ORM/base color spaces, wrong alpha socket, anisotropy'],'sourceSHA256':original},indent=2)+'\n')
    print('EXPORT_EDIT_SAFETY_PASS')
if __name__=='__main__':main()
