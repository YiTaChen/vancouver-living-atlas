"""Blender CLI importer of the actual THREE mesh; original geometry only.

Blender --background --python tools/assets/olympic-cauldron/build_blender.py
 -- --mesh work/olympic-cauldron/runtime-mesh.json
 --blend tools/assets/olympic-cauldron/olympic-cauldron.blend
 --preview work/olympic-cauldron/preview.png
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mesh', required=True)
    parser.add_argument('--blend', required=True)
    parser.add_argument('--preview', required=True)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def float_bytes(values):
    return struct.pack('<' + 'f' * len(values), *values)


def mesh_digest(position, normals, colors):
    digest = hashlib.sha256()
    for values in (position, normals, colors):
        digest.update(float_bytes(values))
    return digest.hexdigest()


def main():
    args = arguments()
    source = json.loads(Path(args.mesh).read_text())
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    collection = bpy.data.collections.new('Olympic Cauldron | exact runtime geometry')
    scene.collection.children.link(collection)
    rig = bpy.data.collections.new('Preview studio | offline only')
    scene.collection.children.link(rig)
    evidence = []

    for index, data in enumerate(source['meshes']):
        attrs = {key: struct.unpack('<' + 'f' * (len(base64.b64decode(value)) // 4), base64.b64decode(value)) for key, value in data['attributeBytes'].items()}
        p, n, c = (attrs[key] for key in ('position', 'normal', 'color'))
        assert mesh_digest(p, n, c) == data['geometrySha256']
        vertices = [(p[i], -p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
        faces = [(i, i + 1, i + 2) for i in range(0, len(vertices), 3)]
        mesh = bpy.data.meshes.new(data['name'].split('/')[-1])
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        # Non-indexed flat triangles exactly match THREE's source topology.
        mesh.normals_split_custom_set_from_vertices([(n[i], -n[i + 2], n[i + 1]) for i in range(0, len(n), 3)])
        color = mesh.color_attributes.new(name='crystal-color', type='FLOAT_COLOR', domain='POINT')
        for i, item in enumerate(color.data):
            item.color = (*c[i * 3:i * 3 + 3], 1)
        obj = bpy.data.objects.new(data['name'].split('/')[-1], mesh)
        collection.objects.link(obj)
        obj['runtime_geometry_sha256'] = data['geometrySha256']
        obj['runtime_mesh_role'] = data['name']
        for part in source['metadata']['authoringParts']:
            span = part['ranges'][index]
            obj.vertex_groups.new(name=part['name']).add(list(range(span['first'], span['first'] + span['count'])), 1, 'REPLACE')
        material = bpy.data.materials.new(data['name'])
        material.use_nodes = True
        nodes = material.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value = data['material']['roughness']
        shader.inputs['Metallic'].default_value = data['material']['metalness']
        shader.inputs['Alpha'].default_value = 1
        attribute = nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'crystal-color'
        material.node_tree.links.new(attribute.outputs['Color'], shader.inputs['Base Color'])
        mesh.materials.append(material)
        reconstructed = [coord for vertex in mesh.vertices for coord in (vertex.co.x, vertex.co.z, -vertex.co.y)]
        assert float_bytes(reconstructed) == float_bytes(p), 'Blender coordinates must round trip to the actual runtime vertices'
        assert len(mesh.polygons) == data['triangles']
        evidence.append({'name': data['name'], 'vertices': len(mesh.vertices), 'triangles': len(mesh.polygons), 'geometrySha256': data['geometrySha256'], 'positionRoundTripExact': True, 'editableVertexGroups': list(obj.vertex_groups.keys())})

    # The source file opens ready to edit three material meshes and five crystal
    # vertex groups. The studio is a distinct collection, never exported to web.
    scene['runtime_source_sha256'] = source['sourceSha256']
    scene['reference_sources'] = json.dumps(source['metadata']['contract']['sources'])
    scene['interpretation_limits'] = source['metadata']['contract']['sourcePrecision']
    scene['runtime_triangles'] = source['metadata']['triangles']
    scene['runtime_draw_calls'] = source['metadata']['drawCalls']
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.045))
    ground = bpy.context.object
    ground.name = 'Studio floor | not runtime geometry'
    for old in list(ground.users_collection):
        old.objects.unlink(ground)
    rig.objects.link(ground)
    ground_mat = bpy.data.materials.new('Studio warm concrete')
    ground_mat.diffuse_color = (0.27, 0.3, 0.31, 1)
    ground.data.materials.append(ground_mat)

    def light(name, position, energy, size, color):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        rig.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector((0, 0, 4)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

    light('Large soft daylight', (3, -7, 15), 2300, 9, (0.86, 0.94, 1))
    light('Glass side reflection', (-9, -1, 9), 1600, 7, (0.8, 0.91, 1))
    light('Warm harbour sky', (4, 7, 12), 2600, 7, (1, 0.94, 0.84))
    camera = bpy.data.objects.new('Three-quarter preview camera', bpy.data.cameras.new('Three-quarter preview camera'))
    rig.objects.link(camera)
    camera.location = (18, -24, 12)
    camera.rotation_euler = (Vector((0, 0, 4.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 19
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.color = (0.3, 0.35, 0.4)
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(Path(args.preview).resolve())
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = collection.objects[0]
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_distance = 23
                area.spaces.active.region_3d.view_location = (0, 0, 4.5)
    blend = Path(args.blend).resolve()
    blend.parent.mkdir(parents=True, exist_ok=True)
    Path(args.preview).resolve().parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    bpy.ops.render.render(write_still=True)
    manifest = {
        'schema': 'vancouver-living-atlas/olympic-cauldron-blender-evidence-v1',
        'sourceSha256': source['sourceSha256'],
        'blend': blend.name,
        'coordinateConversion': 'THREE (x,y,z) -> Blender (x,-z,y)',
        'runtimeBoundsM': source['metadata']['bounds'],
        'triangles': source['metadata']['triangles'],
        'drawCalls': source['metadata']['drawCalls'],
        'geometryBytes': source['metadata']['geometryBytes'],
        'meshes': evidence,
    }
    blend.with_name('manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('OLYMPIC_CAULDRON_EVIDENCE ' + json.dumps(manifest))


if __name__ == '__main__':
    main()
