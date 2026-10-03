"""Cycles CPU previews from delivered GLBs only; QA rulers/humans excluded from all exports."""
import hashlib,json,math,platform,sys
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
MAN=json.loads((HERE/'manifest.json').read_text());OUT=HERE/'qa/previews';OUT.mkdir(exist_ok=True);records=[]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=16;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2
    s.render.resolution_x=640;s.render.resolution_y=640;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True;s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';return s

def mat(name,c):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.75;return m

def box(name,loc,size,m):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);return o

def refs(x,y=0):
    gray=mat('QA-human',(0.10,.22,.28));gold=mat('QA-ruler',(.75,.35,.03))
    for j,h in enumerate([1.75,1.81]):
        xx=x+j*.7
        box('QA-human-%sm-body'%h,(xx,y,h*.58),(.38,.19,h*.33),gray)
        box('QA-human-%sm-neck'%h,(xx,y,h*.805),(.12,.12,h*.14),gray)
        for side in [-1,1]:box('QA-human-%sm-leg'%h,(xx+side*.105,y,h*.22),(.15,.17,h*.44),gray)
        for side in [-1,1]:box('QA-human-%sm-arm'%h,(xx+side*.25,y,h*.60),(.1,.14,h*.3),gray)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=h*.07,location=(xx,y,h*.93));bpy.context.object.data.materials.append(gray);bpy.context.object.name='QA-human-%sm-head'%h
    box('QA-one-metre-ruler',(x+1.4,y,.5),(.065,.065,1),gold)
    for i in range(11):box('QA-ruler-tick-%s'%i,(x+1.44,y-.04,i*.1),(.10,.025,.014),gold)

def load(aid,lod,offset=(0,0,0)):
    file=HERE/'exports'/f'{aid}.lod{lod}.glb';before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(file));obs=[o for o in bpy.context.scene.objects if o not in before]
    for o in obs:o.location+=Vector((offset[0],-offset[2],offset[1]))
    return file

def lights(condition='sunny'):
    s=bpy.context.scene
    data={'sunny':((.7,.79,1),.65,(1,.88,.7),3.2), 'overcast':((.8,.85,.9),.85,(.82,.9,1),1.1), 'dusk':((.27,.37,.6),.4,(1,.45,.18),2.4), 'night':((.075,.12,.22),.12,(.55,.7,1),.4)}[condition]
    s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(*data[0],1);s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=data[1]
    d=bpy.data.lights.new('QA-sun','SUN');d.energy=data[3];d.color=data[2];d.angle=.18;o=bpy.data.objects.new('QA-sun',d);s.collection.objects.link(o);o.rotation_euler=(math.radians(30),math.radians(-28),math.radians(-25))
    if condition=='night':
        d=bpy.data.lights.new('QA-warm-fill','AREA');d.energy=500;d.color=(1,.57,.27);d.shape='DISK';d.size=8;o=bpy.data.objects.new('QA-warm-fill',d);s.collection.objects.link(o);o.location=(0,-5,5);o.rotation_euler=(Vector((0,0,3))-o.location).to_track_quat('-Z','Y').to_euler()

def camera(center,span,view='front',aspect=1):
    s=bpy.context.scene;d=bpy.data.cameras.new('QA-camera');d.type='ORTHO';d.ortho_scale=span;o=bpy.data.objects.new('QA-camera',d);s.collection.objects.link(o)
    delta={'front':(0,-span*2,0),'side':(span*2,-span*.1,0),'back':(0,span*2,0),'top':(0,0,span*2)}[view]
    o.location=Vector(center)+Vector(delta);o.rotation_euler=(Vector(center)-o.location).to_track_quat('-Z','Y').to_euler();s.camera=o

def save(name,info):
    p=OUT/(name+'.png');bpy.context.scene.render.filepath=str(p);bpy.ops.render.render(write_still=True)
    reference_bounds={}
    for h in [1.75,1.81]:
        points=[o.matrix_world@v.co for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('QA-human-%sm-'%h) for v in o.data.vertices]
        if points:
            measured=max(p.z for p in points)-min(p.z for p in points);assert abs(measured-h)<1e-5;reference_bounds[str(h)]=measured
    records.append({'file':'qa/previews/'+p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'measuredHumanHeightsM':reference_bounds,'renderer':'Cycles','device':'CPU','samples':16,'threads':2,'resolution':[bpy.context.scene.render.resolution_x,bpy.context.scene.render.resolution_y],**info})

for a in MAN['assets']:
    b=a['boundsM'];w,h,d=b['size'];lo=b['min'];hi=b['max'];span=max(w+3.1,h+1.3,3.6);cx=(lo[0]+hi[0]+1.6)/2;cz=(min(0,lo[1])+max(1.81,hi[1]))/2
    for lod in range(3):
        reset();load(a['id'],lod);refs(hi[0]+.55);lights();camera((cx,0,cz),span);save(a['id']+f'-lod{lod}-front',{'assetId':a['id'],'lod':lod,'view':'front','lighting':'sunny','referenceHeightsM':[1,1.75,1.81],'sourceGLB':a['lods'][lod]['file'],'sourceSha256':a['lods'][lod]['sha256']})
    for view in ['side','back','top']:
        reset();load(a['id'],0);lights();camera(((lo[0]+hi[0])/2,-(lo[2]+hi[2])/2,(lo[1]+hi[1])/2),max(w,h,d)*1.2+.25,view);save(a['id']+'-'+view,{'assetId':a['id'],'lod':0,'view':view,'lighting':'sunny','sourceGLB':a['lods'][0]['file'],'sourceSha256':a['lods'][0]['sha256']})

for assembly in ['waterfront','marine']:
    for condition in ['sunny','overcast','dusk','night']:
        s=reset();s.render.resolution_x=960;s.render.resolution_y=640
        if assembly=='waterfront':
            for x in [-12,-8,-4,4,8,12]:load('waterfront-column',0,(x,0,0));load('waterfront-capital',0,(x,7.825,0))
            load('waterfront-pediment-moulding',0,(0,8.9,1.95));refs(-2,0);camera((0,0,6.1),32)
        else:
            load('marine-archivolt-relief',0);load('marine-copper-grille',0);refs(-1,-.35);camera((0,0,3.7),12.3)
        lights(condition);save(assembly+'-'+condition,{'assembly':assembly,'lod':0,'lighting':condition,'view':'front','source':'delivered GLBs reimported, authored unscaled assembly transforms; no consumer shell','referenceHeightsM':[1,1.75,1.81]})
(HERE/'qa/preview-index.json').write_text(json.dumps({'status':'rendered','blenderVersion':bpy.app.version_string,'platform':platform.platform(),'noRuntimeExportsFromQA':True,'lightingScope':'offline material studies, not city weather/GPU acceptance','renders':records},indent=2)+'\n');print('B04_CYCLES_CPU_REIMPORT_PREVIEWS_DONE')
