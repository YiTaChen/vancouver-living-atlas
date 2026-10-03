"""Actual exported GLBs, reimported and rendered by Cycles CPU. QA refs never exported."""
import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
REFERENCE_MEASUREMENTS=[]
GLB_HASHES={}
SPECIES=['maple','alder','douglas-fir','western-redcedar']

def mat(name,c):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.85;return m

def box(name,pos,scale,m):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(m);return o

def cyl(name,a,b,r,m):
    d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=d.length,location=(Vector(a)+Vector(b))/2);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m)

def label(text,pos,size=.24):
    cu=bpy.data.curves.new('QA-label','FONT');cu.body=text;cu.size=size;cu.align_x='CENTER';ob=bpy.data.objects.new('QA-label-'+text,cu);bpy.context.scene.collection.objects.link(ob);ob.location=pos;ob.rotation_euler=(math.pi/2,0,0);ob.data.materials.append(mat('qa-text-'+text,(.12,.13,.13)))

def refs(x):
    human=mat('QA-only-reference-human',(.2,.24,.28));white=mat('QA-ruler-white',(.88,.88,.86));red=mat('QA-ruler-red',(.66,.09,.03))
    for k,h in enumerate([1.75,1.81]):
        before=set(bpy.data.objects);xx=x+k*.85;yy=-1.6;f=h/1.81
        for off in [-.105,.105]:cyl('QA-reference-leg',(xx+off*f,yy,0),(xx+off*f,yy,.80*f),.065*f,human)
        box('QA-reference-torso',(xx,yy,1.12*f),(.36*f,.20*f,.62*f),human)
        for off in [-.25,.25]:cyl('QA-reference-arm',(xx+off*f,yy,.85*f),(xx+off*f,yy,1.4*f),.052*f,human)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=(xx,yy,1.655*f));ob=bpy.context.object;ob.name='QA-reference-head';ob.scale=(.13*f,.12*f,.155*f);ob.data.materials.append(human)
        bpy.context.view_layer.update()
        pts=[o.matrix_world@Vector(p) for o in set(bpy.data.objects)-before if o.type=='MESH' for p in o.bound_box]
        measured=max(p.z for p in pts)-min(p.z for p in pts);assert abs(measured-h)<1e-5
        REFERENCE_MEASUREMENTS.append({'requestedHeightM':h,'actualHeightM':measured,'minimumZ':min(p.z for p in pts),'runtimeExported':False})
        label(f'{h:.2f} m',(xx,yy-.05,.03),.18)
    for i in range(10):box('QA-only-1m-ruler',(x+1.7,-1.6,(i+.5)*.1),(.09,.09,.1),white if i%2 else red)
    label('1 m',(x+1.7,-1.7,.03),.18)

def setup(width,target):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=False;scene.cycles.max_bounces=6;scene.cycles.transparent_max_bounces=12;scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=1200 if width>20 else 1050;scene.render.resolution_y=660;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
    floor=mat('QA-only-neutral-ground',(.34,.36,.33));box('QA-only-ground',(target[0],0,-.035),(70,50,.05),floor)
    bpy.ops.object.camera_add(location=(target[0]+1,-32,10.5));camera=bpy.context.object;camera.name='QA-camera';camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=width;scene.camera=camera
    scene.world=bpy.data.worlds.new('QA-world');scene.world.use_nodes=True
    bpy.ops.object.light_add(type='SUN',location=(2,-6,12));sun=bpy.context.object;sun.name='QA-sun';sun.rotation_euler=(.48,-.6,-.65);sun.data.angle=.18
    bpy.ops.object.light_add(type='AREA',location=(target[0],-8,10));fill=bpy.context.object;fill.name='QA-fill';fill.rotation_euler=(Vector(target)-fill.location).to_track_quat('-Z','Y').to_euler();fill.data.shape='DISK';fill.data.size=10
    return scene,sun,fill

def light(scene,sun,fill,kind):
    world,sunenergy,suncolor,fillenergy={'clear':[(.62,.72,.85,.45),2.5,(1,.92,.78),60], 'overcast':[(.62,.67,.72,.8),.15,(.91,.95,1),50], 'dusk':[(.12,.18,.28,.20),.7,(1,.40,.14),70], 'night':[(.06,.09,.17,.055),.05,(.45,.58,1),140]}[kind]
    bg=scene.world.node_tree.nodes['Background'];bg.inputs['Color'].default_value=(*world[:3],1);bg.inputs['Strength'].default_value=world[3];sun.data.energy=sunenergy;sun.data.color=suncolor;fill.data.energy=fillenergy;fill.data.color=(1,.84,.60) if kind=='night' else (1,1,1)

def import_tree(species,lod,x):
    file=HERE/'exports'/f'mature-{species}.lod{lod}.glb';key=str(file.relative_to(HERE));digest=hashlib.sha256(file.read_bytes()).hexdigest()
    if key in GLB_HASHES:assert GLB_HASHES[key]==digest
    GLB_HASHES[key]=digest;before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(file));obs=set(bpy.data.objects)-before
    for ob in obs:ob.location.x+=x
    return str(file.relative_to(HERE))

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True);files=[]
    for i,species in enumerate(SPECIES):
        files.append(import_tree(species,0,i*6));label(species,(i*6,-2.7,.05),.29)
    refs(-2.1);scene,sun,fill=setup(25,(9,0,4.8));records=[]
    for kind in (['clear'] if '--quick' in sys.argv else ['clear','overcast','dusk','night']):
        light(scene,sun,fill,kind);file=HERE/'qa/previews'/f'mature-lod0-{kind}.png';scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);records.append({'file':str(file.relative_to(HERE)),'lighting':kind,'lods':[0],'assets':files,'refsM':[1,1.75,1.81]})
    if '--quick' in sys.argv:return
    for species in SPECIES:
        bpy.ops.wm.read_factory_settings(use_empty=True);files=[]
        for lod in range(3):files.append(import_tree(species,lod,lod*6));label(f'{species} LOD{lod}',(lod*6,-2.7,.05),.29)
        refs(-2.2);scene,sun,fill=setup(19,(6,0,4.8));light(scene,sun,fill,'clear');file=HERE/'qa/previews'/f'{species}-lod-comparison.png';scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);records.append({'file':str(file.relative_to(HERE)),'lighting':'clear','lods':[0,1,2],'assets':files,'refsM':[1,1.75,1.81]})
    assert all(hashlib.sha256((HERE/name).read_bytes()).hexdigest()==sha for name,sha in GLB_HASHES.items())
    (HERE/'qa/preview-index.json').write_text(json.dumps({'status':'pass','renderer':'Blender Cycles CPU','blenderVersion':bpy.app.version_string,'samples':24,'threads':2,'source':'actual GLB reimport, no source-only render','referenceObjectsExcludedFromRuntime':True,'humanReferenceMeasurements':REFERENCE_MEASUREMENTS,'rulerHeightM':1,'runtimeAcceptance':'not_run','glbSha256References':GLB_HASHES,'previews':records},indent=2)+'\n')
    print('MATURE_TREE_CPU_RENDERS_PASS')
if __name__=='__main__':main()
