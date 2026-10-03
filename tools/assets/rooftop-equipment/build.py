"""Original editable B01 HVAC source generator. Explicit --output is mandatory.

Never use this to re-export artist edits: export.py reads existing sources without
regenerating their geometry, UVs, or Principled material values.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector

HERE=Path(__file__).resolve().parent
CAT=json.loads((HERE/'catalog.json').read_text())

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
    return scene

def materials():
    result={}
    for spec in CAT['materials']:
        mat=bpy.data.materials.new(spec['material']); mat.use_nodes=True
        mat.use_backface_culling=True
        bs=mat.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value=spec['baseColorLinear']
        bs.inputs['Roughness'].default_value=spec['roughness']
        bs.inputs['Metallic'].default_value=spec['metallic']
        mat['semantic_role']=spec['role'];mat['city_surface_id']=spec['surfaceId']
        mat['physical_tile_metres']=[.8,.8]
        result[spec['material']]=mat
    return result

def metric_uv(ob):
    me=ob.data; uv=me.uv_layers.new(name='UVMap')
    for face in me.polygons:
        axis=max(range(3),key=lambda k:abs(face.normal[k]))
        for li in face.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co
            a,b=(co.x,co.y) if axis==2 else ((co.x,co.z) if axis==1 else (co.y,co.z))
            uv.data[li].uv=(a/.8,b/.8)
    ob['uv_units']='0.8-metre shared-painted-metal repeat'

def mesh(name,verts,faces,mat):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat);metric_uv(ob)
    ob['component_id']=name
    return ob

def box(name,centre,size,mat,bevel=0):
    x,y,z=centre;w,d,h=[v/2 for v in size]
    ob=mesh(name,[(x+a*w,y+b*d,z+c*h) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
    if bevel:
        mod=ob.modifiers.new('Editable housing edge bevel','BEVEL');mod.width=bevel;mod.segments=1
    return ob

def disk(name,x,y,z,r,n,mat):
    return mesh(name,[(x+r*math.cos(2*math.pi*i/n),y+r*math.sin(2*math.pi*i/n),z) for i in range(n)],[tuple(range(n))],mat)

def ring(name,x,y,z,r,n,mat):
    # Thin real annular guard with an open centre, not a painted black fan.
    verts=[(x+rr*math.cos(2*math.pi*i/n),y+rr*math.sin(2*math.pi*i/n),zz) for rr,zz in [(r,z),(r,z+.12),(r-.032,z+.12),(r-.032,z)] for i in range(n)]
    faces=[(j*n+i,j*n+(i+1)%n,((j+1)%4)*n+(i+1)%n,((j+1)%4)*n+i) for j in range(4) for i in range(n)]
    return mesh(name,verts,faces,mat)

def louvre(name,x0,x1,y,z,mat):
    # Tilted closed triangular section: real ventilation blade / recess spacing.
    profile=[(y,z-.018),(y-.05,z+.02),(y-.013,z+.045)]
    verts=[(x,yy,zz) for x in [x0,x1] for yy,zz in profile]
    return mesh(name,verts,[(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],mat)

def pipe(name,points,r,n,mat):
    # Two orthogonal pipe sections; square elbows are a representative low-poly fitting.
    verts=[]
    for p in points:
        # Cross-section stays in YZ for the horizontal segment; terminal rise is an angled fitting.
        verts.extend([(p[0],p[1]+r*math.cos(i*2*math.pi/n),p[2]+r*math.sin(i*2*math.pi/n)) for i in range(n)])
    faces=[tuple(range(n-1,-1,-1)),tuple(range((len(points)-1)*n,len(points)*n))]
    for j in range(len(points)-1):
        faces.extend([(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)])
    return mesh(name,verts,faces,mat)

def build(spec,lod):
    scene=clean();m=materials();housing=m['shared-metal-housing'];detail=m['shared-metal-detail']
    w,h,d=spec['dimensionsM'];fine=lod==0
    box('base-curb',(0,0,.06),(w,d,.12),detail)
    box('body-shell',(0,0,(h-.12+.12)/2),(w-.26,d-.28,h-.24),housing,.025 if fine else 0)
    front=-(d-.28)/2
    if fine:
        # Rim extends ahead of dark inset; lower blade tips remain inside the checked footprint.
        for sx in [-1,1]:box('louvre-frame-'+('left' if sx<0 else 'right'),(sx*(w-.5)/2,front-.034,h*.49),(.06,.07,h*.47),housing)
        for z,name in [(h*.255,'bottom'),(h*.725,'top')]:box('louvre-frame-'+name,(0,front-.034,z),(w-.44,.07,.055),housing)
        # A recessed front panel is part of the grille role; no baked lighting.
        box('louvre-recess',(0,front-.005,h*.49),(w-.56,.004,h*.39),detail)
        for i in range(5):louvre('louvre-blade-%02d'%i,-(w-.58)/2,(w-.58)/2,front-.009,h*.30+i*h*.085,housing)
    else:
        box('louvre-recess',(0,front-.012,h*.49),(w-.5,.024,h*.40),detail)
    centres=[0] if spec['fans']==1 else [-w*.22,w*.22]
    for i,x in enumerate(centres):
        r=spec['fanRadiusM']; y=.09;top=h-.12
        if fine:
            ring('fan-guard-ring-%02d'%i,x,y,top,r,12 if spec['fans']==1 else 8,housing)
            disk('fan-well-%02d'%i,x,y,h-.116,r-.034,12 if spec['fans']==1 else 8,detail)
            for j in range(3):
                angle=j*2*math.pi/3
                pts=[(x+.08*math.cos(angle),y+.08*math.sin(angle),h-.095),(x+(r-.075)*math.cos(angle+.12),y+(r-.075)*math.sin(angle+.12),h-.09),(x+(r-.075)*math.cos(angle+.58),y+(r-.075)*math.sin(angle+.58),h-.082),(x+.08*math.cos(angle+.9),y+.08*math.sin(angle+.9),h-.082)]
                mesh('fan-blade-%02d-%02d'%(i,j),pts,[(0,1,2,3)],housing)
            # Two genuine crossbars over the opening. Do not export a solid fan cap.
            box('fan-grille-x-%02d'%i,(x,y,h-.008),(r*1.82,.024,.016),detail)
            box('fan-grille-y-%02d'%i,(x,y,h-.026),(.024,r*1.82,.016),detail)
        else:
            verts=[(x+r*math.cos(j*math.pi/4),y+r*math.sin(j*math.pi/4),z) for z in [h-.12,h] for j in range(8)]
            faces=[tuple(range(8,16))]+[(j,(j+1)%8,(j+1)%8+8,j+8) for j in range(8)]
            mesh('fan-silhouette-%02d'%i,verts,faces,detail)
    # Service fitting is included in full bounds; it never protrudes past the curb.
    if fine:
        pipe('service-pipe',[(w/2-.3,d*.26,.35),(w/2-.055,d*.26,.35),(w/2-.02,d*.26,.52)],.02,6,housing)
    else:
        box('service-pipe',(w/2-.15,d*.26,.425),(.26,.04,.19),housing)
    scene['asset_id']=spec['id'];scene['lod']=lod;scene['authoring_up']='+Z';scene['export_front']='+Z'
    scene['datum']='roof-contact centre, Blender z=0 / glTF y=0'
    for ob in scene.objects:
        ob['asset_id']=spec['id'];ob['lod']=lod
    return scene

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True,type=Path)
    args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=True);src=out/'source';src.mkdir(exist_ok=True)
    for spec in CAT['assets']:
        for lod in [0,1]:
            path=src/f'{spec["id"]}.lod{lod}.blend'
            if path.exists():raise ValueError('Refusing to regenerate existing artist source: '+str(path))
            build(spec,lod)
            bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    print('ROOFTOP_SOURCE_BUILD_PASSED')
if __name__=='__main__':main()
