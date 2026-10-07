"""Original, texture-free, merged pedestrian authoring. Blender 4.3+; no downloaded art.

Run only to regenerate pristine sources. Use export.py to preserve manual edits.
All design coordinates and scalar pivot attributes are glTF metres (+Y up,+Z front).
Mesh positions convert to Blender (x,-z,y) at authoring, then glTF export converts once.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SPECS = [
    dict(id='pedestrian-commuter', variant='jacket-backpack', height=1.78, width=1.0,
         skin=(.46,.25,.13,1), upper=(.035,.24,.23,1), lower=(.075,.105,.14,1), hair=(.034,.018,.013,1), accessory=(.32,.19,.09,1)),
    dict(id='pedestrian-raincoat', variant='long-raincoat-knit-hat', height=1.67, width=1.04,
         skin=(.76,.49,.32,1), upper=(.65,.31,.055,1), lower=(.065,.10,.12,1), hair=(.095,.038,.018,1), accessory=(.19,.055,.035,1)),
    dict(id='pedestrian-runner', variant='short-sleeve-cap', height=1.86, width=.90,
         skin=(.29,.13,.075,1), upper=(.14,.23,.48,1), lower=(.07,.10,.16,1), hair=(.019,.015,.02,1), accessory=(.58,.14,.08,1)),
    dict(id='pedestrian-tote', variant='hoodie-tote-curly-hair', height=1.60, width=1.12,
         skin=(.60,.34,.20,1), upper=(.34,.14,.25,1), lower=(.16,.21,.23,1), hair=(.038,.022,.018,1), accessory=(.67,.54,.34,1)),
]

class Model:
    def __init__(self):
        self.vertices=[]; self.faces=[]; self.colors=[]; self.limbs=[]; self.pivots=[]; self.palettes=[]
    def add(self,vertices,faces,color,limb=0,pivot=(0,0,0),palette=0):
        offset=len(self.vertices); self.vertices.extend(vertices)
        self.faces.extend(tuple(offset+i for i in face) for face in faces)
        self.colors.extend([color]*len(vertices));self.limbs.extend([limb]*len(vertices))
        self.pivots.extend([pivot]*len(vertices));self.palettes.extend([palette]*len(vertices))
    def rings(self,rings,n,color,limb=0,pivot=(0,0,0),palette=0):
        # (centerX, centerY, centerZ, radiusX, radiusZ); clockwise seen from top.
        vertices=[(x+rx*math.cos(2*math.pi*i/n),y,z+rz*math.sin(2*math.pi*i/n)) for x,y,z,rx,rz in rings for i in range(n)]
        faces=[]
        for row in range(len(rings)-1):
            for i in range(n):
                a=row*n+i;b=row*n+(i+1)%n;c=(row+1)*n+(i+1)%n;d=(row+1)*n+i
                faces.extend([(a,d,c),(a,c,b)])
        for i in range(1,n-1):
            faces.append((0,i,i+1)); top=(len(rings)-1)*n;faces.append((top,top+i+1,top+i))
        self.add(vertices,faces,color,limb,pivot,palette)
    def box(self,center,size,color,limb=0,pivot=(0,0,0),palette=0):
        x,y,z=center;w,h,d=[v/2 for v in size]
        v=[(x+sx*w,y+sy*h,z+sz*d) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1),(-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1)]]
        f=[(0,1,2),(0,2,3),(4,7,6),(4,6,5),(0,4,5),(0,5,1),(1,5,6),(1,6,2),(2,6,7),(2,7,3),(3,7,4),(3,4,0)]
        self.add(v,f,color,limb,pivot,palette)
    def head(self,center,radii,n,rows,color,limb=1,pivot=(0,1.49,0),palette=1):
        # Poles prevent degenerate rings; rounded low-poly face without copied likeness.
        x,y,z=center;rx,ry,rz=radii;v=[(x,y-ry,z)]
        for j in range(1,rows):
            phi=-math.pi/2+math.pi*j/rows
            for i in range(n):
                t=2*math.pi*i/n;v.append((x+rx*math.cos(phi)*math.cos(t),y+ry*math.sin(phi),z+rz*math.cos(phi)*math.sin(t)))
        v.append((x,y+ry,z));top=len(v)-1;f=[]
        for i in range(n):f.append((0,1+i,1+(i+1)%n))
        for j in range(rows-2):
            for i in range(n):
                a=1+j*n+i;b=1+j*n+(i+1)%n;c=b+n;d=a+n;f.extend([(a,d,c),(a,c,b)])
        for i in range(n):f.append((top,1+(rows-2)*n+(i+1)%n,1+(rows-2)*n+i))
        self.add(v,f,color,limb,pivot,palette)
    def finish(self,spec,lod):
        top=max(v[1] for v in self.vertices);scale=spec['height']/top
        self.vertices=[tuple(a*scale for a in p) for p in self.vertices]
        self.pivots=[tuple(a*scale for a in p) for p in self.pivots]
        mesh=bpy.data.meshes.new(spec['id']+'-merged-geometry')
        mesh.from_pydata([(x,-z,y) for x,y,z in self.vertices],[],self.faces);mesh.update()
        obj=bpy.data.objects.new('pedestrian-body',mesh);bpy.context.collection.objects.link(obj)
        colors=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        for d,c in zip(colors.data,self.colors):d.color=c
        mesh.color_attributes.active_color=colors
        for name,values in {'_LIMB':self.limbs,'_PIVOT_X':[v[0] for v in self.pivots],'_PIVOT_Y':[v[1] for v in self.pivots],'_PIVOT_Z':[v[2] for v in self.pivots],'_PALETTE':self.palettes}.items():
            attribute=mesh.attributes.new(name=name,type='FLOAT',domain='POINT')
            for d,value in zip(attribute.data,values):d.value=value
        mat=bpy.data.materials.new('pedestrian-vertex-color-opaque');mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.88
        bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Alpha'].default_value=1
        color=mat.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='Color'
        mat.node_tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color']);mesh.materials.append(mat)
        obj['assetId']=spec['id'];obj['lod']=lod;obj['datum']='foot-sole-y-zero';obj['frontAxis']='+Z'
        obj['animationContract']='rigid-limb-v1';obj['scaleToDesignHeight']=scale
        obj['bodyStatureM']=spec['height'];obj['sourceNature']='original parameterized mesh; no imported citizen geometry'
        for name,limb in [('torso',0),('head',1),('arm-left',2),('arm-right',3),('leg-left',4),('leg-right',5)]:
            group=obj.vertex_groups.new(name=name);indices=[i for i,x in enumerate(self.limbs) if x==limb]
            if indices:group.add(indices,1,'REPLACE')
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        return obj

def create(spec,lod):
    m=Model();n=8 if lod==0 else 4;limb_n=6 if lod==0 else 4;w=spec['width'];skin=spec['skin'];upper=spec['upper'];lower=spec['lower'];hair=spec['hair'];acc=spec['accessory'];shoe=(.032,.043,.05,1)
    variant=spec['variant'];rain='raincoat' in variant;runner='runner' in spec['id'];tote='tote' in spec['id'];head_p=(0,1.48,0)
    # Upper/lower garment silhouette is deliberately distinct in the long coat.
    torso=[(0,.67 if rain else .88,0,.24*w if rain else .165*w,.135),(0,1.08,0,.195*w,.135),(0,1.37,0,.235*w,.125),(0,1.45,0,.17*w,.105)]
    if lod:torso=[torso[0],torso[2],torso[3]]
    m.rings(torso,8 if rain else n,upper,palette=2)
    m.rings([(0,1.41,0,.068,.064),(0,1.53,0,.068,.064)],6 if lod==0 else 4,skin,1,head_p,1)
    m.head((0,1.63,.003),(.123,.154,.113),8 if lod==0 else 4,4 if lod==0 else 3,skin,pivot=head_p)
    # Hair is a single convex cap, not per-strand geometry.
    m.rings([(0,1.69,-.009,.113,.106),(0,1.765,-.009,.086,.081)],8 if lod==0 else 4,hair,1,head_p,5)
    for side in (-1,1):
        x=side*.103*w;leg=4 if side>0 else 5;hip=(x,.92,0);shoulder=(side*.221*w,1.36,0);arm=2 if side>0 else 3
        rings=[(x,.085,0,.063,.066),(x,.50,0,.075,.078),(x,.94,0,.091,.092)]
        if lod:rings=[rings[0],rings[-1]]
        m.rings(rings,limb_n,lower,leg,hip,3)
        m.box((x,.055,.038),(.146,.11,.245),shoe,leg,hip,4)
        hand_y=.835;hand_x=side*.31*w
        arm_rings=[(hand_x,hand_y,0,.047,.052),(side*.275*w,1.105,0,.061,.061),(shoulder[0],1.365,0,.077,.072)]
        if runner:
            # Short sleeves plus forearm preserve a different color/silhouette rhythm.
            m.rings(arm_rings[:2],limb_n,skin,arm,shoulder,1)
            m.rings([arm_rings[1],arm_rings[2]],limb_n,upper,arm,shoulder,2)
        else:m.rings([arm_rings[0],arm_rings[-1]] if lod else arm_rings,limb_n,upper,arm,shoulder,2)
        if lod==0:m.head((hand_x,.795,.006),(.049,.071,.043),6,3,skin,arm,shoulder,1)
        else:m.box((hand_x,.79,0),(.087,.10,.08),skin,arm,shoulder,1)
    if rain:
        # Knit cap above the skull, including a brim (one merged opaque geometry).
        m.rings([(0,1.72,-.005,.133,.123),(0,1.80,-.005,.105,.10)],n,acc,1,head_p,6)
        if lod==0:
            m.box((0,1.17,.14),(.026,.44,.018),acc,palette=6)
            m.box((-.115,.89,.144),(.095,.065,.018),acc,palette=6);m.box((.115,.89,.144),(.095,.065,.018),acc,palette=6)
    elif runner:
        m.rings([(0,1.71,0,.13,.12),(0,1.79,0,.095,.09)],n,acc,1,head_p,6)
        m.box((0,1.715,.13),(.225,.026,.12),acc,1,head_p,6)
        if lod==0:m.box((0,1.16,.137),(.06,.23,.012),(.66,.69,.70,1),palette=6)
    elif tote:
        m.head((0,1.755,-.015),(.14,.071,.13),8 if lod==0 else 4,3 if lod==0 else 2,hair,pivot=head_p,palette=5)
        # Hood mass is torso-owned; tote swings rigidly with the right arm.
        if lod==0:m.rings([(0,1.37,-.10,.17,.08),(0,1.49,-.08,.125,.07)],8,upper,palette=2)
        p=(-.221*w,1.36,0);m.box((-.355*w,.69,-.016),(.14,.31,.26),acc,3,p,6)
        if lod==0:
            for z in (-.105,.075):m.box((-.355*w,.93,z),(.026,.22,.022),acc,3,p,6)
    else:
        m.rings([(0,1.0,-.185,.157,.088),(0,1.38,-.185,.157,.088)],n,acc,palette=6)
        if lod==0:
            for x in (-.125,.125):m.box((x,1.23,.134),(.035,.36,.022),acc,palette=6)
            m.box((0,1.13,.142),(.018,.47,.015),(.55,.57,.54,1),palette=6)
    return m.finish(spec,lod)

def export_object(target):
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
        export_yup=True,export_animations=False,export_skins=False,export_normals=True,
        export_texcoords=False,export_attributes=True,export_extras=True,export_cameras=False,
        export_lights=False,export_materials='EXPORT',export_apply=False)

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=ROOT)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    root=args.out.resolve();(root/'source').mkdir(parents=True,exist_ok=True);(root/'exports').mkdir(exist_ok=True)
    for spec in SPECS:
        for lod in (0,1):
            bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
            create(spec,lod)
            source=root/'source'/f"{spec['id']}.lod{lod}.blend"
            bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
            export_object(root/'exports'/f"{spec['id']}.lod{lod}.glb")
    print('PEDESTRIAN_GENERATION_PASS')
if __name__=='__main__':main()
