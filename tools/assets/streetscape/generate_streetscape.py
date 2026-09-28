"""Original Vancouver street kit. Blender 4.5+, no downloaded assets/dependencies.

Run: blender --background --python generate_streetscape.py -- --output ./build
Optional: --skip-render. GLB coordinates: metres, Y up, front +Z; pivot at
ground-level centre of the facade. Blender authoring uses Z up, front -Y.
"""
from pathlib import Path
import bpy, bmesh, math, json, argparse, sys, random
from mathutils import Vector
import numpy as np

args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser()
p.add_argument('--output', default=str(Path(__file__).resolve().parent))
p.add_argument('--skip-render', action='store_true')
p.add_argument('--quick-preview', action='store_true', help='Render only the compact bay detail preview')
A=p.parse_args(args)
OUT=Path(A.output).resolve()
for d in ['assets','previews','textures']: (OUT/d).mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
bpy.context.scene.unit_settings.system='METRIC'
random.seed(928)

def texture(name, arr, noncolor=False):
    h,w=arr.shape[:2]
    img=bpy.data.images.new(name,width=w,height=h,alpha=True)
    img.colorspace_settings.name='Non-Color' if noncolor else 'sRGB'
    if arr.shape[2]==3: arr=np.concatenate([arr,np.ones((h,w,1))],axis=2)
    img.pixels.foreach_set(np.clip(arr,0,1).astype('float32').ravel())
    img.filepath_raw=str(OUT/'textures'/f'{name}.png'); img.file_format='PNG'; img.save()
    return img

def normal_from_height(h, strength=1):
    dx=np.roll(h,-1,axis=1)-np.roll(h,1,axis=1)
    dy=np.roll(h,-1,axis=0)-np.roll(h,1,axis=0)
    n=np.stack([-dx*strength,-dy*strength,np.ones_like(h)],axis=2)
    n/=np.linalg.norm(n,axis=2)[...,None]
    return n*.5+.5

def maps():
    rng=np.random.default_rng(928)
    s=512; yy,xx=np.mgrid[0:s,0:s]
    row=(yy*22//s).astype(int); ry=(yy*22/s)%1
    bx=((xx*8/s)+(row%2)*.5); col=bx.astype(int)%8; rx=bx%1
    variation=rng.uniform(-.10,.10,(22,8))[row,col]
    grain=rng.uniform(-.018,.018,(s,s))
    d=np.minimum(np.minimum(rx,1-rx)*64,np.minimum(ry,1-ry)*23.27)
    edge=np.clip((d-.45)/1.2,0,1)
    brick=np.stack([.43+variation+grain,.235+variation*.63+grain,.16+variation*.43+grain],axis=2)
    mortar=np.stack([.41+grain,.385+grain,.335+grain],axis=2)
    base=brick*edge[...,None]+mortar*(1-edge[...,None])
    h=edge*.6+grain*.8
    brickimgs=[texture('fired-brick-basecolor',base),texture('fired-brick-normal',normal_from_height(h,3),True),texture('fired-brick-roughness',np.repeat((.83+grain)[...,None],3,axis=2),True)]
    s=256; yy,xx=np.mgrid[0:s,0:s]; noise=rng.uniform(-.027,.027,(s,s))
    stone=np.stack([.61+noise,.565+noise,.47+noise],axis=2)
    stoneimgs=[texture('limestone-basecolor',stone),texture('limestone-normal',normal_from_height(noise,1.5),True)]
    woodgrain=.04*np.sin(xx*.5+3*np.sin(yy*.019))+.025*np.sin(xx*1.7+np.sin(yy*.031))+noise
    wood=np.stack([.39+woodgrain,.21+woodgrain*.64,.105+woodgrain*.35],axis=2)
    woodimgs=[texture('cedar-basecolor',wood),texture('cedar-normal',normal_from_height(woodgrain,.6),True)]
    return brickimgs,stoneimgs,woodimgs

def material(name,color,rough=.5,metal=0,imgs=None,alpha=1,emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    m.use_backface_culling=alpha==1
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,alpha)
    bs.inputs['Roughness'].default_value=rough; bs.inputs['Metallic'].default_value=metal
    bs.inputs['Alpha'].default_value=alpha
    if alpha<1: m.surface_render_method='DITHERED'
    if emission:
        bs.inputs['Emission Color'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    if imgs:
        uv=m.node_tree.nodes.new('ShaderNodeUVMap'); uv.uv_map='UVMap'
        t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=imgs[0]
        m.node_tree.links.new(uv.outputs['UV'],t.inputs['Vector'])
        m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color'])
        n=m.node_tree.nodes.new('ShaderNodeTexImage'); n.image=imgs[1]
        m.node_tree.links.new(uv.outputs['UV'],n.inputs['Vector'])
        nm=m.node_tree.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.65; nm.uv_map='UVMap'
        m.node_tree.links.new(n.outputs['Color'],nm.inputs['Color']); m.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        if len(imgs)>2:
            r=m.node_tree.nodes.new('ShaderNodeTexImage'); r.image=imgs[2]; m.node_tree.links.new(r.outputs['Color'],bs.inputs['Roughness'])
            m.node_tree.links.new(uv.outputs['UV'],r.inputs['Vector'])
    return m

bi,si,wi=maps()
M={
 'brick':material('Original fired brick • 2 m repeating PBR',(.43,.24,.16),.82,imgs=bi),
 'stone':material('Honed sandstone / limestone',(.61,.565,.47),.78,imgs=si),
 'paint':material('Heritage bottle-green enamel',(.035,.083,.067),.28,.26),
 'metal':material('Graphite powdercoat / dark metal',(.045,.055,.06),.31,.72),
 'wood':material('Oiled cedar',(.39,.21,.105),.48,imgs=wi),
 'glass':material('Clear cool glazing • alpha blend',(.35,.60,.63),.16,.15,alpha=.24),
 'window':material('Recessed upper glazing',(.095,.16,.18),.22,.55),
 'light':material('Warm frosted diffuser',(.91,.71,.39),.42,emission=.55),
}
PARTS=[]; LEVEL=0

def add(obj,name,mat):
    obj.name=name; obj.data.materials.append(M[mat]); PARTS.append(obj)
    return obj

def uv_metric(obj,tile=2):
    if obj.type!='MESH': return
    mesh=obj.data
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        normal=poly.normal; axis=max(range(3),key=lambda k:abs(normal[k]))
        for li in poly.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co
            world=obj.matrix_world@co
            if axis==1: v=(world.x/tile,world.z/tile)
            elif axis==2: v=(world.x/tile,world.y/tile)
            else: v=(world.y/tile,world.z/tile)
            uv.data[li].uv=v

def cube(name,loc,dim,mat,bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=dim
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    add(o,name,mat); uv_metric(o)
    if bevel and LEVEL==0:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=bevel; mod.segments=2
        mod.affect='EDGES'
        n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL'); n.keep_sharp=True
    return o

def mesh_obj(name,verts,faces,mat):
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    if len(faces)>1:
        bm=bmesh.new(); bm.from_mesh(mesh); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj); add(obj,name,mat); uv_metric(obj)
    return obj

def extrude_x(name,profile,width,mat):
    # Profile is a clockwise cross-section in Blender Y,Z.
    n=len(profile); vs=[(x,y,z) for x in [-width/2,width/2] for y,z in profile]
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    fs += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh_obj(name,vs,fs,mat)

def rod(name,a,b,r,mat,verts=12):
    a,b=Vector(a),Vector(b); vec=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts if LEVEL==0 else max(6,verts//2),radius=r,depth=vec.length,location=(a+b)*.5)
    o=bpy.context.object; o.rotation_euler=vec.to_track_quat('Z','Y').to_euler()
    add(o,name,mat)
    for f in o.data.polygons: f.use_smooth=True
    return o

def lathe(name,profile,mat,segments=24):
    n=segments if LEVEL==0 else max(8,segments//2)
    verts=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in profile for i in range(n)]
    faces=[]
    for j in range(len(profile)-1):
        for i in range(n): faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces += [tuple(range(n-1,-1,-1)),tuple((len(profile)-1)*n+i for i in range(n))]
    o=mesh_obj(name,verts,faces,mat)
    for f in o.data.polygons: f.use_smooth=True
    return o

def arch_band(name,cx,z,ri,ro,front,back,mat):
    n=24 if LEVEL==0 else 12; vs=[]
    for y in [front,back]:
        for r in [ri,ro]:
            for i in range(n+1):
                t=math.pi*i/n; vs.append((cx+r*math.cos(t),y,z+r*math.sin(t)))
    k=n+1; fs=[]
    for i in range(n):
        fs += [(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),
               (i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)]
    fs += [(0,k,3*k,2*k),(n,2*k+n,3*k+n,k+n)]
    return mesh_obj(name,vs,fs,mat)

def arch_pane(cx,zbase,zspring,r,y):
    n=24 if LEVEL==0 else 12
    vs=[(cx-r,y,zbase),(cx+r,y,zbase)]+[(cx+r*math.cos(i*math.pi/n),y,zspring+r*math.sin(i*math.pi/n)) for i in range(n+1)]
    return mesh_obj('Recessed arched glazing',vs,[tuple(range(len(vs)))],'window')

def text3d(label,x,y,z,size,mat='stone'):
    if LEVEL: return
    cr=bpy.data.curves.new('Original sign lettering','FONT'); cr.body=label; cr.align_x='CENTER'; cr.size=size
    cr.extrude=.002; cr.bevel_depth=.0005; cr.bevel_resolution=0; cr.resolution_u=3
    ob=bpy.data.objects.new(label,cr); bpy.context.collection.objects.link(ob)
    ob.location=(x,y,z); ob.rotation_euler=(math.pi/2,0,0); cr.materials.append(M[mat]); PARTS.append(ob)

def heritage():
    # 6.4 m repeating two-storey facade. Wall has actual recessed apertures.
    w=6.4
    cube('Stone threshold',(0,.08,.12),(w,.55,.24),'stone',.025)
    for x in [-3.04,3.04]:
        cube('Rusticated corner pier',(x,.22,2.11),(.32,.54,3.92),'stone',.025)
        if LEVEL==0:
            for z in np.arange(.6,3.6,.42): cube('Rustication shadow joint',(x,-.057,z),(.33,.018,.017),'metal',0)
    for x in [-.7,.7]: cube('Deep painted shop pilaster',(x,.14,1.98),(.14,.46,3.62),'paint',.018)
    for x in [-2.0,2.0]:
        cube('Display stallriser',(x,.16,.45),(2.1,.42,.62),'paint',.025)
        for px in [x-.7,x,x+.7]:
            cube('Inset stallriser panel',(px,-.068,.45),(.57,.028,.36),'wood',.006)
        cube('Display glazing',(x,.17,1.85),(2.02,.014,2.06),'glass',0)
        cube('Display window lower moulding',(x,-.04,.79),(2.16,.18,.1),'stone',.012)
        for px in [x-1.055,x+1.055]: cube('Shop frame',(px,.05,1.9),(.075,.14,2.2),'paint',.009)
        cube('Transom beam',(x,.04,2.99),(2.18,.2,.095),'paint',.012)
        cube('Transom glazing',(x,.13,3.3),(2.02,.014,.51),'window',0)
        for dx in [-.68,0,.68]: cube('Fine transom mullion',(x+dx,.055,3.3),(.035,.1,.52),'paint',.004)
        # Explicit shallow interior volume, no stolen imagery or fake baked reflection.
        cube('Warm rear display wall',(x,1.72,1.91),(2.12,.10,3.02),'stone',.012)
        cube('Display room floor',(x,.89,.22),(2.05,1.7,.08),'wood',.01)
        cube('Cedar display shelf',(x,.73,1.03),(1.88,.75,.1),'wood',.015)
        if LEVEL==0:
            for k in range(8):
                cube('Independent display books',(x-.77+k*.2,.91,1.23+((k%3)*.03)),(.13,.26,.32+(k%3)*.06),'wood' if k%2 else 'paint',.007)
            rod('Pendant cable',(x,.8,3.28),(x,.8,2.69),.011,'metal',8)
            shade=lathe('Conical pendant',[(.23,2.65),(.23,2.7),(.065,2.89),(.065,2.93)],'paint',24); shade.location.x=x; shade.location.y=.8
            cube('Warm interior diffuser',(x,.8,2.647),(.3,.3,.025),'light',.008)
    cube('Recessed shop door',(0,.39,1.54),(1.16,.08,2.86),'paint',.02)
    cube('Door glazing',(0,.333,1.8),(.96,.015,1.94),'glass',0)
    cube('Door interior backing',(0,.48,1.85),(.99,.03,1.98),'window',.006)
    cube('Door kickplate',(0,.333,.32),(1,.023,.22),'metal',.007)
    rod('Door pull',(.39,.26,1.15),(.39,.26,1.7),.021,'metal')
    for z in [1.15,1.7]: rod('Door pull spacer',(.39,.26,z),(.39,.35,z),.018,'metal')
    cube('Door fanlight',(0,.31,3.31),(1.18,.03,.54),'window',.005)
    cube('Shop fascia',(0,.06,3.89),(6.05,.30,.52),'paint',.026)
    text3d('HARBOUR  &  PINE',0,-.105,3.79,.25)
    for z,d,h in [(3.59,.40,.07),(4.18,.48,.10),(4.32,.57,.13)]: cube('Shopfront cornice',(0,.11-d/2,z),(6.34,d,h),'stone',.016)
    # Native green metal rain hood, with scalloped edge assembled as shaped mesh.
    extrude_x('Sloped shop rain hood',[(.03,3.54),(-1.08,3.18),(-1.08,3.12),(.03,3.48)],5.68,'paint')
    for x in [-2.62,2.62]: rod('Awning support',(x,-.10,2.79),(x,-.99,3.16),.023,'metal')
    for x in np.linspace(-2.72,2.72,18 if LEVEL==0 else 9):
        cube('Scalloped hood valance',(float(x),-1.082,3.05),(.29 if LEVEL==0 else .60,.044,.18),'paint',.065 if LEVEL==0 else 0)
    cube('Upper sill belt',(0,.15,4.66),(w,.61,.17),'stone',.025)
    cube('Brick beneath windows',(0,.25,4.52),(w,.50,.28),'brick',.01)
    centres=[-2.14,0,2.14]; half=.69; spring=6.88; base=4.83; top=7.83
    intervals=[(-3.2,-2.14-half),(-2.14+half,-half),(half,2.14-half),(2.14+half,3.2)]
    for a,b in intervals: cube('Brick window pier',((a+b)/2,.25,(base+top)/2),(b-a,.50,top-base),'brick',.006)
    for cx in centres:
        arch_pane(cx,base+.06,spring,.645,.25)
        # Spandrel brick from curved arch to continuous cornice.
        n=24 if LEVEL==0 else 12; verts=[]; faces=[]
        for i in range(n):
            x1=-half+2*half*i/n; x2=-half+2*half*(i+1)/n
            h1=spring+math.sqrt(max(0,half*half-x1*x1)); h2=spring+math.sqrt(max(0,half*half-x2*x2))
            j=len(verts); verts += [(cx+x1,0,h1),(cx+x2,0,h2),(cx+x2,0,top),(cx+x1,0,top),
                                    (cx+x1,.5,h1),(cx+x2,.5,h2),(cx+x2,.5,top),(cx+x1,.5,top)]
            faces += [(j,j+1,j+2,j+3),(j+4,j+7,j+6,j+5),(j,j+4,j+5,j+1)]
        mesh_obj('Curved arch spandrel',verts,faces,'brick')
        arch_band('Stone arched window surround',cx,spring,.65,.795,-.075,.105,'stone')
        arch_band('Green arched timber sash',cx,spring,.586,.644,.135,.23,'paint')
        for dx in [-.64,.64]:
            cube('Stone jamb',(cx+dx,-.018,(base+spring)/2),(.12,.16,spring-base),'stone',.012)
            cube('Recessed timber sash',(cx+dx*.945,.17,(base+spring)/2),(.052,.08,spring-base),'paint',.009)
        cube('Window stone projecting sill',(cx,-.072,base-.03),(1.64,.39,.16),'stone',.021)
        cube('Stone key',(cx,-.10,spring+.71),(.21,.23,.26),'stone',.015)
        cube('Vertical sash',(cx,.153,(base+spring)/2),(.046,.07,spring-base),'paint',.006)
        for z in [5.78,spring]: cube('Horizontal sash',(cx,.149,z),(1.23,.08,.056),'paint',.006)
    cube('Brick crown',(0,.25,8.02),(w,.5,.38),'brick',.01)
    profile=[(.47,8.11),(-.05,8.11),(-.07,8.19),(-.18,8.25),(-.21,8.34),(-.29,8.39),(-.39,8.42),(-.42,8.55),(-.40,8.61),(.47,8.61)]
    extrude_x('Sculpted projecting crown cornice',profile,6.67,'stone')
    for x in np.linspace(-3.01,3.01,20 if LEVEL==0 else 10):
        cube('Cornice dentil',(float(x),-.115,8.08),(.13 if LEVEL==0 else .22,.19,.15),'stone',.007)
    for x in [-3.02,3.02]:
        for z,d in [(7.6,.11),(7.72,.16),(7.84,.22)]: cube('Corbel projection',(x,-d/2,z),(.27,d,.14),'stone',.012)
    cube('Roof / rear closure',(0,.56,8.15),(6.4,.60,.11),'metal',.01)

def modern():
    cube('Lobby terrazzo threshold',(0,.44,.13),(8.2,1.10,.26),'stone',.025)
    for x in [-3.88,3.88]: cube('Tall honed stone jamb',(x,.47,2.44),(.46,1.16,4.60),'stone',.035)
    cube('Stone header',(0,.45,4.67),(8.20,1.13,.33),'stone',.035)
    cube('Interior ceiling',(0,1.17,4.23),(7.36,2,.12),'wood',.022)
    cube('Interior back wall',(0,2.12,2.15),(7.43,.1,4.07),'stone',.01)
    cube('Interior lobby floor',(0,1.12,.22),(7.35,2.05,.16),'stone',.025)
    for x in [-3.64,-1.28,1.28,3.64]: cube('Curtain wall vertical mullion',(x,.14,2.41),(.062,.18,4.15),'metal',.012)
    for x in [-2.46,2.46]:
        cube('Clear curtain glazing',(x,.19,2.37),(2.28,.018,4.08),'glass',0)
        cube('Curtain wall transom',(x,.14,3.33),(2.36,.18,.058),'metal',.007)
    cube('Door head transom',(0,.16,3.31),(2.52,.18,.07),'metal',.011)
    cube('Glazing above entry',(0,.19,3.91),(2.48,.018,1.12),'glass',0)
    for x in [-.62,.62]:
        cube('Lobby glass door',(x,.37,1.80),(1.20,.018,2.94),'glass',0)
        for dx in [-.59,.59]: cube('Recessed door frame',(x+dx,.32,1.80),(.047,.14,3.02),'metal',.008)
        for z in [.32,3.30]: cube('Door horizontal rail',(x,.32,z),(1.23,.14,.056),'metal',.007)
        hx=x+(.40 if x<0 else -.40)
        rod('Vertical stainless door handle',(hx,.18,1.15),(hx,.18,2.06),.021,'metal')
        for z in [1.15,2.06]: rod('Handle stand-off',(hx,.18,z),(hx,.33,z),.017,'metal')
    # Glass canopy with continuous slender edge, rafters, tied suspension.
    extrude_x('Cantilever glass rain canopy',[(.10,3.69),(-1.89,3.52),(-1.89,3.48),(.10,3.65)],8.28,'glass')
    cube('Canopy front fascia',(0,-1.90,3.48),(8.43,.10,.16),'metal',.026)
    for x in [-4.08,-2.04,0,2.04,4.08]:
        rod('Canopy structural rafter',(x,.18,3.68),(x,-1.90,3.50),.038,'metal',12)
        if x in [-2.04,2.04]: rod('Canopy suspension rod',(x,.09,4.48),(x,-1.66,3.53),.019,'metal',10)
    cube('Warm entry linear light',(0,-.1,3.60),(2.35,.10,.035),'light',.01)
    if LEVEL==0:
        for x in np.linspace(-3.42,3.42,32): cube('Vertical cedar lobby slat',(float(x),2.04,2.40),(.055,.12,3.53),'wood',.009)
        cube('Lobby reception console',(-2.1,1.24,.83),(2.3,.7,1.07),'wood',.032)
        cube('Lobby stone console top',(-2.1,1.24,1.40),(2.39,.76,.07),'stone',.015)
        text3d('W A T E R F R O N T',0,-.15,4.55,.17,'metal')
    cube('Lobby bench seat',(2.43,1.37,.64),(1.45,.55,.13),'wood',.038)
    for x in [1.90,2.95]: cube('Bench support',(x,1.37,.39),(.11,.43,.42),'metal',.011)

def curved_rod(name,points,r,mat):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=8 if LEVEL==0 else 4
    c.bevel_depth=r; c.bevel_resolution=2 if LEVEL==0 else 0
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for b,co in zip(s.bezier_points,points): b.co=co; b.handle_left_type='AUTO'; b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o); c.materials.append(M[mat]); PARTS.append(o); return o

def lamp():
    lathe('Cast lamp pedestal',[(.22,0),(.22,.10),(.185,.16),(.18,.26),(.13,.31),(.115,.83),(.092,.91),(.075,1.03),(.075,3.74),(.11,3.80),(.12,3.89),(.09,3.94),(.07,4.37),(.02,4.49)],'paint')
    if LEVEL==0:
        for t in np.linspace(0,math.tau,12,endpoint=False): rod('Post fluting',(.081*math.cos(t),.081*math.sin(t),1.02),(.081*math.cos(t),.081*math.sin(t),3.68),.008,'paint',6)
    for sign in [-1,1]:
        curved_rod('Curved lantern arm',[(0,0,3.87),(.30*sign,0,4.12),(.62*sign,0,4.20),(.84*sign,0,4.03)],.041,'paint')
        x=.83*sign
        # Hanging lantern under arched arm: frosted taper with four protective frames.
        z1=3.30; z2=3.89
        verts=[(x+dx,y,z) for z,r in [(z1,.14),(z2,.21)] for dx,y in [(-r,-r),(r,-r),(r,r),(-r,r)]]
        mesh_obj('Warm frosted lantern',verts,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'light')
        for dx,dy in [(-1,-1),(1,-1),(1,1),(-1,1)]: rod('Lantern corner strut',(x+dx*.14,dy*.14,z1),(x+dx*.215,dy*.215,z2),.019,'paint',8)
        for z,r in [(z1,.16),(z2,.235)]: cube('Lantern square bead',(x,0,z),(r*2,r*2,.055),'paint',.009)
        roof=lathe('Lantern pyramidal cap',[(.325,3.93),(.325,3.975),(.10,4.17),(.04,4.18)],'paint',4); roof.location.x=x; roof.rotation_euler.z=math.pi/4
        foot=lathe('Lantern lower finial',[(.08,3.17),(.13,3.25),(.16,3.3)],'paint',12); foot.location.x=x

def bench():
    for x in [-.83,.83]:
        rod('Splayed bench front leg',(x,-.26,.04),(x,-.13,.45),.036,'metal')
        rod('Splayed bench rear leg',(x,.28,.04),(x,.16,.46),.036,'metal')
        rod('Seat bearer',(x,-.30,.43),(x,.31,.43),.034,'metal')
        rod('Back support',(x,.21,.43),(x,.37,.94),.031,'metal')
    for y in [-.24,-.12,0,.12,.24]: cube('Rounded cedar seat slat',(0,y,.48),(2.02,.094,.058),'wood',.020)
    for z in [.67,.80,.93]:
        o=cube('Rounded cedar back slat',(0,.29+(z-.67)*.27,z),(2.02,.06,.106),'wood',.020); o.rotation_euler.x=-.25
    for x in [-.84,.84]:
        curved_rod('Accessible armrest',[(x,-.22,.46),(x,-.24,.66),(x,.17,.66),(x,.23,.51)],.026,'metal')
    rod('Bench cross brace',(-.82,.13,.26),(.82,.13,.26),.026,'metal')

def shelter():
    for x in [-2.08,2.08]:
        for y in [-.03,1.19]:
            cube('Shelter anchored baseplate',(x,y,.035),(.23,.23,.07),'metal',.014)
            cube('Slender shelter column',(x,y,1.33),(.065,.075,2.58),'metal',.015)
    # Slightly swept roof profile instead of a slab.
    profile=[(-.34,2.66),(.12,2.76),(.59,2.82),(1.04,2.81),(1.52,2.72),(1.52,2.65),(1.04,2.74),(.59,2.75),(.12,2.69),(-.34,2.59)]
    extrude_x('Swept shelter roof',profile,4.56,'metal')
    for x in [-1.56,-.52,.52,1.56]: cube('Clear rear shelter pane',(x,1.20,1.36),(.995,.017,2.27),'glass',0)
    for x in [-2.08,2.08]: cube('Clear side shelter pane',(x,.58,1.35),(.017,1.13,2.24),'glass',0)
    for z in [.22,2.52]: cube('Back glazing rail',(0,1.21,z),(4.2,.064,.056),'metal',.008)
    for x in [-1.04,0,1.04]: cube('Back glazing seam',(x,1.2,1.36),(.028,.06,2.32),'metal',.005)
    # Safe glass manifestation dots: geometry survives GLB without labels/textures.
    for x in np.linspace(-1.97,1.97,31 if LEVEL==0 else 16): cube('Visibility frit',(float(x),1.186,1.13),(.035 if LEVEL==0 else .05,.008,.035),'stone',0)
    cube('Illuminated roof inset',(0,.64,2.73),(2.6,.075,.025),'light',.004)
    begin=len(PARTS); bench()
    for o in PARTS[begin:]: o.location.y+=.69; o.location.x+=.25
    cube('Timetable panel',(-1.64,.85,1.42),(.53,.075,1.65),'metal',.018)
    cube('Timetable face',(-1.64,.805,1.42),(.45,.012,1.54),'stone',.008)
    cube('Transit blue header',(-1.64,.793,2.10),(.45,.014,.20),'paint',.006)
    text3d('TRANSIT',-1.64,.78,2.06,.067,'stone')
    if LEVEL==0:
        for k in range(13): cube('Abstract timetable rule',(-1.64,.791,1.84-k*.078),(.32-(k%3)*.02,.008,.014),'metal',0)
    for x in [-2.10,2.10]:
        cube('Side safety marker',(x-.009 if x>0 else x+.009,.56,1.12),(.012,.8,.035),'stone',0)

def heritage_bay():
    # Compact independent ground-storey facade unit; human dimensions never scaled.
    cube('Low sandstone threshold',(0,.20,.105),(3.2,.75,.21),'stone',.023)
    for x in [-1.49,1.49]:
        cube('Brick end pier',(x,.15,2.21),(.22,.44,4.21),'brick',.012)
        cube('Sandstone pier shoe',(x,.105,.46),(.25,.53,.60),'stone',.020)
        cube('Pier capital',(x,.045,3.61),(.27,.59,.16),'stone',.020)
    cube('Door shop dividing pilaster',(-.43,.08,1.94),(.115,.33,3.45),'paint',.015)
    for x in [-1.34,1.34]: cube('Enamel shop perimeter stile',(x,.04,1.94),(.075,.26,3.43),'paint',.012)
    cube('Display stallriser',(.455,.085,.48),(1.68,.27,.65),'paint',.024)
    for x in [.03,.88]: cube('Recessed cedar front panel',(x,-.059,.48),(.67,.025,.40),'wood',.008)
    cube('Display stone sill',(.455,-.012,.81),(1.76,.30,.11),'stone',.015)
    cube('Deep display glazing',(.455,.155,1.895),(1.68,.016,2.00),'glass',0)
    for x in [-.375,1.28]: cube('Display timber frame',(x,.06,1.88),(.056,.12,2.04),'paint',.009)
    cube('Shop transom rail',(.0,.07,2.96),(2.69,.21,.105),'paint',.013)
    cube('Display fanlight',(.455,.16,3.245),(1.68,.018,.465),'window',0)
    cube('Door fanlight',(-.875,.28,3.245),(.83,.017,.465),'window',0)
    for x in [-.08,.46,1.02]: cube('Fine transom upright',(x,.08,3.245),(.032,.09,.475),'paint',.004)
    cube('Recessed entry door',(-.875,.34,1.62),(.85,.07,2.66),'paint',.017)
    cube('Entry door inset',(-.875,.291,1.91),(.69,.015,1.86),'window',.004)
    cube('Entry kickplate',(-.875,.29,.42),(.68,.018,.24),'metal',.006)
    rod('Brushed door pull',(-.595,.24,1.24),(-.595,.24,1.78),.018,'metal')
    for z in [1.24,1.78]: rod('Handle pin',(-.595,.24,z),(-.595,.30,z),.013,'metal',8)
    cube('Display interior floor',(.455,.81,.27),(1.65,1.42,.10),'wood',.01)
    cube('Display rear wall',(.455,1.49,1.83),(1.68,.10,2.94),'stone',.012)
    cube('Display counter',(.455,.82,1.06),(1.48,.64,.10),'wood',.019)
    cube('Display interior ceiling',(.455,.77,3.36),(1.68,1.45,.12),'wood',.018)
    if LEVEL==0:
        for k in range(7):
            cube('Small display book',(-.09+k*.16,1.0,1.285+(k%3)*.022),(.10,.24,.33+(k%3)*.044),'paint' if k%2 else 'wood',.006)
        for z in [1.77,2.32]: cube('Wall display shelf',(.455,1.29,z),(1.47,.31,.055),'wood',.01)
        shade=lathe('Display pendant shade',[(.15,2.79),(.15,2.83),(.048,2.99)],'paint',20); shade.location.x=.49; shade.location.y=.71
        rod('Pendant cable',(.49,.71,2.99),(.49,.71,3.3),.008,'metal',8)
        cube('Warm display pendant',(.49,.71,2.78),(.2,.20,.025),'light',.01)
    cube('Painted shop fascia',(0,.00,3.87),(2.80,.29,.47),'paint',.025)
    text3d('HARBOUR & PINE',0,-.152,3.80,.168)
    extrude_x('Original rolled shop cornice',[(.36,4.10),(-.16,4.10),(-.19,4.15),(-.27,4.19),(-.32,4.24),(-.33,4.34),(.36,4.34)],3.20,'stone')
    for x in np.linspace(-1.41,1.41,13 if LEVEL==0 else 7): cube('Small cornice dentil',(float(x),-.14,4.065),(.10 if LEVEL==0 else .16,.12,.09),'stone',.006)
    extrude_x('Weather hood',[(.015,3.54),(-.91,3.22),(-.91,3.16),(.015,3.48)],2.75,'paint')
    cube('Rolled hood valance',(0,-.915,3.12),(2.77,.057,.13),'paint',.028)
    for x in [-1.22,1.22]: rod('Rain hood angle bracket',(x,-.05,2.86),(x,-.84,3.21),.018,'metal',10)

def modern_bay():
    cube('Terrazzo entry threshold',(0,.29,.105),(3.20,.76,.21),'stone',.022)
    for x in [-1.495,1.495]: cube('Honed stone facade jamb',(x,.29,2.27),(.21,.64,4.15),'stone',.025)
    cube('Honed stone top lintel',(0,.30,4.245),(3.2,.66,.21),'stone',.026)
    cube('Lobby rear wall',(0,1.47,2.16),(2.79,.10,3.94),'stone',.015)
    cube('Lobby floor',(0,.84,.23),(2.78,1.35,.15),'stone',.023)
    cube('Cedar interior ceiling',(0,.83,4.01),(2.78,1.39,.105),'wood',.019)
    for x in [-1.37,-.92,.92,1.37]: cube('Curtain wall vertical',(x,.095,2.145),(.038,.135,3.82),'metal',.009)
    for x in [-1.145,1.145]: cube('Fixed glazed sidelight',(x,.12,2.145),(.4,.012,3.77),'glass',0)
    cube('Head transom bar',(0,.09,3.15),(2.79,.14,.052),'metal',.008)
    cube('Glazing above doors',(0,.13,3.58),(1.80,.012,.80),'glass',0)
    for x in [-.455,.455]:
        cube('Recessed entry door glass',(x,.265,1.72),(.87,.014,2.80),'glass',0)
        for xx in [x-.435,x+.435]: cube('Slender door frame',(xx,.225,1.72),(.035,.09,2.88),'metal',.007)
        for z in [.28,3.15]: cube('Door horizontal shoe',(x,.225,z),(.9,.09,.045),'metal',.006)
        hx=x+(.29 if x<0 else -.29)
        rod('Entry pull',(hx,.115,1.21),(hx,.115,1.98),.017,'metal',12)
        for z in [1.21,1.98]: rod('Pull pin',(hx,.115,z),(hx,.23,z),.012,'metal',8)
    extrude_x('Clear cantilever canopy',[(.03,3.49),(-1.38,3.34),(-1.38,3.295),(.03,3.445)],3.20,'glass')
    cube('Canopy leading frame',(0,-1.39,3.31),(3.20,.077,.11),'metal',.014)
    for x in [-1.53,0,1.53]: rod('Canopy beam',(x,.08,3.46),(x,-1.39,3.315),.024,'metal',10)
    for x in [-1.22,1.22]: rod('Canopy tension tie',(x,.02,4.01),(x,-1.15,3.36),.013,'metal',8)
    cube('Entry linear diffuser',(0,-.12,3.42),(1.61,.07,.018),'light',.004)
    if LEVEL==0:
        for x in np.linspace(-1.28,1.28,22): cube('Cedar wall batten',(float(x),1.405,2.36),(.044,.10,3.36),'wood',.007)
        cube('Interior mail console',(-.65,1.12,.90),(.92,.36,1.19),'wood',.021)
        cube('Console stone top',(-.65,1.11,1.51),(1.0,.4,.065),'stone',.012)
        text3d('L O B B Y',0,-.049,4.21,.105,'metal')

BUILDERS={'heritage-shop-bay':heritage_bay,'modern-lobby-bay':modern_bay,'heritage-shopfront':heritage,'modern-lobby':modern,'heritage-lamp':lamp,'cedar-bench':bench,'transit-shelter':shelter}
DESCRIPTIONS={
 'heritage-shop-bay':'Original compact 3.2 m ground-storey facade with recessed entry, moulded cornice, masonry piers, glazed shop display, enamel rain hood and shallow interior. Fictional Harbour & Pine sign.',
 'modern-lobby-bay':'Original compact 3.2 m ground-storey facade with double entry, slim glazed rain canopy, suspension ties, stone jambs and cedar interior.',
 'heritage-shopfront':'Original two-storey masonry facade with genuinely recessed arched windows, moulded cornice, enamel shopfront, sloped rain hood and shallow shop interiors. Fictional Harbour & Pine sign.',
 'modern-lobby':'Original glazed lobby facade with cantilever rain canopy, suspension rods, recessed entry, cedar interior and stone threshold. A typology, not a surveyed building.',
 'heritage-lamp':'Original twin hanging lantern with fluted cast post, curved arms and frosted diffusers; no light objects included.',
 'cedar-bench':'Original cedar-slat bench with rounded slats, splayed legs and armrests.',
 'transit-shelter':'Original glazed shelter with swept roof, manifestation marks, timetable panel and cedar bench. Generic transit typology; not an official TransLink asset.'}

def clear_parts():
    global PARTS
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob,do_unlink=True)
    PARTS=[]

def finish(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS: o.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join(); ob=bpy.context.object; ob.name=name
    bpy.context.scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    # Compact bay assets mount in front of uncut GIS walls. Their shallow display
    # recess stays visible without changing measured massing or collision. X/Z
    # dimensions remain in metres; only non-walkable interior depth is compressed.
    if name in ['heritage-shop-bay','modern-lobby-bay']:
        for vertex in ob.data.vertices:
            y=vertex.co.y
            vertex.co.y=(y*.18 if y>0 else y)-.30
            # Actual displayed sidewalks sit about 1.58 m above the shared
            # foundation datum. Keep the lower human-scale entry unchanged and
            # redesign the transom/sign/crown into a 3.2 m frontage so the module
            # fits below the measured facade's first upper-window band.
            if vertex.co.z>2.40:
                vertex.co.z=2.40+(vertex.co.z-2.40)*(.80/1.95)
        ob.data.update()
    # Triangulate explicitly for stable measured counts and exporter compatibility.
    mod=ob.modifiers.new('Runtime triangles','TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=mod.name)
    # Join can leave repeated material slots. Deduplicate while preserving per-face material.
    unique=[]; remap={}
    for i,m in enumerate(ob.data.materials):
        if m not in unique: unique.append(m)
        remap[i]=unique.index(m)
    indices=[remap[f.material_index] for f in ob.data.polygons]
    ob.data.materials.clear()
    for m in unique: ob.data.materials.append(m)
    for f,i in zip(ob.data.polygons,indices): f.material_index=i
    ob['units']='metres'; ob['front_axis']='+Z in glTF'; ob['original_asset']=True
    ob['generator']='generate_streetscape.py'; ob['lod']=LEVEL
    bounds=[ob.matrix_world@Vector(v) for v in ob.bound_box]
    bmin=[min(v[k] for v in bounds) for k in range(3)]; bmax=[max(v[k] for v in bounds) for k in range(3)]
    stats={'vertices':len(ob.data.vertices),'triangles':len(ob.data.polygons),'materials':len(unique),
           'bounds':{'min':[round(bmin[0],4),round(bmin[2],4),round(-bmax[1],4)],'max':[round(bmax[0],4),round(bmax[2],4),round(-bmin[1],4)]}}
    return ob,stats

def bake_opaque_atlas(ob,key,stats):
    """Bake original metre-UV PBR to one opaque atlas, retaining glass/light.

    Diffuse is color-only (no painted-in light); tangent normals and material
    roughness/metallic survive independently. ORM R=1, no fake baked shadows.
    """
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=8
    scene.render.bake.margin=8; scene.render.bake.use_clear=True
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    atlasuv=ob.data.uv_layers.new(name='RuntimeAtlas'); ob.data.uv_layers.active=atlasuv; atlasuv.active_render=True
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(72),island_margin=.007,area_weight=.35,correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    source=list(ob.data.materials); nodes=[]
    for mat in source:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage'); mat.node_tree.nodes.active=node; nodes.append((mat,node))
    def baked_image(suffix,noncolor):
        size=1024 if LEVEL==0 else 512
        img=bpy.data.images.new(f'{key}-lod{LEVEL}-{suffix}',width=size,height=size,alpha=False)
        img.colorspace_settings.name='Non-Color' if noncolor else 'sRGB'
        for mat,node in nodes: node.image=img; mat.node_tree.nodes.active=node
        return img
    def save(img):
        img.filepath_raw=str(OUT/'textures'/f'{img.name}.png'); img.file_format='PNG'; img.save()
    base=baked_image('basecolor',False)
    bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'}); save(base)
    normal=baked_image('normal',True)
    bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT'); save(normal)
    orm=baked_image('orm',True); temporary=[]
    for mat,node in nodes:
        nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF'); out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
        combine=nt.nodes.new('ShaderNodeCombineXYZ'); combine.inputs['X'].default_value=1
        for keyin,bsname in [('Y','Roughness'),('Z','Metallic')]:
            socket=bs.inputs[bsname]
            if socket.is_linked: nt.links.new(socket.links[0].from_socket,combine.inputs[keyin])
            else: combine.inputs[keyin].default_value=socket.default_value
        emit=nt.nodes.new('ShaderNodeEmission'); nt.links.new(combine.outputs[0],emit.inputs['Color']); nt.links.new(emit.outputs[0],out.inputs['Surface'])
        temporary.append((mat,combine,emit,out,bs))
    bpy.ops.object.bake(type='EMIT'); save(orm)
    for mat,combine,emit,out,bs in temporary:
        mat.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface']); mat.node_tree.nodes.remove(combine); mat.node_tree.nodes.remove(emit)
    for mat,node in nodes: mat.node_tree.nodes.remove(node)
    # Original metre UVs are only needed for baking. Keep one canonical UV set in GLB.
    for layer in list(ob.data.uv_layers):
        if layer.name!='RuntimeAtlas': ob.data.uv_layers.remove(layer)
    ob.data.uv_layers[0].name='UVMap'
    atlas=bpy.data.materials.new(f'{key}-lod{LEVEL} original baked opaque PBR'); atlas.use_nodes=True; atlas.use_backface_culling=True
    nt=atlas.node_tree; bs=nt.nodes.get('Principled BSDF')
    uv=nt.nodes.new('ShaderNodeUVMap'); uv.uv_map='UVMap'
    ims=[]
    for img in [base,normal,orm]:
        tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=img; nt.links.new(uv.outputs['UV'],tex.inputs['Vector']); ims.append(tex)
    nt.links.new(ims[0].outputs['Color'],bs.inputs['Base Color'])
    nm=nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map='UVMap'; nt.links.new(ims[1].outputs['Color'],nm.inputs['Color']); nt.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    sep=nt.nodes.new('ShaderNodeSeparateColor'); sep.mode='RGB'; nt.links.new(ims[2].outputs['Color'],sep.inputs[0])
    nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']); nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    indices=[1 if source[f.material_index]==M['glass'] else 2 if source[f.material_index]==M['light'] else 0 for f in ob.data.polygons]
    ob.data.materials.clear()
    for mat in [atlas,M['glass'],M['light']]: ob.data.materials.append(mat)
    for f,i in zip(ob.data.polygons,indices): f.material_index=i
    stats['materials']=len(set(indices)); stats['pbrAtlas']={'resolution':1024 if LEVEL==0 else 512,'maps':['basecolor','normal','ORM'],'occlusion':'R=1 (unbaked); roughness in G; metallic in B'}

def render_stage():
    clear_parts(); global LEVEL,PARTS
    LEVEL=0
    # Display placement only; module source pivots are untouched in their exports.
    for key,x,y in [('heritage-shopfront',-5,0),('modern-lobby-bay',.23,.16),('heritage-shop-bay',3.43,0),('transit-shelter',8,-1.1),('heritage-lamp',-1.7,-2.3),('cedar-bench',-5,-2.1)]:
        # Preview the actual exported files, including baked atlas and GLB normals.
        before=set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT/'assets'/f'{key}.lod0.glb'))
        added=set(bpy.data.objects)-before
        for ob in added:
            if ob.parent not in added: ob.location+=(Vector((x,y,0)))
    PARTS=[]
    cube('Preview pavement only',(1,0,-.12),(23,8,.22),'stone',.08)
    # Joint grid is only part of preview ground, not any shipping module.
    for x in range(-10,13): cube('Pavement joint',(x,-1,-.004),(.012,6,.011),'metal',0)
    for y in range(-4,4): cube('Pavement joint',(1,y,-.004),(23,.012,.011),'metal',0)
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32
    scene.cycles.use_denoising=True; scene.render.resolution_x=1680; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
    scene.world.use_nodes=True; scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.32,.40,.48,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.5
    bpy.ops.object.light_add(type='AREA',location=(-7,-8,13)); key=bpy.context.object; key.data.energy=1700; key.data.shape='DISK'; key.data.size=7
    key.rotation_euler=(Vector((0,0,3))-key.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.light_add(type='SUN',location=(0,0,10)); sun=bpy.context.object; sun.data.energy=2.2; sun.data.angle=.09; sun.rotation_euler=(math.radians(26),math.radians(-24),math.radians(-28))
    bpy.ops.object.camera_add(location=(15.7,-25.6,13.7)); cam=bpy.context.object; cam.rotation_euler=(Vector((1.1,.0,3.3))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.type='ORTHO'; cam.data.ortho_scale=26.2; scene.camera=cam
    scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'; scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(OUT/'previews'/'streetscape-kit.png')
    for img in bpy.data.images:
        if img.source=='FILE' and not img.packed_file:
            try: img.pack()
            except RuntimeError: pass
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'streetscape-source.blend'))
    if A.quick_preview:
        cam.location=(6.1,-10.6,5.8); cam.rotation_euler=(Vector((1.85,0,1.75))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=7.2
        scene.render.resolution_x=1440; scene.render.resolution_y=1000; scene.render.filepath=str(OUT/'previews'/'bays-detail.png'); bpy.ops.render.render(write_still=True)
        return
    bpy.ops.render.render(write_still=True)
    cam.location=(-10.5,-12.7,7.5); cam.rotation_euler=(Vector((-5,0,4.1))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=11.8
    scene.render.resolution_x=1200; scene.render.resolution_y=1200; scene.render.filepath=str(OUT/'previews'/'heritage-detail.png'); bpy.ops.render.render(write_still=True)
    cam.location=(6.1,-10.6,5.8); cam.rotation_euler=(Vector((1.85,0,2.1))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=8.2
    scene.render.resolution_x=1440; scene.render.resolution_y=1000; scene.render.filepath=str(OUT/'previews'/'bays-detail.png'); bpy.ops.render.render(write_still=True)

manifest={'kit':'Vancouver original streetscape kit','version':2,'license':'LicenseRef-Vancouver-Living-Atlas-NC-1.0','geometryAuthor':'Original procedural modelling for Vancouver Living Atlas',
 'interface':{'maximumHeightM':3.2,'minimumEntryClearanceM':2.3,'reliefBackMinM':.0228,'foundationDatumNote':'Pavement is generally terrain + 1.18 m, shared facade foundation terrain - 0.4 m. Placement uses actual sidewalk samples and first upper pane clearance; do not scale modules to force a fit.'},
 'units':'metres','upAxis':'+Y','frontAxis':'+Z','origin':'Ground centre of facade plane for facade modules; ground centre for furniture',
 'coordinateConversion':'Blender (x,y,z) exports as glTF (x,z,-y). No manual loader rotation required.',
 'reproduction':'Blender 4.5+: blender --background --python generate_streetscape.py -- --output OUTPUT [--skip-render]',
 'placementNotes':['Facade module +Z points toward the street. Place local z=0 on the existing facade plane. Compact shipped bays sit entirely in +Z outside the opaque GIS wall; optional full-height library modules may extend into -Z.',
 'Compact bays are 3.2 m tall surface-mounted relief. The shallow interior occupies the first 0.3 m outside the GIS wall; the canopy projects farther. No entry or walkable interior is claimed.',
 'Use facade modules in near-street LOD only, and suppress overlapping procedural ground details within their extents.',
 'Use uniform scale, ideally 1; adjust placement or repeat bays instead of stretching door and human-scale details.',
 'Keep the compact bay crown at least 0.02 m below the physical bottom of the preserved first upper window sill. Suppress only overlapping procedural ground frontage; retain upper window frames and sills.',
 'Facade modules are original architectural typologies and have not been surveyed; they are not exact historic reconstructions.',
 'Glazing uses alpha-blended standard PBR, no transmission extension. Sort transparent primitives normally and disable glass depthWrite if integration requires it.',
 'Emissive diffusers are visual materials, not runtime point lights. No shadows or lights are exported.'],
 'lodRecommendations':{'lod0':'0–60 m, detailed frames/bevels/interior props','lod1':'60–150 m, same silhouette without small contents and most bevels','beyond':'Cull furniture; rely on existing city massing for facades. Tune distances to projected size and device.'},
 'referenceSources':[{'title':'City of Vancouver Gastown Heritage Management Plan','url':'https://vancouver.ca/files/cov/gastown-heritage-management-plan-2001.pdf','use':'Typological research only; no images, meshes or texture pixels copied.'},
 {'title':'City of Vancouver Gastown HA-2 Design Guidelines','url':'https://vancouver.ca/files/cov/gastown-ha2-design-guidelines.pdf','use':'General storefront, cornice and masonry proportions only.'},
 {'title':'City of Vancouver Central Area Pedestrian Weather Protection','url':'https://guidelines.vancouver.ca/guidelines-central-area-pedestrian-weather-protection.pdf','use':'General rain-canopy function only.'}],
 'assets':[]}
for key,builder in BUILDERS.items():
    entry={'id':key,'description':DESCRIPTIONS[key],'lods':[],'anchors':{'ground':[0,0,0],'streetFacing':[0,0,1]}}
    if key in ['heritage-shopfront','modern-lobby']: entry['anchors']['entry']=[0,0,.01]
    if key=='heritage-shop-bay': entry['anchors']['entry']=[-.875,0,.01]
    if key=='modern-lobby-bay': entry['anchors']['entry']=[0,0,.01]
    for lev in [0,1]:
        LEVEL=lev; clear_parts(); builder(); ob,stats=finish(key)
        if key in ['heritage-shop-bay','modern-lobby-bay','transit-shelter']: bake_opaque_atlas(ob,key,stats)
        file=OUT/'assets'/f'{key}.lod{lev}.glb'
        bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
        stats.update({'level':lev,'file':f'assets/{file.name}','bytes':file.stat().st_size})
        entry['lods'].append(stats)
    manifest['assets'].append(entry)
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if not A.skip_render: render_stage()
print('KIT COMPLETE:',OUT)
