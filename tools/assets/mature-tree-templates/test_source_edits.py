"""Actual artist edit -> save -> reopen -> source-preserving export regression."""
import bpy, json, importlib.util, tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('exporter',HERE/'export.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)

def main():
    work=Path(tempfile.mkdtemp(prefix='mature-tree-edit-'));src=HERE/'source/mature-maple.lod0.blend';original=e.contract.digest(src)
    bpy.ops.wm.open_mainfile(filepath=str(src));ob=bpy.data.objects['trunk'];ob.data.vertices[0].co.x-=.123;ob.data.uv_layers.active.data[0].uv.x+=.017;bpy.data.objects['branches'].location.x+=.071
    bpy.data.materials['foliage-straight-alpha'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.63
    edited=work/'artist-edit.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);editsha=e.contract.digest(edited)
    out=work/'edited.glb';e.export_one(edited,out);assert e.contract.digest(edited)==editsha and e.contract.digest(src)==original
    doc,bin=e.contract.read_glb(out);base,bb=e.contract.read_glb(HERE/'exports/mature-maple.lod0.glb')
    def mesh(node,document,binary):
        n=next(n for n in document['nodes'] if n['name']==node);p=document['meshes'][n['mesh']]['primitives'][0];return n,e.contract.accessor(document,binary,p['attributes']['POSITION']),e.contract.accessor(document,binary,p['attributes']['TEXCOORD_0'])
    n,pts,uv=mesh('trunk',doc,bin);_,bp,bu=mesh('trunk',base,bb);assert pts!=bp and uv!=bu
    n,_,_=mesh('branches',doc,bin);assert abs(n['translation'][0]-.071)<1e-6
    mat=next(m for m in doc['materials'] if m['name']=='foliage-straight-alpha');assert abs(mat['pbrMetallicRoughness']['roughnessFactor']-.63)<1e-5
    bpy.ops.wm.open_mainfile(filepath=str(edited));bpy.data.materials['bark-opaque'].node_tree.nodes.new('ShaderNodeTexNoise');bad=work/'unsupported.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad),compress=True)
    rejected=False
    try:e.export_one(bad,work/'must-not-export.glb')
    except AssertionError:rejected=True
    assert rejected
    report={'status':'pass','savedSourceUnchanged':True,'originalSourceUnchanged':True,'originalSourceSha256':original,'meshEditSurvives':True,'uvEditSurvives':True,'objectTranslationSurvives':True,'materialRoughnessSurvives':True,'unsupportedGraphRejected':True,'workDirectory':str(work),'blenderVersion':bpy.app.version_string}
    (HERE/'qa/source-edit-safety.json').write_text(json.dumps(report,indent=2)+'\n');print('MATURE_TREE_ARTIST_EDIT_PASS')
if __name__=='__main__':main()
