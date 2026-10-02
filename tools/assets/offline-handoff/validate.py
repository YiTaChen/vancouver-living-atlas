"""Read-only integrity audit for the offline Blender handoff (standard library).
Does not claim application/GPU acceptance; track-specific validators own geometry,
source reopening, deformation, UV, alpha coverage and source re-export checks.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def audit_glb(path):
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack_from('<4sII', data) != (b'glTF', 2, len(data)):
        raise ValueError('invalid GLB header')
    offset, chunks = 12, []
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            raise ValueError('invalid GLB chunk')
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if len(chunks) != 2 or chunks[0][0] != 0x4E4F534A or chunks[1][0] != 0x004E4942:
        raise ValueError('expected self-contained JSON/BIN GLB')
    doc, binary = json.loads(chunks[0][1]), chunks[1][1]
    def finite_json(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('non-finite JSON number')
        if isinstance(value, dict):
            for child in value.values():
                finite_json(child)
        elif isinstance(value, list):
            for child in value:
                finite_json(child)
    finite_json(doc)
    if len(doc.get('buffers', [])) != 1 or doc['buffers'][0].get('uri'):
        raise ValueError('external/multiple buffers')
    if not 0 <= len(binary) - doc['buffers'][0]['byteLength'] <= 3:
        raise ValueError('binary length mismatch')
    if any('uri' in x for x in doc.get('images', [])):
        raise ValueError('external image')
    if doc.get('cameras') or doc.get('extensions', {}).get('KHR_lights_punctual'):
        raise ValueError('export contains preview cameras/lights')
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
    types = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
    for view in doc.get('bufferViews', []):
        if view.get('buffer', 0) != 0 or view.get('byteOffset', 0) + view['byteLength'] > len(binary):
            raise ValueError('bufferView out of bounds')
    for accessor in doc.get('accessors', []):
        if 'sparse' in accessor or 'bufferView' not in accessor:
            raise ValueError('sparse/unbacked accessor needs explicit validator support')
        fmt, width = types[accessor['componentType']]
        n = components[accessor['type']]
        view = doc['bufferViews'][accessor['bufferView']]
        stride = view.get('byteStride', n * width)
        relative = accessor.get('byteOffset', 0)
        if accessor['count'] <= 0 or stride < n * width or relative + (accessor['count'] - 1) * stride + n * width > view['byteLength']:
            raise ValueError('accessor out of bounds')
        if fmt == 'f':
            start = view.get('byteOffset', 0) + relative
            for i in range(accessor['count']):
                if not all(math.isfinite(v) for v in struct.unpack_from('<' + fmt * n, binary, start + i * stride)):
                    raise ValueError('non-finite accessor')
    triangles, primitives = 0, 0
    for mesh in doc.get('meshes', []):
        for primitive in mesh['primitives']:
            if primitive.get('mode', 4) != 4:
                raise ValueError('non-triangle primitive')
            accessor = doc['accessors'][primitive.get('indices', primitive['attributes']['POSITION'])]
            if accessor['count'] % 3:
                raise ValueError('incomplete triangle')
            if 'indices' in primitive:
                if accessor['type'] != 'SCALAR' or accessor['componentType'] not in (5121, 5123, 5125):
                    raise ValueError('invalid index accessor')
                view = doc['bufferViews'][accessor['bufferView']]
                fmt, width = types[accessor['componentType']]
                start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                stride = view.get('byteStride', width)
                vertex_count = doc['accessors'][primitive['attributes']['POSITION']]['count']
                if any(struct.unpack_from('<' + fmt, binary, start + i * stride)[0] >= vertex_count for i in range(accessor['count'])):
                    raise ValueError('index outside position array')
            triangles += accessor['count'] // 3
            primitives += 1
    return {'triangles': triangles, 'primitives': primitives, 'materials': len(doc.get('materials', [])), 'images': len(doc.get('images', [])), 'skins': len(doc.get('skins', [])), 'animations': len(doc.get('animations', []))}


def validate(manifest):
    entries = manifest['files']
    if not entries or len({x['path'] for x in entries}) != len(entries):
        raise ValueError('empty/duplicate inventory')
    results = []
    for entry in entries:
        path = (ROOT / entry['path']).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError('missing/outside inventory file: ' + entry['path'])
        data = path.read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('inventory digest mismatch: ' + entry['path'])
        record = {'path': entry['path'], 'bytes': len(data)}
        if path.suffix == '.glb':
            record.update(audit_glb(path))
        elif path.suffix == '.blend' and not data.startswith((b'BLENDER', b'\x1f\x8b', b'\x28\xb5\x2f\xfd')):
            raise ValueError('unknown Blender source container: ' + entry['path'])
        elif path.suffix == '.png':
            if data[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('invalid PNG')
            record['pixels'] = list(struct.unpack_from('>II', data, 16))
        results.append(record)
    return {'status': 'pass', 'scope': 'file integrity and self-contained finite GLB; track audits required separately; no application/GPU claim', 'files': len(results), 'totalBytes': sum(x['bytes'] for x in results), 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, default=HERE / 'manifest.json')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = validate(json.loads(args.manifest.read_text()))
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'results'}, indent=2))
