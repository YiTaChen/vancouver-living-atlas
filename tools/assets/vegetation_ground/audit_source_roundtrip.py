"""Blender source re-export audit: geometry arrays + embedded map bytes equal delivery.
blender -b -t 2 --python tools/assets/vegetation_ground/audit_source_roundtrip.py
"""
from pathlib import Path
import bpy,json,struct,hashlib,tempfile
R=Path(__file__).resolve().parent

def decode(p):
    b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);return d,b[28+n:]
def arrays(d,b):
    out=[]
    for mesh in d['meshes']:
        for prim in mesh['primitives']:
            row={}
            for key,i in {**prim['attributes'],'indices':prim['indices']}.items():
                a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];size={5126:4,5125:4,5123:2,5121:1}[a['componentType']]*n;start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size);raw=b''.join(b[start+j*stride:start+j*stride+size] for j in range(a['count']));row[key]=hashlib.sha256(raw).hexdigest()
            out.append(row)
    return out

def image_hashes(d,b):
    return sorted(hashlib.sha256(b[(v:=d['bufferViews'][im['bufferView']]).get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]).hexdigest() for im in d['images'])
def main():
    import sys
    sys.path.insert(0,str(R))
    from export_from_source import export_saved
    report=[]
    with tempfile.TemporaryDirectory(prefix='vegetation-ground-roundtrip-') as tmp:
        export_saved(R/'source/vegetation_ground.blend',Path(tmp))
        assert all(im.packed_file for im in bpy.data.images if im.source=='FILE')
        for item in json.loads((R/'manifest.json').read_text())['assets']:
            src,sb=decode(R/item['file']);out,ob=decode(Path(tmp)/(item['id']+'.glb'))
            assert arrays(src,sb)==arrays(out,ob),item['id']
            assert image_hashes(src,sb)==image_hashes(out,ob),item['id']
            assert src['materials']==out['materials'],item['id']+' material mismatch'
            assert src['samplers']==out['samplers'],item['id']+' sampler mismatch'
            report.append({'asset':item['id'],'geometryAttributesAndIndices':'exact byte equality','embeddedMaps':'exact SHA256 equality','materialsAndSamplers':'exact JSON equality including MASK/cutoff/wrap modes'})
    (R/'source-roundtrip.json').write_text(json.dumps({'status':'pass','blender':bpy.app.version_string,'assets':report,'note':'Audited actual safe source exporter including shipping alpha patch and ground samplers. No source regeneration or save.'},indent=2)+'\n')
    print('SOURCE_ROUNDTRIP_PASS',len(report))
if __name__=='__main__':main()
