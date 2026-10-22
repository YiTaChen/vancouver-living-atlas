"""Editable October-2026 Roadster cabin, metres, +X front/+Y left/+Z up.

Primary visual: Tesla Roadster Carousel Slide 4, inspected at 2200x1040:
https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Desktop.jpg
The photograph establishes the TWO-seat reference cabin, not Rocket packaging.
Rocket's one seat is confirmed in the current specification. Keeping its driver
at the pictured LHD position and placing pressure vessels in the right bay is
an explicitly inferred concept arrangement, not a claim about Tesla engineering.
The roof pod exists in the photograph; assigning its two dark faces to the
specified forward displays is also an inference until a clearer angle exists.

No render, save, scene deletion, external textures, or people are created here.
Call build_interior(root, trim='rocket', driver_y=.36). Returned configure_trim
switches the editable passenger seat / inferred Rocket pack without rebuilding.
Door-card roots have the exact exterior pivot origins; after parenting one to
its matching exterior door, set its matrix_basis to Matrix.Identity(4).
"""
import math
import bpy
from mathutils import Matrix, Vector


RI_SOURCE_URL = 'https://www.tesla.com/roadster?redirect=no'
RI_IMAGE_URL = 'https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Desktop.jpg'
RI_PREFIX = 'RD26 Cabin | '


def _ri_empty(name, parent, collection, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(RI_PREFIX + name, None)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.empty_display_size = .06
    return obj


def _ri_mesh(name, vertices, faces, material, parent, collection, smooth=False):
    data = bpy.data.meshes.new(RI_PREFIX + name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(RI_PREFIX + name, data)
    collection.objects.link(obj)
    obj.parent = parent
    if material:
        data.materials.append(material)
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    return obj


def _ri_box(name, center, dimensions, material, parent, collection, bevel=.008):
    cx, cy, cz = center
    hx, hy, hz = [v / 2 for v in dimensions]
    vertices = [(x*hx, y*hy, z*hz)
                for x, y, z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                                (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces = [(0,2,6,4),(1,5,7,3),(0,4,5,1),(2,3,7,6),(0,1,3,2),(4,6,7,5)]
    obj = _ri_mesh(name, vertices, faces, material, parent, collection)
    obj.location = (cx, cy, cz)
    if bevel:
        mod = obj.modifiers.new('Manufactured radii', 'BEVEL')
        mod.width = min(bevel, min(dimensions)*.46)
        mod.segments = 3
        norm = obj.modifiers.new('Weighted panel normals', 'WEIGHTED_NORMAL')
        norm.keep_sharp = True
    return obj


def _ri_material(name, color, metal=0, rough=.4, kind=None, emission=0):
    key = RI_PREFIX + name
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    if emission:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
    if kind in ('leather', 'suede', 'rubber'):
        tex = nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 510 if kind == 'suede' else 250
        tex.inputs['Detail'].default_value = 2.3
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = .00004 if kind == 'suede' else .00009
        bump.inputs['Strength'].default_value = .13 if kind == 'suede' else .24
        links.new(tex.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bs.inputs['Normal'])
        if 'Sheen Weight' in bs.inputs:
            bs.inputs['Sheen Weight'].default_value = .22 if kind == 'suede' else .06
    if kind == 'carbon':
        tex = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Rotation'].default_value[2] = math.pi/4
        links.new(tex.outputs['Object'], mapping.inputs['Vector'])
        waves = []
        for axis in ('X', 'Y'):
            wave = nodes.new('ShaderNodeTexWave')
            wave.wave_type = 'BANDS'
            wave.bands_direction = axis
            wave.inputs['Scale'].default_value = 225
            wave.inputs['Distortion'].default_value = .15
            links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
            waves.append(wave)
        weave = nodes.new('ShaderNodeMath')
        weave.operation = 'MULTIPLY'
        links.new(waves[0].outputs['Color'], weave.inputs[0])
        links.new(waves[1].outputs['Color'], weave.inputs[1])
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (.009, .012, .014, 1)
        ramp.color_ramp.elements[1].color = (.045, .052, .056, 1)
        links.new(weave.outputs[0], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], bs.inputs['Base Color'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = .00012
        bump.inputs['Strength'].default_value = .2
        links.new(weave.outputs[0], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bs.inputs['Normal'])
        if 'Coat Weight' in bs.inputs:
            bs.inputs['Coat Weight'].default_value = .55
            bs.inputs['Coat Roughness'].default_value = .21
    return mat


def _ri_path(points, steps=8):
    """Catmull-Rom points for soft, independently editable trim paths."""
    p = [Vector(v) for v in points]
    if len(p) < 3:
        return [tuple(v) for v in p]
    out = []
    for i in range(len(p)-1):
        a, b = p[max(0,i-1)], p[i]
        c, d = p[i+1], p[min(len(p)-1,i+2)]
        for j in range(steps):
            t = j/steps
            out.append(tuple(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+
                                    (-a+3*b-3*c+d)*t*t*t)))
    out.append(tuple(p[-1]))
    return out


def _ri_tube(name, points, radius, material, parent, collection, sides=8):
    p = [Vector(v) for v in points]
    vertices = []
    for i, center in enumerate(p):
        tangent = (p[min(i+1,len(p)-1)]-p[max(i-1,0)]).normalized()
        ref = Vector((0,0,1)) if abs(tangent.z) < .9 else Vector((0,1,0))
        u = tangent.cross(ref).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            angle = math.tau*j/sides
            vertices.append(tuple(center + radius*(u*math.cos(angle)+v*math.sin(angle))))
    faces = [tuple(reversed(range(sides))), tuple((len(p)-1)*sides+j for j in range(sides))]
    for i in range(len(p)-1):
        for j in range(sides):
            k, n = i*sides+j, i*sides+(j+1)%sides
            faces.append((k,n,n+sides,k+sides))
    return _ri_mesh(name, vertices, faces, material, parent, collection, True)


def _ri_cylinder(name, a, b, radius, material, parent, collection, sides=32):
    return _ri_tube(name, [a,b], radius, material, parent, collection, sides)


def _ri_loft(name, controls, axis, ycenter, material, parent, collection,
             rows=36, sides=48):
    """Closed elliptical-section upholstery; controls=(axis, centre, ry, r2)."""
    vertices = []
    count = len(controls)-1
    for i in range(rows):
        t = i/(rows-1)*count
        j, f = min(count-1, int(t)), min(1, t-min(count-1,int(t)))
        a, b = controls[j], controls[j+1]
        value = [a[k]*(1-f)+b[k]*f for k in range(4)]
        pos, center, ry, r2 = value
        for k in range(sides):
            q = math.tau*k/sides
            y = ycenter+ry*math.cos(q)
            second = center+r2*math.sin(q)
            vertices.append((pos,y,second) if axis == 'X' else (second,y,pos))
    faces = [tuple(reversed(range(sides))),tuple((rows-1)*sides+j for j in range(sides))]
    for i in range(rows-1):
        for j in range(sides):
            n = (j+1)%sides
            faces.append((i*sides+j,i*sides+n,(i+1)*sides+n,(i+1)*sides+j))
    if axis == 'Z':
        faces = [tuple(reversed(face)) for face in faces]
    return _ri_mesh(name, vertices, faces, material, parent, collection, True)


def _ri_stitches(name, points, material, parent, collection, spacing=.008):
    vertices, faces = [], []
    p = [Vector(v) for v in points]
    distance, next_distance = 0, .002
    for a, b in zip(p,p[1:]):
        delta = b-a
        length = delta.length
        if length < 1e-8:
            continue
        direction = delta/length
        while next_distance+.003 < distance+length:
            if next_distance < distance:
                next_distance += spacing
                continue
            start = a+direction*(next_distance-distance)
            end = start+direction*.003
            ref = Vector((0,0,1)) if abs(direction.z)<.9 else Vector((0,1,0))
            u = direction.cross(ref).normalized()*.00065
            v = direction.cross(u).normalized()*.00065
            n = len(vertices)
            for center in (start,end):
                for j in range(6):
                    vertices.append(tuple(center+u*math.cos(math.tau*j/6)+v*math.sin(math.tau*j/6)))
            for j in range(6):
                faces.append((n+j,n+(j+1)%6,n+(j+1)%6+6,n+j+6))
            next_distance += spacing
        distance += length
    return _ri_mesh(name, vertices, faces, material, parent, collection, True)


def _ri_profile(name, polygon_xz, ycenter, depth, material, parent, collection, bevel=.006):
    vertices = [(x,ycenter-depth/2,z) for x,z in polygon_xz]
    vertices += [(x,ycenter+depth/2,z) for x,z in polygon_xz]
    n = len(polygon_xz)
    faces = [tuple(reversed(range(n))),tuple(n+i for i in range(n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(polygon_xz,polygon_xz[1:]+polygon_xz[:1]))
    if area > 0:
        faces = [tuple(reversed(face)) for face in faces]
    obj = _ri_mesh(name, vertices, faces, material, parent, collection)
    if bevel:
        mod = obj.modifiers.new('Soft moulded profile edges','BEVEL')
        mod.width = min(bevel, depth*.44)
        mod.segments = 3
        obj.modifiers.new('Weighted profile normals','WEIGHTED_NORMAL')
    return obj


def _ri_frame_profile(name, outer, inner, ycenter, depth, material, parent, collection):
    """Moulded door surround with a real recessed/open centre, not a round bar."""
    n=len(outer)
    if n!=len(inner): raise ValueError('Frame loops must have matching vertex counts')
    vertices=[]
    for y in (ycenter-depth/2,ycenter+depth/2):
        vertices += [(x,y,z) for x,z in outer]+[(x,y,z) for x,z in inner]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        faces += [(i,j,n+j,n+i),(2*n+j,2*n+i,3*n+i,3*n+j),
                  (j,i,2*n+i,2*n+j),(n+i,n+j,3*n+j,3*n+i)]
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outer,outer[1:]+outer[:1]))
    if area<0: faces=[tuple(reversed(face)) for face in faces]
    obj=_ri_mesh(name,vertices,faces,material,parent,collection)
    mod=obj.modifiers.new('Moulded surround edge radius','BEVEL')
    mod.width=.004
    mod.segments=3
    obj.modifiers.new('Surround weighted normals','WEIGHTED_NORMAL')
    return obj


def _ri_text(name, text, location, size, material, parent, collection, facing_front=False):
    data = bpy.data.curves.new(RI_PREFIX+name,'FONT')
    data.body = text
    data.size = size
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    data.extrude = .00003
    data.resolution_u = 3
    obj = bpy.data.objects.new(RI_PREFIX+name,data)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    basis = Matrix(((0,0,1),(1,0,0),(0,1,0))) if facing_front else Matrix(((0,0,-1),(-1,0,0),(0,1,0)))
    obj.rotation_euler = basis.to_euler()
    data.materials.append(material)
    return obj


def _ri_visibility(root, visible):
    for obj in [root, *root.children_recursive]:
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def build_interior(root, trim='rocket', driver_y=.36):
    """Build detailed source-grounded cabin; return editable assemblies/anchors.

    The default preserves photographed LHD. driver_y=0 is supported as an artist
    configuration but is not asserted to be Rocket's production seating layout.
    """
    if root is None:
        raise ValueError('A roadster_root parent is required')
    if trim.lower() not in ('rocket','thrust','performance'):
        raise ValueError('trim must be rocket, thrust or performance')
    collection = bpy.data.collections.new('Roadster2026 | Editable cabin')
    bpy.context.scene.collection.children.link(collection)
    cabin = _ri_empty('interior assemblies',root,collection)
    cabin['source_url'] = RI_SOURCE_URL
    cabin['source_image'] = RI_IMAGE_URL
    cabin['visual_reference_trim'] = 'Two-seat pictured cabin; Rocket packaging inferred'
    cabin['rocket_layout_assumption'] = 'LHD retained; right seat replaced by concept pressure-vessel package'
    cabin['forward_display_location_assumption'] = 'Paired faces in photographed roof pod; function/location not confirmed'
    cabin['units'] = 'metres; +X front,+Y left,+Z up'
    mats = {
        'white': _ri_material('Ultrawhite soft upholstery',(.79,.80,.78),rough=.48,kind='leather'),
        'suede': _ri_material('Grey microsuede inserts',(.16,.17,.18),rough=.89,kind='suede'),
        'dash_suede': _ri_material('Dark charcoal dashboard microsuede',(.042,.048,.056),rough=.86,kind='suede'),
        'roof': _ri_material('Charcoal microsuede headliner',(.025,.029,.034),rough=.94,kind='suede'),
        'rubber': _ri_material('Soft black switch and grip rubber',(.009,.012,.016),rough=.62,kind='rubber'),
        'carbon': _ri_material('Clearcoat woven carbon',(.022,.027,.03),metal=.18,rough=.29,kind='carbon'),
        'titanium': _ri_material('Satin titanium accents',(.42,.45,.47),metal=.88,rough=.27),
        'dark': _ri_material('Satin black structure',(.014,.018,.023),metal=.28,rough=.35),
        'thread': _ri_material('Light grey upholstery thread',(.47,.49,.48),rough=.8),
        'red': _ri_material('Door ambient red diffuser',(.58,.003,.004),rough=.25,emission=1.3),
        'glass': _ri_material('Display optically bonded glass',(.003,.006,.009),metal=.08,rough=.16,emission=.13),
        'ui': _ri_material('Display subdued pale graphics',(.32,.39,.44),rough=.45,emission=.6),
        'ui_red': _ri_material('Display restrained red graphics',(.48,.014,.008),rough=.45,emission=.7),
    }
    white, suede, carbon = mats['white'],mats['suede'],mats['carbon']
    dark, rubber, titanium = mats['dark'],mats['rubber'],mats['titanium']
    floor = _ri_empty('Carbon tub and footwells',cabin,collection)
    _ri_box('Tub floor',(-.02,0,.205),(2.12,1.45,.035),carbon,floor,collection,.012)
    for side in (-1,1):
        _ri_profile('Rising sill inner '+str(side),[(-.96,.22),(.80,.22),(.91,.36),(-.90,.38)],
                    side*.707,.065,carbon,floor,collection,.012)
        _ri_box('Heel pad '+str(side),(.66,side*.36,.231),(.62,.37,.012),rubber,floor,collection,.014)
        for j in range(9):
            _ri_box('Heel pad rib '+str((side,j)),(.42+j*.054,side*.36,.239),(.012,.30,.006),dark,floor,collection,.002)
    _ri_profile('Rear cabin low bulkhead',[(-.99,.23),(-.81,.23),(-.92,.51),(-1.04,.53)],0,1.38,carbon,floor,collection,.009)

    def seat(label, yc):
        group = _ri_empty(label+' seat editable set',cabin,collection,(0,yc,0))
        group['configuration'] = 'Fixed sculpted bucket; controls and belt stowed outside driver clearance'
        _ri_loft(label+' carbon bucket shell',[(.245,-.47,.22,.018),(.36,-.51,.28,.035),(.60,-.63,.27,.038),(.79,-.71,.20,.035),(.87,-.74,.15,.025)],
                 'Z',0,carbon,group,collection,40,48)
        _ri_loft(label+' grey back perimeter',[(.33,-.475,.21,.028),(.49,-.55,.245,.040),(.68,-.625,.235,.040),(.83,-.70,.145,.032)],
                 'Z',0,suede,group,collection,38,56)
        back_controls=[(.34,-.443,.145,.021),(.50,-.515,.177,.027),(.68,-.588,.167,.026),(.82,-.665,.119,.022)]
        _ri_loft(label+' white back centre',back_controls,
                 'Z',0,white,group,collection,42,64)
        _ri_loft(label+' cushion grey recessed perimeter',[(-.59,.268,.20,.027),(-.45,.27,.236,.034),(-.12,.258,.23,.035),(.10,.255,.18,.028)],
                 'X',0,suede,group,collection,38,56)
        cushion_controls=[(-.57,.282,.142,.021),(-.40,.286,.176,.024),(-.10,.270,.168,.026),(.10,.268,.129,.020)]
        _ri_loft(label+' white cushion centre',cushion_controls,
                 'X',0,white,group,collection,42,64)
        def upholstery_edge(controls,axis,side):
            path=[]
            for j in range(45):
                coordinate=controls[0][0]+(controls[-1][0]-controls[0][0])*j/44
                a,b=next((a,b) for a,b in zip(controls,controls[1:]) if a[0]-1e-9<=coordinate<=b[0]+1e-9)
                f=(coordinate-a[0])/(b[0]-a[0])
                center,ry,r2=[a[k]*(1-f)+b[k]*f for k in (1,2,3)]
                y=side*ry*.93
                second=center+r2*math.sqrt(1-.93**2)+.001
                path.append((coordinate,y,second) if axis=='X' else (second,y,coordinate))
            return path
        for side in (-1,1):
            _ri_loft(label+' white lower bolster '+str(side),[(-.60,.292,.040,.030),(-.43,.306,.055,.045),(-.10,.300,.052,.043),(.12,.280,.027,.027)],
                     'X',side*.238,white,group,collection,32,40)
            _ri_loft(label+' white torso bolster '+str(side),[(.32,-.43,.042,.035),(.43,-.46,.057,.068),(.62,-.55,.055,.072),(.76,-.64,.035,.038)],
                     'Z',side*.226,white,group,collection,32,40)
            cushion_seam = upholstery_edge(cushion_controls,'X',side)
            _ri_tube(label+' cushion piping '+str(side),cushion_seam,.00115,suede,group,collection,6)
            _ri_stitches(label+' cushion double stitch '+str(side),[(x,y+side*.004,z+.001) for x,y,z in cushion_seam],mats['thread'],group,collection)
            back_seam = upholstery_edge(back_controls,'Z',side)
            _ri_tube(label+' back piping '+str(side),back_seam,.00115,suede,group,collection,6)
            _ri_stitches(label+' back stitch '+str(side),[(x+.0008,y+side*.003,z) for x,y,z in back_seam],mats['thread'],group,collection)
        _ri_loft(label+' integrated white headrest',[(.79,-.695,.12,.037),(.86,-.727,.147,.049),(.95,-.755,.136,.046),(.986,-.767,.10,.023)],
                 'Z',0,white,group,collection,30,56)
        _ri_box(label+' white badge pocket rim',(-.647,0,.790),(.022,.222,.064),white,group,collection,.012)
        _ri_box(label+' carbon badge inset',(-.632,0,.790),(.010,.197,.044),carbon,group,collection,.009)
        _ri_text(label+' red RDSTR seat embroidery','RDSTR',(-.626,0,.790),.016,mats['ui_red'],group,collection,True)
        # Actual tiny cavity geometry on the white back/cushion, as shown by
        # Tesla design-film closeups. The elongated white headrest stays smooth.
        holes_v, holes_f = [], []
        for iz in range(26):
            z = .364+iz*.014
            a,b=next((a,b) for a,b in zip(back_controls,back_controls[1:]) if a[0]<=z<=b[0])
            t=(z-a[0])/(b[0]-a[0])
            cx,ry,rx=[a[k]*(1-t)+b[k]*t for k in (1,2,3)]
            for iy in range(23):
                y = (iy-11)*.011
                if abs(y)>ry*.91 or (iy//2+iz//2)%4==3: continue
                x = cx+rx*math.sqrt(max(0,1-(y/ry)**2))+.00045
                n=len(holes_v)
                for j in range(8):
                    a=math.tau*j/8
                    holes_v.append((x,y+.00072*math.cos(a),z+.00072*math.sin(a)))
                holes_v.append((x-.00025,y,z))
                holes_f.extend((n+j,n+(j+1)%8,n+8) for j in range(8))
        _ri_mesh(label+' back microperforation cavities',holes_v,holes_f,rubber,group,collection,True)
        holes_v,holes_f=[],[]
        for ix in range(24):
            x=-.53+ix*.024
            a,b=next((a,b) for a,b in zip(cushion_controls,cushion_controls[1:]) if a[0]<=x<=b[0])
            t=(x-a[0])/(b[0]-a[0])
            cz,ry,rz=[a[k]*(1-t)+b[k]*t for k in (1,2,3)]
            for iy in range(23):
                y=(iy-11)*.011
                if abs(y)>ry*.90 or (iy//2+ix//2)%4==3: continue
                z=cz+rz*math.sqrt(max(0,1-(y/ry)**2))+.00045
                n=len(holes_v)
                for j in range(8):
                    a=math.tau*j/8
                    holes_v.append((x+.00072*math.cos(a),y+.00072*math.sin(a),z))
                holes_v.append((x,y,z-.00025))
                holes_f.extend((n+j,n+(j+1)%8,n+8) for j in range(8))
        _ri_mesh(label+' cushion microperforation cavities',holes_v,holes_f,rubber,group,collection,True)
        for side in (-1,1):
            _ri_box(label+' fixed seat rail '+str(side),(-.31,side*.16,.237),(.64,.025,.025),titanium,group,collection,.004)
            for x in (-.55,-.07):
                _ri_cylinder(label+' rail socket '+str((side,x)),(x,side*.16,.249),(x,side*.16,.258),.009,dark,group,collection,12)
        outer = 1 if yc>=0 else -1
        _ri_cylinder(label+' manual adjustment knurl',(-.33,outer*.274,.265),(-.33,outer*.294,.265),.028,titanium,group,collection,40)
        for j in range(16):
            a=math.tau*j/16
            _ri_cylinder(label+' adjustment knurl rib '+str(j),(-.33+.028*math.cos(a),outer*.274,.265+.028*math.sin(a)),
                         (-.33+.028*math.cos(a),outer*.294,.265+.028*math.sin(a)),.0014,dark,group,collection,6)
        # Stowed three-point belt stays beside the empty seat, not across the
        # future occupant's chest or hip. Buckle/red release remain separate.
        strap = [(-.81,outer*.265,.89),(-.75,outer*.28,.71),(-.61,outer*.29,.47),(-.48,outer*.28,.30)]
        for a,b in zip(strap,strap[1:]):
            a,b=Vector(a),Vector(b)
            obj=_ri_box(label+' stowed woven belt',tuple((a+b)*.5),(.008,.043,(b-a).length),rubber,group,collection,.002)
            obj.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
        buckle=_ri_box(label+' inboard seatbelt buckle',(-.35,-outer*.226,.317),(.060,.034,.040),dark,group,collection,.008)
        buckle.rotation_euler[1]=-.16
        _ri_box(label+' red buckle release',(-.371,-outer*.226,.339),(.022,.025,.007),mats['ui_red'],group,collection,.003)
        return group

    driver_seat=seat('Driver',driver_y)
    passenger_seat=seat('Passenger',-.36)
    console_y=0 if abs(driver_y)>.2 else -.43
    console=_ri_empty('White centre console',cabin,collection,(0,console_y,0))
    _ri_loft('Carbon console lower saddle',[(-.87,.275,.075,.045),(-.52,.29,.115,.065),(.05,.29,.105,.055),(.42,.31,.070,.045)],
             'X',0,carbon,console,collection,36,48)
    _ri_loft('White console armrest',[(-.83,.335,.075,.044),(-.66,.355,.108,.054),(-.22,.350,.106,.050),(.08,.324,.086,.044),(.24,.31,.052,.036)],
             'X',0,white,console,collection,42,64)
    for side in (-1,1):
        seam=_ri_path([(-.78,side*.077,.365),(-.56,side*.096,.390),(-.22,side*.094,.387),(.08,side*.072,.355)],12)
        _ri_stitches('Console side stitch '+str(side),seam,mats['thread'],console,collection,.008)
    _ri_profile('Floating display long vertical support',[(.405,.32),(.495,.32),(.56,.62),(.49,.64)],0,.10,dark,console,collection,.009)
    _ri_box('Support inlaid titanium spine',(.465,0,.438),(.016,.035,.19),titanium,console,collection,.004)

    dashboard=_ri_empty('Dashboard and continuous vent',cabin,collection)
    _ri_box('Microsuede upper dash',(.66,0,.681),(.25,1.445,.082),mats['dash_suede'],dashboard,collection,.032)
    _ri_box('Carbon dash lower beam',(.656,0,.605),(.18,1.445,.086),carbon,dashboard,collection,.020)
    _ri_box('Continuous vent dark recess',(.555,0,.619),(.026,1.32,.040),rubber,dashboard,collection,.008)
    for j in range(31):
        _ri_box('Vent vertical vane '+str(j),(.541,-.63+j*.042,.619),(.020,.003,.032),dark,dashboard,collection,.001)
    for z in (.604,.633):
        _ri_tube('Vent satin lip '+str(z),[(.539,-.655,z),(.539,.655,z)],.0023,titanium,dashboard,collection,8)
    dash_seam=_ri_path([(.540,-.69,.705),(.523,-.36,.712),(.525,0,.713),(.523,.36,.712),(.540,.69,.705)],12)
    _ri_stitches('Dashboard restrained stitch seam',dash_seam,mats['thread'],dashboard,collection,.009)

    display=_ri_empty('Central touchscreen floating assembly',console,collection,(.494,0,.718))
    display.rotation_euler[1]=.12
    _ri_box('Touchscreen bonded black bezel',(0,0,0),(.018,.352,.238),dark,display,collection,.014)
    _ri_box('Touchscreen active glass',(-.010,0,0),(.002,.334,.220),mats['glass'],display,collection,.011)
    # Subtle physically modelled UI layers and the pictured vehicle silhouette.
    car=[(-.12,-.012),(-.102,.002),(-.075,.010),(-.044,.039),(.016,.047),(.071,.024),(.113,.014),(.122,-.005),(.094,-.011)]
    _ri_tube('Screen roadster silhouette',[(-.0115,-y,z+.016) for y,z in car],.0010,mats['ui'],display,collection,6)
    for y in (-.076,.076):
        ring=[(-.0117,y+.016*math.cos(t),.003+.016*math.sin(t)) for t in [math.tau*j/32 for j in range(33)]]
        _ri_tube('Screen car wheel '+str(y),ring,.0010,mats['ui'],display,collection,6)
    _ri_text('Screen title','ROADSTER',(-.0118,.070,.084),.008,mats['ui_red'],display,collection)
    for j in range(8):
        _ri_box('Screen footer control '+str(j),(-.0119,-.139+j*.039,-.085),(.0008,.015,.004),mats['ui_red'] if j==0 else mats['ui'],display,collection,.001)

    yoke=_ri_empty('Steer by wire closed loop yoke',cabin,collection,(.353,driver_y,.635))
    loop=[]
    for j in range(129):
        t=math.tau*j/128
        y=.158*math.copysign(abs(math.cos(t))**.48,math.cos(t))
        z=.105*math.copysign(abs(math.sin(t))**.58,math.sin(t))
        loop.append((-.008,y,z))
    _ri_tube('Yoke thick squared oval grip',loop,.022,rubber,yoke,collection,16)
    _ri_tube('Yoke white outer face',[(-.027,y,z) for _,y,z in loop],.0105,white,yoke,collection,12)
    _ri_tube('Yoke satin outer perimeter',[(-.036,y,z) for _,y,z in loop],.0023,titanium,yoke,collection,8)
    for side in (-1,1):
        _ri_tube('Yoke inner grip seam '+str(side),_ri_path([(-.029,side*.14,-.066),(-.031,side*.144,0),(-.029,side*.14,.068)],12),.0011,mats['thread'],yoke,collection,6)
        _ri_profile('Yoke titanium spoke '+str(side),[(-.01,-.016),(.04,-.016),(.04,.028),(-.015,.043)],side*.094,.079,titanium,yoke,collection,.008)
        _ri_box('Yoke switch pod '+str(side),(-.041,side*.104,.034),(.018,.050,.027),dark,yoke,collection,.008)
        _ri_cylinder('Yoke thumb scroll '+str(side),(-.052,side*.104-.012,.034),(-.052,side*.104+.012,.034),.008,titanium,yoke,collection,24)
        for j in range(7):
            _ri_cylinder('Yoke scroll knurl '+str((side,j)),(-.059,side*.104-.010+j*.0033,.034),(-.060,side*.104-.010+j*.0033,.034),.0014,dark,yoke,collection,6)
        rear_triangle=[(.042,side*.048,.052),(.055,side*.148,.086),(.059,side*.104,.022),(.042,side*.048,.052)]
        _ri_tube('Yoke rear titanium triangular paddle '+str(side),rear_triangle,.0048,titanium,yoke,collection,10)
        _ri_box('Yoke lower rear carbon paddle '+str(side),(.054,side*.107,-.042),(.012,.061,.072),carbon,yoke,collection,.008)
    # Rounded, broad upper airbag with tapered lower corners, not the older
    # open-topped Model S yoke or a circular steering-wheel placeholder.
    airbag=_ri_profile('Yoke softly faceted central airbag',[(-.052,-.070),(-.066,.025),(-.038,.068),(.039,.065),(.064,.022),(.046,-.070)],0,.14,rubber,yoke,collection,.021)
    airbag.rotation_euler[2]=math.pi/2
    _ri_box('Yoke centre face',(-.060,0,-.002),(.018,.136,.118),rubber,yoke,collection,.023)
    crest=[(-.0705,-.010,.016),(-.0705,-.013,.008),(-.0705,-.006,-.013),(-.0705,0,-.019),(-.0705,.006,-.013),(-.0705,.013,.008),(-.0705,.010,.016),(-.0705,-.010,.016)]
    _ri_tube('Yoke subtle elongated shield emblem',crest,.0007,dark,yoke,collection,6)
    _ri_tube('Yoke emblem vertical inlay',[(-.071,0,.012),(-.071,0,-.012)],.00065,dark,yoke,collection,6)
    _ri_cylinder('Steering column',(.02,0,0),(.23,0,.026),.040,dark,yoke,collection,40)
    _ri_cylinder('Steering titanium collar',(.024,0,.001),(.043,0,.004),.047,titanium,yoke,collection,48)

    pedals=_ri_empty('Driver pedals and foot rest',cabin,collection,(0,driver_y,0))
    for label,y,width,height in [('brake',.063,.075,.125),('accelerator',-.070,.047,.16)]:
        pedal=_ri_empty(label+' pedal',pedals,collection,(1.001,y,.222))
        pedal.rotation_euler[1]=-.24
        _ri_box(label+' titanium face',(0,0,0),(.017,width,height),titanium,pedal,collection,.010)
        for j in range(7):
            _ri_box(label+' grip groove '+str(j),(-.009,0,-height*.36+j*height*.12),(.004,width*.76,.004),rubber,pedal,collection,.001)
        _ri_cylinder(label+' pivot',(0,-width*.65,height*.49),(0,width*.65,height*.49),.011,dark,pedal,collection,24)
    _ri_box('Driver left foot rest',(.91,.19,.239),(.23,.09,.018),carbon,pedals,collection,.008)
    dead_pedal=_ri_empty('Driver titanium dead pedal',pedals,collection,(.985,.197,.218))
    dead_pedal.rotation_euler[1]=-.24
    _ri_box('Dead pedal titanium face',(0,0,0),(.017,.078,.17),titanium,dead_pedal,collection,.008)
    for j in range(8):
        _ri_box('Dead pedal grip groove '+str(j),(-.009,0,-.064+j*.018),(.004,.061,.004),rubber,dead_pedal,collection,.001)

    headliner=_ri_empty('Microsuede headliner removable panel trim',cabin,collection)
    roof_inserts=_ri_empty('Removable roof inner visor inserts',headliner,collection)
    for side in (-1,1):
        _ri_tube('A pillar soft inner trim '+str(side),_ri_path([(.91,side*.715,.675),(.54,side*.679,.823),(.18,side*.635,.970),(-.065,side*.589,1.043)],16),.023,mats['roof'],headliner,collection,12)
        _ri_tube('Roof side soft rail '+str(side),_ri_path([(-.86,side*.58,.998),(-.56,side*.601,1.030),(-.12,side*.599,1.045),(-.05,side*.59,1.043)],12),.022,mats['roof'],headliner,collection,12)
        _ri_box('Folded suede sun visor '+str(side),(-.18,side*.30,1.026),(.22,.40,.018),mats['roof'],roof_inserts,collection,.014)
        _ri_tube('Visor stitched border '+str(side),[(-.286,side*.30-.18,1.015),(-.286,side*.30+.18,1.015)],.0009,mats['thread'],roof_inserts,collection,6)
    _ri_box('Roof forward cross trim',(-.048,0,1.043),(.052,1.14,.027),mats['roof'],headliner,collection,.012)
    forward=_ri_empty('Photographed angular roof pod',cabin,collection,(.055,0,.988))
    forward['screen_function_inferred']=True
    _ri_box('Roof pod bridge',(0,0,0),(.052,.218,.045),dark,forward,collection,.006)
    _ri_cylinder('Roof pod narrow hanger',(-.08,0,.048),(.005,0,.022),.009,titanium,forward,collection,20)
    screens=[]
    for side in (-1,1):
        pod=_ri_empty('Forward display '+('left' if side>0 else 'right'),forward,collection,(0,side*.053,-.002))
        pod.rotation_euler[2]=side*.09
        _ri_box('Forward pod glass '+str(side),(-.028,0,0),(.003,.095,.032),mats['glass'],pod,collection,.003)
        screens.append(pod)

    door_cards={}
    for side,label in [(1,'left'),(-1,'right')]:
        pivot=(.78,side*.83,.58)
        card=_ri_empty(label+' door card pivot attach',cabin,collection,pivot)
        card['attach_to']='door_'+label
        card['attach_reset_matrix_basis']=True
        # Author in vehicle coordinates, then move mesh vertices into exactly
        # matching pivot-local space. Door cards stay inside the exterior glass.
        card_geo=_ri_empty(label+' card vehicle-coordinate geometry',card,collection,tuple(-v for v in pivot))
        outer_shape=[(-.88,.29),(.66,.30),(.72,.49),(.68,.642),(-.83,.653)]
        _ri_profile(label+' door moulded carbon backing',outer_shape,side*.781,.036,carbon,card_geo,collection,.009)
        _ri_profile(label+' door suede inset',[(-.81,.34),(.58,.34),(.65,.54),(.57,.59),(-.77,.59)],side*.757,.016,mats['roof'],card_geo,collection,.015)
        _ri_box(label+' carbon upper door cap',(-.05,side*.768,.621),(1.43,.065,.059),carbon,card_geo,collection,.017)
        _ri_box(label+' soft upper door rail',(-.04,side*.747,.655),(1.44,.032,.021),suede,card_geo,collection,.010)
        handle_path=_ri_path([(-.76,side*.735,.332),(-.17,side*.733,.442),(.31,side*.732,.530),(.50,side*.734,.515),(.56,side*.735,.465),(.37,side*.734,.417),(-.73,side*.735,.286)],10)
        _ri_frame_profile(label+' moulded microsuede armrest surround',
                          [(-.80,.33),(-.14,.45),(.30,.55),(.50,.54),(.61,.46),(-.72,.27)],
                          [(-.64,.340),(-.07,.452),(.29,.515),(.46,.496),(.47,.462),(-.60,.310)],
                          side*.734,.028,suede,card_geo,collection)
        _ri_tube(label+' red ambient diffuser',[(x,y-side*.020,z-.012) for x,y,z in handle_path],.0034,mats['red'],card_geo,collection,8)
        _ri_stitches(label+' armrest stitch',[(x,y-side*.022,z+.010) for x,y,z in handle_path],mats['thread'],card_geo,collection,.009)
        _ri_tube(label+' floating door pull',_ri_path([(.20,side*.716,.469),(.33,side*.704,.489),(.46,side*.716,.480)],12),.012,carbon,card_geo,collection,12)
        _ri_box(label+' window switch recess',(.11,side*.72,.538),(.115,.035,.012),dark,card_geo,collection,.007)
        for j in range(2):
            _ri_box(label+' titanium window rocker '+str(j),(.077+j*.050,side*.717,.546),(.035,.022,.008),titanium,card_geo,collection,.003)
        _ri_box(label+' lower map pocket lip',(-.23,side*.741,.306),(.90,.028,.050),carbon,card_geo,collection,.014)
        seam=_ri_path([(-.78,side*.732,.646),(-.30,side*.730,.652),(.25,side*.730,.650),(.62,side*.735,.634)],12)
        _ri_stitches(label+' upper rail stitch',seam,mats['thread'],card_geo,collection,.009)
        door_cards[label]=card

    rear_copv=_ri_empty('Source-visible transverse rear carbon COPV',cabin,collection,(-1.27,0,.70))
    rear_copv['source']='Tesla design film / current two-seat cabin image; proportions artist-estimated'
    vessel=_ri_loft('Rear transverse COPV shell',[(-.52,0,.018,.018),(-.49,0,.105,.105),(-.43,0,.16,.16),(.43,0,.16,.16),(.49,0,.105,.105),(.52,0,.018,.018)],
                    'X',0,carbon,rear_copv,collection,44,48)
    vessel.rotation_euler[2]=math.pi/2
    for side in (-1,1):
        _ri_cylinder('Rear COPV end neck '+str(side),(0,side*.515,0),(0,side*.552,0),.027,titanium,rear_copv,collection,32)
        _ri_cylinder('Rear COPV protected valve '+str(side),(0,side*.550,0),(0,side*.578,0),.019,dark,rear_copv,collection,12)
        band=[(.166*math.cos(t),side*.31,.166*math.sin(t)) for t in [math.tau*j/64 for j in range(65)]]
        _ri_tube('Rear COPV titanium retaining strap '+str(side),band,.006,titanium,rear_copv,collection,8)
        _ri_box('Rear COPV cradle '+str(side),(0,side*.31,-.177),(.21,.058,.032),dark,rear_copv,collection,.007)
    _ri_tube('Rear COPV visible protected manifold',_ri_path([(0,.577,0),(.08,.57,-.06),(.10,.45,-.18),(.09,.19,-.22)],12),.007,rubber,rear_copv,collection,10)

    rocket_pack=_ri_empty('INFERRED Rocket right-bay pressure package',cabin,collection)
    rocket_pack['assumption']='Artist packaging only. Tesla confirms one seat, not these cabin tank positions.'
    for yc in (-.23,-.49):
        _ri_loft('Inferred carbon pressure vessel '+str(yc),[(-.80,.415,.018,.018),(-.76,.415,.087,.087),(-.67,.415,.103,.103),(-.06,.415,.103,.103),(.035,.415,.087,.087),(.075,.415,.018,.018)],
                 'X',yc,carbon,rocket_pack,collection,44,56)
        for x in (-.58,-.20):
            ring=[(x,yc+.109*math.cos(t),.415+.109*math.sin(t)) for t in [math.tau*j/64 for j in range(65)]]
            _ri_tube('Vessel titanium restraint '+str((yc,x)),ring,.007,titanium,rocket_pack,collection,10)
            _ri_box('Pressure vessel saddle '+str((yc,x)),(x,yc,.291),(.075,.21,.032),dark,rocket_pack,collection,.006)
        _ri_cylinder('Vessel valve boss '+str(yc),(.071,yc,.415),(.117,yc,.415),.027,titanium,rocket_pack,collection,32)
        _ri_cylinder('Vessel valve block '+str(yc),(.116,yc,.415),(.145,yc,.415),.019,dark,rocket_pack,collection,12)
        hose=_ri_path([(.136,yc,.415),(.17,yc,.360),(-.05,yc-.04,.267),(-.79,yc-.04,.267),(-.92,yc,.36)],14)
        _ri_tube('Inferred protected supply line '+str(yc),hose,.008,rubber,rocket_pack,collection,10)
    _ri_box('Inferred vessel guard plate',(-.34,-.36,.247),(.99,.57,.025),carbon,rocket_pack,collection,.015)

    driver_eye=_ri_empty('Driver eye anchor',cabin,collection,(-.68,driver_y,.88))
    passenger_eye=_ri_empty('Passenger eye anchor',cabin,collection,(-.68,-.36,.88))
    driver_hip=_ri_empty('Driver hip anchor',cabin,collection,(-.36,driver_y,.315))
    clearance=_ri_empty('Future driver clear-space reference',cabin,collection,(-.30,driver_y,.56))
    clearance.empty_display_type='CUBE'
    clearance.empty_display_size=.22
    clearance['note']='No people/rig. Stowed belts leave head, torso, legs and pedal reach unoccupied.'

    def configure_trim(selected):
        selected=selected.lower()
        if selected not in ('rocket','thrust','performance'):
            raise ValueError('Unknown Roadster trim')
        _ri_visibility(passenger_seat,selected!='rocket')
        _ri_visibility(rocket_pack,selected=='rocket')
        cabin['active_trim']=selected
        cabin['active_seats']=1 if selected=='rocket' else 2
        return selected

    configure_trim(trim)
    objects=[cabin,*cabin.children_recursive]
    return {'cabin_root':cabin,'driver_seat':driver_seat,'passenger_seat':passenger_seat,
            'seats':[driver_seat,passenger_seat],'dashboard':dashboard,'yoke':yoke,
            'center_display':display,'forward_displays':screens,'console':console,
            'headliner':headliner,'door_cards':door_cards,'driver_eye':driver_eye,
            'passenger_eye':passenger_eye,'driver_hip':driver_hip,'materials':mats,
            'objects':objects,'collection':collection,'rocket_pack':rocket_pack,
            'roof_inserts':roof_inserts,'rear_copv':rear_copv,'configure_trim':configure_trim}
