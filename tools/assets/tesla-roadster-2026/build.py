"""Derive synchronous Atlas LODs from the editable October 2026 Rocket hero.

Run Blender 4.5 --background --python build.py -- --hero source/reference/Tesla_Roadster_2026_Rocket_Detailed.blend
The reference is preserved. No rendering, networking or runtime TypeScript edits.
"""
import argparse
import array
import base64
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parents[2]
sys.path.insert(0, str(PACKAGE))
from emissive_export import finalize_glb
from controlled_tires import tyre_part, NOTE as CONTROLLED_TYRES
SCALE = .0001
DATUM = .0005
AXIS = Matrix(((0, 1, 0, 0), (0, 0, 1, DATUM), (1, 0, 0, 0), (0, 0, 0, 1)))
RADIUS = .3505
PORT_ANCHORS = []
CLAMP_REPORT = {}
NODES = [{'id': 'body', 'parent': None, 'position': [0, 0, 0]}]
for axle, z in [('front', 1.35), ('rear', -1.35)]:
    for side, x in [('left', .84), ('right', -.84)]:
        name = f'{axle}-{side}-steer'
        NODES += [{'id': name, 'parent': None, 'position': [x, .3505, z]},
                  {'id': name + '-roll', 'parent': name, 'position': [0, 0, 0]}]
NODES += [
    {'id': 'steer-by-wire-yoke', 'parent': None, 'position': [.36, .6355, .353]},
    {'id': 'active-rear-wing', 'parent': None, 'position': [0, .84, -2.205]},
    {'id': 'butterfly-door-left', 'parent': None, 'position': [.83, .5805, .78]},
    {'id': 'butterfly-door-right', 'parent': None, 'position': [-.83, .5805, .78]},
    {'id': 'removable-roof', 'parent': None, 'position': [0, 0, 0]},
]
for i, y in enumerate([-.63, -.21, .21, .63]):
    NODES.append({'id': f'rear-suction-fan-{i}', 'parent': None,
                  'position': [y, .2185, -2.292]})
NODE_MAP = {n['id']: n for n in NODES}


def origin(name):
    node = NODE_MAP[name]
    return Vector(node['position']) + (origin(node['parent']) if node['parent'] else Vector())


ORIGINS = {name: origin(name) for name in NODE_MAP}


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rig():
    return {'nodes': NODES,
            'wheelSteers': ['front-left-steer', 'front-right-steer'],
            'wheelRolls': [n['id'] for n in NODES if n['id'].endswith('-roll')],
            'fans': [f'rear-suction-fan-{i}' for i in range(4)],
            'steering': 'steer-by-wire-yoke', 'wing': 'active-rear-wing',
            'doors': {'left': {'id': 'butterfly-door-left', 'axis': [.9403762258, -.340136064, 0]},
                      'right': {'id': 'butterfly-door-right', 'axis': [.9403762258, .340136064, 0]}},
            'roof': 'removable-roof'}


def assembly(obj):
    name = obj.name
    for i in range(4):
        if name.startswith(f'R26_fan_{i}_sculpted_blade_') or name == f'R26_fan_rotor_hub_{i}':
            return f'rear-suction-fan-{i}'
    p = obj
    while p:
        name = p.name
        if name.startswith('roadster_wheel_'):
            return name.removeprefix('roadster_wheel_').replace('_', '-') + '-steer-roll'
        if name in ('roadster_door_left', 'roadster_door_right'):
            return 'butterfly-door-' + name.rsplit('_', 1)[1]
        if name == 'roadster_roof':
            return 'removable-roof'
        if name == 'roadster_active_wing':
            return 'active-rear-wing'
        if 'Steer by wire closed loop yoke' in name:
            return 'steer-by-wire-yoke'
        p = p.parent
    if 'fixed_caliper' in obj.name:
        for axle in ('front', 'rear'):
            for side in ('left', 'right'):
                if axle + '_' + side in obj.name:
                    return f'{axle}-{side}-steer'
    return 'body'


def role_for(mat, group):
    s = mat.name.lower() if mat else 'black'
    if group.endswith('-roll'):
        return 'rubber' if any(k in s for k in ('rubber', 'tread', 'lettering')) else 'titanium'
    if group.endswith('-steer') or group.startswith('rear-suction-fan-'):
        return 'titanium'
    if group == 'steer-by-wire-yoke':
        return 'white'
    if group.startswith('butterfly-door-'):
        if 'door ambient red diffuser' in s:
            return 'accent'
        return 'glass' if 'copper_solar_glass' in s else 'paint'
    if group == 'removable-roof':
        return 'glass' if 'copper_solar_glass' in s else 'carbon'
    if group == 'active-rear-wing':
        return 'paint'
    if 'copper_solar_glass' in s:
        return 'glass'
    if 'pearl_white' in s:
        return 'paint'
    if 'headlight_led' in s:
        return 'headlight'
    if any(k in s for k in ('rear_light_led', 'red graphics', 'ambient red', 'amber_marker')):
        return 'tail'
    if any(k in s for k in ('display subdued', 'display optically')):
        return 'display'
    if any(k in s for k in ('upholstery', 'microsuede', 'thread')):
        return 'white'
    if any(k in s for k in ('titanium', 'steel', 'alloy', 'bronze', 'number_plate')):
        return 'titanium'
    return 'carbon'


def color_for(mat):
    if not mat or not mat.use_nodes:
        return (.02, .025, .03, 1)
    shader = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not shader:
        return (.02, .025, .03, 1)
    color = tuple(shader.inputs['Base Color'].default_value)
    if 'copper_solar_glass' in mat.name:
        return (.085, .057, .032, 1)
    return color


def skip_detail(obj):
    name = obj.name.lower()
    if obj.type == 'FONT':
        return True
    return any(s in name for s in (
        'stitch', 'perforation', 'thread stitch', 'drill_mouth', 'rotor_vane',
        'titanium_lug', 'tire_letter', 'sidewall_bottom', 'sidewall_top',
        'knurl', 'grip seam', 'scroll knurl', 'screen title', 'embroidery',
        'screen text', 'display text', 'rear_plate_lettering',
    ))


def extract(hero):
    bpy.ops.wm.open_mainfile(filepath=str(hero))
    root = bpy.data.objects['roadster_root']
    for key in ('doors_open', 'roof_lift', 'active_wing', 'wheel_spin', 'steering'):
        root[key] = 0.0
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    PORT_ANCHORS.clear()
    for obj in root.children_recursive:
        if not obj.name.startswith('roadster_nozzle_'):
            continue
        point = AXIS @ obj.matrix_world.translation
        outward = AXIS.to_3x3() @ (obj.matrix_world.to_3x3() @ Vector((0, 0, 1)))
        kind = 'rear' if obj.get('hardware_role') == 'rearward_cold_gas' else 'lift'
        PORT_ANCHORS.append({'id':obj.name,'kind':kind,'position':list(point),
            'direction':list(outward.normalized()),'radius':.066*(.86 if kind=='rear' else .62),
            'radiusBasis':'Authored outlet inner lip, not manufacturer nozzle dimensions.'})
    objects = [o for o in root.children_recursive if o.type in ('MESH', 'CURVE', 'FONT')
               and not o.hide_render and not any(p.hide_render for p in ancestors(o))]
    # Source-formed panes without Solidify: runtime glazing has one outward layer.
    for obj in objects:
        if 'copper' in obj.name.lower() and obj.type == 'MESH':
            for mod in obj.modifiers:
                if mod.type == 'SOLIDIFY':
                    mod.show_viewport = False
                    mod.show_render = False
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    batches = defaultdict(lambda: {'vertices': [], 'faces': [], 'colors': []})
    dropped = []
    source_tris = 0
    for obj in objects:
        if skip_detail(obj):
            dropped.append(obj.name)
            continue
        group = assembly(obj)
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        source_tris += len(mesh.loop_triangles)
        matrix = AXIS @ obj.matrix_world
        points = [matrix @ v.co - ORIGINS[group] for v in mesh.vertices]
        # Material partitions preserve connected source topology before decimation.
        partitions = defaultdict(list)
        for polygon in mesh.polygons:
            mat = mesh.materials[min(polygon.material_index, len(mesh.materials)-1)] if mesh.materials else None
            if mat and 'clear_optical_lens' in mat.name:
                continue  # opaque internal LED geometry remains; no duplicate refractive lenses
            partitions[(role_for(mat, group), color_for(mat))].append(polygon)
        for (role, color), polygons in partitions.items():
            batch = batches[(group, role)]
            remap = {}
            for polygon in polygons:
                face = []
                for old in polygon.vertices:
                    if old not in remap:
                        remap[old] = len(batch['vertices'])
                        batch['vertices'].append(tuple(points[old]))
                    face.append(remap[old])
                if len(face) >= 3:
                    batch['faces'].append(face)
                    batch['colors'].append(color)
        evaluated.to_mesh_clear()
    return dict(batches), {'evaluatedSourceTrianglesAfterDetailFilter': source_tris,
                           'droppedObjects': dropped, 'retainedBatches': len(batches)}


def ancestors(obj):
    p = obj.parent
    while p:
        yield p
        p = p.parent


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def material(role):
    name = 'Atlas Roadster | ' + role
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
    shader.inputs['Roughness'].default_value = {'paint': .26, 'carbon': .42, 'rubber': .85,
        'glass': .16, 'titanium': .29, 'white': .7, 'display': .3, 'accent': .6}.get(role, .25)
    shader.inputs['Metallic'].default_value = {'paint': .18, 'carbon': .2, 'titanium': .75,
                                              'glass': .22}.get(role, 0)
    attr = m.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'COLOR_0'
    m.node_tree.links.new(attr.outputs['Color'], shader.inputs['Base Color'])
    if role in ('headlight', 'tail', 'display', 'accent'):
        m.node_tree.links.new(attr.outputs['Color'], shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value = 1
    if role == 'glass':
        m.use_backface_culling = True
        m.surface_render_method = 'DITHERED'
    m['semantic_role'] = role
    m['vertex_color_space'] = 'linear RGB'
    return m


def create_meshes(batches):
    nodes = {}
    for node in NODES:
        obj = bpy.data.objects.new(node['id'], None)
        bpy.context.collection.objects.link(obj)
        obj.location = node['position']
        if node['parent']:
            obj.parent = nodes[node['parent']]
        nodes[node['id']] = obj
    results = []
    for (group, role), data in batches.items():
        mesh = bpy.data.meshes.new(group + ':' + role)
        mesh.from_pydata(data['vertices'], [], data['faces'])
        mesh.update()
        attr = mesh.color_attributes.new(name='COLOR_0', type='FLOAT_COLOR', domain='CORNER')
        for p, color in zip(mesh.polygons, data['colors']):
            p.use_smooth = True
            for loop in p.loop_indices:
                attr.data[loop].color = color
        obj = bpy.data.objects.new(group + ':' + role, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = nodes[group]
        obj.data.materials.append(material(role))
        obj['assembly'] = group
        obj['semantic_role'] = role
        obj['single_outward_glazing'] = role == 'glass'
        obj['source_bounds_min'] = [min(v[k] for v in data['vertices']) for k in range(3)]
        obj['source_bounds_max'] = [max(v[k] for v in data['vertices']) for k in range(3)]
        results.append(obj)
    return nodes, results


def evaluate_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def simplify(objects, target):
    initial = sum(triangles(o) for o in objects)
    # Collapse connected surface tessellation; preserve coloured assembly separation.
    for obj in objects:
        mod = obj.modifiers.new('City LOD controlled collapse', 'DECIMATE')
        mod.ratio = min(.95, target / initial * .88)
        mod.use_collapse_triangulate = True
        evaluate_modifiers(obj)
    for attempt in range(5):
        count = sum(triangles(o) for o in objects)
        if count < target:
            break
        for obj in objects:
            mod = obj.modifiers.new('Bounded triangle budget', 'DECIMATE')
            mod.ratio = min(.9, target / count * .9)
            mod.use_collapse_triangulate = True
            evaluate_modifiers(obj)
    count = sum(triangles(o) for o in objects)
    if count >= target:
        raise RuntimeError(f'Decimation stalled above budget: {count} >= {target}')
    return count


def b64(values, dtype):
    buf = array.array(dtype, values)
    if sys.byteorder != 'little':
        buf.byteswap()
    return base64.b64encode(buf.tobytes()).decode('ascii')


def quantize(obj, quality):
    mesh = obj.data
    lower, upper = obj['source_bounds_min'], obj['source_bounds_max']
    count, maximum = 0, 0.0
    for vertex in mesh.vertices:
        old = vertex.co.copy()
        for k in range(3):
            vertex.co[k] = max(lower[k], min(upper[k], vertex.co[k]))
        distance = (vertex.co-old).length
        count += distance > 1e-7
        maximum = max(maximum, distance)
    mesh.update()
    CLAMP_REPORT.setdefault(quality, {})[obj.name] = {
        'sourceLocalMin': list(lower), 'sourceLocalMax': list(upper),
        'clampedVertices': count, 'maximumCorrectionM': maximum,
        'maximumQuantizationEscapeM': .00005,
    }
    if hasattr(mesh, 'set_sharp_from_angle'):
        mesh.set_sharp_from_angle(angle=math.radians(48))
    mesh.calc_loop_triangles()
    colors = mesh.color_attributes.get('COLOR_0')
    vertices, normals, rgb, indices, cache = [], [], [], [], {}
    for tri in mesh.loop_triangles:
        for loop in tri.loops:
            vertex = mesh.vertices[mesh.loops[loop].vertex_index]
            co = vertex.co.copy()
            if obj['assembly'].endswith('-roll'):
                radius = math.hypot(co.y, co.z)
                if radius > RADIUS - .0001:
                    co.y *= (RADIUS - .0001) / radius
                    co.z *= (RADIUS - .0001) / radius
            position = tuple(round(float(x) / SCALE) for x in co)
            normal = mesh.corner_normals[loop].vector
            nq = tuple(max(-127, min(127, round(float(x)*127))) for x in normal)
            color = colors.data[loop].color if colors else (1, 1, 1, 1)
            cq = tuple(max(0, min(255, round(float(x)*255))) for x in color[:3])
            key = position + nq + cq
            if key not in cache:
                cache[key] = len(vertices)//3
                vertices.extend(position)
                normals.extend(nq)
                rgb.extend(cq)
            indices.append(cache[key])
    # Quantization can collapse source bevel slivers: remove geometric zero-area
    # triangles before both data serialization and the matching editable exports.
    clean = []
    for start in range(0, len(indices), 3):
        tri = indices[start:start+3]
        a, b, c = [vertices[i*3:i*3+3] for i in tri]
        ab = [b[i]-a[i] for i in range(3)]
        ac = [c[i]-a[i] for i in range(3)]
        cross = (ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0])
        if any(cross):
            clean.extend(tri)
    indices = clean
    if max(indices, default=0) > 65535:
        raise RuntimeError('Batch exceeds Uint16 vertex indexing')
    if any(v < -32768 or v > 32767 for v in vertices):
        raise RuntimeError('Batch exceeds Int16 position range')
    return {'assembly': obj['assembly'], 'role': obj['semantic_role'],
            'positions': b64(vertices, 'h'), 'normals': b64(normals, 'b'),
            'colors': b64(rgb, 'B'), 'indices': b64(indices, 'H'),
            'vertexCount': len(vertices)//3, 'indexCount': len(indices)}, (vertices, normals, rgb, indices)


def replace_with_decoded(obj, values):
    positions, normals, colors, indices = values
    old = obj.data
    mesh = bpy.data.meshes.new(old.name + ':quantized')
    mesh.from_pydata([tuple(v*SCALE for v in positions[i:i+3]) for i in range(0,len(positions),3)],
                     [], [indices[i:i+3] for i in range(0,len(indices),3)])
    mesh.update()
    attr = mesh.color_attributes.new(name='COLOR_0', type='FLOAT_COLOR', domain='POINT')
    for i in range(len(mesh.vertices)):
        attr.data[i].color = (*[c/255 for c in colors[i*3:i*3+3]], 1)
    split_normals = [Vector(normals[i:i+3]).normalized() for i in range(0,len(normals),3)]
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.normals_split_custom_set_from_vertices(split_normals)
    mesh.materials.append(material(obj['semantic_role']))
    obj.data = mesh
    bpy.data.meshes.remove(old)


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--hero', type=Path, default=PACKAGE/'source/reference/Tesla_Roadster_2026_Rocket_Detailed.blend')
    parsed = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for folder in ('source', 'exports', 'qa'):
        (PACKAGE/folder).mkdir(parents=True, exist_ok=True)
    batches, extraction = extract(parsed.hero.resolve())
    print('EXTRACT', json.dumps({k:v for k,v in extraction.items() if k != 'droppedObjects'}), flush=True)
    data = {'version': 1, 'positionScale': SCALE, 'axes': 'Atlas: +X left,+Y up,+Z front',
            'rig': rig(), 'anchors': {'driverEye': [.36,.8805,-.68], 'seatPelvis': [.36,.3155,-.36],
                'steeringWheel': [.36,.6355,.353], 'driverLookAt': [.36,.8805,3],
                'frontChase': [0,1.6,5.8], 'rearChase': [0,1.8,-6.2], 'chaseTarget': [0,.65,.3]},
            'lods': {}, 'source': {'name': 'Original October 2026 Rocket hero reconstruction',
                'hero': 'source/reference/'+parsed.hero.name, 'heroSha256': hash_file(parsed.hero),
                'referenceUrl': 'https://www.tesla.com/roadster?redirect=no',
                'dimensionBasis': 'Image-based representative dimensions; not Tesla CAD or factory dimensions.',
                'sourceToAtlas': '(Blender Y, Blender Z + .0005, Blender X)',
                'datumShiftM': DATUM, 'wheelRadiusM': RADIUS,
                'glazing': 'One outward source layer; opaque tinted runtime approximation; no refraction.',
                'yawPorts': 'Two inferred front yaw ports remain owned by the runtime procedural adapter.',
                'colorSpace': 'Absolute linear RGB, Uint8 normalized; white-base role materials.'}}
    data['source']['controlledTyres'] = CONTROLLED_TYRES
    manifest_lods = []
    for quality, level, budget in [('high',0,59000),('medium',1,29000),('low',2,11500)]:
        clear_scene()
        nodes, objects = create_meshes(batches)
        count = simplify(objects, budget)
        parts = []
        for obj in objects:
            if triangles(obj) == 0:
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            part, values = quantize(obj, quality)
            if obj['semantic_role'] == 'rubber' and obj['assembly'].endswith('-roll'):
                part, values = tyre_part(obj['assembly'], quality)
            parts.append(part)
            replace_with_decoded(obj, values)
        total = sum(p['indexCount']//3 for p in parts)
        assert total < {'high':60000,'medium':30000,'low':12000}[quality], (quality,total)
        assert len(parts) <= 34, (quality,len(parts))
        data['lods'][quality] = {'triangles': total, 'parts': parts}
        scene = bpy.context.scene
        scene.unit_settings.system = 'METRIC'
        scene['asset_contract'] = 'tesla-roadster-2026-quantized-v1'
        scene['axes'] = data['axes']
        scene['triangle_count'] = total
        scene['quality'] = quality
        # Blender is Z-up: rotate the single collection root only for authoring display/export.
        # Mesh/node coordinates intentionally retain exact Atlas basis for data parity.
        source = PACKAGE/'source'/f'tesla-roadster-2026.lod{level}.blend'
        exported = PACKAGE/'exports'/f'tesla-roadster-2026.lod{level}.glb'
        bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
        # glTF expects Y-up; authored mesh already uses Y-up, so no additional basis conversion.
        bpy.ops.export_scene.gltf(filepath=str(exported), export_format='GLB', export_yup=False,
            export_apply=False, export_materials='EXPORT', export_normals=True,
            export_animations=False, export_extras=True, export_cameras=False, export_lights=False)
        finalize_glb(exported)
        manifest_lods.append({'level':level,'quality':quality,'file':exported.name,
            'export':'exports/'+exported.name,'bytes':exported.stat().st_size,'sha256':hash_file(exported),
            'source':'source/'+source.name,'sourceBytes':source.stat().st_size,'sourceSha256':hash_file(source),
            'triangles':total,'primitives':len(parts)})
        print('LOD',quality,total,len(parts),flush=True)
    output = PACKAGE/'exports/tesla-roadster-detailed-data.json'
    raw = json.dumps(data,separators=(',',':')).encode()
    output.write_bytes(raw)
    generated = REPO/'lib/city/assets/tesla-roadster-detailed-data.json'
    generated.write_bytes(raw)
    (PACKAGE/'qa/extraction.json').write_text(json.dumps(extraction,indent=2)+'\n')
    (PACKAGE/'qa/decimation-bounds.json').write_text(json.dumps(CLAMP_REPORT,indent=2)+'\n')
    references = []
    for path in sorted((PACKAGE/'source/reference').glob('*')):
        if path.is_file():
            references.append({'file':str(path.relative_to(PACKAGE)), 'bytes':path.stat().st_size,
                               'sha256':hash_file(path)})
    manifest = {'schemaVersion':1,'contract':'tesla-roadster-2026-quantized-v1',
        'packageId':'tesla-roadster-2026','version':'1.0.0','units':'m','axes':data['axes'],
        'textures':[], 'runtimeData':{'file':'exports/'+output.name,'generated':'lib/city/assets/'+output.name,
            'bytes':len(raw),'sha256':hash_file(output)}, 'referenceFiles':references,
        'assets':[{'id':'tesla-roadster-2026-rocket','lods':manifest_lods}],
        'rig':data['rig'],'anchors':data['anchors'],
        'source':{**data['source'],'portAnchors':PORT_ANCHORS}}
    (PACKAGE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('DONE',len(raw),hash_file(output),flush=True)


if __name__ == '__main__':
    main()
