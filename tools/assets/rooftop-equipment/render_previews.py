"""Cycles CPU previews of the actual delivered GLBs, never generator scenes.

48 frames: each of 3 assets x 2 LODs has front/side/back/top in clear lighting
and an identical-camera human/ruler view in clear/overcast/dusk/night.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import platform
import sys
import time
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('source_builder',HERE/'build.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
s=importlib.util.spec_from_file_location('package_contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)

LIGHTS={
 'clear':{'world':[.42,.49,.58,1],'strength':.65,'sunEnergy':2.1,'sunColor':[1,.95,.85],'sunRotation':[.48,-.55,-.60]},
 'overcast':{'world':[.62,.68,.72,1],'strength':.72,'sunEnergy':.2,'sunColor':[.85,.92,1],'sunRotation':[.48,-.55,-.60]},
 'dusk':{'world':[.16,.22,.36,1],'strength':.30,'sunEnergy':1.3,'sunColor':[1,.43,.16],'sunRotation':[1.31,-.25,-.90]},
 'night':{'world':[.035,.06,.13,1],'strength':.18,'sunEnergy':.14,'sunColor':[.45,.62,1],'sunRotation':[.7,.25,-.3]}}

def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.8
    return m

def text(label,loc,size,mat):
    cu=bpy.data.curves.new('qa-label','FONT');cu.body=label;cu.size=size;cu.align_x='CENTER';cu.extrude=0
    ob=bpy.data.objects.new('qa-label-'+label,cu);bpy.context.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=(math.pi/2,0,0);ob.data.materials.append(mat)

def human(x,h,color):
    scale=h/1.81;mat=material('qa-human-%.2fm'%h,color)
    for dx in [-.11,.11]:
        b.box('qa-leg',(x+dx*scale,0,.46*scale),(.15*scale,.17*scale,.81*scale),mat)
        b.box('qa-foot',(x+dx*scale,-.035*scale,.035*scale),(.17*scale,.30*scale,.07*scale),mat)
    b.box('qa-pelvis',(x,0,.89*scale),(.39*scale,.23*scale,.18*scale),mat)
    b.box('qa-torso',(x,0,1.21*scale),(.43*scale,.23*scale,.51*scale),mat)
    for dx in [-.28,.28]:b.box('qa-arm',(x+dx*scale,0,1.21*scale),(.10*scale,.14*scale,.43*scale),mat)
    b.box('qa-neck',(x,0,1.475*scale),(.13*scale,.13*scale,.13*scale),mat)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.165*scale,location=(x,0,1.645*scale));bpy.context.object.name='qa-head';bpy.context.object.data.materials.append(mat)
    return {'heightM':h,'footY':0,'topY':h,'referenceOnly':True}

def setup_scene(root,a,lod,view,light):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root/lod['file']))
    imported=list(bpy.context.scene.objects)
    assert len(imported)==1 and imported[0].name=='body-shell'
    w,h,d=a['expectedDimensionsM'];scene=bpy.context.scene
    floor=material('qa-ground',(.32,.35,.36));ink=material('qa-ink',(.035,.05,.06))
    b.box('qa-ground',(0,0,-.07),(200,200,.12),floor)
    refs=[]
    if view=='scale':
        refs=[human(w/2+.58,1.75,(.15,.38,.52)),human(w/2+1.23,1.81,(.55,.27,.13))]
        text('1.75 m',(w/2+.58,-.22,1.90),.13,ink);text('1.81 m',(w/2+1.23,-.22,1.97),.13,ink)
        x=-w/2-.35;y=-d/2-.1
        b.box('qa-1m-ruler',(x,y,.5),(.025,.025,1),ink)
        for i in range(11):b.box('qa-ruler-tick',(x+.04,y,i/10),(.10 if i%5==0 else .055,.025,.012),ink)
        text('1 m',(x-.02,y-.02,1.12),.13,ink)
        target=Vector((.60,0,.85));offset=Vector((5,-8,4.8));scale=max((w+2.0)*1.16,5.35)
    else:
        target=Vector((0,0,h*.50))
        offset={'front':Vector((0,-7,.3)),'back':Vector((0,7,.3)),'side':Vector((7,0,.3)),'top':Vector((0,0,7))}[view]
        scale=max((d if view=='side' else w)*1.18,h*1.6*4/3,2.4)
    bpy.ops.object.camera_add(location=target+offset);cam=bpy.context.object;cam.name='qa-camera'
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=scale;scene.camera=cam
    cfg=LIGHTS[light];world=bpy.data.worlds.new('qa-world');world.use_nodes=True
    bg=world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=cfg['world'];bg.inputs['Strength'].default_value=cfg['strength'];scene.world=world
    bpy.ops.object.light_add(type='SUN');sun=bpy.context.object;sun.name='qa-sun';sun.data.energy=cfg['sunEnergy'];sun.data.color=cfg['sunColor'];sun.rotation_euler=cfg['sunRotation'];sun.data.angle=.15 if light!='overcast' else .7
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=False
    scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.exposure=0
    return {'cameraLocationBlenderM':list(cam.location),'cameraTargetBlenderM':list(target),'orthographicScaleM':scale,'references':refs,'rulerLengthM':1 if refs else None,'lighting':cfg}

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=HERE);p.add_argument('--only',default='');args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    root=args.root.resolve();m=json.loads((root/'manifest.json').read_text());dest=root/'qa/previews';dest.mkdir(parents=True,exist_ok=True);records=[]
    for a in m['assets']:
        for lod in a['lods']:
            # 8 frames per asset/LOD: 4 orthographic + 4 scale/lighting = 48 actual images.
            combinations=[(v,'clear') for v in ['front','side','back','top']]+[('scale',l) for l in LIGHTS]
            for view,light in combinations:
                stem=f'{a["id"]}.lod{lod["level"]}.{view}.{light}'
                if args.only and args.only not in stem:continue
                started=time.monotonic();meta=setup_scene(root,a,lod,view,light)
                file=dest/(stem+'.png');bpy.context.scene.render.filepath=str(file);bpy.ops.render.render(write_still=True)
                records.append({'assetId':a['id'],'lod':lod['level'],'view':view,'condition':light,'file':str(file.relative_to(root)),'sha256':c.digest(file),'inputGlb':lod['file'],'inputSha256':c.digest(root/lod['file']),'seconds':round(time.monotonic()-started,3),**meta})
    report={'status':'rendered_pending_visual_review','engine':'Cycles','device':'CPU','samples':12,'resolution':[640,480],'threads':2,'blenderVersion':bpy.app.version_string,'platform':platform.platform(),'lightingScope':'offline studio studies; clear/overcast/dusk/night are not city WebGL weather reproduction','referencesExcludedFromRuntime':True,'records':records}
    (root/'qa/preview-index.json').write_text(json.dumps(report,indent=2)+'\n')
    print('ROOFTOP_CPU_PREVIEWS_RENDERED',len(records))
if __name__=='__main__':main()
