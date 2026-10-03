"""B04 original editable source builder. --output must be fresh. Never re-export edits via this file."""
import argparse,json,math,sys
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
CAT=json.loads((HERE/'catalog.json').read_text())

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
    bpy.context.preferences.filepaths.save_version=0

def material(spec):
    m=bpy.data.materials.new(spec['name']);m.use_nodes=True;m.use_backface_culling=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=spec['baseColorLinear'];p.inputs['Roughness'].default_value=spec['roughness'];p.inputs['Metallic'].default_value=spec['metallic']
    for a,b in [('semantic_role','role'),('surface_id','surfaceId'),('tile_metres','tileMeters')]:m[a]=spec[b]
    return m

def mesh(name,verts,faces,mat):
    # Geometry inputs are glTF-local (x,up,out); author once in Blender Z-up.
    me=bpy.data.meshes.new(name);me.from_pydata([(x,-z,y) for x,y,z in verts],[],faces);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob);ob.data.materials.append(mat)
    uv=me.uv_layers.new(name='UVMap');tile=mat['tile_metres']
    for p in me.polygons:
        axis=max(range(3),key=lambda k:abs(p.normal[k]))
        for i in p.loop_indices:
            c=me.vertices[me.loops[i].vertex_index].co
            a,b=(c.x,-c.y) if axis==2 else ((c.x,c.z) if axis==1 else (-c.y,c.z))
            uv.data[i].uv=(a/tile,b/tile)
    ob['component_id']=name;ob['asset_id']=bpy.context.scene['asset_id'];ob['lod']=bpy.context.scene['lod'];ob['uv_units']='metres / material tile_metres'
    return ob

def box(name,center,size,mat):
    x,y,z=center;w,h,d=(s/2 for s in size)
    v=[(x+a*w,y+b*h,z+c*d) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

def lathe(name,profile,n,mat,flutes=0):
    v=[]
    for y,r in profile:
        for i in range(n):
            a=2*math.pi*i/n;rr=r-(.012*(1-math.cos(a*12))/2 if flutes and .2<y<7.9 else 0)
            v.append((rr*math.cos(a),y,rr*math.sin(a)))
    faces=[tuple(reversed(range(n))),tuple((len(profile)-1)*n+i for i in range(n))]
    for j in range(len(profile)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    return mesh(name,v,faces,mat)

def prism_ring(name,outer,inner,z0,z1,mat):
    n=len(outer);assert len(inner)==n
    v=[(x,y,z) for z in [z0,z1] for ring in [outer,inner] for x,y in ring];f=[]
    for i in range(n):
        j=(i+1)%n
        f.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    return mesh(name,v,f,mat)

def beam(name,a,b,width,depth,mat):
    # Rectangular beam in facade XY, depth along Z, flat shaded.
    dx,dy=b[0]-a[0],b[1]-a[1];ln=math.hypot(dx,dy);nx,ny=-dy/ln*width/2,dx/ln*width/2
    outer=[(a[0]+nx,a[1]+ny),(a[0]-nx,a[1]-ny),(b[0]-nx,b[1]-ny),(b[0]+nx,b[1]+ny)]
    z=(a[2]+b[2])/2
    v=[(x,y,zz) for zz in [z-depth/2,z+depth/2] for x,y in outer]
    return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)

def arch_strip(name,ix,iy,ox,oy,z0,z1,n,mat,spring=3.7,cap_ends=True):
    # Inner polygon circumscribes the aperture ellipse (no chord intrusion).
    ang=[math.pi]+[math.pi-(i+.5)*math.pi/n for i in range(n)]+[0]
    if math.pi/2 not in ang:ang.append(math.pi/2);ang.sort(reverse=True)
    v=[];factor=1/math.cos(math.pi/(2*n))
    for z in [z0,z1]:
        for j,a in enumerate(ang):
            f=1 if j in (0,len(ang)-1) else factor
            v.extend([(math.cos(a)*ix*f,spring+math.sin(a)*iy*f,z),(math.cos(a)*ox,spring+math.sin(a)*oy,z)])
    m=len(ang)*2;faces=[]
    for i in range(len(ang)-1):
        a=2*i;b=2*(i+1)
        faces.extend([(a,b,b+1,a+1),(m+a,m+a+1,m+b+1,m+b),(a,m+a,m+b,b),(a+1,b+1,m+b+1,m+a+1)])
    if cap_ends:faces.extend([(0,1,m+1,m),(m-2,2*m-2,2*m-1,m-1)])
    return mesh(name,v,faces,mat)

def build(spec,lod):
    reset();scene=bpy.context.scene;scene['asset_id']=spec['id'];scene['lod']=lod;scene['datum']=spec['datum'];scene['front_axis']='Blender -Y; glTF +Z';scene['original_authored_geometry']=True
    mat=material(next(s for s in CAT['materials'] if s['name']==spec['material']));aid=spec['id']
    if spec['kind']=='column':
        profiles=[[(0,.6),(.14,.6),(.22,.575),(.3,.57),(7.6,.57),(7.78,.58),(7.88,.6),(8,.6)],[(0,.6),(.22,.575),(7.78,.575),(8,.6)],[(0,.6),(8,.6)]]
        lathe('column-shaft',profiles[lod],[48,24,8][lod],mat,lod==0)
    elif spec['kind']=='capital':
        if lod==2:box('capital-abacus',(0,.175,0),(1.6,.35,1.6),mat)
        else:
            lathe('capital-necking',[(0,.6),(.07,.62),(.14,.72),(.20,.77)],[24,12][lod],mat)
            box('capital-abacus',(0,.275,0),(1.6,.15,1.6),mat)
            if lod==0:
                lathe('capital-collar',[(.015,.602),(.035,.64),(.055,.64),(.07,.622)],24,mat)
    elif spec['kind']=='pediment-moulding':
        outer=[(-14,0),(14,0),(0,3.5)];inner=[(-12.62,.17),(12.62,.17),(0,3.325)]
        prism_ring('pediment-main-moulding',outer,inner,0,.24,mat)
        if lod<2:
            prism_ring('pediment-inner-bead',inner,[(-12.10,.23),(12.10,.23),(0,3.215)],.045,.16,mat)
        if lod==0:
            for i in range(35):box('pediment-dentil-%02d'%i,(-11.9+i*.7,.26,.195),(.22,.12,.07),mat)
    elif spec['kind']=='window-reveal':
        outer=[(-1.66,0),(1.66,0),(1.66,5.32),(-1.66,5.32)];inner=[(-1.5,.16),(1.5,.16),(1.5,5.16),(-1.5,5.16)]
        prism_ring('window-reveal',outer,inner,0,.12 if lod<2 else .24,mat)
        if lod<2:
            # Separate cove step sits outside the retained exact 3 x 5 opening.
            outer2=outer
            inner2=[(-1.57,.09),(1.57,.09),(1.57,5.23),(-1.57,5.23)]
            prism_ring('window-moulding-step',outer2,inner2,.12,.24,mat)
    elif spec['kind']=='archivolt-relief':
        bands=[(2.55,2.82,2.77,3.01,-.2,.035),(2.82,3.06,3.03,3.23,-.065,.1),(3.08,3.28,3.31,3.43,.025,.17),(3.36,3.49,3.6,3.64,.06,.23)]
        if lod==1:bands=[(2.55,2.82,3.03,3.23,-.2,.1),(3.08,3.28,3.6,3.64,.025,.23)]
        if lod==2:bands=[(2.55,2.82,3.6,3.64,-.2,.23)]
        for i,(ix,iy,ox,oy,z0,z1) in enumerate(bands):
            arch_strip('archivolt-%d'%i,ix,iy,ox,oy,z0,z1,[32,20,12][lod],mat,cap_ends=False)
            for sign in [-1,1]:box('archivolt-jamb-%d-%s'%(i,sign),(sign*(ix+ox)/2,1.93,(z0+z1)/2),(ox-ix,3.54,z1-z0),mat)
        for sign in [-1,1]:
            box('original-relief-panel-%s'%sign,(sign*3.88,2.06,.11),(.48,3.28,.16),mat)
            # At low LOD retain one symbolic raised chevron; no photo/sculpture copy.
            for row in range([5,3,1][lod]):
                y=.65+row*(2.55/max(1,[5,3,1][lod]-1))
                if lod<2:
                    for arm in [-1,1]:beam('original-chevron-%s-%s-%s'%(sign,row,arm),(sign*3.88+arm*.17,y,.2175),(sign*3.88,y+.17,.2175),.045,.045,mat)
                else:box('original-relief-emblem-%s'%sign,(sign*3.88,1.93,.215),(.22,.35,.05),mat)
    elif spec['kind']=='transom-grille':
        # Exact outer bounds; ring is INSIDE existing masonry aperture.
        arch_strip('grille-arch-frame',2.49,2.76,2.55,2.82,-1.2,-1.08,[32,20,12][lod],mat)
        box('grille-transom-rail',(0,3.18,-1.14),(5.1,.06,.12),mat)
        for sign in [-1,1]:box('grille-edge-%s'%sign,(sign*2.52,3.425,-1.14),(.06,.49,.12),mat)
        xs=[[-1.7,-.85,0,.85,1.7],[-1.6,0,1.6],[0]][lod]
        for i,x in enumerate(xs):
            top=3.7+2.73*math.sqrt(1-(x/2.46)**2)
            box('grille-vertical-%d'%i,(x,(3.21+top)/2,-1.14),(.045,top-3.21,.08),mat)
        if lod<2:
            for i in range(1,[9,5][lod]):
                a=i*math.pi/[9,5][lod]
                beam('grille-fan-%d'%i,(0,3.55,-1.14),(math.cos(a)*2.44,3.7+math.sin(a)*2.71,-1.14),.032,.07,mat)
    for o in scene.objects:
        assert o.type=='MESH';assert all(abs(s-1)<1e-6 for s in o.scale)
    return scene

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);ap.add_argument('--asset',choices=[x['id'] for x in CAT['assets']]);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=a.output.resolve();assert not out.exists(),'Fresh output required; refusing to overwrite artist edits'
    out.mkdir(parents=True)
    for spec in CAT['assets']:
        if a.asset and spec['id']!=a.asset:continue
        for lod in range(3):
            build(spec,lod);bpy.ops.wm.save_as_mainfile(filepath=str(out/(spec['id']+'.lod%d.blend'%lod)),compress=True)
    print('B04_EDITABLE_SOURCES_CREATED')
if __name__=='__main__':main()
