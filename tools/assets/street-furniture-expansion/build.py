"""Editable independent furniture sources, derived from original streetscape designs.
Build only into this candidate package; re-export edited sources with export.py.
"""
import bpy, bmesh, math, json, sys, argparse, ast, hashlib, importlib.util
from pathlib import Path
from mathutils import Vector
import numpy as np
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from export import export_one, write_manifest, IDS
LEVEL=0; PARTS=[]; M={}; FRIT=0

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1
    global M,PARTS,FRIT;PARTS=[];M={};FRIT=0
    for key,role,color,rough,metal,alpha,emit in [
      ('metal','metal',(.085,.12,.115),.45,.65,1,0),('paint','metal',(.085,.12,.115),.45,.65,1,0),
      ('wood','wood',(.46,.245,.105),.55,0,1,0),('glass','glass',(.54,.74,.77),.16,0,.22,0),
      ('light','diffuser',(.92,.78,.52),.5,0,1,.35),('stone','metal',(.69,.72,.69),.5,.2,1,0)]:
        if key=='paint':M[key]=M['metal'];continue
        if key=='stone':M[key]=M['metal'];continue
        m=bpy.data.materials.new(role);m.use_nodes=True;m['semantic_role']=role
        bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,alpha);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;bs.inputs['Alpha'].default_value=alpha
        if emit:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emit
        m.use_backface_culling=role!='glass'
        if alpha<1:m.surface_render_method='DITHERED'
        M[key]=m

def add(o,name,mat):
    # Per-component sources survive; exporter batches evaluated copies by semantic role.
    o.name=name.lower().replace(' ','-');o.data.materials.append(M[mat]);o['semantic_role']=M[mat]['semantic_role'];PARTS.append(o);return o

def uv_metric(o):
    if o.type!='MESH':return
    uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
    o.data.update()
    for f in o.data.polygons:
        axis=max(range(3),key=lambda i:abs(f.normal[i]))
        for li in f.loop_indices:
            v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=(v.x,v.z) if axis==1 else (v.x,v.y) if axis==2 else (v.y,v.z)

def cube(name,loc,dim,mat,bevel=.018):
    global FRIT
    if LEVEL==1 and name=='Visibility frit':
        FRIT+=1
        if FRIT%4:return None
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);add(o,name,mat);uv_metric(o)
    if bevel and LEVEL==0:
        mod=o.modifiers.new('Editable manufactured edge','BEVEL');mod.width=min(bevel,min(dim)*.23);mod.segments=1
    return o

def mesh_obj(name,verts,faces,mat):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);add(o,name,mat);uv_metric(o);return o

def extrude_x(name,profile,width,mat):
    n=len(profile);return mesh_obj(name,[(x,y,z) for x in [-width/2,width/2] for y,z in profile],[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat)

def rod(name,a,b,r,mat,verts=12):
    a,b=Vector(a),Vector(b);vec=b-a;n=min(verts,8) if LEVEL==0 else 4
    bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=vec.length,location=(a+b)*.5);o=bpy.context.object;o.rotation_euler=vec.to_track_quat('Z','Y').to_euler();add(o,name,mat);uv_metric(o)
    return o

def lathe(name,profile,mat,segments=24):
    n=min(segments,12) if LEVEL==0 else min(segments,8)
    vs=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in profile for i in range(n)]
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(profile)-1) for i in range(n)]+[tuple(range(n-1,-1,-1)),tuple((len(profile)-1)*n+i for i in range(n))]
    return mesh_obj(name,vs,fs,mat)

def curved_rod(name,points,r,mat):
    # Editable Bezier control points preserve original arm design; modest tessellation.
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=2;c.bevel_depth=r;c.bevel_resolution=0;c.use_fill_caps=True
    s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for b,co in zip(s.bezier_points,points):b.co=co;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);return add(o,name,mat)

def text3d(*args,**kwargs):pass # No branding; generic blank panel, separate editable mesh.

# Execute only named legacy design functions, never its top-level generation/baking.
LEGACY=HERE.parent/'streetscape/generate_streetscape.py'
module=ast.parse(LEGACY.read_text());defs=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in ['bench','lamp','shelter']]
exec(compile(ast.Module(body=defs,type_ignores=[]),str(LEGACY),'exec'),globals())
legacy_bench=bench;legacy_lamp=lamp

def bench():
    if LEVEL==0:legacy_bench()
    else:
        for x in [-.83,.83]:
            
            for y0,y1,z1 in [(-.26,-.13,.45),(.28,.16,.46)]:
                mesh_obj('grounded-splayed-leg',[(x+dx,y+dy,z) for y,z in [(y0,0),(y1,z1)] for dx,dy in [(-.036,-.032),(.036,-.032),(.036,.032),(-.036,.032)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'metal')
            rod('seat-bearer',(x,-.30,.43),(x,.31,.43),.034,'metal');rod('back-support',(x,.21,.43),(x,.37,.94),.031,'metal')
        for y in [-.15,.15]:cube('cedar-seat',(0,y,.48),(2.02,.274,.058),'wood',0)
        for z in [.70,.90]:
            o=cube('cedar-back',(0,.29+(z-.67)*.27,z),(2.02,.06,.160),'wood',0);o.rotation_euler.x=-.25
        # 2 bent sheet armrests retain the source's broad shape at distance (20 tris each).
        for x in [-.84,.84]:
            o=extrude_x('armrest',[(-.255,.46),(-.26,.69),(.205,.69),(.255,.51),(.203,.51),(.17,.638),(-.208,.638),(-.208,.46)],.052,'metal');o.location.x=x
    # Original design's sloped legs end ~3 cm above authoring zero. Add sole blocks,
    # without moving the existing seat/body: actual ground contact now Y=0.
    for x in ([-.83,.83] if LEVEL==0 else []):
        for y in [-.26,.28]:cube('ground-contact-shoe',(x,y,.0175),(.072,.064,.035),'metal',0)

def lamp():
    if LEVEL==0:legacy_lamp()
    else:
        lathe('heritage-post',[(.22,0),(.22,.10),(.115,.31),(.075,1.03),(.075,3.89),(.02,4.49)],'metal',6)
        for sign in [-1,1]:
            # Same endpoint heights, twin lantern outline; low segmented arms.
            for a,b in zip([(0,0,3.87),(.30*sign,0,4.12),(.62*sign,0,4.20)],[(.30*sign,0,4.12),(.62*sign,0,4.20),(.84*sign,0,4.03)]):rod('arm',a,b,.041,'metal')
            x=.83*sign;mesh_obj('diffuser',[(x+dx,y,z) for z,r in [(3.30,.14),(3.89,.21)] for dx,y in [(-r,-r),(r,-r),(r,r),(-r,r)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'light')
            roof=lathe('lantern-cap',[(.325,3.93),(.325,3.975),(.04,4.18)],'metal',4);roof.location.x=x;roof.rotation_euler.z=math.pi/4
            foot=lathe('lantern-finial',[(.08,3.17),(.16,3.3)],'metal',4);foot.location.x=x

def arterial():
    # Purpose-built 8 m design, independent from the 4.49 m heritage geometry.
    lathe('arterial-tapered-pole',[(.15,0),(.15,.18),(.11,.24),(.065,7.82)],'metal',12)
    cube('service-door',(0,-.115,.57),(.115,.022,.40),'metal',.004)
    rod('outreach',(0,0,7.76),(1.24,0,7.90),.05,'metal')
    cube('luminaire-housing',(1.36,0,7.92),(.80,.34,.16),'metal',.035)
    cube('diffuser-panel',(1.36,0,7.835),(.64,.265,.018),'light',.008)

def garbage():
    # Actual opening: separate front/back/side walls and raised canopy, no solid box.
    cube('bin-back',(0,.245,.435),(.52,.04,.87),'metal',.012)
    for x in [-.24,.24]:cube('bin-side',(x,0,.435),(.04,.45,.87),'metal',.012)
    cube('bin-front-lower',(0,-.245,.34),(.52,.04,.68),'metal',.012)
    cube('bin-base',(0,0,.04),(.54,.54,.08),'metal',.012)
    cube('bin-lid',(0,0,.935),(.58,.58,.07),'metal',.022)
    for x in [-.22,.22]:cube('lid-standoff',(x,.20,.84),(.035,.035,.18),'metal',.004)
    if LEVEL==0:
        for x in [-.15,-.05,.05,.15]:cube('vent-slot-rim',(x,-.269,.28),(.015,.01,.37),'metal',.002)

def hydrant():
    lathe('hydrant-body',[(.18,0),(.18,.065),(.12,.09),(.12,.62),(.17,.65),(.15,.73),(.07,.81)],'metal',12)
    for sign in [-1,1]:
        rod('side-outlet',(.08*sign,0,.53),(.245*sign,0,.53),.073,'metal');rod('side-cap',(.23*sign,0,.53),(.275*sign,0,.53),.083,'metal',6)
    rod('front-outlet',(0,-.08,.42),(0,-.20,.42),.10,'metal');rod('front-cap',(0,-.20,.42),(0,-.23,.42),.11,'metal',6)
    cube('operating-nut',(0,0,.832),(.075,.075,.044),'metal',0)

def rack():
    # Bent inverted-U rack with open central bicycle envelope, 0.84 m top.
    pts=[(-.40,0,.04),(-.40,0,.72),(-.33,0,.805),(.33,0,.805),(.40,0,.72),(.40,0,.04)]
    for i in range(len(pts)-1):rod('rack-tube',pts[i],pts[i+1],.035,'metal')
    for x in [-.4,.4]:cube('rack-base',(x,0,.025),(.17,.17,.05),'metal',.006)

def bollard():
    lathe('bollard-shell',[(.095,0),(.095,.04),(.075,.06),(.075,.85),(.055,.90)],'metal',12)
    # Diffuser is explicitly a passive optical band, never a point light.
    lathe('reflective-band',[(.0755,.73),(.0755,.79)],'light',12)

BUILDERS={'cedar-bench':bench,'heritage-lamp':lamp,'transit-shelter':shelter,'arterial-lamp-8m':arterial,'garbage-bin':garbage,'fire-hydrant':hydrant,'bicycle-rack':rack,'bollard':bollard}

def run(out,force_reset=False):
    if (out/'source').exists() and any((out/'source').glob('*.blend')) and not force_reset:
        raise RuntimeError('Editable sources already exist. Use export.py to preserve edits, or --force-reset-sources only for an intentional rebuild.')
    (out/'source').mkdir(parents=True,exist_ok=True);(out/'exports').mkdir(exist_ok=True);(out/'qa').mkdir(exist_ok=True)
    records={}
    for aid in IDS:
        for lod in [0,1]:
            global LEVEL;LEVEL=lod;reset();BUILDERS[aid]()
            for o in bpy.context.scene.objects:
                if o.type=='MESH':uv_metric(o)
            s=bpy.context.scene;s['asset_id']=aid;s['lod']=lod;s['units']='metres';s['front_axis']='Blender -Y, glTF +Z';s['provenance']='Vancouver Living Atlas by YiTaChen; derived legacy furniture, original representative additions'
            stem=f'{aid}.lod{lod}';src=out/'source'/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True)
            records[stem]=export_one(src,out/'exports'/(stem+'.glb'))
            print('ASSET',stem,records[stem]['triangles'],records[stem]['bytes'],records[stem]['boundsM'],flush=True)
    write_manifest(out,records)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=HERE);p.add_argument('--force-reset-sources',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);run(a.output.resolve(),a.force_reset_sources)
