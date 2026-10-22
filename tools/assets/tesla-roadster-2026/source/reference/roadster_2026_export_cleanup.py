"""Remove collapsed exported triangles without altering editable Blender sources.

Only primitive index references change. Original vertex, normal, UV, material,
node and index data remain in the binary buffer; replacement aligned index data
is appended. Run after glTF export and before computing the package hash.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

try:
    from .verify_roadster_2026 import GLB, COMPONENTS, cross, finite, length, point, require, sub
except ImportError:
    from verify_roadster_2026 import GLB, COMPONENTS, cross, finite, length, point, require, sub


def clean_glb(path) -> dict:
    """Return exact instanced triangle counts and a per-primitive cleanup audit.

    A shared primitive is cleaned once only if every instance agrees which faces
    collapse in world space. Mixed classifications or a fully collapsed primitive
    fail before the file is changed. The source Blender scene is never opened.
    """
    path = Path(path)
    asset = GLB(path)
    data = asset.data
    instances = {}
    for node_index, matrix in asset.world.items():
        node = asset.nodes[node_index]
        if 'mesh' in node:
            instances.setdefault(node['mesh'], []).append((node_index, matrix))
    binary = bytearray(asset.binary)
    original_triangles = removed_triangles = 0
    changes = []
    mesh_report = []
    for mesh_index, mesh_instances in instances.items():
        meshes = data.get('meshes', [])
        require(isinstance(mesh_index, int) and 0 <= mesh_index < len(meshes), 'invalid mesh index')
        mesh = meshes[mesh_index]
        mesh_removed = mesh_original = 0
        for primitive_index, primitive in enumerate(mesh.get('primitives', [])):
            label = f"mesh {mesh_index} {mesh.get('name', '')} primitive {primitive_index}"
            require(primitive.get('mode', 4) == 4 and not primitive.get('targets'),
                    f'cleanup requires ordinary triangle geometry: {label}')
            position_index = primitive.get('attributes', {}).get('POSITION')
            positions = asset.accessor(position_index)
            require(data['accessors'][position_index]['type'] == 'VEC3' and
                    data['accessors'][position_index]['componentType'] == 5126 and
                    all(finite(p) for p in positions), f'invalid positions: {label}')
            if 'indices' in primitive:
                accessor = data['accessors'][primitive['indices']]
                component = accessor['componentType']
                require(accessor['type'] == 'SCALAR' and component in (5121, 5123, 5125)
                        and not accessor.get('normalized'), f'invalid indices: {label}')
                indices = [row[0] for row in asset.accessor(primitive['indices'])]
            else:
                indices = list(range(len(positions)))
                component = 5123 if len(positions) <= 65536 else 5125
            require(len(indices) % 3 == 0 and indices and
                    all(0 <= i < len(positions) for i in indices), f'invalid triangle indices: {label}')
            face_count = len(indices) // 3
            instance_count = len(mesh_instances)
            original_triangles += face_count * instance_count
            mesh_original += face_count * instance_count
            collapsed = None
            for node_index, matrix in mesh_instances:
                vertices = [point(matrix, p) for p in positions]
                require(all(finite(p) for p in vertices), f'non-finite world positions: {label}')
                found = set()
                for face in range(face_count):
                    a, b, c = (vertices[i] for i in indices[face*3:face*3+3])
                    if .5 * length(cross(sub(b, a), sub(c, a))) <= 1e-12:
                        found.add(face)
                require(collapsed is None or found == collapsed,
                        f'shared instances disagree on world-area degeneracy: {label}')
                collapsed = found
            if not collapsed:
                continue
            require(len(collapsed) < face_count, f'fully degenerate primitive: {label}')
            retained = [index for face in range(face_count) if face not in collapsed
                        for index in indices[face*3:face*3+3]]
            code, _ = COMPONENTS[component]
            payload = struct.pack('<' + code * len(retained), *retained)
            binary.extend(b'\x00' * ((-len(binary)) % 4))
            offset = len(binary)
            binary.extend(payload)
            binary.extend(b'\x00' * ((-len(binary)) % 4))
            view_index = len(data.setdefault('bufferViews', []))
            data['bufferViews'].append({'buffer': 0, 'byteOffset': offset,
                                        'byteLength': len(payload), 'target': 34963})
            accessor_index = len(data.setdefault('accessors', []))
            data['accessors'].append({'bufferView': view_index, 'componentType': component,
                                      'count': len(retained), 'type': 'SCALAR',
                                      'min': [min(retained)], 'max': [max(retained)]})
            primitive['indices'] = accessor_index
            removed = len(collapsed) * instance_count
            removed_triangles += removed
            mesh_removed += removed
            changes.append({'meshIndex': mesh_index, 'mesh': mesh.get('name', ''),
                            'primitive': primitive_index,
                            'nodes': [asset.nodes[i].get('name', str(i)) for i, _ in mesh_instances],
                            'instances': instance_count,
                            'removedPerInstance': len(collapsed), 'removedTriangles': removed,
                            'retainedPerInstance': len(retained)//3,
                            'replacementAccessor': accessor_index})
        if mesh_removed:
            mesh_report.append({'meshIndex': mesh_index, 'mesh': mesh.get('name', ''),
                                'instances': len(mesh_instances), 'originalTriangles': mesh_original,
                                'removedTriangles': mesh_removed,
                                'exportedTriangles': mesh_original-mesh_removed})
    if changes:
        data['buffers'][0]['byteLength'] = len(binary)
        encoded = json.dumps(data, separators=(',', ':'), ensure_ascii=False,
                             allow_nan=False).encode('utf-8')
        encoded += b' ' * ((-len(encoded)) % 4)
        total = 12 + 8 + len(encoded) + 8 + len(binary)
        output = (struct.pack('<4sII', b'glTF', 2, total) +
                  struct.pack('<II', len(encoded), 0x4E4F534A) + encoded +
                  struct.pack('<II', len(binary), 0x004E4942) + binary)
        temporary = path.with_name(path.name + '.cleanup.tmp')
        try:
            temporary.write_bytes(output)
            reloaded = GLB(temporary)
            for change in changes:
                require(len(reloaded.accessor(change['replacementAccessor'])) ==
                        change['retainedPerInstance'] * 3, 'replacement index range failed verification')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return {'exportedTriangles': original_triangles - removed_triangles,
            'removedDegenerateTriangles': removed_triangles,
            'cleanedPrimitiveCount': len(changes), 'cleanedPrimitives': changes,
            'cleanupMeshes': mesh_report,
            'cleanupPolicy': 'index-only; world triangle area <= 1e-12 m²; original binary data retained'}
