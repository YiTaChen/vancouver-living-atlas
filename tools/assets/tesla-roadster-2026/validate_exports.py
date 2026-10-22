"""CPU-only validation of the actual derived GLBs and editable-source hashes."""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_glb(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and length == len(raw)
    offset = 12
    document = binary = None
    while offset < len(raw):
        length, kind = struct.unpack_from('<II', raw, offset)
        payload = raw[offset+8:offset+8+length]
        if kind == 0x4E4F534A:
            document = json.loads(payload)
        elif kind == 0x004E4942:
            binary = payload
        offset += length + 8
    assert document and binary
    return document, binary


def accessor(document, binary, index):
    a = document['accessors'][index]
    v = document['bufferViews'][a['bufferView']]
    fmt, size = {5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),
                 5125:('I',4),5126:('f',4)}[a['componentType']]
    width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    stride = v.get('byteStride',width*size)
    return [struct.unpack_from('<'+fmt*width,binary,start+i*stride)
            for i in range(a['count'])]


def audit():
    manifest = json.loads((ROOT/'manifest.json').read_text())
    report = {'schemaVersion':1,'passed':True,'levels':{},'referenceFiles':[]}
    for ref in manifest['referenceFiles']:
        file = ROOT/ref['file']
        assert sha(file)==ref['sha256'] and file.stat().st_size==ref['bytes']
        report['referenceFiles'].append(ref)
    for lod in manifest['assets'][0]['lods']:
        file = ROOT/lod['export']
        source = ROOT/lod['source']
        assert sha(file)==lod['sha256'] and sha(source)==lod['sourceSha256']
        document, binary = load_glb(file)
        triangles = primitives = degenerate = 0
        accent_materials = [i for i,m in enumerate(document['materials'])
                            if m.get('name') == 'Atlas Roadster | accent']
        assert len(accent_materials) == 1
        accent_factor = document['materials'][accent_materials[0]].get('emissiveFactor', [0,0,0])
        assert accent_factor[0] > .5 and max(accent_factor[1:]) < .01, 'Door accent emission must remain red'
        accent_primitives = 0
        nodes = document['nodes']
        parents = {child:i for i,node in enumerate(nodes) for child in node.get('children',[])}
        def position(i):
            node = nodes[i]
            assert 'matrix' not in node and node.get('rotation',[0,0,0,1])==[0,0,0,1]
            local = node.get('translation',[0,0,0])
            parent = position(parents[i]) if i in parents else [0,0,0]
            return [a+b for a,b in zip(local,parent)]
        minimum = [math.inf]*3
        maximum = [-math.inf]*3
        for i,node in enumerate(nodes):
            if 'mesh' not in node:
                continue
            offset = position(i)
            for primitive in document['meshes'][node['mesh']]['primitives']:
                accent_primitives += primitive.get('material') in accent_materials
                attrs = primitive['attributes']
                assert primitive.get('mode',4)==4 and 'COLOR_0' in attrs and 'NORMAL' in attrs
                points = accessor(document,binary,attrs['POSITION'])
                normals = accessor(document,binary,attrs['NORMAL'])
                authored = node.get('extras', {})
                lower, upper = authored['source_bounds_min'], authored['source_bounds_max']
                assert all(lower[k]-.000051 <= point[k] <= upper[k]+.000051
                           for point in points for k in range(3)), 'Decimation escaped source batch bounds'
                indices = [v[0] for v in accessor(document,binary,primitive['indices'])]
                assert len(indices)%3==0 and max(indices)<len(points)
                assert all(math.isfinite(x) for p in points for x in p)
                assert all(.98 < math.sqrt(sum(x*x for x in n)) < 1.02 for n in normals)
                for v in indices:
                    for axis,x in enumerate(points[v]):
                        value = x+offset[axis]
                        minimum[axis]=min(minimum[axis],value)
                        maximum[axis]=max(maximum[axis],value)
                for k in range(0,len(indices),3):
                    a,b,c = [points[v] for v in indices[k:k+3]]
                    ab=[b[t]-a[t] for t in range(3)];ac=[c[t]-a[t] for t in range(3)]
                    cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
                    degenerate += sum(x*x for x in cross)<1e-24
                triangles += len(indices)//3
                primitives += 1
        assert triangles==lod['triangles'] and primitives==lod['primitives'] and degenerate==0
        assert accent_primitives == 2
        report['levels'][lod['quality']]={'triangles':triangles,'primitives':primitives,
            'degenerateTriangles':degenerate,'colorPrimitives':primitives,
            'sourceBatchBoundsVerified':True,'sourceBoundsToleranceM':.000051,
            'emissiveRedAccentPrimitives':accent_primitives,
            'materials':len(document.get('materials',[])),
            'boundsM':{'min':minimum,'max':maximum,'size':[b-a for a,b in zip(minimum,maximum)]},
            'sourceSha256':sha(source),'sha256':sha(file),'bytes':file.stat().st_size}
    return report


if __name__=='__main__':
    result=audit()
    (ROOT/'qa/export-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'levels':{q:{'triangles':v['triangles'],
        'primitives':v['primitives']} for q,v in result['levels'].items()}}))
