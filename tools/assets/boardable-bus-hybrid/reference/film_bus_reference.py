"""Detailed New Flyer-inspired Vancouver TransLink low-floor bus, +X forward.
Exterior proportions and livery checked against the supplied reference and
Kevin Lo TransLink photographs (kevinsbusrail.com). No external image assets.
"""
import bpy
import math
from mathutils import Matrix


def build_bus():
    root = bpy.data.objects.new('BusRoot', None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = 'CUBE'
    root.empty_display_size = 0.35

    def mat(name, color, metal=0.0, rough=0.4, emission=0.0):
        material = bpy.data.materials.get(name)
        if material:
            return material
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        bs = material.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Metallic'].default_value = metal
        bs.inputs['Roughness'].default_value = rough
        if emission:
            bs.inputs['Emission Color'].default_value = (*color, 1)
            bs.inputs['Emission Strength'].default_value = emission
        return material

    silver = mat('Bus brushed silver', (0.55, 0.60, 0.65), 0.57, .28)
    light_silver = mat('Bus light aluminum', (.64, .68, .70), .65, .26)
    blue = mat('Bus TransLink navy', (.006, .043, .19), .29, .27)
    yellow = mat('Bus TransLink yellow', (1.0, .67, .015), .25, .29)
    black = mat('Bus black trim', (.009, .012, .016), .12, .48)
    under = mat('Bus undercarriage', (.025, .030, .034), .62, .50)
    rubber = mat('Bus rubber', (.018, .021, .024), .0, .72)
    rim = mat('Bus wheel polished alloy', (.58, .63, .66), .86, .22)
    white = mat('Bus lettering white', (.87, .9, .92), .12, .35)
    glass = mat('Bus dark reflective glazing', (.012, .026, .042), .65, .18)
    head = mat('Bus LED white', (.80, .91, 1.0), .1, .25, 6)
    red = mat('Bus LED red', (1.0, .012, .006), .1, .28, 4)
    amber = mat('Bus LED amber', (1.0, .28, .008), .1, .35, 3)
    destination = mat('Bus destination amber', (1.0, .38, .015), .05, .4, 1.7)
    nozzle = mat('Bus thruster dark titanium', (.075, .090, .11), .88, .30)

    # Real tinted glazing, with a lit physical cabin visible through it.
    glass.surface_render_method = 'BLENDED'
    glass.use_transparent_shadow = True
    glass_bs = glass.node_tree.nodes.get('Principled BSDF')
    glass_bs.inputs['Alpha'].default_value = .24
    glass_bs.inputs['Metallic'].default_value = .25
    glass_bs.inputs['Roughness'].default_value = .16
    glass_bs.inputs['Base Color'].default_value = (.035, .085, .11, 1)
    glass_bs.inputs['Coat Weight'].default_value = .6
    glass_bs.inputs['Coat Roughness'].default_value = .12
    glass_bs.inputs['IOR'].default_value = 1.46
    # Fine tread bump reads as worn rubber rather than a perfect CG torus.
    nt = rubber.node_tree
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 95
    noise.inputs['Detail'].default_value = 2
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .23
    bump.inputs['Distance'].default_value = .008
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], nt.nodes.get('Principled BSDF').inputs['Normal'])
    upholstery=mat('Bus blue speckled transit upholstery',(.032,.13,.28),.02,.83)
    cabin_plastic=mat('Bus interior warm grey',(.48,.52,.52),.05,.5)
    floor_mat=mat('Bus nonslip black floor',(.065,.075,.078),.05,.86)
    pole_yellow=mat('Bus yellow interior handrails',(1,.57,.008),.43,.3)
    cabin_light=mat('Bus warm fluorescent strips',(.84,.91,1),.0,.3,2.0)
    red_upholstery=mat('Bus priority seat fabric',(.28,.026,.045),.01,.85)
    nf_badge=mat('Bus manufacturer medallion',(.30,.36,.39),.9,.2)
    def parent(obj, par=None):
        obj.parent = par or root
        return obj

    def finish(obj, name, material, bevel=0, par=None):
        obj.name = name
        if material:
            obj.data.materials.append(material)
        parent(obj, par)
        if bevel:
            modifier = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
            modifier.width = bevel
            modifier.segments = 3
            modifier.affect = 'EDGES'
            norm = obj.modifiers.new('Panel normals', 'WEIGHTED_NORMAL')
            norm.keep_sharp = True
        return obj

    def box(name, loc, size, material, bevel=.025, par=None):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return finish(obj, name, material, bevel, par)

    def mesh(name, verts, faces, material, bevel=0, par=None):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return finish(obj, name, material, bevel, par)

    def cylinder(name, loc, radius, depth, material, axis='Z', par=None):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth, location=loc)
        obj = bpy.context.object
        if axis == 'Y':
            obj.rotation_euler[0] = math.pi / 2
        elif axis == 'X':
            obj.rotation_euler[1] = math.pi / 2
        for p in obj.data.polygons:
            p.use_smooth = len(p.vertices) == 4
        return finish(obj, name, material, .009, par)

    def torus(name, loc, major, minor, material, par=None, axis='Y'):
        bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=12,
                                       location=loc, major_radius=major, minor_radius=minor)
        obj = bpy.context.object
        if axis == 'Y':
            obj.rotation_euler[0] = math.pi/2
        elif axis == 'X':
            obj.rotation_euler[1] = math.pi/2
        for p in obj.data.polygons:
            p.use_smooth = True
        return finish(obj, name, material, 0, par)

    def curve(name, points, width, material):
        data = bpy.data.curves.new(name, 'CURVE')
        data.dimensions = '3D'
        data.resolution_u = 12
        data.bevel_depth = width
        data.bevel_resolution = 3
        spline = data.splines.new('POLY')
        spline.points.add(len(points)-1)
        for v, point in zip(spline.points, points):
            v.co = (*point, 1)
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return finish(obj, name, material)

    def text(name, body, loc, size, material, side='near', align='CENTER'):
        data = bpy.data.curves.new(name, 'FONT')
        data.body = body
        data.align_x = align
        data.align_y = 'CENTER'
        data.size = size
        # Built-in Bfont keeps this editable reference font-independent.
        data.extrude = .0008
        data.resolution_u = 3
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        if side == 'near':
            # Baseline +X, upright +Z, surface normal -Y.
            basis = Matrix(((1,0,0),(0,0,-1),(0,1,0)))
        elif side == 'far':
            basis = Matrix(((-1,0,0),(0,0,1),(0,1,0)))
        elif side == 'front':
            basis = Matrix(((0,0,1),(1,0,0),(0,1,0)))
        else:
            basis = Matrix(((0,0,-1),(-1,0,0),(0,1,0)))
        obj.rotation_euler = basis.to_euler()
        return finish(obj, name, material)

    def batched_boxes(name, specs, material, bevel=.01):
        vertices, faces = [], []
        for loc, size in specs:
            n = len(vertices)
            x,y,z=loc
            a,b,c=[v/2 for v in size]
            vertices.extend([(x-a,y-b,z-c),(x-a,y-b,z+c),(x-a,y+b,z-c),(x-a,y+b,z+c),
                             (x+a,y-b,z-c),(x+a,y-b,z+c),(x+a,y+b,z-c),(x+a,y+b,z+c)])
            faces.extend([tuple(n+i for i in f) for f in [(0,4,6,2),(1,3,7,5),(0,1,5,4),
                                                               (2,6,7,3),(0,2,3,1),(4,5,7,6)]])
        return mesh(name, vertices, faces, material, bevel)

    def rounded_rect(cx,cz,w,h,r,segments=5):
        result=[]
        for xx,zz,a0 in [(cx+w/2-r,cz+h/2-r,0),(cx-w/2+r,cz+h/2-r,90),
                          (cx-w/2+r,cz-h/2+r,180),(cx+w/2-r,cz-h/2+r,270)]:
            for j in range(segments+1):
                a=math.radians(a0+j*90/segments)
                result.append((xx+r*math.cos(a),zz+r*math.sin(a)))
        return result

    def panel(name, points, side, material, thick=.016):
        # A surface on the bus side; X,Z points are given in vehicle coordinates.
        verts=[(x,side*1.281,z) for x,z in points]
        obj=mesh(name,verts,[tuple(range(len(verts)))],material)
        if thick:
            mod=obj.modifiers.new('Sheet thickness','SOLIDIFY'); mod.thickness=thick
        return obj

    def window(name,cx,cz,w,h,side,r=.055,frame=.048):
        outside=rounded_rect(cx,cz,w,h,r)
        inside=rounded_rect(cx,cz,w-frame*2,h-frame*2,max(.012,r-frame*.6))
        n=len(outside)
        verts=[(x,side*1.292,z) for x,z in outside]+[(x,side*1.302,z) for x,z in inside]
        faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        gasket=mesh(name+' rounded black gasket',verts,faces,black)
        solid=gasket.modifiers.new('Rubber gasket thickness','SOLIDIFY'); solid.thickness=.035
        mesh(name+' actual tinted glass',[(x,side*1.299,z) for x,z in inside],[tuple(range(n))],glass)
        return gasket

    def beam(name,a,b,r,material):
        from mathutils import Vector
        a,b=Vector(a),Vector(b)
        obj=cylinder(name,(a+b)*.5,r,(b-a).length,material)
        obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
        return obj

    def rounded_body_ring(xmin,xmax,ymax,r,z):
        points=[]
        for x,y,a0 in [(xmax-r,ymax-r,0),(xmin+r,ymax-r,90),
                       (xmin+r,-ymax+r,180),(xmax-r,-ymax+r,270)]:
            for j in range(7):
                a=math.radians(a0+j*90/6)
                points.append((x+r*math.cos(a),y+r*math.sin(a),z))
        return points

    def body_loft(name,rings,material,cap=True):
        verts=[v for ring in rings for v in ring]; n=len(rings[0]); faces=[]
        for k in range(len(rings)-1):
            for j in range(n):
                faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
        if cap:
            faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+j for j in range(n))])
        obj=mesh(name,verts,faces,material)
        for p in obj.data.polygons: p.use_smooth=len(p.vertices)==4
        norm=obj.modifiers.new('Weighted manufactured normals','WEIGHTED_NORMAL'); norm.keep_sharp=True
        return obj

    # A real hollow bus body: the window band is open, showing the modeled cabin.
    body_loft('Rounded silver roof monocoque',[
        rounded_body_ring(-6.03,5.93,1.268,.23,2.97),
        rounded_body_ring(-6.04,5.90,1.266,.24,3.105),
        rounded_body_ring(-5.96,5.83,1.19,.25,3.225),
        rounded_body_ring(-5.88,5.75,1.12,.26,3.255)],silver)
    box('Interior ceiling',(-.05,0,2.969),(11.78,2.36,.055),cabin_plastic,.07)
    box('Low floor platform',(.9,0,.68),(10.2,2.32,.14),floor_mat,.02)
    box('Raised rear seating platform',(-4.82,0,.91),(2.37,2.32,.32),floor_mat,.03)
    box('Underframe center chassis',(-.1,0,.47),(10.75,1.66,.22),under,.04)
    for x in [-3.7,3.5]:
        cylinder('Axle beam',(x,0,.53),.105,2.18,under,'Y')
        box('Suspension transverse member',(x,0,.56),(.43,1.96,.23),under,.03)
    for y in [-.69,.69]:
        box('Longitudinal chassis rail',(-.05,y,.43),(10.9,.13,.19),under,.022)

    # Lower aluminum panels have actual tire clearance; navy belt remains broad.
    profile=[(-6.03,.52)]
    for center in [-3.7,3.5]:
        profile.append((center-.645,.52))
        for k in range(25):
            a=math.pi-k*math.pi/24
            profile.append((center+.645*math.cos(a),.53+.645*math.sin(a)))
        profile.append((center+.645,.52))
    profile.append((6.00,.52))
    for side in [-1,1]:
        verts=[]; faces=[]
        for x,z in profile:
            verts.extend([(x,side*1.264,z),(x,side*1.264,1.245),
                          (x,side*1.211,z),(x,side*1.211,1.245)])
        for j in range(len(profile)-1):
            a,b=j*4,(j+1)*4
            faces.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),
                          (a+1,b+1,b+3,a+3)])
        mesh('Silver wheel arch body panels '+str(side),verts,faces,silver,.009)
        # Broad midbody blue paint is deliberately visible well below the windows.
        box('Solid navy TransLink midbody '+str(side),(-.04,side*1.263,1.48),(11.94,.055,.49),blue,.015)
        box('Navy upper window sill '+str(side),(-.05,side*1.26,1.753),(11.93,.065,.08),blue,.008)
        box('Yellow continuous waist stripe '+str(side),(-.05,side*1.302,1.757),(11.91,.018,.071),yellow,.004)
        box('Black upper window cap '+str(side),(-.05,side*1.269,2.927),(11.91,.065,.09),black,.018)
        box('Silver roofline drip rail '+str(side),(-.05,side*1.292,3.009),(11.91,.035,.04),light_silver,.009)
        for center in [-3.7,3.5]:
            curve('Raised wheel arch edge',[(center+.657*math.cos(math.pi-k*math.pi/30),side*1.293,
                  .53+.657*math.sin(math.pi-k*math.pi/30)) for k in range(31)],.027,black)
        # Strong yellow angular rear shoulder, characteristic of the supplied livery.
        panel('Navy rear shoulder '+str(side),[(-6.015,1.77),(-5.54,1.77),(-5.54,2.92),(-6.015,2.92)],side,blue)
        panel('Yellow rear shoulder sweep '+str(side),[(-6.015,2.94),(-5.82,2.94),(-4.66,2.63),
              (-4.66,2.51),(-5.81,2.77),(-6.015,2.80)],side,yellow,.022)
        # Low blue sweep intersects the silver panel forward of the front wheel.
        panel('Blue front lower livery swoop '+str(side),[(2.82,1.248),(5.95,1.248),(5.95,.60),
              (4.41,.60),(4.02,.93),(3.72,1.08)],side,blue)

    # Window bays, narrow metal pillars, and top sliding ventilators.
    near_bays=[(-5.06,1.05),(-3.84,1.20),(-2.43,1.44),(.17,1.17),(1.51,1.34),(2.91,1.30),(5.64,.55)]
    far_bays=[(-5.06,1.05),(-3.83,1.21),(-2.43,1.44),(-.86,1.58),(.80,1.59),
              (2.40,1.49),(3.85,1.35),(5.15,1.14)]
    for side,bays in [(-1,near_bays),(1,far_bays)]:
        for i,(x,w) in enumerate(bays):
            window('Passenger window %d %02d'%(side,i),x,2.35,w,1.12,side)
        batched_boxes('Opening window mullions '+str(side),[((x,side*1.319,2.596),(w-.10,.024,.027))
                      for x,w in bays],black,.004)
        batched_boxes('Window aluminium mullions '+str(side),[((x+w/2+.025,side*1.265,2.35),(.055,.06,1.17))
                      for x,w in bays],silver,.006)
        # Upper window TransLink wordmark as seen on the reference bus.
        text('TransLink window wordmark '+str(side),'TransLink',(4.01 if side<0 else -4.94,side*1.332,2.765),
             .19,white,'near' if side<0 else 'far')

    # Twin curbside passenger doors, open glazing, rubber seals, yellow grab bars.
    for center,label in [(4.66,'Front entrance'),(-1.02,'Rear exit')]:
        # Outer door casing comprises strips, leaving the glazed opening unobstructed.
        batched_boxes(label+' silver door portal',[
            ((center-.62,-1.284,1.73),(.09,.09,2.38)),((center+.62,-1.284,1.73),(.09,.09,2.38)),
            ((center,-1.284,2.898),(1.27,.09,.08)),((center,-1.294,.57),(1.27,.10,.09))],silver,.014)
        for j,offset in enumerate([-.295,.295]):
            window(label+' glazed leaf '+str(j),center+offset,1.72,.58,2.24,-1,.025,.045)
            box(label+' center yellow seal '+str(j),(center+offset+(.244 if j==0 else -.244),-1.331,1.70),
                (.018,.020,2.06),yellow,.003)
            box(label+' leaf kick panel '+str(j),(center+offset,-1.32,.79),(.49,.03,.25),blue,.008)
            curve(label+' yellow interior grab handle '+str(j),[(center+offset-.16,-1.20,1.19),
                 (center+offset-.16,-1.20,1.68),(center+offset+.12,-1.20,1.68)],.017,pole_yellow)
        box(label+' central door seal',(center,-1.333,1.71),(.044,.035,2.20),black,.004)
        box(label+' threshold step',(center,-1.27,.54),(1.24,.17,.07),under,.01)
        text(label+' EXIT decal','EXIT' if center<0 else 'ENTRANCE',(center,-1.342,2.55),.083,white,'near')
        text(label+' caution decal','STAND CLEAR',(center,-1.342,1.13),.064,yellow,'near')
        cylinder(label+' yellow request button',(center-.68,-1.322,1.98),.037,.018,yellow,'Y')

    # Sculpted New Flyer front: a raked double windshield and rounded, layered fascia.
    body_loft('Curved front silver nose',[
        rounded_body_ring(5.75,6.16,1.245,.16,.64),
        rounded_body_ring(5.75,6.205,1.258,.18,.90),
        rounded_body_ring(5.75,6.145,1.255,.19,1.38),
        rounded_body_ring(5.75,6.115,1.225,.18,1.58)],silver)
    body_loft('Front navy fascia band',[
        rounded_body_ring(5.765,6.225,1.255,.16,.80),
        rounded_body_ring(5.765,6.18,1.265,.18,1.15)],blue)
    # Near and far front corner pillars follow the windshield rake.
    for side in [-1,1]:
        panel('Front silver A pillar '+str(side),[(5.84,1.66),(6.01,1.66),(5.82,2.93),(5.67,2.93)],side,silver,.06)
    def front_x(z): return 6.115-(z-1.55)*.177
    # One continuous black perimeter, two individual see-through glass panes.
    for side in [-1,1]:
        y0,y1=(.033,1.15) if side>0 else (-1.15,-.033)
        verts=[(front_x(1.59),y0,1.59),(front_x(1.59),y1,1.59),
               (front_x(2.83),y1,2.83),(front_x(2.83),y0,2.83)]
        mesh('Front windshield actual glass '+str(side),verts,[(0,1,2,3)],glass)
        beam('Front window lower gasket',(front_x(1.58)+.01,y0,1.58),(front_x(1.58)+.01,y1,1.58),.028,black)
        beam('Front window upper gasket',(front_x(2.84)+.01,y0,2.84),(front_x(2.84)+.01,y1,2.84),.033,black)
        beam('Front window outside gasket',(front_x(1.58)+.01,y1,1.58),(front_x(2.84)+.01,y1,2.84),.034,black)
    beam('Front center vertical windshield divider',(front_x(1.57)+.02,0,1.57),
         (front_x(2.84)+.02,0,2.84),.026,black)
    # Upper destination screen is sloped to meet the front roof radius.
    box('Front black destination recess',(5.881,0,2.968),(.085,2.32,.272),black,.028)
    box('Front silver brow sunshield',(5.94,0,3.142),(.27,2.43,.095),silver,.04)
    for y in [-.53,.53]:
        curve('Windshield wiper articulated arm',[(6.144,y*.4,1.60),(6.056,y,1.94),
              (5.996,y+.12,2.30)],.013,black)
        beam('Windshield wiper blade',(6.037,y+.10,1.99),(5.949,y+.14,2.46),.018,black)
    body_loft('Thick curved front rubber bumper',[
        rounded_body_ring(5.75,6.30,1.30,.14,.49),
        rounded_body_ring(5.75,6.33,1.30,.16,.69),
        rounded_body_ring(5.75,6.26,1.28,.16,.76)],black)
    for y in [-.91,.91]:
        box('Recessed sculpted front headlamp pod',(6.201,y,1.10),(.075,.43,.30),black,.10)
        for yy in [y-.09,y+.09]:
            cylinder('Round front LED headlamp lens',(6.247,yy,1.105),.074,.028,head,'X')
            torus('Front headlamp chrome bezel',(6.266,yy,1.105),.079,.009,rim,axis='X')
        box('Front amber turn signal',(6.225,y,1.324),(.035,.25,.062),amber,.019)
    text('Front fleet number','V 7416',(6.167,-.89,1.47),.106,black,'front')
    cylinder('New Flyer manufacturer badge',(6.174,0,1.441),.060,.018,nf_badge,'X')
    text('Manufacturer emblem','N',(6.187,0,1.439),.070,white,'front')
    # Folded bus bicycle rack is a distinctive Vancouver detail.
    for y in [-.77,.77]:
        curve('Front folded bike rack outer frame',[(6.42,y,.70),(6.46,y,1.52),(6.46,y*.86,1.65)],.025,under)
    for z in [.76,1.02,1.53]:
        beam('Bicycle rack transverse bar',(6.46,-.77,z),(6.46,.77,z),.024,silver)
    for y in [-.47,.47]:
        curve('Bicycle rack folded wheel tray',[(6.49,y-.12,.79),(6.51,y-.12,1.39),
              (6.51,y+.12,1.39),(6.49,y+.12,.79)],.017,silver)
        curve('Bicycle rack yellow retaining hook',[(6.52,y,1.24),(6.54,y,1.64),
              (6.54,y-.13,1.64),(6.54,y-.13,1.54)],.021,yellow)
    box('Front license plate',(6.352,0,.60),(.022,.38,.13),white,.007)
    text('Front license numerals','BC 7416',(6.369,0,.60),.063,black,'front')
    # Rear cap, service doors, louvres and the six circular tail lamps.
    body_loft('Rounded rear silver cap',[
        rounded_body_ring(-6.15,-5.80,1.25,.15,.62),
        rounded_body_ring(-6.17,-5.80,1.26,.16,1.62),
        rounded_body_ring(-6.14,-5.80,1.25,.17,2.91)],silver)
    box('Rear engine black louvre recess',(-6.185,0,2.16),(.045,1.98,1.20),black,.045)
    batched_boxes('Rear individual metal engine louvres', [((-6.217,0,1.63+i*.082),(.038,1.91,.024))
                  for i in range(14)],under,.004)
    batched_boxes('Rear vertical grille dividers', [((-6.243,y,2.16),(.018,.021,1.15)) for y in [-.66,0,.66]],black,.003)
    box('Rear upper destination display housing',(-6.177,0,2.928),(.055,1.96,.30),black,.025)
    box('Rear service access panel',(-6.202,0,1.215),(.04,1.77,.50),silver,.024)
    box('Rear engine hatch handle',(-6.233,0,1.40),(.03,.17,.027),black,.009)
    box('Rear aluminum bumper trim',(-6.215,0,.715),(.16,2.45,.20),silver,.04)
    box('Rear rubber bumper',(-6.29,0,.55),(.21,2.52,.18),black,.045)
    for y in [-1.055,1.055]:
        box('Rear vertical lamp black bezel',(-6.202,y,1.23),(.06,.185,1.09),black,.075)
        for z,material in [(.83,red),(1.105,amber),(1.38,red),(1.65,red)]:
            cylinder('Rear circular tail lamp',(-6.245,y,z),.069,.024,material,'X')
            torus('Rear circular chrome lamp rim',(-6.261,y,z),.072,.009,rim,axis='X')
    box('Rear license plate',(-6.333,0,.62),(.02,.39,.145),white,.007)
    text('Rear license numerals','BC 7416',(-6.348,0,.62),.063,black,'rear')
    text('Rear fleet number','V7416',(-6.232,0,1.28),.115,black,'rear')
    text('Rear New Flyer badge','NEW FLYER',(-6.239,0,1.056),.062,black,'rear')
    for side in [-1,1]:
        box('Rear side cooling inset '+str(side),(-5.30,side*1.294,.94),(1.13,.026,.55),black,.018)
        batched_boxes('Rear cooling grille '+str(side),[((-5.30,side*1.32,.70+i*.045),(1.05,.021,.014))
                      for i in range(12)],silver,.003)
        text('TransLink main side wordmark '+str(side),'TransLink',(1.26,side*1.327,1.465),.358,white,
             'near' if side<0 else 'far')
        # Preserve the photographed italic bus wordmark. The public Wikimedia
        # emblem is the separate all-caps corporate mark, so no invented symbol.
        text('Side fleet number '+str(side),'V7416',(-5.57,side*1.333,3.076),.129,black,
             'near' if side<0 else 'far')
        text('TransLink website '+str(side),'translink.ca',(-4.93,side*1.329,1.48),.101,white,
             'near' if side<0 else 'far')

    # Real interior seats. Linked meshes share upholstery and the molded seat shape.
    cushion=box('Seat upholstery master',(0,0,0),(.43,.328,.105),upholstery,.065)
    back=box('Seat padded back master',(0,0,0),(.09,.326,.54),upholstery,.068)
    shell=box('Seat molded shell master',(0,0,0),(.075,.356,.60),cabin_plastic,.07)
    seat_positions=[]
    for x in [-4.90,-4.04,-3.18,-2.32,-1.46,-.60,.72,1.58,2.44,3.30]:
        for side in [-1,1]:
            if side==-1 and -1.80<x<-.15: continue
            if side==-1 and x>3: continue
            for ymag in [.566,.924]:
                seat_positions.append((x,side*ymag,1.455 if x<-3.85 else 1.17))
    sources=[cushion,back,shell]
    for i,(x,y,z) in enumerate(seat_positions):
        for source,loc in [(cushion,(x,y,z)),(back,(x-.235,y,z+.294)),(shell,(x-.284,y,z+.30))]:
            obj=source if i==0 else source.copy()
            if i>0:
                obj.data=source.data
                bpy.context.collection.objects.link(obj)
            obj.name='Passenger '+source.name.split(' master')[0]+' %02d'%i
            obj.parent=root; obj.location=loc
            if source in [back,shell]: obj.rotation_euler[1]=-.09
    batched_boxes('Cabin seat pedestal legs',[((x,y,z-.25),(.07,.055,.42)) for x,y,z in seat_positions],under,.01)
    # Aisle handrails, vertical poles and overhead horizontal grab rail.
    for side in [-1,1]:
        curve('Continuous yellow overhead handrail '+str(side),[(-5.39,side*.43,2.70),(4.20,side*.43,2.70)],.022,pole_yellow)
        for x in [-4.45,-2.72,.38,2.13,3.77]:
            beam('Yellow upright stanchion',(x,side*.42,.76),(x,side*.42,2.71),.021,pole_yellow)
            curve('Seat top yellow grab loop',[(x+.08,side*.55,1.73),(x+.08,side*.55,1.94),
                  (x+.08,side*.99,1.94),(x+.08,side*.99,1.74)],.014,pole_yellow)
        for x in [-3.8,-1.8,.8,2.8]:
            curve('Hanging passenger hand strap',[(x,side*.43,2.69),(x,side*.43,2.39),
                  (x+.10,side*.43,2.30),(x+.20,side*.43,2.39),(x+.20,side*.43,2.69)],.013,black)
        # Thin lit ceiling strips are visible through the tinted windows.
        box('Cabin continuous ceiling light '+str(side),(-.20,side*.85,2.93),(10.94,.075,.028),cabin_light,.01)
    for x in [-3.0,2.1]:
        data=bpy.data.lights.new('Interior fluorescent bounce','AREA')
        data.energy=55; data.color=(.80,.88,1.0); data.shape='RECTANGLE'; data.size=3.9; data.size_y=1.8
        obj=bpy.data.objects.new('Interior cabin lighting',data); bpy.context.collection.objects.link(obj)
        obj.parent=root; obj.location=(x,0,2.91)
    box('Driver contoured dashboard',(5.67,.28,1.28),(.56,1.86,.37),black,.12)
    driver=box('Driver seat cushion',(4.96,.66,1.20),(.47,.55,.12),black,.07)
    box('Driver high backrest',(4.71,.66,1.56),(.12,.55,.67),black,.08)
    wheel=torus('Driver steering wheel',(5.60,.64,1.57),.215,.018,black,axis='X')
    wheel.rotation_euler[1]=math.pi/2-.46
    beam('Driver steering column',(5.78,.64,1.12),(5.60,.64,1.57),.035,under)
    box('Farebox pedestal',(5.04,-.25,1.07),(.32,.33,.65),under,.045)
    box('Farebox yellow reader housing',(5.04,-.25,1.43),(.37,.36,.17),pole_yellow,.045)
    box('Farebox reader screen',(5.04,-.25,1.527),(.22,.22,.015),glass,.018)
    # A small route card behind the windshield, and wheelchair decals near the entry.
    text('Driver route card','99',(front_x(1.72)-.055,.74,1.72),.125,white,'front')
    for side in [-1,1]:
        box('Wheelchair blue decal backing',(3.83,side*1.327,2.07),(.16,.014,.19),blue,.01)
        torus('Wheelchair symbol wheel',(3.83,side*1.341,2.027),.043,.008,white,axis='Y')
        cylinder('Wheelchair symbol head',(3.824,side*1.347,2.131),.014,.007,white,'Y')
        curve('Wheelchair symbol body',[(3.823,side*1.35,2.108),(3.813,side*1.35,2.061),
              (3.856,side*1.35,2.061),(3.882,side*1.35,2.020)],.007,white)

    # Roof air conditioning, service hatches, engine compartment and rail seams.
    box('Roof full length equipment cove',(-2.02,0,3.275),(6.70,1.98,.18),silver,.10)
    body_loft('Sculpted rooftop HVAC shroud',[
        rounded_body_ring(-3.5,.38,.99,.18,3.26),rounded_body_ring(-3.36,.25,.92,.24,3.49),
        rounded_body_ring(-3.18,.07,.79,.27,3.55)],silver)
    batched_boxes('HVAC intake black slats',[((-2.90+i*.18,0,3.555),(.042,1.23,.012)) for i in range(15)],under,.003)
    for x in [-4.77,2.14,4.20]:
        box('Raised roof escape hatch',(x,0,3.294),(.69,.84,.065),light_silver,.04)
        box('Roof hatch rubber seam',(x,0,3.263),(.75,.90,.019),black,.035)
    box('Roof front antenna',(4.43,.80,3.31),(.19,.13,.13),black,.035)
    beam('Radio antenna whip',(4.43,.80,3.36),(4.28,.80,3.83),.008,black)
    seam_specs=[]
    for side in [-1,1]:
        for x in [-5.91,-4.58,-2.85,-1.96,.28,1.67,2.74,4.19,5.42]:
            if min(abs(x+3.7),abs(x-3.5))>.76:
                seam_specs.append(((x,side*1.287,.90),(.012,.012,.58)))
        seam_specs.append(((0,side*1.287,.727),(11.82,.012,.014)))
    batched_boxes('Aluminum skirt service panel seams',seam_specs,black,.002)
    for side in [-1,1]:
        curve('Front mirror long support '+str(side),[(5.77,side*1.15,2.80),(6.18,side*1.49,2.82),
              (6.25,side*1.71,2.69),(6.25,side*1.71,2.44)],.026,black)
        box('Tall bus mirror black housing '+str(side),(6.24,side*1.73,2.29),(.19,.21,.49),black,.065)
        box('Tall bus mirror silver glass '+str(side),(6.122,side*1.73,2.29),(.017,.156,.39),rim,.027)
        box('Mirror yellow indicator '+str(side),(6.357,side*1.73,2.22),(.012,.17,.065),amber,.012)
    batched_boxes('Amber side marker lights',[((x,s*1.315,z),(.13,.022,.058))
                  for s in [-1,1] for x,z in [(-5.80,.64),(-.02,.66),(5.70,.68),(-5.90,3.02),(5.65,3.03)]],amber,.015)
    batched_boxes('Front roof amber clearance lights',[((5.955,y,3.142),(.035,.105,.042))
                  for y in [-1.02,-.17,0,.17,1.02]],amber,.012)
    batched_boxes('Rear roof red clearance lights',[((-6.15,y,3.097),(.035,.105,.052))
                  for y in [-1.02,-.17,0,.17,1.02]],red,.012)
    # Four individually spinning wheel pivots retain the original animation contract.
    wheels=[]
    for x in [-3.7,3.5]:
        for side in [-1,1]:
            pivot=bpy.data.objects.new('WheelPivot_%s_%s'%(x,side),None)
            bpy.context.collection.objects.link(pivot); pivot.parent=root
            pivot.location=(x,side*1.20,.53); wheels.append(pivot)
            torus('Heavy bus tire',(0,0,0),.407,.123,rubber,pivot)
            cylinder('Sculpted rubber tire sidewall',(0,0,0),.473,.248,rubber,'Y',pivot)
            torus('Raised sidewall outer ridge',(0,side*.126,0),.447,.009,rubber,pivot)
            torus('Raised tire bead',(0,side*.133,0),.344,.012,rubber,pivot)
            cylinder('22 inch brushed alloy wheel',(0,side*.15,0),.331,.040,rim,'Y',pivot)
            torus('Alloy wheel machined outer lip',(0,side*.177,0),.311,.018,light_silver,pivot)
            cylinder('Inset dark wheel barrel',(0,side*.179,0),.266,.008,under,'Y',pivot)
            cylinder('Deep silver wheel hub',(0,side*.195,0),.214,.030,rim,'Y',pivot)
            cylinder('Axle center cap',(0,side*.224,0),.105,.070,rim,'Y',pivot)
            # Circular vent holes on the alloy face are batched in one mesh.
            verts=[]; faces=[]
            for i in range(10):
                a=i*math.tau/10; cx=.254*math.cos(a); cz=.254*math.sin(a); n=len(verts)
                for j in range(12):
                    aa=j*math.tau/12
                    verts.append((cx+.033*math.cos(aa),side*.206,cz+.033*math.sin(aa)))
                faces.append(tuple(n+j for j in range(12)))
            mesh('Ten alloy wheel ventilation holes',verts,faces,black,0,pivot)
            verts=[]; faces=[]
            for i in range(10):
                a=i*math.tau/10; cx=.160*math.cos(a); cz=.160*math.sin(a); n=len(verts)
                for yy in [side*.214,side*.242]:
                    for j in range(6):
                        aa=j*math.tau/6
                        verts.append((cx+.022*math.cos(aa),yy,cz+.022*math.sin(aa)))
                faces.extend([tuple(n+j for j in range(6)),tuple(n+6+j for j in range(6))])
                for j in range(6): faces.append((n+j,n+(j+1)%6,n+6+(j+1)%6,n+6+j))
            mesh('Ten exposed hexagonal wheel lug nuts',verts,faces,rim,0,pivot)
            # Individually embossed tread blocks are one mesh, not extra objects.
            verts=[]; faces=[]
            for i in range(72):
                for row in range(3):
                    a=i*math.tau/72+(row%2)*.018; n=len(verts)
                    for da,yy in [(-.024,-.112+row*.075),(.024,-.097+row*.075),
                                  (.024,-.044+row*.075),(-.024,-.059+row*.075)]:
                        verts.append((.532*math.cos(a+da),yy,.532*math.sin(a+da)))
                    faces.append((n,n+1,n+2,n+3))
            mesh('Raised bus tire tread blocks',verts,faces,rubber,0,pivot)
    # Stunt thrusters deliberately excluded from the isolated city-bus reference.
    curve('Underbody rear exhaust pipe',[(-4.20,.68,.50),(-5.36,.68,.50),(-5.80,.92,.42),(-6.10,.99,.42)],.060,nozzle)

    # Actual 5x7 dot-matrix amber displays, with each glowing LED in one mesh.
    glyphs={
    ' ':['00000']*7,
    '0':['01110','10001','10011','10101','11001','10001','01110'],
    '1':['00100','01100','00100','00100','00100','00100','01110'],
    '2':['01110','10001','00001','00010','00100','01000','11111'],
    '3':['11110','00001','00001','01110','00001','00001','11110'],
    '4':['00010','00110','01010','10010','11111','00010','00010'],
    '5':['11111','10000','10000','11110','00001','00001','11110'],
    '6':['01110','10000','10000','11110','10001','10001','01110'],
    '7':['11111','00001','00010','00100','01000','01000','01000'],
    '8':['01110','10001','10001','01110','10001','10001','01110'],
    '9':['01110','10001','10001','01111','00001','00001','01110'],
    'A':['01110','10001','10001','11111','10001','10001','10001'],
    'B':['11110','10001','10001','11110','10001','10001','11110'],
    'C':['01111','10000','10000','10000','10000','10000','01111'],
    'D':['11110','10001','10001','10001','10001','10001','11110'],
    'E':['11111','10000','10000','11110','10000','10000','11111'],
    'F':['11111','10000','10000','11110','10000','10000','10000'],
    'G':['01111','10000','10000','10111','10001','10001','01111'],
    'H':['10001','10001','10001','11111','10001','10001','10001'],
    'I':['11111','00100','00100','00100','00100','00100','11111'],
    'J':['00001','00001','00001','00001','10001','10001','01110'],
    'K':['10001','10010','10100','11000','10100','10010','10001'],
    'L':['10000','10000','10000','10000','10000','10000','11111'],
    'M':['10001','11011','10101','10101','10001','10001','10001'],
    'N':['10001','11001','10101','10011','10001','10001','10001'],
    'O':['01110','10001','10001','10001','10001','10001','01110'],
    'P':['11110','10001','10001','11110','10000','10000','10000'],
    'Q':['01110','10001','10001','10001','10101','10010','01101'],
    'R':['11110','10001','10001','11110','10100','10010','10001'],
    'S':['01111','10000','10000','01110','00001','00001','11110'],
    'T':['11111','00100','00100','00100','00100','00100','00100'],
    'U':['10001','10001','10001','10001','10001','10001','01110'],
    'V':['10001','10001','10001','10001','10001','01010','00100'],
    'W':['10001','10001','10001','10101','10101','10101','01010'],
    'X':['10001','10001','01010','00100','01010','10001','10001'],
    'Y':['10001','10001','01010','00100','00100','00100','00100'],
    'Z':['11111','00001','00010','00100','01000','10000','11111'],
    '-':['00000','00000','00000','11111','00000','00000','00000']}
    def led_display(name,body,origin,width,side):
        count=len(body)*6-1; spacing=width/count; radius=spacing*.34
        verts=[]; faces=[]
        for k,ch in enumerate(body):
            rows=glyphs.get(ch,glyphs[' '])
            for row,line in enumerate(rows):
                for col,on in enumerate(line):
                    if on!='1': continue
                    u=(k*6+col-(count-1)/2)*spacing; v=(3-row)*spacing
                    n=len(verts)
                    for j in range(8):
                        a=j*math.tau/8; uu=u+radius*math.cos(a); vv=v+radius*math.sin(a)
                        if side=='front': p=(origin[0],origin[1]+uu,origin[2]+vv)
                        elif side=='rear': p=(origin[0],origin[1]-uu,origin[2]+vv)
                        else: p=(origin[0]+uu,origin[1],origin[2]+vv)
                        verts.append(p)
                    faces.append(tuple(n+j for j in range(8)))
        return mesh(name,verts,faces,destination)
    led_display('Front 99 B LINE UBC amber dot matrix','99 B-LINE UBC',(5.931,0,2.966),2.13,'front')
    led_display('Rear route 99 amber dot matrix','99',(-6.211,0,2.929),.39,'rear')
    box('Curbside amber destination black recess',(3.02,-1.337,2.767),(1.28,.018,.212),black,.012)
    led_display('Side 99 UBC amber dot matrix','99 UBC',(3.02,-1.354,2.768),1.14,'near')
    root['vehicle']='Vancouver TransLink New Flyer 40 foot low floor bus - detailed version 2'
    root['forward_axis']='+X'; root['wheel_radius']=.53
    root['reference_sources']='Supplied night reference; Kevin Lo TransLink fleet photographs at kevinsbusrail.com'
    return root,wheels


if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bus, wheels=build_bus()
    bus.location=(0,0,0)
    bus.rotation_euler=(0,0,0)
    print('Isolated upright film reference; no arena, gas, thrusters or external fonts.')
