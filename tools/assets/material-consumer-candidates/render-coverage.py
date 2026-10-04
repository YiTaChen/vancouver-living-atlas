"""24 independent Cycles CPU GLB reimport renders; one process, two threads."""
import bpy, sys, json, math, hashlib, importlib.util
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('furniture_build',P/'build.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
WORK=P/'qa'/'.coverage-work';WORK.mkdir(exist_ok=True)
VIEWS={'front':(0,-1,.05),'side':(1,0,.05),'back':(0,1,.05),'top':(0,0,1),'perspective':(1,-1,.7)}

def render(aid,lod,view,light,index):
    path=P/'exports'/f'{aid}.lod{lod}.glb';objects=b.reimport(path);b.assign_shared(objects)
    # Each scene is a fresh actual GLB import, not a modified source scene.
    centre=Vector((0,0,.55));direction=Vector(VIEWS[view]).normalized()
    right=direction.cross(Vector((0,0,1))).normalized() if view!='top' else Vector((1,0,0))
    # Human and metre reference sit consistently on camera-right, outside asset.
    reference=right*1.22;b.human(1.81,reference.x,reference.y)
    metre=-right*1.05;b.box('qa-one-metre-ruler',(.025,.025,1),(metre.x,metre.y,.5),'qa-ruler',0)
    if view=='top':b.box('qa-one-metre-plan-ruler',(1,.025,.025),(1.1,1.2,.0125),'qa-ruler',0)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=False
    scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=288;scene.render.resolution_y=256;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    world=bpy.data.worlds.new('QA '+light);world.use_nodes=True;scene.world=world
    settings={'clear':((.63,.74,.95),.45,(1,.90,.74),950,1.5),'overcast':((.72,.78,.86),.7,(.89,.94,1),650,5),'dusk':((.2,.28,.5),.18,(1,.5,.25),360,3),'night':((.12,.18,.35),.035,(.60,.72,1),150,2.5)}
    sky,strength,color,energy,size=settings[light]
    world.node_tree.nodes['Background'].inputs[0].default_value=(*sky,1);world.node_tree.nodes['Background'].inputs[1].default_value=strength
    bpy.ops.object.light_add(type='AREA',location=(-3,-4,5));lamp=bpy.context.object;lamp.data.energy=energy;lamp.data.color=color;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(Vector((0,0,.5))-lamp.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=centre+direction*6);cam=bpy.context.object;cam.rotation_euler=(centre-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.9;scene.camera=cam
    b.box('qa-ground',(200,200,.04),(0,0,-.07),'qa-ground',0)
    output=WORK/f'{index:02d}-{aid}-lod{lod}-{view}-{light}.png';scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
    return {'assetId':aid,'lod':lod,'view':view,'lighting':light,'sourceGLB':str(path.relative_to(P)),'sourceGLBSha256':b.sha(path),'rawFile':output.name,'rawPngSha256':b.sha(output),'width':288,'height':256,'camera':{'location':list(cam.location),'quaternionXYZW':list(cam.rotation_euler.to_quaternion())[1:]+[cam.rotation_euler.to_quaternion().w],'orthographicScale':2.9},'referencesM':[1,1.81],'engine':'Cycles CPU','samples':12,'threads':2}

results=[]
for aid in ['lecture-chair-module','admissions-counter-module']:
    for lod in [0,1]:
        for view in ['front','side','back','top']:results.append(render(aid,lod,view,'overcast',len(results)))
for aid in ['lecture-chair-module','admissions-counter-module']:
    for lighting in ['clear','overcast','dusk','night']:results.append(render(aid,0,'perspective',lighting,len(results)))
(P/'qa'/'render-coverage.json').write_text(json.dumps({'status':'rendered_pending_contact_sheet','blender':bpy.app.version_string,'renderCount':len(results),'renders':results,'scope':'Actual delivered GLB reimports; geometrical views/LOD and studio light coverage; no WebGL city claim.'},indent=2)+'\n')
