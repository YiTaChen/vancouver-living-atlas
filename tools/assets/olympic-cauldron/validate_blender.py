"""Validate a saved .blend against its freshly exported actual runtime mesh.

Blender --background tools/assets/olympic-cauldron/olympic-cauldron.blend
 --python tools/assets/olympic-cauldron/validate_blender.py
 -- --mesh work/olympic-cauldron/runtime-mesh.json
"""
import argparse
import base64
import json
from pathlib import Path
import struct
import sys

import bpy


def packed(values):
    return struct.pack('<' + 'f' * len(values), *values)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mesh', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = json.loads(Path(args.mesh).read_text())
    assert bpy.context.scene['runtime_source_sha256'] == source['sourceSha256'], 'Regenerate Blender source after changing runtime code'
    collection = bpy.data.collections['Olympic Cauldron | exact runtime geometry']
    assert len(collection.objects) == 3
    triangles = 0
    for index, data in enumerate(source['meshes']):
        obj = collection.objects[data['name'].split('/')[-1]]
        assert obj.type == 'MESH' and obj.mode == 'OBJECT'
        assert len(obj.modifiers) == 0
        assert obj['runtime_geometry_sha256'] == data['geometrySha256']
        mesh = obj.data
        positions = [coord for vertex in mesh.vertices for coord in (vertex.co.x, vertex.co.z, -vertex.co.y)]
        assert packed(positions) == base64.b64decode(data['attributeBytes']['position']), f'{obj.name}: vertex positions changed'
        colors = [channel for color in mesh.color_attributes['crystal-color'].data for channel in color.color[:3]]
        assert packed(colors) == base64.b64decode(data['attributeBytes']['color']), f'{obj.name}: linear vertex colors changed'
        assert len(mesh.polygons) == data['triangles']
        assert all(len(polygon.vertices) == 3 for polygon in mesh.polygons)
        assert len(mesh.materials) == 1
        shader = mesh.materials[0].node_tree.nodes.get('Principled BSDF')
        assert abs(shader.inputs['Roughness'].default_value - data['material']['roughness']) < 1e-6
        assert abs(shader.inputs['Metallic'].default_value - data['material']['metalness']) < 1e-6
        assert shader.inputs['Alpha'].default_value == 1
        assert len(obj.vertex_groups) == 5
        for part in source['metadata']['authoringParts']:
            group = obj.vertex_groups[part['name']]
            span = part['ranges'][index]
            selected = [vertex.index for vertex in mesh.vertices if any(item.group == group.index and item.weight == 1 for item in vertex.groups)]
            assert selected == list(range(span['first'], span['first'] + span['count']))
        triangles += len(mesh.polygons)
    assert triangles == source['metadata']['triangles']
    print(json.dumps({'savedBlendVerified': True, 'runtimePositionAndColorFloat32Match': True, 'editableMeshes': 3, 'crystalSelectionGroupsPerMesh': 5, 'triangles': triangles, 'drawCalls': 3}))


if __name__ == '__main__':
    main()
