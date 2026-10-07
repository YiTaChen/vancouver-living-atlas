"""Render actual GLB reimports with Cycles CPU; references never enter exports."""
import bpy, math, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
IDS=['pedestrian-commuter','pedestrian-raincoat','pedestrian-runner','pedestrian-tote']
HASHES={};MEASUREMENTS=[]

def material(name,c):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;return m

def box(name,pos,size,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=size;o.data.materials.append(mat);return o

def label(text,pos,size=.12):
    data=bpy.data.curves.new('QA-text','FONT');data.body=text;data.size=size;data.align_x='CENTER'
    obj=bpy.data.objects.new('QA-label',data);bpy.context.scene.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(math.pi/2,0,0);obj.data.materials.append(material('QA-ink',(.08,.10,.13)))

def reimport(asset,lod,x,y=0):
    file=ROOT/'exports'/f'{asset}.lod{lod}.glb';HASHES[str(file.relative_to(ROOT))]=hashlib.sha256(file.read_bytes()).hexdigest()
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(file));objects=list(set(bpy.data.objects)-before)
    mesh=[o for o in objects if o.type=='MESH'];assert len(mesh)==1
    obj=mesh[0];bpy.context.view_layer.update();pts=[obj.matrix_world@v.co for v in obj.data.vertices]
    measured={'min':[min(p[k] for p in pts) for k in range(3)],'max':[max(p[k] for p in pts) for k in range(3)]}
    MEASUREMENTS.append({'file':str(file.relative_to(ROOT)),'blenderBoundsZUp':measured,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons)})
    # Imported source remains at origin for measurement; only QA placement moves it.
    for ob in objects:
        if ob.parent is None:ob.location.x+=x;ob.location.y+=y
    return obj

def references(x):
    m=material('QA-reference-human',(.36,.39,.42));red=material('QA-ruler-red',(.65,.08,.04));white=material('QA-ruler-white',(.90,.89,.87))
    for i,h in enumerate((1.75,1.81)):
        xx=x+i*.7;s=h/1.81
        for dx in (-.105,.105):box('QA-reference-leg',(xx+dx*s,0,.425*s),(.13*s,.14*s,.85*s),m)
        box('QA-reference-torso',(xx,0,1.15*s),(.37*s,.22*s,.6*s),m)
        for dx in (-.255,.255):box('QA-reference-arm',(xx+dx*s,0,1.11*s),(.10*s,.11*s,.59*s),m)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=(xx,0,1.655*s));bpy.context.object.scale=(.13*s,.12*s,.155*s);bpy.context.object.data.materials.append(m)
        label(f'{h:.2f} m',(xx,-.8,.012),.12)
    for i in range(10):box('QA-1m-ruler',(x+1.28,0,(i+.5)*.1),(.07,.07,.1),red if i%2 else white)
    label('1 m',(x+1.28,-.8,.012),.12)

def setup(width,target,back=False):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=False
    scene.cycles.max_bounces=4;scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=1400;scene.render.resolution_y=670;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX';scene.world=bpy.data.worlds.new('QA-neutral-world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.79,.88,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
    floor=material('QA-ground',(.72,.74,.76));box('QA-ground',(target[0],0,-.041),(30,30,.08),floor)
    bpy.ops.object.camera_add(location=(target[0]+(.4 if back else .35),12 if back else -12,4.3));cam=bpy.context.object;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=width;scene.camera=cam
    bpy.ops.object.light_add(type='AREA',location=(target[0]-3,-4,6));light=bpy.context.object;light.data.energy=850;light.data.size=5;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.light_add(type='SUN',location=(2,-3,6));sun=bpy.context.object;sun.data.energy=1.1;sun.data.angle=.18;sun.rotation_euler=(.4,-.4,-.55)
    return scene

def main():
    records=[]
    for lod in (0,1):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        for i,asset in enumerate(IDS):reimport(asset,lod,i*1.1);label(asset.removeprefix('pedestrian-'),(i*1.1,-.8,.012),.13)
        references(4.6);scene=setup(7.2,(2.8,0,.80));file=ROOT/'qa/previews'/f'background-lod{lod}-front.png';scene.render.filepath=str(file);bpy.ops.render.render(write_still=True)
        records.append({'file':str(file.relative_to(ROOT)),'view':'front','lod':lod,'glbs':[f'exports/{a}.lod{lod}.glb' for a in IDS],'referenceHeightsM':[1,1.75,1.81]})
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for i,asset in enumerate(IDS):reimport(asset,0,i*1.1)
    scene=setup(5.5,(1.65,0,.9),True);file=ROOT/'qa/previews/background-lod0-rear.png';scene.render.filepath=str(file);bpy.ops.render.render(write_still=True)
    records.append({'file':str(file.relative_to(ROOT)),'view':'rear','lod':0,'glbs':[f'exports/{a}.lod0.glb' for a in IDS]})
    (ROOT/'qa/preview-index.json').write_text(json.dumps({'status':'pass','renderer':'Blender Cycles CPU','blenderVersion':bpy.app.version_string,'samples':24,'source':'actual GLB reimport','runtimeAcceptance':'not_run','referenceObjectsExcludedFromRuntime':True,'glbSha256References':HASHES,'reimportMeasurements':MEASUREMENTS,'previews':records},indent=2)+'\n')
if __name__=='__main__':main()
