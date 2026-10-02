"""Original metre-scale architecture kit. Run with Blender 4.3+ in background.

Source meshes retain editable parts, physical UVs and packed shared city maps.
Export copies are joined and have their UVs divided by the catalog tile metres.
No source building, runtime placement or production asset is changed by this tool.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CATALOG = ROOT / 'tools/assets/city-materials/catalog.json'
TEXTURES = CATALOG.parent / 'source/textures'
SPECS = {entry['id']: entry for entry in json.loads(CATALOG.read_text())['materials']}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clean():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        if not block.users:
            bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        if not block.users:
            bpy.data.materials.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    return scene


def material(surface, runtime=False):
    name = f'City {surface}' + (' export' if runtime else ' metre UV')
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    m['city_surface_id'] = surface
    m['physical_tile_metres'] = SPECS[surface]['tileMeters']
    nt = m.node_tree
    bs = nt.nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = 1
    bs.inputs['Metallic'].default_value = 1
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    vector = uv.outputs['UV']
    if not runtime:
        scale = nt.nodes.new('ShaderNodeVectorMath')
        scale.name = 'Metres to shared physical repeat'
        scale.operation = 'MULTIPLY'
        tw, th = SPECS[surface]['tileMeters']
        scale.inputs[1].default_value = (1 / tw, 1 / th, 1)
        nt.links.new(vector, scale.inputs[0])
        vector = scale.outputs[0]
    maps = {}
    for kind in ['color', 'normal', 'orm']:
        path = TEXTURES / f'{surface}-{kind}.png'
        image = bpy.data.images.load(str(path), check_existing=True)
        image.colorspace_settings.name = 'sRGB' if kind == 'color' else 'Non-Color'
        image.pack()
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'REPEAT'
        nt.links.new(vector, tex.inputs['Vector'])
        maps[kind] = tex
    nt.links.new(maps['color'].outputs['Color'], bs.inputs['Base Color'])
    normal = nt.nodes.new('ShaderNodeNormalMap')
    normal.uv_map = 'UVMap'
    nt.links.new(maps['normal'].outputs['Color'], normal.inputs['Color'])
    nt.links.new(normal.outputs['Normal'], bs.inputs['Normal'])
    channels = nt.nodes.new('ShaderNodeSeparateColor')
    channels.mode = 'RGB'
    nt.links.new(maps['orm'].outputs['Color'], channels.inputs[0])
    nt.links.new(channels.outputs['Green'], bs.inputs['Roughness'])
    nt.links.new(channels.outputs['Blue'], bs.inputs['Metallic'])
    return m


def metric_uv(obj):
    mesh = obj.data
    layer = mesh.uv_layers.get('UVMap') or mesh.uv_layers.new(name='UVMap')
    mesh.update()
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda k: abs(poly.normal[k]))
        for li in poly.loop_indices:
            co = obj.matrix_world @ mesh.vertices[mesh.loops[li].vertex_index].co
            # Dominant-axis projection in real metres, same as the shared library.
            pair = (co.x, co.z) if axis == 1 else ((co.x, co.y) if axis == 2 else (co.y, co.z))
            layer.data[li].uv = pair
    obj['uv_units'] = 'metres'


def mesh(name, vertices, faces, surface):
    # Input vertices use the runtime's X right, Y up, Z street coordinate system.
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material(surface))
    metric_uv(obj)
    return obj


def prism(name, profile, width, surface, x=0):
    """Extrude an authored (street depth, height) section horizontally."""
    n = len(profile)
    points = [(x + side * width / 2, y, z) for side in [-1, 1] for z, y in profile]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, points, faces, surface)


def box(name, centre, size, surface, bevel=0):
    x, y, z = centre
    w, h, d = size
    obj = prism(name, [(z-d/2, y-h/2), (z+d/2, y-h/2),
                       (z+d/2, y+h/2), (z-d/2, y+h/2)], w, surface, x)
    if bevel:
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('Editable one-segment manufactured edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
        metric_uv(obj)
    return obj


def ring(name, width, height, border, front, back, surface, detailed):
    """A true empty opening with continuous mitred frame and a rebated face."""
    outer = [(-width/2, 0), (width/2, 0), (width/2, height), (-width/2, height)]
    inner = [(-width/2+border, border), (width/2-border, border),
             (width/2-border, height-border), (-width/2+border, height-border)]
    loops = [(outer, back), (outer, front), (inner, front), (inner, back)]
    if detailed:
        inset = .012
        small = [(x + (inset if x < 0 else -inset), y + (inset if y < height/2 else -inset)) for x, y in outer]
        loops = [(outer, back), (outer, front-.016), (small, front),
                 (inner, front), (inner, back)]
    vertices = [(x, y, z) for points, z in loops for x, y in points]
    faces = []
    for j in range(len(loops)):
        k = (j + 1) % len(loops)
        for i in range(4):
            ni = (i + 1) % 4
            faces.append((j*4+i, j*4+ni, k*4+ni, k*4+i))
    return mesh(name, vertices, faces, surface)


def build(kind, lod):
    fine = lod == 0
    if kind == 'sandstone-sill':
        profile = [(.02, 0), (.24, 0), (.24, .10), (.20, .18), (.02, .18)]
        if fine:
            # Recessed underside drip interrupts water return without more meshes.
            profile = [(.02, 0), (.175, 0), (.175, .015), (.195, .015),
                       (.195, 0), (.24, 0), (.24, .10), (.20, .18), (.02, .18)]
        prism('Sloped stone sill with underside drip', profile, 1.4, 'sandstone')
    elif kind == 'heritage-window-frame':
        ring('Mitred open window surround', 1.4, 1.6, .10, .14, .02, 'painted-metal', fine)
    elif kind == 'heritage-cornice':
        profile = [(.02, 0), (.19, 0), (.19, .055), (.24, .075), (.24, .12),
                   (.30, .16), (.36, .18), (.36, .24), (.02, .24)]
        if not fine:
            profile = [(.02, 0), (.19, 0), (.19, .075), (.30, .16), (.36, .18), (.36, .24), (.02, .24)]
        prism('Moulded cornice section', profile, 2, 'sandstone')
    elif kind == 'sandstone-plinth':
        profile = [(.02, 0), (.20, 0), (.20, .10), (.17, .12), (.17, .35), (.14, .42), (.02, .42)]
        if not fine:
            profile = [(.02, 0), (.20, 0), (.20, .10), (.17, .35), (.14, .42), (.02, .42)]
        prism('Chamfered plinth with raised foot', profile, 2, 'sandstone')
    elif kind == 'sandstone-corner':
        # 90-degree external corner: one L-plan core, decorative bands only at LOD0.
        footprint = [(0, .02), (.26, .02), (.26, .09), (.09, .09), (.09, .26), (0, .26)]
        levels = [(0, 1), (2.4, 1)]
        if fine:
            levels = [(0, 1)]
            for h in [.48, .96, 1.44, 1.92]:
                levels.extend([(h-.010, 1), (h-.006, .975), (h+.006, .975), (h+.010, 1)])
            levels.append((2.4, 1))
        vertices = [(x*scale, height, .02+(z-.02)*scale) for height, scale in levels for x, z in footprint]
        n = len(footprint)
        faces = [tuple(range(n-1, -1, -1)), tuple(range((len(levels)-1)*n, len(levels)*n))]
        for j in range(len(levels)-1):
            faces += [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i) for i in range(n)]
        mesh('Continuous L-plan corner with shallow course joints', vertices, faces, 'sandstone')
    elif kind == 'residential-entry-surround':
        for side in [-1, 1]:
            box('Open entry cedar jamb', (side*.585, 1.15, .105), (.13, 2.3, .17), 'cedar', .006 if fine else 0)
        prism('Cedar open entry lintel', [(.02, 2.3), (.19, 2.3), (.19, 2.48), (.16, 2.5), (.02, 2.5)], 1.3, 'cedar')
        if fine:
            # Narrow face mouldings stay entirely on the jambs; there is no threshold.
            for side in [-1, 1]:
                box('Jamb raised face moulding', (side*.60, 1.15, .198), (.035, 2.25, .016), 'cedar')
    elif kind == 'sloped-metal-awning':
        prism('Folded weather hood', [(.02, 2.7), (.87, 2.48), (.87, 2.43), (.02, 2.65)], 1.6, 'painted-metal')
        box('Hemmed leading valance', (0, 2.415, .855), (1.6, .07, .03), 'painted-metal')
        for side in [-1, 1]:
            profile = [(.06, 2.37), (.80, 2.44), (.06, 2.62)]
            if fine:
                profile = [(.06, 2.37), (.80, 2.44), (.54, 2.47), (.06, 2.62)]
            prism('Folded triangular side support', profile, .025, 'painted-metal', side*.66)
    elif kind == 'flat-metal-awning':
        prism('Contemporary sloped drainage canopy', [(.02, 2.65), (1.02, 2.60), (1.02, 2.53), (.02, 2.58)], 1.8, 'painted-metal')
        for side in [-1, 1]:
            profile = [(.02, 2.48), (.92, 2.53), (.02, 2.58)]
            if fine:
                profile = [(.02, 2.48), (.92, 2.53), (.62, 2.55), (.02, 2.58)]
            prism('Cantilever tapered rib', profile, .035, 'painted-metal', side*.72)


KINDS = {
    'sandstone-sill': {'role': 'sill', 'triangles': [64, 32]},
    'heritage-window-frame': {'role': 'window-frame', 'triangles': [64, 40], 'clearance': {'min': [-.6, .1, .019], 'max': [.6, 1.5, .141]}},
    'heritage-cornice': {'role': 'cornice', 'triangles': [48, 32]},
    'sandstone-plinth': {'role': 'base', 'triangles': [40, 28]},
    'sandstone-corner': {'role': 'corner', 'triangles': [224, 24]},
    'residential-entry-surround': {'role': 'entrance', 'triangles': [160, 48], 'clearance': {'min': [-.52, 0, .019], 'max': [.52, 2.3, .207]}},
    'sloped-metal-awning': {'role': 'awning', 'triangles': [48, 40], 'clearance': {'min': [-.8, 0, .019], 'max': [.8, 2.3, .871]}},
    'flat-metal-awning': {'role': 'awning', 'triangles': [40, 28], 'clearance': {'min': [-.9, 0, .019], 'max': [.9, 2.3, 1.021]}},
}


def source_stats(objects):
    bounds = [ob.matrix_world @ vertex.co for ob in objects for vertex in ob.data.vertices]
    points = [(v.x, v.z, -v.y) for v in bounds]
    return {'min': [round(min(v[k] for v in points), 6) for k in range(3)],
            'max': [round(max(v[k] for v in points), 6) for k in range(3)]}


def export(kind, lod, output):
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in parts:
        obj['asset_id'] = kind
        obj['lod'] = lod
        obj['original_asset'] = True
        obj['units'] = 'metres'
        obj['front_axis'] = '+Z glTF / -Y Blender'
    scene = bpy.context.scene
    scene['kit_version'] = 1
    scene['asset_id'] = kind
    scene['lod'] = lod
    scene['authoring_uvs'] = 'Dominant-axis world metre UVMap; no baked illumination'
    source = output / 'source' / f'{kind}.lod{lod}.blend'
    # Write only this scene and dependencies, not orphan geometry/materials from
    # another LOD. Each source is self-contained and independently editable.
    bpy.data.libraries.write(str(source), {scene}, path_remap='RELATIVE', compress=True)
    bounds = source_stats(parts)
    # Transform copies only; the separately saved artist source remains editable.
    for obj in parts:
        mat = obj.data.materials[0]
        surface = mat['city_surface_id']
        tw, th = SPECS[surface]['tileMeters']
        for loop in obj.data.uv_layers['UVMap'].data:
            loop.uv.x /= tw
            loop.uv.y /= th
        obj.data.materials.clear()
        obj.data.materials.append(material(surface, runtime=True))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = kind
    obj['uv_units'] = 'catalog tile repeat; source retains metres'
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    triangulate = obj.modifiers.new('Export triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    # Join deduplicates identical material slots in Blender, enforce one semantic surface.
    surface = obj.data.materials[0]['city_surface_id']
    obj.data.materials.clear()
    obj.data.materials.append(material(surface, runtime=True))
    for face in obj.data.polygons:
        face.material_index = 0
    triangles = len(obj.data.polygons)
    assert triangles <= KINDS[kind]['triangles'][lod], (kind, lod, triangles)
    dest = output / 'assets' / f'{kind}.lod{lod}.glb'
    bpy.ops.export_scene.gltf(filepath=str(dest), export_format='GLB', use_selection=True,
                              export_yup=True, export_texcoords=True, export_normals=True,
                              export_tangents=True, export_materials='EXPORT',
                              export_animations=False, export_extras=True, export_cameras=False,
                              export_lights=False, export_apply=False)
    return {'level': lod, 'file': str(dest.relative_to(output)), 'source': str(source.relative_to(output)),
            'triangles': triangles, 'triangleCap': KINDS[kind]['triangles'][lod],
            'materials': 1, 'primitives': 1, 'bounds': bounds,
            'bytes': dest.stat().st_size, 'sha256': sha(dest), 'sourceSha256': sha(source),
            'surface': surface, 'tileMeters': SPECS[surface]['tileMeters']}


def preview(output):
    scene = clean()
    offsets = [(0, 0), (2.3, 0), (4.6, 0), (7.1, 0), (0, 4), (2.3, 4), (4.6, 4), (7.1, 4)]
    for (kind, spec), (x, y) in zip(KINDS.items(), offsets):
        bpy.ops.import_scene.gltf(filepath=str(output/'assets'/f'{kind}.lod0.glb'))
        imported = list(bpy.context.selected_objects)
        for obj in imported:
            obj.location.x += x
            obj.location.y += y
            # Isolated hanging components are lowered on the inspection board only.
            if spec['role'] == 'awning':
                obj.location.z -= 1.6
        bpy.ops.object.text_add(location=(x-.85, y-.32, -.11), rotation=(math.pi/2, 0, 0))
        label = bpy.context.object
        label.data.body = kind.replace('-', ' ')
        label.data.size = .115
        label.data.extrude = 0
        label.data.align_x = 'LEFT'
    bpy.ops.mesh.primitive_plane_add(size=200, location=(3, 1, -.23))
    floor = bpy.context.object
    neutral = bpy.data.materials.new('Preview neutral backdrop')
    neutral.diffuse_color = (.08, .09, .10, 1)
    floor.data.materials.append(neutral)
    bpy.ops.object.light_add(type='AREA', location=(3, -4, 9))
    key = bpy.context.object
    key.data.energy = 1800
    key.data.shape = 'DISK'
    key.data.size = 7
    key.rotation_euler = (Vector((3, 1, 0))-key.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add(location=(10, -13, 10))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((3.6, 2, 1))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 12.4
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False  # Debian Blender build has no OpenImageDenoise
    scene.world.color = (.25, .25, .25)
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(output / 'preview.png')
    bpy.ops.render.render(write_still=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, default=HERE)
    p.add_argument('--from-source', type=Path, help='Re-export independently edited LOD scenes; never regenerate geometry or UVs')
    p.add_argument('--skip-render', action='store_true')
    a = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output = a.output.resolve()
    if output == ROOT/'public' or ROOT/'public' in output.parents:
        raise ValueError('Offline kit output must remain outside public until integration is accepted')
    for folder in ['source', 'assets']:
        (output/folder).mkdir(parents=True, exist_ok=True)
    manifest = {'kit': 'Original architecture detail modules', 'version': 1,
                'status': 'offline-candidate; no runtime integration',
                'license': 'LicenseRef-Vancouver-Living-Atlas-NC-1.0',
                'units': 'metres', 'upAxis': '+Y', 'frontAxis': '+Z',
                'origin': 'Facade attachment plane at local ground datum; corners use external corner datum',
                'blenderVersion': bpy.app.version_string,
                'catalogSha256': sha(CATALOG), 'builderSha256': sha(__file__),
                'sourceMaps': {}, 'assets': []}
    for surface in ['sandstone', 'painted-metal', 'cedar']:
        manifest['sourceMaps'][surface] = {kind: sha(TEXTURES/f'{surface}-{kind}.png') for kind in ['color', 'normal', 'orm']}
    for kind, spec in KINDS.items():
        entry = {'id': kind, 'role': spec['role'], 'lods': [], 'maximumMaterials': 1}
        if 'clearance' in spec:
            entry['clearance'] = spec['clearance']
        for lod in [0, 1]:
            if a.from_source:
                source = a.from_source.resolve()/f'{kind}.lod{lod}.blend'
                if source.parent == (output/'source'):
                    raise ValueError('Re-export to a different output directory to preserve edited originals')
                bpy.ops.wm.open_mainfile(filepath=str(source))
                entry.setdefault('inputSources', []).append({'level': lod, 'sha256': sha(source)})
            else:
                clean()
                build(kind, lod)
            entry['lods'].append(export(kind, lod, output))
        manifest['assets'].append(entry)
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    if not a.skip_render:
        preview(output)
    print(json.dumps({'assets': len(manifest['assets']), 'output': str(output),
                      'triangles': {str(lod): sum(asset['lods'][lod]['triangles'] for asset in manifest['assets']) for lod in [0, 1]}}))


if __name__ == '__main__':
    main()
