"""Dependency-free integrity audit for exported original GLBs and their manifest."""
from pathlib import Path
import json, struct, math, argparse

parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3]/'public/models/streetscape')
root=parser.parse_args().root.resolve()
manifest=json.loads((root/'manifest.json').read_text())
summary=[]
for asset in manifest['assets']:
    for lod in asset['lods']:
        path=root/lod['file']; raw=path.read_bytes()
        magic,version,size=struct.unpack_from('<4sII',raw)
        assert magic==b'glTF' and version==2 and size==len(raw), path
        n,kind=struct.unpack_from('<I4s',raw,12); assert kind==b'JSON'
        doc=json.loads(raw[20:20+n]); binary_offset=20+n+8
        assert not doc.get('animations') and not doc.get('cameras'), path
        total=0
        for mesh in doc['meshes']:
            for prim in mesh['primitives']:
                assert prim.get('mode',4)==4
                pos=doc['accessors'][prim['attributes']['POSITION']]
                assert pos['count']>0 and all(math.isfinite(v) for k in ['min','max'] for v in pos[k])
                idx=doc['accessors'][prim['indices']]; assert idx['count']%3==0
                total+=idx['count']//3
                assert 'NORMAL' in prim['attributes']
        assert total==lod['triangles'], (path,total,lod['triangles'])
        if 'pbrAtlas' in lod:
            assert len(doc['materials'])<=3
            pbr=doc['materials'][0]['pbrMetallicRoughness']
            assert 'baseColorTexture' in pbr and 'metallicRoughnessTexture' in pbr
            assert 'normalTexture' in doc['materials'][0]
            for texture in [pbr['baseColorTexture'],pbr['metallicRoughnessTexture'],doc['materials'][0]['normalTexture']]:
                assert texture.get('texCoord',0)==0, 'Baked runtime materials must use UV0'
            for mesh in doc['meshes']:
                for primitive in mesh['primitives']:
                    if primitive.get('material',0)==0:
                        assert 'TEXCOORD_0' in primitive['attributes']
        if asset['id'] in ['heritage-shop-bay','modern-lobby-bay']:
            assert lod['bounds']['min'][2]>0, 'Compact relief must stay outside uncut GIS wall'
            assert 3.19 <= lod['bounds']['max'][1] <= 3.21
        image_bytes=sum(doc['bufferViews'][img['bufferView']]['byteLength'] for img in doc.get('images',[]))
        for img in doc.get('images',[]):
            assert 'uri' not in img, 'Self-contained GLBs must embed images'
        summary.append({'asset':asset['id'],'lod':lod['level'],'bytes':len(raw),'triangles':total,
                        'materials':len(doc['materials']),'primitives':sum(len(m['primitives']) for m in doc['meshes']),
                        'imageBytes':image_bytes,'alphaModes':[m.get('alphaMode','OPAQUE') for m in doc['materials']]})
(root/'validation.json').write_text(json.dumps({'passed':True,'checks':['GLB container integrity','embedded self-contained images','triangle counts match generator','finite position bounds','normal attributes present','static meshes only','baked PBR maps present','core atlas modules <=3 materials'],'assets':summary},indent=2)+'\n')
print(json.dumps(summary,indent=2))
