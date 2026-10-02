"""Blender 4.3+: author or re-export the bounded residential perennial.
No external asset inputs. Re-export uses mesh/UV/COLOR edits from --blend.
"""
import argparse, hashlib, json, math, pathlib, sys
import bpy
from mathutils import Vector

p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
p.add_argument('--blend', help='Re-export an edited source; never regenerate it')
p.add_argument('--render', action='store_true')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = pathlib.Path(a.output).resolve(); out.mkdir(parents=True, exist_ok=True)

def material():
    m = bpy.data.materials.new('Residential foliage / shared vertex-color role')
    m.use_nodes = True
    n = m.node_tree.nodes; bsdf = n.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 1
    bsdf.inputs['Metallic'].default_value = 0
    attr = n.new('ShaderNodeVertexColor'); attr.layer_name = 'COLOR_0'
    m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    return m

def author(before=False):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    vertices, faces = [], []
    # Same seven-face/population budget and 0.286 m maximum clearance radius.
    if before:
        for k in range(7):
            r = .23 + (k % 3)*.028
            t, u = k*math.tau/7, (k+1)*math.tau/7
            start = len(vertices)
            vertices += [(0, 0, .23), (math.cos(t)*r, math.sin(t)*r, .025), (math.cos(u)*r, math.sin(u)*r, .025)]
            faces.append((start, start+1, start+2))
    else:
        vertices = [(.018, -.012, .23)]
        for k in range(7):
            r = [.258, .23, .286, .252, .278, .238, .267][k]
            t = k*math.tau/7
            vertices.append((math.cos(t)*r, math.sin(t)*r, .025))
        faces = [(0, k+1, (k+1)%7+1) for k in range(7)]
    mesh = bpy.data.meshes.new('Perennial seven connected leaf lobes')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new('ResidentialPerennial', mesh); bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    mesh.materials.append(material())
    mesh.uv_layers.new(name='UVMap')
    mesh.color_attributes.new(name='COLOR_0', type='FLOAT_COLOR', domain='CORNER')
    # CustomData allocation can invalidate prior RNA layer references.
    uv = mesh.uv_layers['UVMap']
    colors = mesh.color_attributes['COLOR_0']
    for face in mesh.polygons:
        for loop in face.loop_indices:
            v = mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv = (.5+v.x/.6, .5+v.y/.6)
            # Unlit intrinsic green variation, not AO/directional baked light.
            value = 1 if before else [.96, 1, .94, .98, .95, 1, .97][face.index]
            colors.data[loop].color = (value, value, value, 1)
    obj['surface_role'] = 'residential-foliage-vertex-color'
    obj['provenance'] = 'Original representative perennial; not a surveyed species or parcel planting'
    return obj

def export(obj, name):
    mesh = obj.data; mesh.calc_loop_triangles()
    assert len(mesh.loop_triangles) == 7, 'Existing plant triangle budget must remain seven'
    assert len(mesh.materials) == 1
    uv = mesh.uv_layers['UVMap']; col = mesh.color_attributes['COLOR_0']
    vertices = []; indices = []; colors = []; uvs = []
    for v in mesh.vertices:
        # Blender Z up -> runtime Y up; reverse horizontal axis retains winding.
        vertices.append([round(v.co.x, 8), round(v.co.z, 8), round(-v.co.y, 8)])
        assert math.hypot(v.co.x, v.co.y) <= .286001
        assert .02499 <= v.co.z <= .230001
    for tri in mesh.loop_triangles:
        indices.append(list(tri.vertices))
        colors.append([list(col.data[i].color)[:3] for i in tri.loops])
        uvs.append([list(uv.data[i].uv) for i in tri.loops])
        assert tri.area > 1e-6
    assert all(0 <= value <= 1 for face in uvs for corner in face for value in corner)
    assert all(.93 <= value <= 1 for face in colors for corner in face for value in corner)
    payload = {'vertices': vertices, 'triangles': indices, 'colors': colors, 'uvs': uvs}
    (out / (name+'.json')).write_text(json.dumps(payload, indent=2)+'\n')
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')), export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True, export_materials='EXPORT', export_attributes=True)
    return payload

if a.blend:
    bpy.ops.wm.open_mainfile(filepath=str(pathlib.Path(a.blend).resolve()))
    obj = bpy.data.objects['ResidentialPerennial']
    data = export(obj, 'perennial')
    source = pathlib.Path(a.blend)
else:
    before = author(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'before.blend'), compress=True)
    export(before, 'before')
    obj = author()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'perennial.blend'), compress=True)
    data = export(obj, 'perennial')
    source = out/'perennial.blend'
header = '// Generated from the editable Blender mesh; use build_perennial.py --blend to re-export.\n'
(out/'residential-perennial-data.ts').write_text(header+'export const RESIDENTIAL_PERENNIAL = '+json.dumps(data,separators=(',', ':'))+' as const;\n')
report = {'blender': bpy.app.version_string, 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'triangles':7, 'materials':1, 'radiusLimitM':.286, 'heightRangeM':[.025,.23], 'uvBounds':[0,1], 'lod':'existing residential cell mesh at 0 m, empty group at 650 m; unchanged', 'textureCount':0, 'provenance':'Original Blender-authored representative geometry; existing source-selected domestic foundation gardens only'}
for f in out.glob('*'):
    if f.suffix in ['.glb','.json','.ts'] and f.name != 'validation.json':
        report[f.name] = hashlib.sha256(f.read_bytes()).hexdigest()
(out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
if a.render:
    # Matched orthographic QA, one render per source, no runtime geometry changes.
    for name in ['before','perennial']:
        bpy.ops.wm.open_mainfile(filepath=str(out/(name+'.blend')))
        obj = bpy.data.objects['ResidentialPerennial']
        mat = obj.data.materials[0]; nodes=mat.node_tree.nodes; links=mat.node_tree.links
        bsdf=nodes.get('Principled BSDF'); attr=next(n for n in nodes if n.type=='VERTEX_COLOR')
        mul=nodes.new('ShaderNodeMixRGB'); mul.blend_type='MULTIPLY'; mul.inputs[0].default_value=1
        mul.inputs[2].default_value=(.1384,.1714,.0908,1)
        links.new(attr.outputs['Color'],mul.inputs[1]); links.new(mul.outputs[0],bsdf.inputs['Base Color'])
        bpy.ops.mesh.primitive_plane_add(size=200)
        floor=bpy.context.object; floor.location.z=0
        m=bpy.data.materials.new('Neutral soil'); m.diffuse_color=(.18,.15,.11,1); floor.data.materials.append(m)
        bpy.ops.object.camera_add(location=(.78,-1.1,.68)); camera=bpy.context.object
        camera.rotation_euler=(Vector((0,0,.1))-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.type='ORTHO'; camera.data.ortho_scale=.78
        scene=bpy.context.scene; scene.camera=camera
        scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.device='CPU'; scene.cycles.use_denoising=False
        scene.render.threads_mode='FIXED'; scene.render.threads=2
        scene.world.color=(.3,.3,.3)
        bpy.ops.object.light_add(type='AREA', location=(-1,-1,2)); bpy.context.object.data.energy=100; bpy.context.object.data.shape='DISK'; bpy.context.object.data.size=2
        scene.render.resolution_x=640; scene.render.resolution_y=480; scene.render.resolution_percentage=100
        scene.view_settings.view_transform='Standard'; scene.render.filepath=str(out/(name+'.png'))
        bpy.ops.render.render(write_still=True)
