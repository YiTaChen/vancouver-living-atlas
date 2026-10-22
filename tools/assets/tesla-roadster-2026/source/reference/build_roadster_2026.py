"""Assemble the separately authored 2026 Roadster exterior/cabin and studio.

Run: blender --background --python production/build_roadster_2026.py -- --render
All dimensions are project estimates unless identified otherwise in references.
"""
import argparse
import hashlib
import json
import math
import sys
from contextlib import contextmanager
from pathlib import Path

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE_DIR))
OUT = BASE if SOURCE_DIR.name == 'source' else BASE / 'output' / 'roadster_2026'


def arguments():
    p = argparse.ArgumentParser()
    p.add_argument('--render', action='store_true')
    p.add_argument('--draft', action='store_true')
    p.add_argument('--no-export', action='store_true')
    p.add_argument('--output', type=Path, default=OUT)
    p.add_argument('--views', default='rocket_front,rocket_cabin_detail,thrust_cabin_detail',
                   help='Comma-separated preview names, or all for all nine cameras/poses.')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def relocate(obj, destination):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    destination.objects.link(obj)


def camera(name, position, target, lens, destination):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_start = .025
    data.clip_end = 200
    obj = bpy.data.objects.new(name, data)
    destination.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def area(name, position, power, size, destination, color=(1, 1, 1), size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'RECTANGLE'
    data.size = size
    data.size_y = size_y if size_y is not None else size * .75
    obj = bpy.data.objects.new(name, data)
    destination.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector((0, 0, .5)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def property_driver(obj, path, index, root, prop, expression):
    driver = obj.driver_add(path, index).driver
    driver.type = 'SCRIPTED'
    value = driver.variables.new()
    value.name = 'control'
    value.type = 'SINGLE_PROP'
    value.targets[0].id = root
    value.targets[0].data_path = '["%s"]' % prop
    driver.expression = expression


def controls(root, exterior, interior):
    for prop, description in {
        'doors_open': 'Butterfly doors, 0 closed to 1 open.',
        'roof_lift': 'Lift removable roof panel in metres for editing and cabin inspection.',
        'active_wing': 'Rear wing lift, 0 stowed to 1 track position.',
        'wheel_spin': 'Wheel rotation in radians around local Y.',
        'steering': 'Front wheel steering in radians around local Z.',
    }.items():
        root[prop] = 0.0
        low, high = (-100, 100) if prop == 'wheel_spin' else ((-.6, .6) if prop == 'steering' else (0, 1.5 if prop == 'roof_lift' else 1))
        root.id_properties_ui(prop).update(description=description, min=low, max=high)
    for side, door in exterior['doors'].items():
        door.rotation_mode = 'AXIS_ANGLE'
        axis = Vector(exterior['door_axes'][side]).normalized()
        door.rotation_axis_angle = (0, *axis)
        property_driver(door, 'rotation_axis_angle', 0, root, 'doors_open', 'control * 1.2566370614')
        card = interior['door_cards'][side]
        card.parent = door
        card.matrix_parent_inverse.identity()
        card.location = (0, 0, 0)
        card.rotation_euler = (0, 0, 0)
        card.scale = (1, 1, 1)
    roof = exterior['roof']
    neutral_roof = roof.location.z
    property_driver(roof, 'location', 2, root, 'roof_lift', f'{neutral_roof:.9f}+control')
    wing = exterior['wing']
    neutral_wing = wing.location.z
    property_driver(wing, 'location', 2, root, 'active_wing', f'{neutral_wing:.9f}+control*.24')
    for wheel in exterior['wheels'].values():
        property_driver(wheel, 'rotation_euler', 1, root, 'wheel_spin', 'control')
    for steer in exterior['steer'].values():
        property_driver(steer, 'rotation_euler', 2, root, 'steering', 'control')
    root['asset_version'] = '1.0.0'
    root['axes'] = 'Blender metres: +X forward, +Y left, +Z up; tyre contact Z=0'
    root['reference_page'] = 'https://www.tesla.com/roadster?redirect=no'
    root['rocket_cabin_note'] = 'Single LHD seat/right equipment bay inferred from the public two-seat cabin; unpublished engineering layout is not claimed.'


def refresh(root):
    root.update_tag(refresh={'OBJECT', 'DATA', 'TIME'})
    scene = bpy.context.scene
    frame = scene.frame_current
    scene.frame_set(frame + 1)
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def branch_visibility(obj, visible):
    # Blender empty visibility does not hide its descendants at render time.
    for child in [obj, *obj.children_recursive]:
        child.hide_render = not visible
        child.hide_viewport = not visible


def verify_controls(root, exterior):
    roof_base = exterior['roof'].location.z
    wing_base = exterior['wing'].location.z
    root['doors_open'], root['roof_lift'], root['active_wing'] = 1., .4, 1.
    root['wheel_spin'], root['steering'] = .5, .2
    refresh(root)
    checks = {
        'door_angles_rad': {side: float(o.rotation_axis_angle[0]) for side, o in exterior['doors'].items()},
        'roof_lift_m': float(exterior['roof'].location.z - roof_base),
        'wing_lift_m': float(exterior['wing'].location.z - wing_base),
        'wheel_spin_rad': {name: float(o.rotation_euler.y) for name, o in exterior['wheels'].items()},
        'steering_rad': {name: float(o.rotation_euler.z) for name, o in exterior['steer'].items()},
    }
    assert all(abs(x-math.pi*.4) < 1e-5 for x in checks['door_angles_rad'].values()), checks
    assert abs(checks['roof_lift_m']-.4) < 1e-5 and abs(checks['wing_lift_m']-.24) < 1e-5, checks
    assert all(abs(x-.5) < 1e-5 for x in checks['wheel_spin_rad'].values()), checks
    assert all(abs(x-.2) < 1e-5 for x in checks['steering_rad'].values()), checks
    for key in ('doors_open', 'roof_lift', 'active_wing', 'wheel_spin', 'steering'):
        root[key] = 0.
    refresh(root)
    (OUT / 'rig_checks.json').write_text(json.dumps(checks, indent=2) + '\n')


@contextmanager
def exchange_materials():
    # glTF cannot translate woven Noise/Wave shaders. Use the authored PBR
    # socket defaults rather than letting unsupported node chains export white.
    detached = []
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        tree = material.node_tree
        for node in tree.nodes:
            if node.type != 'BSDF_PRINCIPLED':
                continue
            for name in ('Base Color', 'Normal', 'Roughness'):
                for link in list(node.inputs[name].links):
                    detached.append((tree, link.from_socket, link.to_socket))
                    tree.links.remove(link)
    try:
        yield
    finally:
        for tree, source, destination in detached:
            tree.links.new(source, destination)


def select_asset(root):
    bpy.ops.object.select_all(action='DESELECT')
    def visible(obj):
        while obj:
            if obj.hide_render:
                return False
            obj = obj.parent
        return True
    for obj in [root, *root.children_recursive]:
        if visible(obj):
            obj.hide_set(False)
            obj.select_set(True)
    bpy.context.view_layer.objects.active = root


def measure(root):
    deps = bpy.context.evaluated_depsgraph_get()
    result = {'meshObjects': 0, 'evaluatedTriangles': 0, 'vertices': 0, 'nonFiniteVertices': 0}
    positions = []
    for obj in root.children_recursive:
        if obj.type not in {'MESH', 'CURVE', 'FONT'}:
            continue
        if any(p.hide_render for p in [obj, *ancestors(obj)]):
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        if not mesh:
            continue
        mesh.calc_loop_triangles()
        result['meshObjects'] += 1
        result['evaluatedTriangles'] += len(mesh.loop_triangles)
        result['vertices'] += len(mesh.vertices)
        for v in mesh.vertices:
            point = obj.matrix_world @ v.co
            if not all(math.isfinite(c) for c in point):
                result['nonFiniteVertices'] += 1
            positions.append(tuple(point))
        ev.to_mesh_clear()
    result['boundsM'] = {
        'min': [min(p[i] for p in positions) for i in range(3)],
        'max': [max(p[i] for p in positions) for i in range(3)],
    }
    result['dimensionsM'] = [result['boundsM']['max'][i] - result['boundsM']['min'][i] for i in range(3)]
    return result


def ancestors(obj):
    result = []
    obj = obj.parent
    while obj:
        result.append(obj)
        obj = obj.parent
    return result


def set_view(scene, cameras, name, file):
    scene.camera = cameras[name]
    scene.render.filepath = str(file)
    bpy.ops.render.render(write_still=True)


def main():
    global OUT
    args = arguments()
    OUT = args.output.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'previews').mkdir(exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    from roadster_2026_exterior import build_exterior
    from roadster_2026_interior import build_interior
    from roadster_2026_export_cleanup import clean_glb
    asset = collection('01 ROADSTER — editable vehicle')
    studio = collection('90 STUDIO — excluded from GLB')
    views = collection('91 CAMERAS — excluded from GLB')
    root = bpy.data.objects.new('roadster_root', None)
    asset.objects.link(root)
    exterior = build_exterior(root, trim='rocket')
    interior = build_interior(root, trim='rocket', driver_y=.36)
    bpy.context.view_layer.update()
    inserts = interior.get('roof_inserts')
    if inserts:
        original_world = inserts.matrix_world.copy()
        inserts.parent = exterior['roof']
        inserts.matrix_world = original_world
    controls(root, exterior, interior)
    verify_controls(root, exterior)
    readme = bpy.data.texts.new('READ ME — model controls and references')
    readme.write('Tesla Roadster 2026 detailed reconstruction.\nSelect roadster_root > Custom Properties: doors_open, roof_lift, active_wing, wheel_spin, steering.\nMetres, +X front / +Y left / +Z up.\nRocket is the single-seat flying configuration; Thrust is the two-seat rear-thruster configuration.\nOfficial reference: https://www.tesla.com/roadster?redirect=no\nBody dimensions and concealed engineering are artist estimates. The public cabin photo is two-seat; the Rocket passenger-side equipment arrangement is an explicit inference.\nStudio and cameras are separate collections and excluded from GLB. Both cabin seat sets remain editable in the .blend.\n')
    for obj in root.children_recursive:
        relocate(obj, asset)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if args.draft else 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.eevee.taa_render_samples = 16 if args.draft else 96
    scene.eevee.use_raytracing = True
    scene.eevee.ray_tracing_options.resolution_scale = '2'
    scene.eevee.ray_tracing_options.screen_trace_quality = .75
    scene.render.resolution_x = 960 if args.draft else 1920
    scene.render.resolution_y = 540 if args.draft else 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    world = bpy.data.worlds.new('Neutral studio environment')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.19, .23, .29, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .45
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.015))
    floor = bpy.context.object
    floor.name = 'Studio seamless ground'
    relocate(floor, studio)
    material = bpy.data.materials.new('Studio graphite satin')
    material.diffuse_color = (.09, .115, .145, 1)
    material.use_nodes = True
    bs = material.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (.09, .115, .145, 1)
    bs.inputs['Roughness'].default_value = .3
    floor.data.materials.append(material)
    area('Key large white softbox', (3, 3, 5.5), 1500, 5, studio)
    area('Side softbox', (1, -4.5, 3), 1050, 4, studio, (.84, .91, 1))
    area('Rear rim strip', (-3, 1, 4), 1700, 4.5, studio, (1, .93, .83), .75)
    area('Roof highlight strip', (0, 0, 5.5), 800, 5, studio, (1, 1, 1), .6)
    area('Low front fill', (5, -2, 1.5), 400, 2, studio)
    cameras = {
        'front': camera('Camera Front Three Quarter', (5.8, 4.6, 2.8), (0, 0, .55), 52, views),
        'rear': camera('Camera Rear Three Quarter', (-5.5, -4.5, 2.5), (-.15, 0, .52), 52, views),
        'side': camera('Camera Side Profile', (0, 9, 1.5), (0, 0, .53), 54, views),
        'interior': camera('Camera Cabin Forward', (-.92, 0, .95), (.76, 0, .64), 23, views),
        'open': camera('Camera Butterfly Doors', (6, 5.4, 3.3), (-.1, 0, .9), 46, views),
        'cabin': camera('Camera Cabin Top Detail', (1.7, .12, 1.95), (-.30, 0, .6), 36, views),
        'rear_detail': camera('Camera Rear Hardware Detail', (-3.7, -1.7, .95), (-2, 0, .4), 48, views),
    }
    scene.camera = cameras['front']
    bpy.context.view_layer.update()
    reports = {}
    for trim, title in [('rocket', 'Rocket'), ('thrust', 'Thrust')]:
        interior['configure_trim'](trim)
        for key, hardware in exterior['hardware'].items():
            hidden = key == 'perimeter' and trim != 'rocket'
            branch_visibility(hardware, not hidden)
        root['trim'] = trim
        root['seat_count'] = 1 if trim == 'rocket' else 2
        bpy.context.view_layer.update()
        reports[trim] = measure(root)
        select_asset(root)
        if not args.no_export:
            export = OUT / f'Tesla_Roadster_2026_{title}_Detailed.glb'
            with exchange_materials():
                bpy.ops.export_scene.gltf(filepath=str(export), export_format='GLB', use_selection=True,
                                          export_apply=True, export_extras=True, export_animations=False,
                                          export_cameras=False, export_lights=False, export_yup=True)
            reports[trim].update(clean_glb(export))
            reports[trim]['glbBytes'] = export.stat().st_size
            reports[trim]['glbSha256'] = hashlib.sha256(export.read_bytes()).hexdigest()
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'Tesla_Roadster_2026_{title}_Detailed.blend'), compress=True)
        if args.render:
            requested = set(args.views.split(','))
            wanted = lambda name: 'all' in requested or f'{trim}_{name}' in requested
            names = ['front', 'rear', 'side', 'rear_detail'] if trim == 'rocket' else ['interior']
            for name in names:
                if wanted(name):
                    set_view(scene, cameras, name, OUT / 'previews' / f'{trim}_{name}.png')
            root['doors_open'] = 1.0
            root['active_wing'] = 1.0
            refresh(root)
            if wanted('doors_open'):
                set_view(scene, cameras, 'open', OUT / 'previews' / f'{trim}_doors_open.png')
            branch_visibility(exterior['roof'], False)
            # Presentation cutaway: remove windscreen only for this detail image.
            windscreen = bpy.data.objects.get('R26_copper_windscreen')
            if windscreen:
                windscreen.hide_render = True
            if wanted('cabin_detail'):
                set_view(scene, cameras, 'cabin', OUT / 'previews' / f'{trim}_cabin_detail.png')
            if windscreen:
                windscreen.hide_render = False
            branch_visibility(exterior['roof'], True)
            root['doors_open'] = 0.0
            root['active_wing'] = 0.0
            scene.camera = cameras['front']
            refresh(root)
    # The primary scene opens in the single-seat flying configuration.
    interior['configure_trim']('rocket')
    branch_visibility(exterior['hardware']['perimeter'], True)
    root['trim'] = 'rocket'
    root['seat_count'] = 1
    scene.camera = cameras['front']
    select_asset(root)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'Tesla_Roadster_2026_Rocket_Detailed.blend'), compress=True)
    (OUT / 'measurements.json').write_text(json.dumps(reports, indent=2) + '\n')
    rig = {
        'axes': 'glTF metres: +X front, +Y up, -Z left',
        'doors': {side: {'node': obj.name, 'axis': [exterior['door_axes'][side][0], exterior['door_axes'][side][2], -exterior['door_axes'][side][1]]} for side, obj in exterior['doors'].items()},
        'roof': exterior['roof'].name,
        'wing': exterior['wing'].name,
        'wheels': {key: obj.name for key, obj in exterior['wheels'].items()},
        'steer': {key: obj.name for key, obj in exterior['steer'].items()},
        'thrusters': [{'node': entry['node'].name, 'role': entry['role'], 'trim': entry.get('trim', 'rocket')} for entry in exterior['thrusters']],
    }
    (OUT / 'rig.json').write_text(json.dumps(rig, indent=2) + '\n')
    print('ROADSTER_BUILD_COMPLETE', json.dumps({key: {name: row[name] for name in ('meshObjects', 'evaluatedTriangles', 'exportedTriangles', 'dimensionsM', 'glbBytes')} for key, row in reports.items()}))


if __name__ == '__main__':
    main()
