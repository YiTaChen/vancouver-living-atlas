"""Read-only PBR asset audit. Python standard library; Blender optional for .blend inspection."""
from pathlib import Path
import argparse, hashlib, json, math, shutil, struct, subprocess, sys, tempfile, zlib

ROOT = Path(__file__).resolve().parents[3]
EXPECTED_SLOTS = ['heritage-brick', 'sandstone', 'concrete', 'cedar', 'roof-shingle',
                  'street-brick', 'painted-metal', 'asphalt']
MAPS = ('color', 'normal', 'orm')


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png(raw, label):
    """Decode non-interlaced RGB/RGBA 8-bit PNG, including every standard row filter."""
    require(raw[:8] == b'\x89PNG\r\n\x1a\n', f'{label}: PNG signature')
    offset, compressed, header, ended = 8, bytearray(), None, False
    while offset < len(raw):
        require(offset + 12 <= len(raw), f'{label}: truncated PNG chunk')
        size, kind = struct.unpack_from('>I4s', raw, offset)
        offset += 8
        data = raw[offset:offset + size]
        require(len(data) == size and offset + size + 4 <= len(raw), f'{label}: truncated {kind!r}')
        crc = struct.unpack_from('>I', raw, offset + size)[0]
        require(zlib.crc32(kind + data) & 0xffffffff == crc, f'{label}: {kind!r} CRC')
        offset += size + 4
        if kind == b'IHDR':
            require(header is None and size == 13, f'{label}: IHDR')
            header = struct.unpack('>2I5B', data)
        elif kind == b'IDAT':
            compressed.extend(data)
        elif kind == b'IEND':
            require(size == 0, f'{label}: IEND')
            ended = True
            break
    require(header is not None and ended and offset == len(raw), f'{label}: complete PNG container')
    width, height, depth, color, compression, filtering, interlace = header
    require(0 < width <= 4096 and 0 < height <= 4096, f'{label}: bounded image dimensions')
    require(depth == 8 and color in (2, 6) and (compression, filtering, interlace) == (0, 0, 0),
            f'{label}: expected 8-bit RGB/RGBA, non-interlaced PNG')
    channels = 3 if color == 2 else 4
    stride = width * channels
    scanlines = zlib.decompress(compressed)
    require(len(scanlines) == (stride + 1) * height, f'{label}: decoded PNG length')
    pixels, previous = bytearray(), bytearray(stride)
    for row in range(height):
        start = row * (stride + 1)
        filter_type = scanlines[start]
        require(filter_type <= 4, f'{label}: unknown PNG filter')
        current = bytearray(scanlines[start + 1:start + 1 + stride])
        if filter_type == 0:
            pixels.extend(current)
            previous = current
            continue
        for i in range(stride):
            left = current[i - channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                prediction = left
            elif filter_type == 2:
                prediction = up
            elif filter_type == 3:
                prediction = (left + up) // 2
            elif filter_type == 4:
                p = left + up - corner
                distances = (abs(p - left), abs(p - up), abs(p - corner))
                prediction = (left, up, corner)[distances.index(min(distances))]
            else:
                prediction = 0
            current[i] = (current[i] + prediction) & 255
        pixels.extend(current)
        previous = current
    return {'width': width, 'height': height, 'channels': channels, 'pixels': bytes(pixels)}


def pixel(image, x, y):
    """Bottom-origin UV pixel, independent of the PNG top scanline convention."""
    offset = ((image['height'] - 1 - y) * image['width'] + x) * image['channels']
    return image['pixels'][offset:offset + 3]


def normal_stats(image, label):
    channels = image['channels']
    rgb = [image['pixels'][i::channels] for i in range(3)]
    max_error = 0
    for r, g, b in zip(*rgb):
        require(b >= 128, f'{label}: tangent normal points behind its surface')
        length = math.sqrt(sum((v / 127.5 - 1) ** 2 for v in (r, g, b)))
        max_error = max(max_error, abs(length - 1))
    require(max_error < .015, f'{label}: invalid encoded unit normal ({max_error})')
    return {'channelRanges': [[min(v), max(v)] for v in rgb], 'maxUnitLengthError': round(max_error, 6)}


def library_report(root, source, catalog):
    manifest = json.loads((root / 'manifest.json').read_text())
    require(manifest['atlas'] == catalog['atlas'], 'manifest atlas differs from editable catalog')
    ids = [m['id'] for m in manifest['materials']]
    require(ids == EXPECTED_SLOTS == [m['id'] for m in catalog['materials']], 'material slot order changed')
    require(manifest['normalConvention'] == 'OpenGL +Y tangent', 'normal convention is not OpenGL +Y')
    atlas = manifest['atlas']
    width, height = atlas['width'], atlas['height']
    slot, padding = atlas['slotSize'], atlas['padding']
    useful = slot - padding * 2
    require((width, height, atlas['columns'], atlas['rows'], slot, padding) == (1024, 512, 4, 2, 256, 8),
            'runtime atlas layout contract changed; update shaders and validator together')
    report = {'runtimeMaps': {}, 'slots': []}
    images = {}
    for key in MAPS:
        raw = (root / manifest['maps'][key]).read_bytes()
        require(len(raw) == manifest['files'][key]['bytes'], f'{key}: manifest byte count')
        require(digest(raw) == manifest['files'][key]['sha256'], f'{key}: manifest SHA-256')
        image = images[key] = png(raw, key)
        require((image['width'], image['height'], image['channels']) == (width, height, 3), f'{key}: atlas dimensions/channels')
        report['runtimeMaps'][key] = {'bytes': len(raw), 'sha256': digest(raw), 'dimensions': [width, height]}
    report['runtimeMaps']['normal'].update(normal_stats(images['normal'], 'normal atlas'))
    for index, spec in enumerate(manifest['materials']):
        original = catalog['materials'][index]
        for key in ('id', 'tileMeters', 'roughness', 'metalness', 'reliefMeters', 'pattern'):
            require(spec[key] == original[key], f'{spec["id"]}: stale catalog field {key}')
        require(all(math.isfinite(v) and v > 0 for v in spec['tileMeters']), f'{spec["id"]}: physical dimensions')
        row, col = divmod(index, atlas['columns'])
        origin_x, origin_y = col * slot, row * slot
        summary = {'id': spec['id'], 'slot': index, 'tileMeters': spec['tileMeters'], 'sourceMaps': {}}
        for key in MAPS:
            image = images[key]
            for y in range(slot):
                for x in range(slot):
                    if padding <= x < slot - padding and padding <= y < slot - padding:
                        continue
                    expected = pixel(image, origin_x + padding + (x - padding) % useful,
                                     origin_y + padding + (y - padding) % useful)
                    require(pixel(image, origin_x + x, origin_y + y) == expected,
                            f'{spec["id"]}/{key}: incorrect wrap padding at {x},{y}')
            raw = (source / 'textures' / f'{spec["id"]}-{key}.png').read_bytes()
            source_image = png(raw, f'{spec["id"]}/{key}')
            require((source_image['width'], source_image['height'], source_image['channels']) == (480, 480, 3),
                    f'{spec["id"]}/{key}: editable source dimensions')
            summary['sourceMaps'][key] = {'bytes': len(raw), 'sha256': digest(raw)}
            if key == 'normal':
                summary['sourceMaps'][key].update(normal_stats(source_image, f'{spec["id"]}/{key}'))
            if key == 'orm':
                for image_name, pixels in [('source', source_image['pixels']), ('atlas slot', bytes(
                    v for y in range(useful) for x in range(useful)
                    for v in pixel(image, origin_x + padding + x, origin_y + padding + y)))]:
                    require(set(pixels[0::3]) == {255}, f'{spec["id"]}/{image_name}: AO must be neutral R=1')
                    roughness = pixels[1::3]
                    require(min(roughness) / 255 >= spec['roughness'] - .092 and max(roughness) / 255 <= min(1, spec['roughness'] + .092),
                            f'{spec["id"]}/{image_name}: roughness exceeds catalog range')
                    require(set(pixels[2::3]) == {round(spec['metalness'] * 255)}, f'{spec["id"]}/{image_name}: metallic channel')
        mean = [sum(pixel(images['color'], origin_x + padding + x, origin_y + padding + y)[c]
                    for y in range(useful) for x in range(useful)) / (useful * useful * 255) for c in range(3)]
        require(all(abs(a - b) < .0021 for a, b in zip(mean, spec['averageColor'])), f'{spec["id"]}: fallback color does not match encoded atlas')
        summary['encodedAverageColor'] = [round(v, 6) for v in mean]
        report['slots'].append(summary)
    return report


BLENDER_AUDIT = r'''
import bpy, json, sys, hashlib, math
from pathlib import Path
args = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text())
def require(value, message):
    if not value: raise RuntimeError(message)
specs = {m['id']: m for m in args['catalog']['materials']}
results = []
for path, is_module in args['files']:
    bpy.ops.wm.open_mainfile(filepath=path)
    found = []
    for material in bpy.data.materials:
        identifier = material.get('city_surface_id' if is_module else 'surface_id')
        if not identifier: continue
        require(identifier in specs, 'Unknown surface ' + identifier)
        spec = specs[identifier]; found.append(identifier)
        nodes = material.node_tree.nodes
        maps = {Path(node.image.filepath).name.rsplit('-', 1)[-1].removesuffix('.png'): node.image
                for node in nodes if node.type == 'TEX_IMAGE' and node.image}
        require(set(maps) == {'color', 'normal', 'orm'}, material.name + ': complete editable maps')
        for key, image in maps.items():
            require(image.packed_file is not None, material.name + ': unpacked image ' + key)
            require(image.colorspace_settings.name == ('sRGB' if key == 'color' else 'Non-Color'), material.name + ': color space ' + key)
            expected = Path(args['source']) / 'textures' / (identifier + '-' + key + '.png')
            require(hashlib.sha256(image.packed_file.data).digest() == hashlib.sha256(expected.read_bytes()).digest(), material.name + ': stale packed ' + key)
        mapping = [n for n in nodes if n.type == 'VECT_MATH' and n.operation == 'MULTIPLY']
        require(len(mapping) == 1, material.name + ': one physical UV scale')
        scale = mapping[0].inputs[1].default_value
        factor = 2 if is_module else 1
        require(all(abs(scale[i] - factor / spec['tileMeters'][i]) < 1e-5 for i in (0, 1)), material.name + ': physical UV dimensions')
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        require(bsdf.inputs['Base Color'].is_linked and bsdf.inputs['Normal'].is_linked, material.name + ': PBR color/normal link')
        for channel, socket in [('Green', 'Roughness'), ('Blue', 'Metallic')]:
            links = bsdf.inputs[socket].links
            require(len(links) == 1 and links[0].from_socket.name == channel and links[0].from_node.type == 'SEPARATE_COLOR', material.name + ': ORM channel ' + socket)
    if is_module:
        require({'sandstone', 'cedar', 'painted-metal'} <= set(found), path + ': shared source materials missing')
        meshes = [ob for ob in bpy.context.scene.objects if ob.type == 'MESH']
        require(len(meshes) == 1, path + ': expected one editable dimensioned module')
        ob = meshes[0]; uv = ob.data.uv_layers.get('UVMap')
        require(uv is not None and len(ob.data.uv_layers) == 1, path + ': source must retain metric UVMap before atlas bake')
        for polygon in ob.data.polygons:
            loops = list(polygon.loop_indices)
            # Any consistent dominant-axis projection is valid; triangle normals
            # near a 45-degree bevel can choose either axis after triangulation.
            candidates = [(0, 2), (0, 1), (1, 2)]
            require(any(all(max(abs(uv.data[li].uv[c] - (ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co)[axes[c]] / 2) for c in (0, 1)) < 2e-5 for li in loops) for axes in candidates), path + ': UVs no longer match final metre geometry')
        require(abs(ob.dimensions.z - 3.2) < .02, path + ': compact module height')
    else:
        require(sorted(found) == sorted(specs), path + ': all eight editable source materials')
    results.append({'file': path, 'surfaceIds': sorted(set(found)), 'packedImagesMatchSource': True,
                    'colorSpacesAndORMChannels': True, 'physicalUVScale': True})
Path(args['report']).write_text(json.dumps(results))
'''


def blend_report(blender, source, catalog, module_source):
    files = [(source / 'city-material-library.blend', False)]
    if module_source:
        files += [(module_source / f'{name}.lod{lod}.blend', True) for name in ('heritage-shop-bay', 'modern-lobby-bay') for lod in (0, 1)]
    for path, _ in files:
        require(path.is_file(), f'Missing editable source: {path}')
    with tempfile.TemporaryDirectory(prefix='city-material-audit-') as directory:
        directory = Path(directory)
        script, args, report = directory / 'inspect.py', directory / 'args.json', directory / 'report.json'
        script.write_text(BLENDER_AUDIT)
        args.write_text(json.dumps({'files': [(str(p), module) for p, module in files],
                                   'source': str(source), 'catalog': catalog, 'report': str(report)}))
        process = subprocess.run([str(blender), '--background', '--factory-startup', '--python-exit-code', '1',
                                  '--python', str(script), '--', str(args)], capture_output=True, text=True)
        require(process.returncode == 0 and report.is_file(), 'Blender source audit failed:\n' + process.stdout[-5000:] + process.stderr[-2000:])
        result = json.loads(report.read_text())
    for row, (path, _) in zip(result, files):
        row['sha256'] = digest(path.read_bytes())
    return result


def streetscape_report(root):
    """Read embedded shipping PBR maps and UVs; glTF itself defines color/data interpretation."""
    manifest = json.loads((root / 'manifest.json').read_text())
    require(manifest.get('sharedMaterialCatalog') == 'tools/assets/city-materials/catalog.json',
            'Streetscape manifest does not identify the shared source catalog')
    assets = [asset for asset in manifest['assets'] if asset['id'] in ('heritage-shop-bay', 'modern-lobby-bay')]
    require(len(assets) == 2, 'Both shipping bay modules are required')
    result = []
    for asset in assets:
        require(sorted(lod['level'] for lod in asset['lods']) == [0, 1], 'Both shipping LODs are required')
        for lod in asset['lods']:
            path = root / lod['file']; raw = path.read_bytes()
            require(struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw)), f'{path}: GLB header')
            require(len(raw) == lod['bytes'], f'{path}: manifest byte count')
            offset, document, binary = 12, None, None
            while offset < len(raw):
                length, kind = struct.unpack_from('<I4s', raw, offset)
                data = raw[offset + 8:offset + 8 + length]
                require(len(data) == length, f'{path}: truncated GLB chunk')
                if kind == b'JSON': document = json.loads(data)
                elif kind == b'BIN\x00': binary = data
                offset += 8 + length
            require(document is not None and binary is not None and offset == len(raw), f'{path}: GLB chunks')
            material = document['materials'][0]; pbr = material['pbrMetallicRoughness']
            require(len(document['materials']) <= 3, f'{path}: opaque/glass/diffuser material budget')
            require(pbr.get('baseColorFactor', [1, 1, 1, 1]) == [1, 1, 1, 1], f'{path}: baked albedo unexpectedly tinted')
            require(pbr.get('metallicFactor', 1) == 1 and pbr.get('roughnessFactor', 1) == 1,
                    f'{path}: ORM channels unexpectedly scaled')
            require('KHR_materials_transmission' not in material.get('extensions', {}), f'{path}: unsupported transmission')
            image_info, decoded_images = {}, {}
            for key, reference in [('color', pbr['baseColorTexture']), ('normal', material['normalTexture']),
                                   ('orm', pbr['metallicRoughnessTexture'])]:
                require(reference.get('texCoord', 0) == 0, f'{path}: {key} must use UV0')
                require('KHR_texture_transform' not in reference.get('extensions', {}), f'{path}: baked UV transform')
                image_doc = document['images'][document['textures'][reference['index']]['source']]
                require('uri' not in image_doc and image_doc['mimeType'] == 'image/png', f'{path}: embedded PNG required')
                view = document['bufferViews'][image_doc['bufferView']]
                image_raw = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
                decoded = decoded_images[key] = png(image_raw, f'{path}/{key}')
                size = 1024 if lod['level'] == 0 else 512
                require((decoded['width'], decoded['height']) == (size, size), f'{path}/{key}: LOD atlas size')
                image_info[key] = {'sha256': digest(image_raw), 'bytes': len(image_raw), 'dimensions': [size, size]}
                if key == 'orm':
                    channels = decoded['channels']; pixels = decoded['pixels']
                    active = [i for i in range(0, len(pixels), channels) if pixels[i] > 240]
                    require(len(active) > size * size * .1, f'{path}: no substantial baked ORM coverage')
                    # Island boundaries contain a few antialiased coverage texels;
                    # they are not authored ambient occlusion. Interior AO stays neutral.
                    require(sum(pixels[i] == 255 for i in active) / len(active) > .999, f'{path}: covered ORM AO should be neutral')
                    image_info[key]['coveredPixels'] = len(active)
                    image_info[key]['roughnessRange'] = [min(pixels[i + 1] for i in active), max(pixels[i + 1] for i in active)]
                    image_info[key]['metallicRange'] = [min(pixels[i + 2] for i in active), max(pixels[i + 2] for i in active)]
            orm, normal = decoded_images['orm'], decoded_images['normal']
            good, covered = 0, 0
            for index in range(orm['width'] * orm['height']):
                if orm['pixels'][index * orm['channels']] <= 240: continue
                covered += 1
                start = index * normal['channels']
                values = normal['pixels'][start:start + 3]
                length = math.sqrt(sum((v / 127.5 - 1) ** 2 for v in values))
                good += values[2] >= 128 and abs(length - 1) < .03
            require(good / covered > .98, f'{path}: covered normal atlas is not tangent-space unit data')
            image_info['normal']['validCoveredFraction'] = round(good / covered, 6)
            for mesh in document['meshes']:
                for primitive in mesh['primitives']:
                    if primitive.get('material', 0) != 0: continue
                    accessor = document['accessors'][primitive['attributes']['TEXCOORD_0']]
                    require(accessor['componentType'] == 5126 and accessor['type'] == 'VEC2', f'{path}: float UV0 required')
                    view = document['bufferViews'][accessor['bufferView']]
                    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                    stride = view.get('byteStride', 8)
                    for index in range(accessor['count']):
                        require(all(math.isfinite(v) and -.00001 <= v <= 1.00001 for v in struct.unpack_from('<2f', binary, start + index * stride)), f'{path}: UV0 outside baked atlas')
            result.append({'asset': asset['id'], 'lod': lod['level'], 'file': str(path), 'sha256': digest(raw), 'maps': image_info})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'public/materials/city')
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parent / 'source')
    parser.add_argument('--report', type=Path, help='Write JSON evidence; omitted means stdout only')
    parser.add_argument('--blender', type=Path, default=shutil.which('blender') or '/Applications/Blender.app/Contents/MacOS/Blender')
    parser.add_argument('--skip-blender', action='store_true', help='Check maps only; report explicitly marks sources unverified')
    parser.add_argument('--streetscape-source', type=Path, help='Also audit the four editable ID.lodN.blend source files in this directory')
    parser.add_argument('--streetscape-root', type=Path, help='Also audit the two exported GLB modules and LODs under this manifest root')
    args = parser.parse_args()
    catalog_file = Path(__file__).resolve().parent / 'catalog.json'
    catalog = json.loads(catalog_file.read_text())
    result = library_report(args.root.resolve(), args.source.resolve(), catalog)
    result.update({'passed': True, 'catalogSha256': digest(catalog_file.read_bytes()),
                   'generatorSha256': digest((catalog_file.parent / 'generate_city_materials.py').read_bytes()),
                   'blenderSourceAudit': 'skipped' if args.skip_blender else 'passed'})
    if not args.skip_blender:
        result['editableSources'] = blend_report(args.blender, args.source.resolve(), catalog,
                                                args.streetscape_source.resolve() if args.streetscape_source else None)
    if args.streetscape_root:
        result['shippingGLBs'] = streetscape_report(args.streetscape_root.resolve())
    output = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output)
    print(output)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zlib.error, struct.error) as error:
        print(f'City material validation FAILED: {error}', file=sys.stderr)
        sys.exit(1)
