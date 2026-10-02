"""Bake artist-edited opaque Principled materials into the shared city atlas.

Run with Blender 4.5+ --background --factory-startup --python-exit-code 1
--python export_material_library.py -- --blend INPUT --output WORKDIR
--source WORKSOURCE. This does not regenerate catalog fields, edit the input
.blend, alter city geometry, or publish the result to public/.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import struct
import sys
import tempfile
import zlib

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SLOTS = ('heritage-brick', 'sandstone', 'concrete', 'cedar', 'roof-shingle',
         'street-brick', 'painted-metal', 'asphalt')
MAPS = ('color', 'normal', 'orm')
SOURCE_SIZE, TILE_SIZE, PADDING = 480, 240, 8
SOURCE_UV, BAKE_UV = 'UVMap', 'CityExportUV'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def encoded(data):
    return np.rint(np.clip(data, 0, 1) * 255).astype(np.uint8)


def linear_to_srgb(data):
    data = np.clip(data, 0, 1)
    return np.where(data <= .0031308, data * 12.92,
                    1.055 * np.power(data, 1 / 2.4) - .055)


def png(path, pixels, color=False):
    """Write RGB bytes with bottom-origin UV rows and explicit PNG color intent."""
    require(pixels.dtype == np.uint8 and pixels.ndim == 3 and pixels.shape[2] == 3,
            f'{path}: expected RGB8 pixels')
    height, width, _ = pixels.shape

    def chunk(kind, value):
        return (struct.pack('!I', len(value)) + kind + value
                + struct.pack('!I', zlib.crc32(kind + value) & 0xffffffff))

    raw = b''.join(b'\x00' + row.tobytes() for row in pixels[::-1])
    intent = chunk(b'sRGB', b'\x00') if color else b''
    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0))
                     + intent + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def downsample(data, normal=False):
    """2x2 area filter in linear color/data; renormalize tangent normals."""
    values = data * 2 - 1 if normal else data
    result = values.reshape(TILE_SIZE, 2, TILE_SIZE, 2, 3).mean(axis=(1, 3))
    if normal:
        length = np.linalg.norm(result, axis=2, keepdims=True)
        require(bool(np.all(length > 1e-6)), 'Normal downsample cancelled opposing normals')
        result = result / length * .5 + .5
    return result


def walked_nodes(tree, visited=None):
    visited = set() if visited is None else visited
    if tree.as_pointer() in visited:
        return
    visited.add(tree.as_pointer())
    for node in tree.nodes:
        yield node
        if node.type == 'GROUP' and node.node_tree:
            yield from walked_nodes(node.node_tree, visited)


def source_socket(socket):
    require(len(socket.links) == 1, 'Expected one material surface connection')
    result = socket.links[0].from_socket
    while result.node.type == 'REROUTE':
        require(len(result.node.inputs[0].links) == 1, 'Disconnected material reroute')
        result = result.node.inputs[0].links[0].from_socket
    return result


def principled(material):
    require(material.use_nodes and material.node_tree, material.name + ': nodes are required')
    outputs = [node for node in material.node_tree.nodes
               if node.type == 'OUTPUT_MATERIAL' and node.is_active_output
               and node.target in ('ALL', 'CYCLES')]
    require(len(outputs) == 1, material.name + ': expected one active Cycles material output')
    output = outputs[0]
    require(not output.inputs['Volume'].is_linked,
            material.name + ': volume shaders cannot be represented by an opaque surface atlas')
    require(not output.inputs['Displacement'].is_linked,
            material.name + ': displacement changes geometry; use a Bump/Normal input instead')
    bs = source_socket(output.inputs['Surface']).node
    require(bs.type == 'BSDF_PRINCIPLED',
            material.name + ': output must be one opaque Principled BSDF (no shader mixes/glass)')
    # These lobes have no representation in the shared color/normal/ORM contract.
    for name, expected in [('Weight', 1), ('Alpha', 1), ('IOR', 1.5),
                           ('Specular IOR Level', .5), ('Diffuse Roughness', 0),
                           ('Transmission Weight', 0),
                           ('Subsurface Weight', 0), ('Coat Weight', 0),
                           ('Sheen Weight', 0), ('Anisotropic IOR Level', 0),
                           ('Thin Film Thickness', 0)]:
        socket = bs.inputs.get(name)
        if socket:
            require(not socket.is_linked and abs(socket.default_value - expected) < 1e-6,
                    f'{material.name}: unsupported {name}; this exporter is opaque color/normal/ORM only')
    tint = bs.inputs.get('Specular Tint')
    if tint:
        require(not tint.is_linked and all(abs(v - 1) < 1e-6 for v in tint.default_value[:3]),
                material.name + ': specular tint has no shared-atlas representation')
    strength, color = bs.inputs.get('Emission Strength'), bs.inputs.get('Emission Color')
    if strength and color:
        black = not color.is_linked and max(abs(v) for v in color.default_value[:3]) < 1e-6
        disabled = not strength.is_linked and abs(strength.default_value) < 1e-6
        require(black or disabled, material.name + ': emissive materials require a separate runtime material')
    for node in walked_nodes(material.node_tree):
        if node.type == 'TEX_IMAGE' and node.image:
            require(node.image.source in ('FILE', 'GENERATED'),
                    material.name + ': animated/tiled images are not supported')
            require(node.image.source == 'GENERATED' or node.image.packed_file is not None,
                    material.name + ': pack external images in Blender before exporting: ' + node.image.name)
        if node.type == 'UVMAP':
            require(node.uv_map in ('', SOURCE_UV),
                    material.name + ': only the metre UVMap is available on the bake tile')
        if node.type == 'NORMAL_MAP':
            require(node.space == 'TANGENT' and node.uv_map in ('', SOURCE_UV),
                    material.name + ': normals must use tangent space and the metre UVMap')
        if node.type == 'TEX_COORD':
            require(not any(node.outputs[name].is_linked for name in ('Reflection', 'Camera')),
                    material.name + ': camera/reflection coordinates cannot define a reusable surface')
        if node.type == 'NEW_GEOMETRY':
            require(not any(node.outputs[name].is_linked for name in ('Incoming', 'Backfacing')),
                    material.name + ': incoming/backfacing coordinates cannot define a reusable surface')
        require(node.type not in ('LIGHT_PATH', 'CAMERA', 'SHADER_TO_RGB', 'FRESNEL', 'LAYER_WEIGHT'),
                material.name + ': view/light-dependent nodes cannot define a reusable unlit surface')
    return bs, output


def material_copy(original, groups):
    """Make temporary node trees; make implicit UV readers explicitly use metres."""
    material = original.copy()
    material.name = '__city_export_' + original.name
    copied_groups = {}

    def prepare(tree):
        for node in list(tree.nodes):
            if node.type == 'GROUP' and node.node_tree:
                key = node.node_tree.as_pointer()
                if key not in copied_groups:
                    copy = node.node_tree.copy()
                    copied_groups[key] = copy
                    groups.append(copy)
                    prepare(copy)
                node.node_tree = copied_groups[key]
            if node.type == 'TEX_COORD' and node.outputs['UV'].is_linked:
                uv = tree.nodes.new('ShaderNodeUVMap')
                uv.uv_map = SOURCE_UV
                for link in list(node.outputs['UV'].links):
                    target = link.to_socket
                    tree.links.remove(link)
                    tree.links.new(uv.outputs['UV'], target)
            if node.type in ('UVMAP', 'NORMAL_MAP') and not node.uv_map:
                node.uv_map = SOURCE_UV
            if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
                uv = tree.nodes.new('ShaderNodeUVMap')
                uv.uv_map = SOURCE_UV
                tree.links.new(uv.outputs['UV'], node.inputs['Vector'])
    prepare(material.node_tree)
    return material


def bake_tile(scene, material, tile_metres, samples):
    width, height = tile_metres
    mesh = bpy.data.meshes.new('__city_export_tile')
    mesh.from_pydata([(0, 0, 0), (width, 0, 0), (width, height, 0), (0, height, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    source_uv = mesh.uv_layers.new(name=SOURCE_UV)
    target_uv = mesh.uv_layers.new(name=BAKE_UV)
    for index, coordinate in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        source_uv.data[index].uv = (coordinate[0] * width, coordinate[1] * height)
        target_uv.data[index].uv = coordinate
    mesh.uv_layers.active = source_uv
    source_uv.active_render = True
    ob = bpy.data.objects.new('__city_export_tile', mesh)
    scene.collection.objects.link(ob)
    mesh.materials.append(material)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    nt = material.node_tree
    bs, output = principled(material)
    surface = output.inputs['Surface'].links[0].from_socket
    target = nt.nodes.new('ShaderNodeTexImage')
    target.label = 'Temporary bake target, not an input to the material'
    result = {}
    scene.cycles.samples = samples

    def bake(key, mode):
        image = bpy.data.images.new('__city_export_' + key, width=SOURCE_SIZE,
                                    height=SOURCE_SIZE, alpha=False, float_buffer=True)
        # Raw float pixels are scene-linear color or numerical data. PNG writing
        # applies sRGB exactly once for color, with no AgX/display transform.
        image.colorspace_settings.name = 'Non-Color'
        target.image = image
        nt.nodes.active = target
        try:
            bpy.ops.object.bake(type=mode, uv_layer=BAKE_UV, normal_space='TANGENT',
                                normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
            pixels = np.empty(SOURCE_SIZE * SOURCE_SIZE * 4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(SOURCE_SIZE, SOURCE_SIZE, 4)[..., :3].copy()
            require(bool(np.isfinite(pixels).all()), material.name + '/' + key + ': non-finite bake')
            require(float(pixels.min()) >= -.001 and float(pixels.max()) <= 1.001,
                    material.name + '/' + key + ': values outside the supported 0–1 surface range')
            result[key] = np.clip(pixels, 0, 1)
        finally:
            target.image = None
            bpy.data.images.remove(image)

    def input_to(source, destination):
        if source.is_linked:
            nt.links.new(source.links[0].from_socket, destination)
        else:
            destination.default_value = source.default_value

    temporary = []
    try:
        emit = nt.nodes.new('ShaderNodeEmission')
        temporary.append(emit)
        input_to(bs.inputs['Base Color'], emit.inputs['Color'])
        emit.inputs['Strength'].default_value = 1
        nt.links.new(emit.outputs[0], output.inputs['Surface'])
        bake('color', 'EMIT')
        nt.links.new(surface, output.inputs['Surface'])
        bake('normal', 'NORMAL')
        normal = result['normal'] * 2 - 1
        length = np.linalg.norm(normal, axis=2, keepdims=True)
        require(bool(np.all(length > .5)) and bool(np.all(normal[..., 2] >= -.001)),
                material.name + ': tangent normals must face out of the surface')
        result['normal'] = normal / length * .5 + .5
        combine = nt.nodes.new('ShaderNodeCombineXYZ')
        temporary.append(combine)
        combine.inputs['X'].default_value = 1
        input_to(bs.inputs['Roughness'], combine.inputs['Y'])
        input_to(bs.inputs['Metallic'], combine.inputs['Z'])
        nt.links.new(combine.outputs[0], emit.inputs['Color'])
        nt.links.new(emit.outputs[0], output.inputs['Surface'])
        bake('orm', 'EMIT')
        require(bool(np.all(np.abs(result['orm'][..., 0] - 1) < .001)),
                material.name + ': occlusion channel must remain neutral')
        result['orm'][..., 0] = 1
        return result
    finally:
        nt.links.new(surface, output.inputs['Surface'])
        for node in temporary + [target]:
            nt.nodes.remove(node)
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def destination(path, blend):
    path = path.resolve()
    require(not path.is_relative_to(ROOT / 'public'), 'Export to a work directory, not public/: ' + str(path))
    require(not blend.is_relative_to(path) and not path.is_relative_to(blend.parent),
            'Output must be separate from the original .blend directory: ' + str(path))
    require(not path.exists() or (path.is_dir() and not any(path.iterdir())),
            'Output must be a new or empty directory: ' + str(path))
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blend', required=True, type=Path, help='Artist-edited source .blend; never overwritten')
    parser.add_argument('--output', required=True, type=Path, help='New work directory for the runtime atlas and manifest')
    parser.add_argument('--source', required=True, type=Path, help='New work directory for the source snapshot and 480px maps')
    parser.add_argument('--samples', type=int, default=8, help='Cycles CPU bake samples (default: 8)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    blend = args.blend.resolve()
    require(blend.is_file() and blend.suffix.lower() == '.blend', 'Input .blend does not exist')
    require(1 <= args.samples <= 256, '--samples must be between 1 and 256')
    output, source = destination(args.output, blend), destination(args.source, blend)
    require(not output.is_relative_to(source) and not source.is_relative_to(output),
            '--output and --source must be separate directories')
    catalog_path = HERE / 'catalog.json'
    catalog = json.loads(catalog_path.read_text())
    require(tuple(entry['id'] for entry in catalog['materials']) == SLOTS, 'Catalog surface slot contract changed')
    require(catalog['atlas'] == {'width': 1024, 'height': 512, 'columns': 4, 'rows': 2,
                                 'slotSize': 256, 'padding': 8}, 'Catalog atlas contract changed')
    source_hash = digest(blend)
    exporter_hash = digest(Path(__file__))
    catalog_hash = digest(catalog_path)
    # Disable embedded Python handlers/drivers before opening an artist file.
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=str(blend), use_scripts=False)
    originals = []
    for entry in catalog['materials']:
        matches = [mat for mat in bpy.data.materials if mat.get('surface_id') == entry['id']]
        require(len(matches) == 1, entry['id'] + ': expected exactly one material with this surface_id')
        material = matches[0]
        principled(material)
        metres = list(material.get('tile_metres', entry['tileMeters']))
        require(len(metres) == 2 and all(np.isfinite(v) and v > 0 for v in metres),
                entry['id'] + ': invalid physical repeat')
        require(all(abs(a - b) < 1e-6 for a, b in zip(metres, entry['tileMeters'])),
                entry['id'] + ': tile_metres must match catalog; edit mapping within that physical repeat')
        originals.append(material)
    source.parent.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    prior_scene = bpy.context.window.scene
    scene = bpy.data.scenes.new('__city_material_export')
    bpy.context.window.scene = scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.render.bake.use_clear = True
    scene.render.bake.margin = 0
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.target = 'IMAGE_TEXTURES'
    atlases = {key: np.zeros((512, 1024, 3), dtype=np.uint8) for key in MAPS}
    records = []
    try:
        with tempfile.TemporaryDirectory(prefix='.city-material-export-', dir=output.parent) as temporary:
            staging = Path(temporary)
            staged_source = staging / 'source'
            staged_output = staging / 'atlas'
            textures = staged_source / 'textures'
            textures.mkdir(parents=True)
            staged_output.mkdir()
            for slot, (entry, original) in enumerate(zip(catalog['materials'], originals)):
                print('BAKING ARTIST MATERIAL', entry['id'], flush=True)
                groups = []
                material = material_copy(original, groups)
                try:
                    baked = bake_tile(scene, material, entry['tileMeters'], args.samples)
                finally:
                    bpy.data.materials.remove(material)
                    for group in reversed(groups):
                        bpy.data.node_groups.remove(group, do_unlink=True)
                row, col = divmod(slot, 4)
                record = {'id': entry['id'], 'materialName': original.name, 'maps': {}}
                for key in MAPS:
                    data = baked[key]
                    runtime = downsample(data, normal=key == 'normal')
                    full_pixels = encoded(linear_to_srgb(data) if key == 'color' else data)
                    runtime_pixels = encoded(linear_to_srgb(runtime) if key == 'color' else runtime)
                    file = textures / f"{entry['id']}-{key}.png"
                    png(file, full_pixels, color=key == 'color')
                    padded = np.pad(runtime_pixels, ((PADDING, PADDING), (PADDING, PADDING), (0, 0)), mode='wrap')
                    atlases[key][row * 256:(row + 1) * 256, col * 256:(col + 1) * 256] = padded
                    record['maps'][key] = {'bytes': file.stat().st_size, 'sha256': digest(file),
                                           'dimensions': [SOURCE_SIZE, SOURCE_SIZE],
                                           'range': [float(data.min()), float(data.max())]}
                    if key == 'color':
                        entry['averageColor'] = [round(float(v), 6) for v in runtime_pixels.mean(axis=(0, 1)) / 255]
                    if key == 'orm':
                        # Distant/failure fallbacks represent the exported artist material.
                        entry['roughness'] = round(float(runtime_pixels[..., 1].mean() / 255), 6)
                        entry['metalness'] = round(float(runtime_pixels[..., 2].mean() / 255), 6)
                record['averageColor'] = entry['averageColor']
                record['roughness'] = entry['roughness']
                record['metalness'] = entry['metalness']
                records.append(record)
            for key, pixels in atlases.items():
                png(staged_output / f'{key}.png', pixels, color=key == 'color')
            snapshot = staged_source / 'city-material-library.blend'
            shutil.copy2(blend, snapshot)
            require(digest(snapshot) == source_hash == digest(blend), 'Original .blend changed during export')
            catalog.update({
                'maps': {key: key + '.png' for key in MAPS},
                'normalConvention': 'OpenGL +Y tangent',
                'uvConvention': 'metres; atlas row zero is lower UV row',
                'authoring': 'Artist-edited Blender Principled materials; Cycles emission/normal bake, no illumination or AO',
                'source': str(source / 'city-material-library.blend'),
                'export': {'kind': 'artist-node-bake', 'blender': bpy.app.version_string,
                           'inputBlendSha256': source_hash, 'catalogSha256': catalog_hash,
                           'exporterSha256': exporter_hash, 'samples': args.samples,
                           'colorEncoding': 'sRGB', 'normalEncoding': 'non-color', 'ormEncoding': 'non-color',
                           'occlusion': 'neutral R=1', 'sourceResolution': SOURCE_SIZE,
                           'geometry': 'unchanged; temporary bake tiles are not saved'},
                'files': {key: {'bytes': (staged_output / f'{key}.png').stat().st_size,
                                 'sha256': digest(staged_output / f'{key}.png')} for key in MAPS},
            })
            (staged_output / 'manifest.json').write_text(json.dumps(catalog, indent=2) + '\n')
            (staged_output / 'bake-report.json').write_text(json.dumps({
                'valid': True, 'kind': 'artist-node-bake', 'materials': records,
                'inputBlendUnchanged': True, 'sourceBlendSha256': source_hash,
                'validationScope': 'Finite bounded bake samples, forward unit normals, neutral AO, measured fallbacks and file hashes. Not visual, seamlessness, browser, or performance approval.',
            }, indent=2) + '\n')
            # Move only complete work artifacts into requested empty destinations.
            if source.exists():
                source.rmdir()
            if output.exists():
                output.rmdir()
            shutil.move(str(staged_source), str(source))
            shutil.move(str(staged_output), str(output))
    finally:
        bpy.context.window.scene = prior_scene
        bpy.data.scenes.remove(scene)
    print('ARTIST MATERIAL EXPORT COMPLETE', output, flush=True)
    print('SOURCE SNAPSHOT AND 480PX MAPS', source, flush=True)


if __name__ == '__main__':
    main()
