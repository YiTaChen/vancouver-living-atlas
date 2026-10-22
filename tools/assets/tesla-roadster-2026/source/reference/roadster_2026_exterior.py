"""Editable October-2026 Roadster exterior, based on the current Tesla image set.

Blender metres: +X nose, +Y left/driver, +Z up, tire contact Z=0.
The 4.60 x 2.00 x 1.10 m / 2.70 m wheelbase envelope is representative:
Tesla's current page does not publish exterior dimensions. Rocket is the default
hardware configuration; the compatible two-seat Thrust cabin is built separately.
No scene reset, camera, light, file save or render occurs in this module.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix

_R26_ROOT = None
_R26_M = {}
TAU = 2 * math.pi
DIMENSIONS = {'length_m':4.60,'body_width_m':2.00,'roof_height_m':1.10,
              'wheelbase_m':2.70,'tire_radius_m':.35,
              'dimension_basis':'Representative proportions from current official Tesla images; not published manufacturer dimensions.'}
DOOR_PIVOTS = {'left':(.78,.83,.58),'right':(.78,-.83,.58)}
DOOR_AXES = {'left':(0,.94,-.34),'right':(0,.94,.34)}
WHEEL_CENTERS = {f'{a}_{s}':(x,y,.35) for a,x in [('front',1.35),('rear',-1.35)]
                 for s,y in [('left',.84),('right',-.84)]}


def _r26_materials():
    def material(name,col,rough=.3,metal=0,coat=0,trans=0,alpha=1,emission=0):
        m=bpy.data.materials.get('R26_'+name)
        if m:return m
        m=bpy.data.materials.new('R26_'+name);m.use_nodes=True;m.diffuse_color=(*col,alpha)
        p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1)
        p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
        p.inputs['Coat Weight'].default_value=coat;p.inputs['Coat Roughness'].default_value=.09
        p.inputs['Transmission Weight'].default_value=trans;p.inputs['IOR'].default_value=1.46
        p.inputs['Alpha'].default_value=alpha
        if emission:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emission
        if alpha<1:m.surface_render_method='BLENDED';m.use_backface_culling=False
        m['asset_role']='roadster_2026_'+name
        return m
    mats={
        'pearl':material('pearl_white',(.76,.79,.82),.26,.08,.45),
        'carbon':material('woven_carbon',(.018,.023,.029),.29,.33,.28),
        'rubber':material('performance_rubber',(.012,.015,.019),.62),
        'tread':material('tread_blocks',(.019,.023,.027),.65),
        'black':material('satin_black',(.008,.011,.015),.34,.18),
        'gloss':material('piano_black',(.005,.007,.010),.12,.25,.75),
        'alloy':material('diamond_cut_alloy',(.53,.58,.63),.18,.94,.25),
        'rimdark':material('graphite_wheel',(.035,.044,.053),.24,.8,.25),
        'steel':material('brushed_steel',(.28,.32,.36),.28,.88),
        'titanium':material('cold_gas_titanium',(.39,.34,.26),.23,.92),
        'bronze':material('heated_inner_bell',(.20,.12,.055),.25,.88),
        'ceramic':material('carbon_ceramic_rotor',(.15,.16,.17),.52,.26),
        'caliper':material('vermilion_caliper',(.48,.013,.006),.24,.35,.7),
        'copperglass':material('copper_solar_glass',(.32,.18,.085),.09,0,.8,1,1),
        'clear':material('clear_optical_lens',(.69,.79,.86),.055,.05,.8,.86,.34),
        'whiteled':material('headlight_led',(.80,.91,1.0),.18,.1,.25,emission=10),
        'redled':material('rear_light_led',(.72,.004,.008),.17,.12,.3,emission=6),
        'amber':material('amber_marker',(.95,.16,.006),.2,.1,.4,emission=3),
        'letter':material('tire_lettering',(.22,.24,.26),.65),
        'plate':material('number_plate',(.34,.37,.40),.26,.6),
    }
    glass=mats['copperglass'];glass.surface_render_method='DITHERED'
    glass.use_raytrace_refraction=True;glass.thickness_mode='SLAB'
    output=glass.node_tree.nodes.get('Material Output')
    if output and 'Thickness' in output.inputs:output.inputs['Thickness'].default_value=.003
    # Fine material detail is procedural and remains editable/packed in the .blend.
    for role,scale,strength,distance in [('pearl',650,.035,.0005),('rubber',210,.12,.001),('ceramic',300,.12,.0009)]:
        m=mats[role];ns=m.node_tree.nodes;lk=m.node_tree.links;p=ns.get('Principled BSDF')
        tex=ns.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=2
        bump=ns.new('ShaderNodeBump');bump.inputs['Strength'].default_value=strength;bump.inputs['Distance'].default_value=distance
        lk.new(tex.outputs['Fac'],bump.inputs['Height']);lk.new(bump.outputs['Normal'],p.inputs['Normal'])
    m=mats['carbon'];ns=m.node_tree.nodes;lk=m.node_tree.links;p=ns.get('Principled BSDF')
    tc=ns.new('ShaderNodeTexCoord');waves=[]
    for direction in ['X','Y']:
        wave=ns.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction=direction;wave.inputs['Scale'].default_value=145
        lk.new(tc.outputs['Object'],wave.inputs['Vector']);waves.append(wave)
    mul=ns.new('ShaderNodeMath');mul.operation='MULTIPLY';lk.new(waves[0].outputs['Color'],mul.inputs[0]);lk.new(waves[1].outputs['Color'],mul.inputs[1])
    ramp=ns.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.006,.008,.010,1);ramp.color_ramp.elements[1].color=(.045,.052,.060,1)
    lk.new(mul.outputs[0],ramp.inputs[0]);lk.new(ramp.outputs[0],p.inputs['Base Color'])
    bump=ns.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.08;bump.inputs['Distance'].default_value=.00018
    lk.new(mul.outputs[0],bump.inputs['Height']);lk.new(bump.outputs[0],p.inputs['Normal'])
    return mats


def _r26_parent_matrix(parent):
    chain=[];o=parent
    while o and o!=_R26_ROOT:chain.append(o.matrix_basis.copy());o=o.parent
    result=Matrix.Identity(4)
    for matrix in reversed(chain):result=result@matrix
    return result


def _r26_empty(name,point=(0,0,0),parent=None):
    parent=parent or _R26_ROOT;o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent
    o.location=_r26_parent_matrix(parent).inverted()@Vector(point);o.empty_display_type='PLAIN_AXES';o.empty_display_size=.08
    o['coordinate_frame']='metres; +X front, +Y left, +Z up';return o


def _r26_mesh(name,vertices,faces,material,parent=None,smooth=True,solid=0,bevel=0):
    parent=parent or _R26_ROOT;matrix=_r26_parent_matrix(parent).inverted()
    d=bpy.data.meshes.new('R26_'+name+'_mesh');d.from_pydata([matrix@Vector(v) for v in vertices],[],faces);d.update()
    o=bpy.data.objects.new('R26_'+name,d);bpy.context.collection.objects.link(o);o.parent=parent;d.materials.append(_R26_M[material])
    for p in d.polygons:p.use_smooth=smooth
    if solid:
        mod=o.modifiers.new('Editable_panel_thickness','SOLIDIFY');mod.thickness=solid;mod.offset=-1;mod.use_rim=True
    if bevel:
        mod=o.modifiers.new('Precision_edge_radii','BEVEL');mod.width=bevel;mod.segments=3
    o['part_role']=name;o['editable']=True;return o


def _r26_grid(name,fn,nu,nv,material,parent=None,flip=False,solid=0):
    vs=[fn(i/nu,j/nv) for i in range(nu+1) for j in range(nv+1)];fs=[]
    for i in range(nu):
        for j in range(nv):
            a=i*(nv+1)+j;face=(a,a+nv+1,a+nv+2,a+1);fs.append(tuple(reversed(face)) if flip else face)
    return _r26_mesh(name,vs,fs,material,parent,True,solid)


def _r26_box(name,c,size,mat,parent=None,bevel=.005):
    vs=[(c[0]+a*size[0]/2,c[1]+b*size[1]/2,c[2]+z*size[2]/2) for a,b,z in
        [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    return _r26_mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,parent,False,bevel=bevel)


def _r26_frame(direction):
    z=Vector(direction).normalized();x=z.cross(Vector((0,0,1)))
    if x.length<.01:x=z.cross(Vector((0,1,0)))
    x.normalize();y=z.cross(x).normalized();return x,y,z


def _r26_lathe(name,center,axis,profile,mat,parent=None,n=96,closed=True):
    u,v,w=_r26_frame(axis);c=Vector(center);vs=[]
    for depth,radius in profile:
        for j in range(n):
            a=TAU*j/n;vs.append(c+w*depth+radius*(u*math.cos(a)+v*math.sin(a)))
    fs=[];rows=len(profile)
    for k in range(rows if closed else rows-1):
        k1=(k+1)%rows
        for j in range(n):fs.append((k*n+j,k*n+(j+1)%n,k1*n+(j+1)%n,k1*n+j))
    return _r26_mesh(name,vs,fs,mat,parent,True)


def _r26_cylinder(name,a,b,radius,mat,parent=None,n=32,r2=None):
    a=Vector(a);b=Vector(b);u,v,w=_r26_frame(b-a);vs=[]
    for c,r in [(a,radius),(b,radius if r2 is None else r2)]:
        vs.extend(c+r*(u*math.cos(TAU*j/n)+v*math.sin(TAU*j/n)) for j in range(n))
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    fs.extend((j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n))
    return _r26_mesh(name,vs,fs,mat,parent,True)


def _r26_pipe(name,points,radius,mat,parent=None,sides=8):
    pp=[Vector(p) for p in points];vs=[]
    for i,p in enumerate(pp):
        tangent=pp[min(i+1,len(pp)-1)]-pp[max(0,i-1)];u,v,_=_r26_frame(tangent)
        vs.extend(p+radius*(u*math.cos(TAU*j/sides)+v*math.sin(TAU*j/sides)) for j in range(sides))
    fs=[]
    for i in range(len(pp)-1):
        for j in range(sides):fs.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    return _r26_mesh(name,vs,fs,mat,parent,True)


def _r26_text(name,text,point,size,normal,up=(0,0,1),mat='alloy',parent=None):
    parent=parent or _R26_ROOT;n=Vector(normal).normalized();v=Vector(up).normalized();u=v.cross(n).normalized();v=n.cross(u).normalized()
    data=bpy.data.curves.new('R26_'+name,'FONT');data.body=text;data.align_x='CENTER';data.align_y='CENTER';data.size=size;data.extrude=.0002;data.resolution_u=3
    o=bpy.data.objects.new('R26_'+name,data);bpy.context.collection.objects.link(o);o.parent=parent
    basis=Matrix((u,v,n)).transposed().to_4x4();basis.translation=Vector(point);o.matrix_basis=_r26_parent_matrix(parent).inverted()@basis;data.materials.append(_R26_M[mat])
    # Built-in Bfont only. Conversion gives stable geometry without external fonts.
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def _r26_interp(x,points):
    if x<=points[0][0]:return points[0][1]
    if x>=points[-1][0]:return points[-1][1]
    for (a,aa),(b,bb) in zip(points,points[1:]):
        if a<=x<=b:
            t=(x-a)/(b-a);t=t*t*(3-2*t);return aa+(bb-aa)*t


def _r26_width(x):return _r26_interp(x,[(-2.30,.955),(-1.35,1.0),(-.70,.94),(.50,.93),(1.35,1.0),(2.30,.935)])
def _r26_hood_z(x):return _r26_interp(x,[(.80,.686),(1.05,.677),(1.45,.625),(1.90,.515),(2.28,.438)])
def _r26_waist(x):return _r26_interp(x,[(-2.30,.774),(-1.742,.805),(-1.35,.810),(-.958,.775),(-.94,.748),(.78,.678),(.958,.720),(1.35,.765),(1.742,.645),(2.30,.448)])
def _r26_deck_width(x):return _r26_interp(x,[(-2.30,.70),(-2.10,.69),(-1.90,.55),(-1.72,.385)])
def _r26_deck_z(x):return _r26_interp(x,[(-2.30,.775),(-1.72,.84)])
def _r26_hood_halfwidth(x):
    u=max(0,min(1,(x-.805)/1.477));return .58+.016*math.sin(math.pi*u)
def _r26_front_shoulder_point(x,y):
    side=1 if y>=0 else -1;yy=abs(y);inner_y=_r26_hood_halfwidth(x);outer_y=_r26_width(x)-.07
    v=max(0,min(1,(yy-inner_y)/(outer_y-inner_y)))
    # Rise to a controlled shelf before the inner tyre edge. The full tyre and
    # wheelhouse envelope then stays under the fender, rather than poking through
    # the hood/shoulder blend. Edge curves still match their adjacent panels.
    cover=max(0,min(1,(yy-inner_y)/(.725-inner_y)))
    inner_z=_r26_hood_z(x)+.012*(1-(inner_y/.71)**2)
    z=inner_z+(_r26_waist(x)-inner_z)*math.sin(cover*math.pi/2)+.006*math.sin(math.pi*v)
    return(x,side*yy,z)
def _r26_window_top(x):return _r26_interp(x,[(-.94,1.045),(-.65,1.074),(-.05,1.070),(.78,.745)])
def _r26_window_y(x):return _r26_interp(x,[(-.94,.615),(-.05,.61),(.78,.718)])


def _r26_body(body,doors,roof):
    # Low tub and separate sills leave the entire door/cockpit volume genuinely open.
    _r26_grid('undertray_centre',lambda u,v:(-1.0+2.02*u,-.76+1.52*v,.148+.012*math.sin(math.pi*u)),48,28,'carbon',body,solid=.014)
    for side in [-1,1]:
        _r26_grid('rocker_sill_'+str(side),lambda u,v:(-.955+1.76*u,side*(.82+.145*math.sin(v*math.pi/2)),.205+.125*v),64,12,'carbon',body,flip=side>0,solid=.014)
        # Closed side skin exists only ahead/behind the wheel openings, never across them.
        for label,a,b in [('nose',1.742,2.30),('tail',-2.30,-1.742),('a_pillar_lower',.80,.958)]:
            def fn(u,v,a=a,b=b,side=side):
                x=a+(b-a)*u;top=_r26_waist(x);width=_r26_width(x)
                return (x,side*(width-.07*(v**3)-.045*((1-v)**5)),.225+(top-.225)*v)
            _r26_grid('quarter_'+label+'_'+str(side),fn,40,18,'pearl',body,flip=side>0,solid=.012)
        # Smooth wheel arch skins connect an inner top ridge to the cut outer lip.
        for axle,xw in [('front',1.35),('rear',-1.35)]:
            radius=.392
            def outer_fender(u,v,side=side,xw=xw):
                x=xw-radius+2*radius*u;arch=.35+math.sqrt(max(0,radius**2-(x-xw)**2))
                upper=_r26_waist(x)
                return(x,side*(_r26_width(x)-.07*(v**3)),arch+(upper-arch)*v)
            _r26_grid('cut_arch_outer_skin_'+axle+'_'+str(side),outer_fender,80,12,'pearl',body,flip=side>0,solid=.010)
            # Folded metal return/lip, black wheelhouse and subtle seam at the arch.
            points=[]
            for j in range(97):
                a=math.pi*j/96;x=xw+radius*math.cos(a);z=.35+radius*math.sin(a)
                points.append((x,side*(_r26_width(x)+.0015),z))
            _r26_pipe(axle+'_arch_edge_'+str(side),points,.004,'pearl',body,10)
            def liner(u,v,side=side,xw=xw):
                a=math.pi*u;r=.375+.009*math.sin(math.pi*v)
                inner_y=.713 if xw>0 else .699
                return(xw+r*math.cos(a),side*(inner_y+(.98-inner_y)*v),.35+r*math.sin(a))
            _r26_grid(axle+'_wheelhouse_'+str(side),liner,72,12,'black',body,flip=side>0,solid=.003)
        # Door outer skin, no shared fixed panel behind the aperture.
        name='left' if side>0 else 'right';door=doors[name]
        def door_fn(u,v,side=side):
            x=-.938+1.716*u;z=.337+(_r26_waist(x)-.337)*v
            y=_r26_width(x)-.016-.104*(v**2)+.014*math.sin(math.pi*u)*math.sin(math.pi*v)
            return(x,side*y,z)
        _r26_grid('door_outer_'+name,door_fn,72,20,'pearl',door,flip=side>0,solid=.014)
        # Painted inner edge returns make the open panel read as a real door.
        for xx in [-.938,.778]:
            _r26_grid('door_return_'+name+str(xx),lambda u,v,xx=xx,side=side:(xx,side*(.802+.135*u),.337+(_r26_waist(xx)-.337)*v),4,20,'black',door,flip=xx<0,solid=.003)
        _r26_pipe('door_lower_seal_'+name,[(-.938+1.716*i/64,side*(_r26_width(-.938+1.716*i/64)-.013),.336) for i in range(65)],.0032,'black',door)
        # Upper painted cap and flush handle remain attached to the moving door.
        waist=[(-.938+1.716*i/72,side*(_r26_width(-.938+1.716*i/72)-.117),_r26_waist(-.938+1.716*i/72)+.002) for i in range(73)]
        _r26_pipe('door_waist_cap_'+name,waist,.008,'pearl',door,10)
        _r26_box('flush_handle_'+name,(-.69,side*.917,.669),(.11,.009,.021),'rimdark',door,.006)
        _r26_box('handle_light_'+name,(-.69,side*.924,.675),(.068,.003,.002),'whiteled',door,.0007)
        for xx,top in [(-.951,.752),(.792,.68)]:
            _r26_box('fixed_door_jamb_'+name+str(xx),(xx,side*.845,(top+.323)/2),(.024,.202,top-.323),'carbon',body,.007)
        # Recessed side marker at the front-door hinge, visible in the official side view.
        _r26_mesh('side_marker_recess_'+name,[(.79,side*.957,.588),(.96,side*.99,.602),(1.005,side*.985,.57),(.84,side*.959,.559)],[(0,1,2,3)],'gloss',body,False,solid=.005)
        _r26_pipe('side_marker_'+name,[(.86,side*.968,.573),(.965,side*.989,.591)],.004,'amber',body,6)
    # Central hood is a compound-curved sheet with precise edges, not a box.
    def hood(u,v):
        x=.805+1.477*u;y=(-1+2*v)*_r26_hood_halfwidth(x)
        return(x,y,_r26_hood_z(x)+.012*(1-(y/.71)**2))
    _r26_grid('compound_curved_hood',hood,96,40,'pearl',body,solid=.012)
    for side in [-1,1]:
        _r26_pipe('hood_shutline_'+str(side),[(.81+1.466*i/96,side*_r26_hood_halfwidth(.81+1.466*i/96),_r26_hood_z(.81+1.466*i/96)+.001) for i in range(97)],.0016,'black',body,6)
        # One controlled shoulder spans hood, wheel and nose corner. Its outer
        # edge is exactly the side skin's upper curve; there are no floating hoops.
        def front_shoulder(u,v,side=side):
            x=.805+1.495*u;inner_y=_r26_hood_halfwidth(x);outer_y=_r26_width(x)-.07
            return _r26_front_shoulder_point(x,side*(inner_y+(outer_y-inner_y)*v))
        _r26_grid('continuous_front_shoulder_'+str(side),front_shoulder,112,20,'pearl',body,flip=side<0,solid=.012)
        # Rear quarter and C-buttress share one surface, eliminating the previous
        # overlap between independent fender/deck/buttress sheets.
        def rear_shoulder(u,v,side=side):
            x=-2.30+1.362*u
            if x<=-1.72:inner_y=_r26_deck_width(x);inner_z=_r26_deck_z(x)
            else:
                t=min(1,(x+1.72)/.78);inner_y=.385+.23*t;inner_z=.84+.205*t
            outer_y=_r26_width(x)-.07
            return(x,side*(inner_y+(outer_y-inner_y)*v),inner_z*(1-v)+_r26_waist(x)*v+.010*math.sin(math.pi*v))
        _r26_grid('continuous_rear_quarter_'+str(side),rear_shoulder,112,24,'pearl',body,flip=side<0,solid=.012)
        # White nose end cap wraps from the black centre into the side panel.
        def front_corner(u,v,side=side):
            outer_y=_r26_width(2.30)-.07*v**3-.045*(1-v)**5
            return(2.301+.002*math.sin(math.pi*v),side*(.715+(outer_y-.715)*u),.225+(.448-.225)*v)
        _r26_grid('connected_white_front_corner_'+str(side),front_corner,20,24,'pearl',body,flip=side<0,solid=.012)
    def rear_deck(u,v):
        x=-2.30+.58*u;width=_r26_deck_width(x);y=(-1+2*v)*width
        return(x,y,_r26_deck_z(x)+.010*(1-(y/width)**2))
    _r26_grid('rear_deck',rear_deck,64,36,'pearl',body,solid=.012)
    # Rear centre bumper faceted to match the current white reveal.
    _r26_mesh('rear_white_fascia',[(-2.30,-.93,.67),(-2.30,.93,.67),(-2.278,.90,.46),(-2.272,.58,.48),(-2.285,.36,.52),(-2.285,-.36,.52),(-2.272,-.58,.48),(-2.278,-.90,.46)],[(0,1,2,3,4,5,6,7)],'pearl',body,False,solid=.015,bevel=.006)
    for side in [-1,1]:
        _r26_mesh('rear_side_vent_'+str(side),[(-2.14,side*.97,.67),(-2.29,side*.96,.653),(-2.29,side*.94,.49),(-2.02,side*.98,.565)],[(0,1,2,3)],'gloss',body,False,solid=.008)
        _r26_mesh('closed_rear_carbon_corner_'+str(side),[(-2.302,side*.84,.473),(-2.302,side*.93,.460),(-2.280,side*.94,.225),(-2.315,side*.84,.112)],[(0,1,2,3)],'carbon',body,False,solid=.012)
    # Closed lower nose is black; the hood/front lip remains a separate white sheet.
    _r26_grid('recessed_raked_black_nose',lambda u,v:(2.310-.052*(1-v)**2-.008*((2*u-1)**2),(2*u-1)*(.700+.016*v),.198+.225*v),56,24,'gloss',body,solid=.015)
    _r26_grid('white_front_hood_lip',lambda u,v:(2.282+.029*u,(2*v-1)*.582,.438-.004*u),8,64,'pearl',body,solid=.010)
    _r26_grid('front_splitter',lambda u,v:(2.08+(.245-.060*abs(2*v-1)**6)*u,-.96+1.92*v,.167+.012*math.cos((v-.5)*math.pi)-.012*u),24,48,'carbon',body,solid=.012)
    _r26_pipe('front_light_lip',[(2.312-.025*(y/.716)**2,y,.434+.009*(1-(y/.716)**2)) for y in [-.716+1.432*i/96 for i in range(97)]],.0038,'whiteled',body,8)
    # Copper windscreen, removable roof, rear glass and independently moving door glazing.
    def windshield(u,v):
        x=-.05+1.0*u;width=.608+.126*u;y=(-1+2*v)*width
        return(x,y,1.073-.397*u+.022*(1-(y/width)**2)*math.sin(math.pi*u))
    _r26_grid('copper_windscreen',windshield,64,48,'copperglass',body,solid=.003)
    for side in [-1,1]:
        _r26_pipe('A_pillar_'+str(side),[windshield(i/64,1 if side>0 else 0) for i in range(65)],.012,'pearl',body,12)
        _r26_pipe('windshield_seal_'+str(side),[(x,y-side*.010,z+.002) for x,y,z in [windshield(i/64,1 if side>0 else 0) for i in range(65)]],.0055,'black',body,8)
    def roof_fn(u,v):
        x=-.91+.86*u;width=.615;y=(-1+2*v)*width
        return(x,y,1.065+.033*(1-(y/width)**2)+.004*math.sin(math.pi*u))
    _r26_grid('removable_copper_roof',roof_fn,48,36,'copperglass',roof,solid=.0035)
    for side in [-1,1]:_r26_pipe('roof_side_frame_'+str(side),[roof_fn(i/48,1 if side>0 else 0) for i in range(49)],.009,'gloss',roof,10)
    for u in [0,1]:_r26_pipe('roof_cross_seal_'+str(u),[roof_fn(u,j/48) for j in range(49)],.006,'black',roof,8)
    def backglass(u,v):
        x=-1.72+.78*u;width=.385+.23*u;y=(-1+2*v)*width
        return(x,y,.84+.205*u+.018*(1-(y/width)**2)*math.sin(math.pi*u))
    _r26_grid('tapered_rear_copper_glass',backglass,56,40,'copperglass',body,solid=.003)
    _r26_grid('rear_roof_header',lambda u,v:(-.94+.03*u,(2*v-1)*.615,1.045+.020*u),4,48,'gloss',body,solid=.006)
    for side in [-1,1]:_r26_pipe('rear_glass_edge_'+str(side),[backglass(i/56,1 if side>0 else 0) for i in range(57)],.004,'black',body,8)
    for side in [-1,1]:
        name='left' if side>0 else 'right';door=doors[name]
        def window(u,v,side=side):
            x=-.935+1.715*u;low=_r26_waist(x)+.012;top=_r26_window_top(x)
            ybase=_r26_width(x)-.119;y=ybase*(1-v)+_r26_window_y(x)*v+.008*math.sin(math.pi*v)
            return(x,side*y,low+(top-low)*v)
        _r26_grid('door_copper_glass_'+name,window,68,24,'copperglass',door,flip=side>0,solid=.003)
        for v in [0,1]:_r26_pipe('door_window_'+name+'_seal_'+str(v),[window(i/68,v) for i in range(69)],.006,'gloss',door,10)
        for u in [0,1]:_r26_pipe('door_window_'+name+'_end_'+str(u),[window(u,j/24) for j in range(25)],.007,'gloss',door,10)
    # Recessed triangular pop-down headlamp assemblies, with layered real optics.
    for side in [-1,1]:
        tri=[Vector(_r26_front_shoulder_point(x,side*y))+Vector((0,0,.003)) for x,y in [(1.940,.731),(1.910,.882),(2.190,.735)]]
        centre=sum(tri,Vector())/3
        def lamp_panel(name,corners,lift,material,solid):
            n=18;vv=[];ids={};ff=[]
            for i in range(n+1):
                for j in range(n+1-i):
                    point=corners[0]*(1-(i+j)/n)+corners[1]*(i/n)+corners[2]*(j/n)
                    ids[i,j]=len(vv);point=Vector(_r26_front_shoulder_point(point.x,point.y));point.z+=lift;vv.append(point)
            for i in range(n):
                for j in range(n-i):
                    face=(ids[i,j],ids[i+1,j],ids[i,j+1]);ff.append(tuple(reversed(face)) if side>0 else face)
                    if i+j<n-1:
                        face=(ids[i+1,j],ids[i+1,j+1],ids[i,j+1]);ff.append(tuple(reversed(face)) if side>0 else face)
            return _r26_mesh(name,vv,ff,material,body,True,solid=solid)
        lamp_panel('triangular_headlight_pocket_'+str(side),tri,.003,'black',.008)
        inner=[centre+(p-centre)*.87 for p in tri]
        lamp_panel('triangular_headlight_lens_'+str(side),inner,.008,'clear',.002)
        border=[]
        for aa,bb in zip(tri,tri[1:]+tri[:1]):
            for j in range(24):
                point=aa*(1-j/24)+bb*(j/24);point=Vector(_r26_front_shoulder_point(point.x,point.y));point.z+=.005;border.append(point)
        _r26_pipe('headlight_surround_'+str(side),border+[border[0]],.003,'rimdark',body,8)
        for k in range(6):
            t=.10+.80*k/5;point=tri[0]*(1-t)+tri[1]*t;point=Vector(_r26_front_shoulder_point(point.x,point.y))+Vector((.004,0,.010))
            _r26_cylinder('projector_'+str(side)+'_'+str(k),point-Vector((.006,0,0)),point+Vector((.007,0,0)),.0095,'whiteled',body,16)
        # Narrow side camera replaces an unreferenced conventional mirror pod.
        _r26_box('flush_side_camera_'+str(side),(.66,side*.915,.665),(.064,.024,.028),'gloss',doors['left' if side>0 else 'right'],.009)
    # Rear lamp has a dark optical housing and separate continuous light guides.
    _r26_box('rear_lamp_black_housing',(-2.307,0,.714),(.025,1.914,.069),'gloss',body,.014)
    _r26_pipe('continuous_rear_red_light',[(-2.324+.010*(y/.942)**2,y,.722+.004*(1-(y/.942)**2)) for y in [-.942+1.884*i/128 for i in range(129)]],.0058,'redled',body,10)
    _r26_pipe('rear_lower_red_guide',[(-2.322,y,.693) for y in [-.938+1.876*i/96 for i in range(97)]],.0018,'redled',body,6)
    _r26_box('rear_number_plate',(-2.307,0,.572),(.022,.326,.128),'plate',body,.012)
    _r26_text('rear_plate_lettering','RDSTR',(-2.322,0,.572),.063,(-1,0,0),mat='alloy',parent=body)
    # Small camera and two fasteners complete the fascia without fictitious badges.
    _r26_cylinder('rear_camera',(-2.319,0,.665),(-2.329,0,.665),.009,'gloss',body,20)
    for y in [-.131,.131]:_r26_cylinder('plate_screw',(-2.321,y,.616),(-2.325,y,.616),.003,'steel',body,12)


def _r26_wheel(name,point,parent):
    x,y,z=point;side=1 if y>0 else -1;width=.142 if name.startswith('rear') else .131
    profile=[(-width*.82,.274),(-width,.292),(-width*1.035,.323),(-width*.95,.344),(-width*.73,.35),(width*.73,.35),(width*.95,.344),(width*1.035,.323),(width,.292),(width*.82,.274)]
    _r26_lathe(name+'_rounded_tire',point,(0,1,0),profile,'rubber',parent,160)
    # Physical tread blocks, staggered chevrons with open drainage channels.
    vs=[];fs=[]
    for row in range(4):
        yc=-width*.69+(row+.5)*width*1.38/4
        for j in range(64):
            a=TAU*(j+.5*(row%2))/64;da=TAU/64*.43;dy=width*1.38/4*.43;offset=len(vs)
            for radial in [.3488,.3505]:
                for aa,yy in [(-da,-dy),(da,-dy),(da,dy),(-da,dy)]:
                    angle=a+aa+.055*(yy/width)*(1 if row<2 else -1)
                    vs.append((x+radial*math.sin(angle),y+yc+yy,z+radial*math.cos(angle)))
            fs.extend(tuple(offset+i for i in face) for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    _r26_mesh(name+'_individual_tread_blocks',vs,fs,'tread',parent,False)
    outer=y+side*(width+.004)
    barrelprofile=[(-width*.88,.248),(-width*.88,.275),(-width*.60,.282),(width*.88,.282),(width*.96,.271),(width*.94,.255),(width*.72,.249)]
    _r26_lathe(name+'_forged_barrel',point,(0,1,0),barrelprofile,'rimdark',parent,128)
    _r26_lathe(name+'_diamond_cut_rim_lip',(x,outer,z),(0,side,0),[(-.003,.261),(0,.272),(.004,.274),(.007,.270),(.005,.261)],'alloy',parent,128)
    # Five swept aero blades: dark structural spokes and triangular silver faces.
    for j in range(5):
        a=TAU*j/5+.15
        outline=[(.060,a-.17),(.259,a-.28),(.265,a+.22),(.205,a+.25),(.080,a+.12)]
        vv=[]
        for depth in [-.018,.007]:
            vv.extend((x+r*math.sin(aa),outer+side*depth,z+r*math.cos(aa)) for r,aa in outline)
        faces=[tuple(reversed(range(5))),tuple(range(5,10))]+[(k,(k+1)%5,(k+1)%5+5,k+5) for k in range(5)]
        _r26_mesh(name+'_aero_spoke_'+str(j),vv,faces,'rimdark',parent,False,bevel=.003)
        blade=[(.083,a-.08),(.246,a-.21),(.248,a+.12),(.183,a+.16)]
        _r26_mesh(name+'_machined_blade_'+str(j),[(x+r*math.sin(aa),outer+side*.011,z+r*math.cos(aa)) for r,aa in blade],[(0,1,2,3)],'alloy',parent,False,solid=.0025,bevel=.0015)
    _r26_cylinder(name+'_centre_lock',(x,outer-side*.02,z),(x,outer+side*.018,z),.061,'rimdark',parent,64)
    _r26_cylinder(name+'_centre_cap',(x,outer+side*.018,z),(x,outer+side*.022,z),.042,'alloy',parent,64)
    for j in range(5):
        a=j*TAU/5;xx=x+.067*math.sin(a);zz=z+.067*math.cos(a)
        _r26_cylinder(name+'_titanium_lug_'+str(j),(xx,outer+side*.008,zz),(xx,outer+side*.023,zz),.0075,'titanium',parent,12)
    # Ceramic rotor, ventilation vane ring, drilled hole mouths and fixed caliper.
    discy=y+side*(width*.38)
    _r26_lathe(name+'_ceramic_rotor',(x,discy,z),(0,side,0),[(-.011,.101),(-.011,.232),(.011,.232),(.011,.101)],'ceramic',parent,128)
    _r26_lathe(name+'_rotor_hat',(x,discy,z),(0,side,0),[(-.012,.055),(-.012,.102),(.015,.102),(.015,.055)],'steel',parent,80)
    for ring,count,phase in [(.173,22,0),(.210,28,.07)]:
        for j in range(count):
            a=j*TAU/count+phase;xx=x+ring*math.sin(a);zz=z+ring*math.cos(a)
            _r26_cylinder(name+'_drill_mouth',(xx,discy+side*.0113,zz),(xx,discy+side*.012,zz),.0038,'black',parent,8)
    for j in range(32):
        a=j*TAU/32
        _r26_cylinder(name+'_rotor_vane',(x+.225*math.sin(a),discy-.012,z+.225*math.cos(a)),(x+.225*math.sin(a+.035),discy+.012,z+.225*math.cos(a+.035)),.002,'steel',parent,6)
    # Caliper remains under steering parent, not the spinning wheel.
    fixed=parent.parent
    _r26_box(name+'_fixed_caliper',(x-.185,y+side*.047,z+.035),(.090,.095,.155),'caliper',fixed,.019)
    for zz in [-.012,.080]:_r26_cylinder(name+'_caliper_pin',(x-.187,y+side*.092,z+zz),(x-.187,y+side*.102,z+zz),.006,'steel',fixed,16)
    _r26_text(name+'_sidewall_top','ULTRA PERFORMANCE',(x,outer+side*.003,z+.312),.0185,(0,side,0),mat='letter',parent=parent)
    _r26_text(name+'_sidewall_bottom','ELECTRIC ROADSTER',(x,outer+side*.003,z-.310),.016,(0,side,0),mat='letter',parent=parent)
    # Sidewall moulding lines and valve stem are actual geometry.
    for r in [.287,.322]:_r26_lathe(name+'_sidewall_ring',(x,outer,z),(0,side,0),[(0,r-.0006),(.001,r), (0,r+.0006)],'rubber',parent,128)
    _r26_cylinder(name+'_valve_stem',(x+.207,outer,z+.101),(x+.207,outer+side*.015,z+.101),.004,'black',parent,12)


def _r26_suspension(body):
    for axle,x in [('front',1.35),('rear',-1.35)]:
        _r26_box(axle+'_carbon_subframe',(x,0,.255),(.30,1.08,.095),'carbon',body,.018)
        for side in [-1,1]:
            hub=(x,side*.76,.35)
            for z in [.285,.47]:
                for dx in [-.19,.19]:_r26_cylinder(axle+'_wishbone', (x+dx,side*.48,z),hub,.013,'black',body,16)
            _r26_cylinder(axle+'_halfshaft',(x,side*.25,.35),hub,.018,'steel',body,24)
            _r26_lathe(axle+'_cv_boot',(x,side*.65,.35),(0,side,0),[(j*.012,.029+.007*(j%2)) for j in range(9)],'rubber',body,32)
            a=Vector((x+.12,side*.53,.49 if axle=='front' else .61));b=Vector((x-.04,side*.75,.33));u,v,w=_r26_frame(b-a)
            _r26_cylinder(axle+'_damper_body',a,b,.025,'rimdark',body,32)
            _r26_cylinder(axle+'_damper_piston',a-w*.025,a+w*.15,.011,'alloy',body,24)
            points=[]
            for j in range(257):
                t=j/256;angle=t*TAU*7;points.append(a+(b-a)*(.08+.84*t)+.043*(u*math.cos(angle)+v*math.sin(angle)))
            _r26_pipe(axle+'_gold_coil_spring',points,.0065,'titanium',body,8)
            for c in [a,b]:_r26_lathe(axle+'_spring_perch',c,w,[(-.007,.025),(-.007,.053),(.007,.053),(.007,.025)],'steel',body,48)
    # Ribbed pressure/battery undertray, with removable access panels and fasteners.
    for x in [-.72,-.34,.04,.42,.80]:
        _r26_box('undertray_access_panel',(x,0,.139),(.35,1.35,.014),'carbon',body,.012)
        for y in [-.61,.61]:_r26_cylinder('undertray_quarter_turn',(x,y,.125),(x,y,.132),.006,'titanium',body,12)
    for y in [-.52,0,.52]:_r26_pipe('underfloor_aero_strake',[(-1.05,y,.144),(-.85,y,.117),(.65,y,.117),(.99,y,.143)],.006,'carbon',body,6)


def _r26_nozzle(name,point,direction,parent,role,trim):
    anchor=_r26_empty('roadster_nozzle_'+name,point,parent);direction=Vector(direction).normalized()
    anchor.rotation_mode='QUATERNION';anchor.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction)
    anchor['jet_axis']='+Z local outward';anchor['hardware_role']=role;anchor['trim']=trim
    # Mesh positions are built in the root frame; the anchor's local +Z is outward.
    c=Vector(point);u,v,w=_r26_frame(direction)
    radial=.62 if role=='downward_perimeter_cold_gas' else .86;depth=.92
    profile=[(d*depth,r*radial) for d,r in [(-.105,.030),(-.090,.033),(-.070,.039),(-.045,.051),(-.018,.064),(0,.070)]]
    _r26_lathe(name+'_outer_bell',c,w,profile+[(d,r+.006*radial) for d,r in reversed(profile)],'titanium',anchor,96)
    _r26_lathe(name+'_inner_bell',c,w,[(d+.0003,r-.0006*radial) for d,r in profile],'bronze',anchor,96,closed=False)
    _r26_cylinder(name+'_dark_throat',c-w*(.108*depth),c-w*(.104*depth),.028*radial,'black',anchor,48)
    _r26_lathe(name+'_outlet_lip',c,w,[(d,r*radial) for d,r in [(-.003,.068),(0,.073),(.003,.071),(.002,.066)]],'alloy',anchor,96)
    _r26_lathe(name+'_mount_flange',c-w*(.105*depth),w,[(d,r*radial) for d,r in [(-.006,.030),(-.006,.078),(.006,.078),(.006,.030)]],'steel',anchor,64)
    for j in range(6):
        a=j*TAU/6;bolt=c-w*(.099*depth)+.064*radial*(u*math.cos(a)+v*math.sin(a))
        _r26_cylinder(name+'_mount_bolt',bolt-w*.003,bolt+w*.005,.005*radial,'titanium',anchor,10)
    return {'node':anchor,'direction':list(direction),'role':role,'trim':trim}


def _r26_hardware(body,trim):
    rear=_r26_empty('roadster_hardware_rear');perimeter=_r26_empty('roadster_hardware_perimeter');thrusters=[]
    # Four rear jets sit above four separate fan cells (fans are NOT extra jets).
    for i,y in enumerate([-.63,-.21,.21,.63]):
        thrusters.append(_r26_nozzle('rear_'+str(i),(-2.321,y,.409),(-1,0,0),rear,'rearward_cold_gas','thrust_or_rocket'))
        centre=(-2.255,y,.218)
        _r26_lathe('rear_fan_duct_'+str(i),centre,(-1,0,0),[(-.09,.095),(0,.112),(.017,.110),(.020,.097),(-.06,.083)],'carbon',rear,80)
        _r26_cylinder('fan_rotor_hub_'+str(i),(-2.280,y,.218),(-2.302,y,.218),.029,'rimdark',rear,48,r2=.019)
        for blade in range(7):
            def fn(u,v,blade=blade,y=y):
                radius=.028+.063*u;angle=blade*TAU/7+.48*u+(.08+.28*u)*(v-.5)
                return(-2.292+.014*math.sin(math.pi*u)*v,y+radius*math.cos(angle),.218+radius*math.sin(angle))
            _r26_grid('fan_'+str(i)+'_sculpted_blade_'+str(blade),fn,12,5,'rimdark',rear,solid=.003)
    # Carbon frame, diffuser fins and inner rear mesh stay individually editable.
    _r26_pipe('rear_hardware_upper_frame',[(-2.29,-.83,.48),(-2.31,-.76,.492),(-2.31,.76,.492),(-2.29,.83,.48)],.017,'carbon',rear,10)
    for y in [-.84,-.42,0,.42,.84]:
        _r26_mesh('rear_diffuser_fin',[(-1.91,y,.15),(-2.33,y,.105),(-2.33,y,.27),(-2.08,y,.30)],[(0,1,2,3)],'carbon',rear,False,solid=.008)
    _r26_mesh('diffuser_lower_tray',[(-1.89,-.84,.145),(-1.89,.84,.145),(-2.33,.84,.106),(-2.33,-.84,.106)],[(0,1,2,3)],'carbon',rear,True,solid=.012)
    # Visible front-hinge/rear-outer downward jets match the official World/Gravity imagery.
    for axle,x in [('front',.84),('rear',-1.91)]:
        for side in [-1,1]:thrusters.append(_r26_nozzle(axle+('_left' if side>0 else '_right'),(x,side*.91,.105),(0,0,-1),perimeter,'downward_perimeter_cold_gas','rocket'))
    if trim not in ['rocket','thrust']:
        rear.hide_render=True;rear.hide_viewport=True
        for o in rear.children_recursive:o.hide_render=True;o.hide_viewport=True
    if trim!='rocket':
        perimeter.hide_render=True;perimeter.hide_viewport=True
        for o in perimeter.children_recursive:o.hide_render=True;o.hide_viewport=True
    return {'rear':rear,'perimeter':perimeter},thrusters


def _r26_wing(body,wing):
    # A thin full-span foil, with actual cambered section and telescoping struts.
    def airfoil(u,v):
        y=-.945+1.89*u;angle=TAU*v;x=-2.205+.105*math.cos(angle)
        z=.835+.016*math.sin(angle)*(.85+.15*math.cos(angle))+.006*(1-(y/.95)**2)
        return(x,y,z)
    _r26_grid('active_wing_airfoil',airfoil,72,24,'pearl',wing,solid=.003)
    for side in [-1,1]:
        _r26_mesh('active_wing_endplate_'+str(side),[(-2.092,side*.953,.857),(-2.322,side*.953,.842),(-2.321,side*.953,.800),(-2.160,side*.953,.818)],[(0,1,2,3)],'carbon',wing,False,solid=.008,bevel=.003)
    for y in [-.51,.51]:
        _r26_cylinder('wing_fixed_hydraulic_sleeve',(-2.19,y,.64),(-2.19,y,.842),.023,'black',body,32)
        _r26_cylinder('wing_telescoping_piston',(-2.19,y,.590),(-2.19,y,.850),.012,'alloy',wing,32)
        for x in [-2.222,-2.158]:_r26_cylinder('wing_link_clevis',(x,y-.018,.841),(x,y+.018,.841),.008,'steel',wing,20)


def build_exterior(root,trim='rocket'):
    """Attach editable geometry to root and return explicit animation/assembly rig.

    trim='rocket' enables the source-visible perimeter jets and rear hardware.
    trim='thrust' retains rear jets/fans, hides the additional perimeter group.
    A single-seat Rocket vs two-seat Thrust interior is a separate builder choice.
    """
    global _R26_ROOT,_R26_M
    _R26_ROOT=root;_R26_M=_r26_materials();trim=trim.lower()
    root['asset']='October_2026_Roadster';root['trim']=trim;root['front_axis']='+X';root['up_axis']='+Z';root['ground_z']=0
    root['dimensions_basis']=DIMENSIONS['dimension_basis'];root['reference_source']='Current Tesla Roadster CDN images 01/02/03/04/06/07, inspected October2026'
    body=_r26_empty('roadster_body');doors={};roof=_r26_empty('roadster_roof');wing=_r26_empty('roadster_active_wing')
    roof['removable']=True;wing['deployment_axis']='+Z';wing['representative_lift_m']=.24
    for name,point in DOOR_PIVOTS.items():
        door=_r26_empty('roadster_door_'+name,point);axis=Vector(DOOR_AXES[name]).normalized()
        door['hinge_axis']=list(axis);door['open_angle_rad']=math.radians(72);door['motion']='butterfly: rear end rises and swings outward';doors[name]=door
    _r26_body(body,doors,roof)
    wheels={};steer={}
    for name,point in WHEEL_CENTERS.items():
        support=_r26_empty('roadster_steer_'+name,point);support['steering_axis']='+Z'
        pivot=_r26_empty('roadster_wheel_'+name,point,support);pivot['spin_axis']='+Y';pivot['tire_radius_m']=.35
        wheels[name]=pivot
        if name.startswith('front'):steer[name]=support
        _r26_wheel(name,point,pivot)
    _r26_suspension(body);hardware,thrusters=_r26_hardware(body,trim);_r26_wing(body,wing)
    bpy.context.view_layer.update()
    return {'body':body,'doors':doors,'door_axes':{n:list(Vector(a).normalized()) for n,a in DOOR_AXES.items()},
            'roof':roof,'wing':wing,'wheels':wheels,'steer':steer,'thrusters':thrusters,'hardware':hardware,
            'materials':dict(_R26_M),'dimensions':dict(DIMENSIONS),'wheel_spin_axis':(0,1,0),'ground_z':0}
