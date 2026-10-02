"""Read-only GLB and editable Blender source contract audit (standard library).

No report is written unless --report is supplied. Blender checks are required by
normal validation; --skip-blender marks them explicitly as not verified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import shutil
import struct
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def glb(raw):
    require(len(raw) >= 28, 'truncated GLB header')
    require(struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw)), 'invalid GLB header')
    n, tag = struct.unpack_from('<I4s', raw, 12)
    require(tag == b'JSON' and 20+n+8 <= len(raw), 'invalid JSON chunk')
    doc = json.loads(raw[20:20+n])
    size, tag = struct.unpack_from('<I4s', raw, 20+n)
    require(tag == b'BIN\0' and 28+n+size == len(raw), 'invalid binary chunk')
    return doc, raw[28+n:]


def accessor(doc, binary, index):
    a = doc['accessors'][index]
    require('sparse' not in a, 'unexpected sparse accessor')
    view = doc['bufferViews'][a['bufferView']]
    require(view.get('buffer', 0) == 0, 'external buffer')
    formats = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
    require(a['componentType'] in formats, 'unsupported component type')
    code, size = formats[a['componentType']]
    count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    offset = view.get('byteOffset', 0)+a.get('byteOffset', 0)
    stride = view.get('byteStride', size*count)
    end = offset + max(0, a['count']-1)*stride + size*count
    require(end <= view.get('byteOffset', 0)+view['byteLength'] <= len(binary), 'accessor exceeds buffer')
    return [struct.unpack_from('<'+code*count, binary, offset+i*stride) for i in range(a['count'])]


def clearance_intersections(points, indices, clearance):
    """Conservative triangle AABB/open-box test; boundaries may touch the opening."""
    lo, hi = clearance['min'], clearance['max']
    collisions = 0
    for offset in range(0, len(indices), 3):
        triangle = [points[indices[offset+i][0]] for i in range(3)]
        if all(min(v[k] for v in triangle) < hi[k]-1e-6 and
               max(v[k] for v in triangle) > lo[k]+1e-6 for k in range(3)):
            collisions += 1
    return collisions


def validate_lod(root, asset, lod):
    path = root/lod['file']
    require(digest(path) == lod['sha256'], f'{path.name}: GLB hash')
    require(path.stat().st_size == lod['bytes'], f'{path.name}: byte count')
    require(digest(root/lod['source']) == lod['sourceSha256'], f'{path.name}: source hash')
    doc, binary = glb(path.read_bytes())
    require(not doc.get('animations') and not doc.get('skins') and not doc.get('cameras'), 'static meshes only')
    require(len(doc['meshes']) == len(doc['nodes']) == len(doc['materials']) == 1, 'one mesh, node and material required')
    node = doc['nodes'][0]
    require(node.get('translation', [0, 0, 0]) == [0, 0, 0], 'origin must be ground/attachment datum')
    require(node.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1] and node.get('scale', [1, 1, 1]) == [1, 1, 1] and 'matrix' not in node, 'axis conversion must be baked exactly once')
    require(node.get('extras', {}).get('asset_id') == asset['id'], 'asset traceability')
    primitives = doc['meshes'][0]['primitives']
    require(len(primitives) == 1, 'one draw primitive budget')
    prim = primitives[0]
    require(prim.get('mode', 4) == 4, 'triangle geometry required')
    require(all(name in prim['attributes'] for name in ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT']), 'complete PBR attributes')
    points = accessor(doc, binary, prim['attributes']['POSITION'])
    indices = accessor(doc, binary, prim['indices'])
    normals = accessor(doc, binary, prim['attributes']['NORMAL'])
    tangents = accessor(doc, binary, prim['attributes']['TANGENT'])
    uv = accessor(doc, binary, prim['attributes']['TEXCOORD_0'])
    require(len(points) == len(normals) == len(tangents) == len(uv), 'attribute counts')
    require(all(all(math.isfinite(v) for v in item) for values in [points, normals, tangents, uv] for item in values), 'finite vertex attributes')
    require(all(abs(sum(v*v for v in normal)-1) < 1e-4 for normal in normals), 'unit normals')
    require(all(abs(sum(v*v for v in tangent[:3])-1) < 1e-4 and abs(tangent[3]) == 1 for tangent in tangents), 'unit tangent frame')
    for point, normal, texcoord in zip(points, normals, uv):
        x, height, front = point
        author_normal = (normal[0], -normal[2], normal[1])
        # glTF float rounding can tie two 45-degree bevel normals; the source
        # audit checks the exact authoring choice, export may match either tied axis.
        dominant = max(abs(value) for value in author_normal)
        errors = []
        for axis in range(3):
            if dominant-abs(author_normal[axis]) > 1e-6:
                continue
            metres = (x, height) if axis == 1 else ((x, -front) if axis == 2 else (-front, height))
            expected = (metres[0]/lod['tileMeters'][0], 1-metres[1]/lod['tileMeters'][1])
            errors.append(max(abs(texcoord[k]-expected[k]) for k in range(2)))
        require(min(errors) < 1e-4, 'export physical metre UV repeat')
    require(len(indices)%3 == 0 and len(indices)//3 == lod['triangles'] <= lod['triangleCap'], 'triangle budget')
    require(all(0 <= i[0] < len(points) for i in indices), 'index range')
    for offset in range(0, len(indices), 3):
        a, b, c = [points[indices[offset+i][0]] for i in range(3)]
        u = [b[k]-a[k] for k in range(3)]
        v = [c[k]-a[k] for k in range(3)]
        area2 = sum(t*t for t in [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]])
        require(area2 > 1e-16, 'degenerate triangle')
    bounds = {'min': [min(p[k] for p in points) for k in range(3)], 'max': [max(p[k] for p in points) for k in range(3)]}
    require(all(abs(bounds[side][k]-lod['bounds'][side][k]) < 1e-5 for side in bounds for k in range(3)), 'declared real metre dimensions')
    require(bounds['min'][2] >= .01999, 'relief must remain outside facade plane')
    if 'clearance' in asset:
        require(clearance_intersections(points, indices, asset['clearance']) == 0, f'{asset["id"]}: opening obstruction')
    mat = doc['materials'][0]
    require(mat.get('alphaMode', 'OPAQUE') == 'OPAQUE', 'opaque material budget')
    require(mat.get('extras', {}).get('city_surface_id') == lod['surface'], 'shared surface identity')
    pbr = mat['pbrMetallicRoughness']
    require(pbr.get('baseColorFactor', [1, 1, 1, 1]) == [1, 1, 1, 1], 'neutral base color factor')
    require(pbr.get('metallicFactor', 1) == pbr.get('roughnessFactor', 1) == 1, 'neutral PBR factors')
    textures = [mat['normalTexture'], pbr['baseColorTexture'], pbr['metallicRoughnessTexture']]
    require(len(doc['images']) == 3, 'three shared maps per asset')
    for texture, kind in zip(textures, ['normal', 'color', 'orm']):
        require(texture.get('texCoord', 0) == 0, 'physical repeat in UV0')
        image = doc['images'][doc['textures'][texture['index']]['source']]
        view = doc['bufferViews'][image['bufferView']]
        raw = binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        expected = digest(ROOT/'tools/assets/city-materials/source/textures'/f'{lod["surface"]}-{kind}.png')
        require(hashlib.sha256(raw).hexdigest() == expected, 'embedded shared map hash')
    for im in doc['images']:
        require('uri' not in im and im['mimeType'] == 'image/png', 'embedded maps')
        view = doc['bufferViews'][im['bufferView']]
        raw = binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
        require(raw[:8] == b'\x89PNG\r\n\x1a\n', 'PNG image')
        require(struct.unpack_from('>II', raw, 16) == (480, 480), 'reuse existing 480-pixel maps')
    return {'id': asset['id'], 'lod': lod['level'], 'triangles': lod['triangles'], 'materials': 1,
            'drawPrimitives': 1, 'bytes': lod['bytes'], 'clearanceChecked': 'clearance' in asset}


BLENDER_AUDIT = r'''
import bpy, hashlib, json, sys
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]); manifest=json.loads((root/'manifest.json').read_text())
for asset in manifest['assets']:
 for lod in asset['lods']:
  bpy.ops.wm.open_mainfile(filepath=str(root/lod['source']))
  scene=bpy.context.scene
  assert scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1
  assert scene['asset_id']==asset['id'] and scene['lod']==lod['level']
  objects=list(scene.objects); assert objects and all(o.type=='MESH' for o in objects)
  triangles=0
  for ob in objects:
   assert tuple(ob.location)==(0,0,0) and tuple(ob.scale)==(1,1,1)
   assert ob['asset_id']==asset['id'] and ob['lod']==lod['level']
   assert len(ob.data.materials)==1 and ob['uv_units']=='metres'
   mesh=ob.data; mesh.calc_loop_triangles(); triangles+=len(mesh.loop_triangles)
   uv=mesh.uv_layers['UVMap']
   for poly in mesh.polygons:
    axis=max(range(3),key=lambda k:abs(poly.normal[k]))
    for li in poly.loop_indices:
     co=ob.matrix_world@mesh.vertices[mesh.loops[li].vertex_index].co
     expected=(co.x,co.z) if axis==1 else ((co.x,co.y) if axis==2 else (co.y,co.z))
     assert max(abs(uv.data[li].uv[k]-expected[k]) for k in range(2)) < 1e-5, ('metre UV',asset['id'])
   mat=ob.data.materials[0]; surface=mat['city_surface_id']; assert surface==lod['surface']
   scale=mat.node_tree.nodes['Metres to shared physical repeat']
   assert scale.operation=='MULTIPLY'
   assert max(abs(scale.inputs[1].default_value[k]-1/lod['tileMeters'][k]) for k in range(2)) < 1e-6
   textures=[n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE']; assert len(textures)==3
   for tex in textures:
    img=tex.image; assert img.packed_file and tex.extension=='REPEAT'
    kind=img.name.split('-')[-1].split('.')[0]
    assert img.colorspace_settings.name==('sRGB' if kind=='color' else 'Non-Color')
    assert hashlib.sha256(bytes(img.packed_file.data)).hexdigest()==manifest['sourceMaps'][surface][kind]
  assert triangles==lod['triangles'], (asset['id'],lod['level'],triangles,lod['triangles'])
print('BLENDER_SOURCE_AUDIT_PASSED')
'''


def validate(root=HERE, blender=None, skip_blender=False):
    root = Path(root).resolve()
    manifest = json.loads((root/'manifest.json').read_text())
    require(manifest['units'] == 'metres' and manifest['upAxis'] == '+Y' and manifest['frontAxis'] == '+Z', 'coordinate contract')
    require(len(manifest['assets']) == 8 and len({a['id'] for a in manifest['assets']}) == 8, 'eight distinct modules')
    require({a['role'] for a in manifest['assets']} == {'sill', 'window-frame', 'cornice', 'base', 'corner', 'entrance', 'awning'}, 'Phase C inventory coverage')
    require(manifest['catalogSha256'] == digest(ROOT/'tools/assets/city-materials/catalog.json'), 'current shared catalog provenance')
    require(manifest['builderSha256'] == digest(HERE/'build_architecture_details.py'), 'current builder provenance')
    results = []
    for asset in manifest['assets']:
        require([lod['level'] for lod in asset['lods']] == [0, 1], 'independently authored LOD pair')
        for lod in asset['lods']:
            results.append(validate_lod(root, asset, lod))
        first, second = asset['lods']
        require(second['triangles'] <= first['triangles'], 'LOD triangle reduction')
        require(all(abs(first['bounds'][side][k]-second['bounds'][side][k]) <= .02 for side in ['min', 'max'] for k in range(3)), 'LOD silhouette bound drift exceeds 2 cm')
    source_status = 'skipped'
    if not skip_blender:
        binary = blender or shutil.which('blender')
        require(binary, 'Blender is required for editable source verification')
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp)/'audit.py'
            script.write_text(BLENDER_AUDIT)
            result = subprocess.run([str(binary), '--background', '--factory-startup', '--threads', '2', '--python-exit-code', '1', '--python', str(script), '--', str(root)], capture_output=True, text=True, timeout=120)
            require(result.returncode == 0 and 'BLENDER_SOURCE_AUDIT_PASSED' in result.stdout, f'Blender source audit failed:\n{result.stdout}\n{result.stderr}')
        source_status = 'passed'
    return {'passed': True, 'blenderSources': source_status, 'checks': ['actual GLB triangles and one material/primitive budget', 'static origin and axes', 'real metre bounds', 'finite normals tangents UVs', 'non-degenerate triangles', 'open entry and window/awning clearance', 'LOD primary bounds within 2 cm', 'shared packed PBR source maps', 'editable independent LOD source hashes and physical UVs'], 'assets': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=HERE)
    parser.add_argument('--blender', type=Path)
    parser.add_argument('--skip-blender', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = validate(args.root, args.blender, args.skip_blender)
    text = json.dumps(report, indent=2)+'\n'
    if args.report:
        args.report.write_text(text)
    print(text)


if __name__ == '__main__':
    main()
