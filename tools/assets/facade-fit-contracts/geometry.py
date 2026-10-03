"""Read existing GLBs only; use the repository's audited container/transform reader.

The fit package has its own reference schema. Importing measure_glb does not make
this a new exported-model package. No Blender source or GLB is regenerated.
"""
from pathlib import Path
import importlib.util
import math

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

common = load('facade_common_glb', HERE.parent / 'package-contract/validate.py')
legacy = load('facade_legacy_glb', HERE.parent / 'architecture-details/validate_architecture_details.py')
need, digest = common.need, common.digest


def mesh_triangles(path):
    """Return scene-root-local triangles; each scene transform is applied once."""
    doc, binary = common.read_glb(path)
    triangles, points, visited = [], [], set()
    def walk(index, parent):
        need(index not in visited and 0 <= index < len(doc['nodes']), 'invalid scene graph')
        visited.add(index)
        node = doc['nodes'][index]
        matrix = common.matmul(parent, common.transform(node))
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                need(primitive.get('mode', 4) == 4, 'triangle primitive required')
                p = [common.point(matrix, v) for v in common.accessor(doc, binary, primitive['attributes']['POSITION'])]
                indices = ([v[0] for v in common.accessor(doc, binary, primitive['indices'])]
                           if 'indices' in primitive else list(range(len(p))))
                need(len(indices) % 3 == 0 and all(0 <= i < len(p) for i in indices), 'invalid triangle indices')
                triangles.extend([p[i] for i in indices[k:k+3]] for k in range(0, len(indices), 3))
                points.extend(p)
        for child in node.get('children', []):
            walk(child, matrix)
    for index in doc['scenes'][doc.get('scene', 0)]['nodes']:
        walk(index, common.IDENTITY)
    need(triangles, 'empty geometry')
    return triangles, points


def triangle_in_open_box(triangle, bounds, epsilon=1e-6):
    """Clip actual triangle against six inward-offset planes, not its AABB.

    A nonzero clipped triangle area is an obstruction. Intended boundary contact
    is excluded by epsilon. This catches small interior panels between ray probes.
    """
    polygon = [list(v) for v in triangle]
    for axis in range(3):
        for lower, edge in [(True, bounds['min'][axis] + epsilon),
                            (False, bounds['max'][axis] - epsilon)]:
            if not polygon:
                return False
            output = []
            for a, b in zip(polygon, polygon[1:] + polygon[:1]):
                inside_a = a[axis] >= edge if lower else a[axis] <= edge
                inside_b = b[axis] >= edge if lower else b[axis] <= edge
                if inside_a:
                    output.append(a)
                if inside_a != inside_b:
                    t = (edge-a[axis]) / (b[axis]-a[axis])
                    output.append([a[k] + t*(b[k]-a[k]) for k in range(3)])
            polygon = output
    if len(polygon) < 3:
        return False
    a = polygon[0]
    area = 0
    for b, c in zip(polygon[1:-1], polygon[2:]):
        u = [b[k]-a[k] for k in range(3)]
        v = [c[k]-a[k] for k in range(3)]
        cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        area += math.sqrt(sum(x*x for x in cross))
    return area > 1e-12


def ray_hits(triangles, origin, direction, length):
    """Double-sided Moller-Trumbore finite-segment intersections."""
    def sub(a, b): return [a[k]-b[k] for k in range(3)]
    def dot(a, b): return sum(a[k]*b[k] for k in range(3))
    def cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    found = []
    for a, b, c in triangles:
        e1, e2 = sub(b, a), sub(c, a)
        p = cross(direction, e2)
        det = dot(e1, p)
        if abs(det) < 1e-12:
            continue
        v0 = sub(origin, a)
        u = dot(v0, p)/det
        q = cross(v0, e1)
        v = dot(direction, q)/det
        t = dot(e2, q)/det
        if u >= -1e-8 and v >= -1e-8 and u+v <= 1+1e-8 and 1e-7 < t < length-1e-7:
            found.append(t)
    return sorted(set(round(t, 7) for t in found))


def check_open_volume(triangles, bounds):
    blocked = sum(triangle_in_open_box(t, bounds) for t in triangles)
    need(blocked == 0, f'opening obstruction: {blocked} clipped triangles')
    rays = 0
    # Trace along all three axes inside the declared volume. Bounds exterior is
    # deliberately excluded: a parapet's outer skirts do not obstruct its cavity.
    for axis in range(3):
        other = [k for k in range(3) if k != axis]
        for u in (.1, .3, .5, .7, .9):
            for v in (.1, .3, .5, .7, .9):
                origin = list(bounds['min'])
                origin[axis] += 1e-5
                for k, f in zip(other, (u, v)):
                    origin[k] += (bounds['max'][k]-bounds['min'][k])*f
                direction = [int(k == axis) for k in range(3)]
                length = bounds['max'][axis]-bounds['min'][axis]-2e-5
                need(not ray_hits(triangles, origin, direction, length), 'opening ray obstruction')
                rays += 1
    return {'triangleClipObstructions': blocked, 'openVolumeRays': rays, 'rayObstructions': 0}


def check_witnesses(triangles, points, witnesses):
    """Check physical stop/corner datums and solid frame control probes."""
    for p in witnesses.get('verticesM', []):
        need(any(max(abs(a[k]-p[k]) for k in range(3)) < 2e-5 for a in points), f'missing geometry datum {p}')
    results = []
    for ray in witnesses.get('solidRays', []):
        hits = ray_hits(triangles, ray['originM'], ray['direction'], ray['lengthM'])
        need(bool(hits), 'solid control ray missed; opening test cannot verify an absent frame')
        for t in ray.get('requiredDistancesM', []):
            need(any(abs(t-a) < 2e-5 for a in hits), f'physical stop ray depth mismatch {t}: {hits}')
        results.append({'name': ray['name'], 'distancesM': hits})
    return {'geometryDatumVertices': len(witnesses.get('verticesM', [])), 'solidControlRays': results}
