"""Original B02 material study. Run in Blender; saves true procedural sources.

Default creation is explicit (--defaults). --from-source reads artist sources,
checks opaque Principled support and bakes evaluated nodes without overwriting
inputs. Only inspection GLBs are emitted; nothing is activated in the city.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math
import shutil
import sys
import time
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = '5574d55719f10d1575127d8b92cbd23ff71e446f'
SURFACES = [('roof-mineral-grain', [147/255,152/255,142/255], .88),
            ('roof-membrane-seams', [185/255,192/255,187/255], .82)]
spec = importlib.util.spec_from_file_location('city_bake', HERE.parent/'city-materials/export_material_library.py')
bake = importlib.util.module_from_spec(spec); spec.loader.exec_module(bake)
bake.SOURCE_SIZE = 512; bake.TILE_SIZE = 256

def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(p, data): Path(p).parent.mkdir(parents=True, exist_ok=True); Path(p).write_text(json.dumps(data, indent=2)+'\n')
def require(v, text):
    if not v: raise ValueError(text)
def srgb(v): return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4

def config(scene):
    scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=8
    scene.cycles.use_denoising=False; scene.render.threads_mode='FIXED'; scene.render.threads=2
    scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
    scene.render.bake.use_clear=True; scene.render.bake.margin=0
    scene.render.bake.use_selected_to_active=False; scene.render.bake.target='IMAGE_TEXTURES'
    scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=0; scene.view_settings.gamma=1

def make_material(sid, color, rough):
    mat=bpy.data.materials.new(sid); mat.use_nodes=True
    mat['surface_id']=sid; mat['tile_metres']=[2.,2.]
    mat['provenance']='Original mathematical periodic node graph; no image inputs, photos or scans.'
    nt=mat.node_tree; nt.nodes.clear(); links=nt.links
    def node(t,name,x,y):
        n=nt.nodes.new(t); n.name=name; n.label=name; n.location=(x,y); return n
    def mathnode(op,name,a,b=None,x=0,y=0):
        n=node('ShaderNodeMath',name,x,y); n.operation=op
        for i,v in enumerate([a,b]):
            if v is None: continue
            if isinstance(v,(int,float)): n.inputs[i].default_value=v
            else: links.new(v,n.inputs[i])
        return n.outputs[0]
    uv=node('ShaderNodeUVMap','METRE_UV (1 UV unit = 1 metre)',-1200,80); uv.uv_map='UVMap'
    sep=node('ShaderNodeSeparateXYZ','Metre coordinates',-1010,80); links.new(uv.outputs[0],sep.inputs[0])
    # Closed torus in 4D is exactly periodic on both axes. Unlike modulo noise,
    # it has no discontinuity at the tile boundary.
    cx=mathnode('MULTIPLY','U angle: 2m repeat',sep.outputs[0],math.pi,-840,220)
    cy=mathnode('MULTIPLY','V angle: 2m repeat',sep.outputs[1],math.pi,-840,-100)
    cosx=mathnode('COSINE','cos U',cx,x=-665,y=320); sinx=mathnode('SINE','sin U',cx,x=-665,y=140)
    cosy=mathnode('COSINE','cos V',cy,x=-665,y=-40); siny=mathnode('SINE','sin V',cy,x=-665,y=-220)
    vec=node('ShaderNodeCombineXYZ','Seamless 4D torus XYZ',-485,320)
    for i,s in enumerate([cosx,sinx,cosy]): links.new(s,vec.inputs[i])
    noise=node('ShaderNodeTexNoise','PERIODIC_GRAIN: edit scale/detail',-260,240); noise.noise_dimensions='4D'
    links.new(vec.outputs[0],noise.inputs['Vector']); links.new(siny,noise.inputs['W'])
    noise.inputs['Scale'].default_value=34 if 'mineral' in sid else 65
    noise.inputs['Detail'].default_value=2; noise.inputs['Roughness'].default_value=.55
    if 'mineral' in sid:
        stone=node('ShaderNodeTexVoronoi','PERIODIC_MINERAL: rounded grain clusters',-255,-60)
        stone.voronoi_dimensions='4D'; stone.feature='DISTANCE_TO_EDGE' if False else 'F1'
        links.new(vec.outputs[0],stone.inputs['Vector']); links.new(siny,stone.inputs['W']); stone.inputs['Scale'].default_value=20
        n=mathnode('MULTIPLY','Fine grain amount',noise.outputs['Fac'],.32,0,250)
        v=mathnode('MULTIPLY','Mineral grain amount',stone.outputs['Distance'],.68,0,40)
        height=mathnode('ADD','MINERAL_HEIGHT',n,v,175,140)
        factor=mathnode('MULTIPLY','Grain pigment contrast',height,.18,350,340)
        factor=mathnode('ADD','Pigment centered around palette',factor,.918,520,340)
        roughout=mathnode('MULTIPLY','Roughness grain',height,.08,350,20)
        roughout=mathnode('ADD','EDIT_ROUGHNESS_BASE',roughout,.845,520,20)
        distance=.013
    else:
        # Cosine-powered welded laps: 1m longitudinal rolls, cross-lap every 2m.
        ax=mathnode('MULTIPLY','Seam U: 1m roll width',sep.outputs[0],2*math.pi,-650,-450)
        ay=mathnode('MULTIPLY','Seam V: 2m end lap',sep.outputs[1],math.pi,-650,-650)
        sx=mathnode('COSINE','Long seam cosine',ax,x=-465,y=-450)
        sy=mathnode('COSINE','End seam cosine',ay,x=-465,y=-650)
        sx=mathnode('MULTIPLY_ADD','Long seam 0..1',sx,.5,-280,-450); nt.nodes['Long seam 0..1'].inputs[2].default_value=.5
        sy=mathnode('MULTIPLY_ADD','End seam 0..1',sy,.5,-280,-650); nt.nodes['End seam 0..1'].inputs[2].default_value=.5
        sx=mathnode('POWER','EDIT_LONG_SEAM_WIDTH (~25mm FWHM)',sx,450,-90,-450)
        sy=mathnode('POWER','EDIT_END_SEAM_WIDTH (~25mm FWHM)',sy,1800,-90,-650)
        seam=mathnode('MAXIMUM','MEMBRANE_WELDED_LAPS',sx,sy,90,-440)
        grain=mathnode('MULTIPLY','Membrane micro height',noise.outputs['Fac'],.035,120,180)
        ridge=mathnode('MULTIPLY','Lap relief 2.8mm',seam,.28,280,-440)
        height=mathnode('ADD','MEMBRANE_HEIGHT',grain,ridge,470,160)
        factor=mathnode('MULTIPLY_ADD','Subtle membrane pigment',noise.outputs['Fac'],.04,100,340)
        nt.nodes['Subtle membrane pigment'].inputs[2].default_value=.98
        # Pigment remains almost uniform: seam visibility comes from normal and roughness.
        roughout=mathnode('MULTIPLY_ADD','EDIT_ROUGHNESS_BASE',noise.outputs['Fac'],.04,350,-30)
        nt.nodes['EDIT_ROUGHNESS_BASE'].inputs[2].default_value=.80
        distance=.01
    tint=node('ShaderNodeRGB','EDIT_BASE_TINT (linear from existing sRGB palette)',520,560)
    tint.outputs[0].default_value=tuple(srgb(c) for c in color)+(1,)
    mult=node('ShaderNodeVectorMath','Pigment variation only, no baked lighting',720,430); mult.operation='SCALE'
    links.new(tint.outputs[0],mult.inputs[0]); links.new(factor,mult.inputs['Scale'])
    bump=node('ShaderNodeBump','EDIT_RELIEF_METRES',720,100); bump.inputs['Distance'].default_value=distance
    bump.inputs['Strength'].default_value=.55; links.new(height,bump.inputs['Height'])
    bs=node('ShaderNodeBsdfPrincipled','ROOF_PBR',960,430)
    links.new(mult.outputs[0],bs.inputs['Base Color']); links.new(roughout,bs.inputs['Roughness'])
    bs.inputs['Metallic'].default_value=0; links.new(bump.outputs[0],bs.inputs['Normal'])
    out=node('ShaderNodeOutputMaterial','Material Output',1230,430); links.new(bs.outputs[0],out.inputs['Surface'])
    return mat

def make_coupon(sid, size, mat):
    mesh=bpy.data.meshes.new(f'{sid}-{size}m-mesh')
    mesh.from_pydata([(-size/2,-size/2,0),(size/2,-size/2,0),(size/2,size/2,0),(-size/2,size/2,0)],[],[(0,1,2,3)])
    mesh.update(); uv=mesh.uv_layers.new(name='UVMap')
    for i,p in enumerate([(0,0),(size,0),(size,size),(0,size)]): uv.data[i].uv=p
    ob=bpy.data.objects.new(f'{sid}-coupon-{size}m',mesh); bpy.context.scene.collection.objects.link(ob)
    mesh.materials.append(mat); ob['surface_id']=sid; ob['coupon_metres']=size
    ob['uv_contract']='UVMap: metre coordinates. Inspection exporter divides by 2 exactly once.'
    return ob

def create_source(sid,color,rough,target):
    bpy.ops.wm.read_factory_settings(use_empty=True); config(bpy.context.scene)
    mat=make_material(sid,color,rough)
    a=make_coupon(sid,2,mat); b=make_coupon(sid,10,mat); b.hide_set(True); b.hide_render=True
    bpy.context.view_layer.objects.active=a; a.select_set(True)
    bpy.context.scene['editing_notes']='Two origin-centered editable study coupons. Hide one while editing. UVMap uses metres. Procedural nodes retain original material construction. No runtime placement.'
    bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)

def runtime_material(sid,folder):
    mat=bpy.data.materials.new(sid+'-baked-inspection'); mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF'); nt=mat.node_tree
    for key in ['color','normal','orm']:
        im=bpy.data.images.load(str(folder/f'{sid}-{key}.png'),check_existing=False)
        im.colorspace_settings.name='sRGB' if key=='color' else 'Non-Color'
        n=nt.nodes.new('ShaderNodeTexImage'); n.name=key; n.image=im; n.extension='REPEAT'
        if key=='color': nt.links.new(n.outputs['Color'],bs.inputs['Base Color'])
        elif key=='normal':
            normal=nt.nodes.new('ShaderNodeNormalMap'); normal.space='TANGENT'; normal.uv_map='UVMap'
            nt.links.new(n.outputs['Color'],normal.inputs['Color']); nt.links.new(normal.outputs[0],bs.inputs['Normal'])
        else:
            sep=nt.nodes.new('ShaderNodeSeparateColor'); sep.mode='RGB'; nt.links.new(n.outputs['Color'],sep.inputs[0])
            nt.links.new(sep.outputs[1],bs.inputs['Roughness']); nt.links.new(sep.outputs[2],bs.inputs['Metallic'])
            # Conventional glTF Material Output group exposes neutral R occlusion.
            group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
            if not group.interface.items_tree: group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
            gn=nt.nodes.new('ShaderNodeGroup'); gn.node_tree=group; nt.links.new(sep.outputs[0],gn.inputs['Occlusion'])
    return mat

def import_check(path):
    bpy.ops.wm.read_factory_settings(use_empty=True); config(bpy.context.scene)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']; require(len(meshes)==1,'inspection mesh count')
    ob=meshes[0]; pts=[ob.matrix_world@v.co for v in ob.data.vertices]
    lo=[min(p[k] for p in pts) for k in range(3)]; hi=[max(p[k] for p in pts) for k in range(3)]
    require(all(math.isfinite(x) for p in pts for x in p),'nonfinite reimport')
    require(all(abs(x-1)<1e-6 for x in ob.scale),'unapplied imported scale')
    return {'file':path.name,'sha256':digest(path),'blenderBoundsM':{'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]},'uvRange':[min(v.uv[k] for v in ob.data.uv_layers.active.data) for k in range(2)]+[max(v.uv[k] for v in ob.data.uv_layers.active.data) for k in range(2)],'meshes':len(meshes),'materialNames':[m.name for m in ob.data.materials]}

def qa_material(name,color,rough=.7):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough; return m

def box(name,loc,scale,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.name=name; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(mat); return o

def text_object(body,loc,size,mat):
    data=bpy.data.curves.new('QA label','FONT'); data.body=body; data.size=size; data.align_x='CENTER'
    ob=bpy.data.objects.new('QA-'+body,data); bpy.context.scene.collection.objects.link(ob); ob.location=loc
    ob.rotation_euler=(math.pi/2,0,0); ob.data.materials.append(mat); return ob

def human(height,x,y,mat):
    # Dimensioned simple QA mannequin: not a runtime person asset.
    z=height
    box(f'QA-person-{height}-legs',(x,y,z*.225),(.27,.16,z*.45),mat)
    box(f'QA-person-{height}-torso',(x,y,z*.645),(.42,.22,z*.39),mat)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=(x,y,z*.923))
    o=bpy.context.object; o.name=f'QA-person-{height}-head'; o.scale=(.10,.10,z*.077); o.data.materials.append(mat)
    return [x,y,0,height]

def render_previews(root):
    files=[]; records=[]
    lights={'clear':(2.4,(1,.94,.83),.55,(.65,.76,1)),
            'overcast':(.3,(.87,.92,1),.85,(.81,.87,1)),
            'dusk':(.75,(1,.52,.26),.13,(.34,.43,.71)),
            'night':(.11,(.52,.65,1),.045,(.26,.34,.56))}
    for size in [2,10]:
        bpy.ops.wm.read_factory_settings(use_empty=True); scene=bpy.context.scene; config(scene)
        extent=size; spacing=size+1.3; imported=[]
        for i,(sid,_,_) in enumerate(SURFACES):
            p=root/'exports'/f'{sid}-{size}m.inspection.glb'; bpy.ops.import_scene.gltf(filepath=str(p))
            obs=[o for o in bpy.context.selected_objects if o.type=='MESH']; require(len(obs)==1,'render import')
            obs[0].location.x += (i-.5)*spacing; imported.append({'file':str(p.relative_to(root)),'sha256':digest(p)})
        neutral=qa_material('QA warm neutral ground',(.18,.20,.22)); dark=qa_material('QA charcoal ruler/person',(.035,.05,.07)); white=qa_material('QA ivory labels',(.8,.82,.85))
        box('QA-base',(0,0,-.08),(size*2+4.6,size+4,.15),neutral)
        # One-metre ruler with ten alternating decimetres, outside coupons.
        ry=-size/2-.32
        for i in range(10): box(f'QA-1m-ruler-{i}',(-.45+i*.1,ry,.025),(.1,.09,.05),white if i%2 else dark)
        text_object('1 m', (0,ry-.19,.01),.12 if size==2 else .27,white)
        hdata=[]
        for i,h in enumerate([1.75,1.81]):
            x=(i-.5)*.85; hdata.append(human(h,x,size/2+.48,dark)); text_object(f'{h:.2f} m',(x,size/2+.19,.03),.10 if size==2 else .23,white)
        labels=['MINERAL GRAIN','MEMBRANE SEAMS']
        for i,lab in enumerate(labels): text_object(f'{lab} | {size} x {size} m',((i-.5)*spacing,-size/2-.72,.02),.16 if size==2 else .40,white)
        camd=bpy.data.cameras.new('QA-camera'); cam=bpy.data.objects.new('QA-camera',camd); scene.collection.objects.link(cam)
        cam.location=(size*.75,-size*1.45,size*1.75+1.5); target=Vector((0,.3,0))
        cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler(); camd.type='ORTHO'; camd.ortho_scale=size*2+4.1; scene.camera=cam
        ld=bpy.data.lights.new('QA-sun','SUN'); light=bpy.data.objects.new('QA-sun',ld); scene.collection.objects.link(light)
        light.rotation_euler=(math.radians(28),math.radians(-25),math.radians(-35)); ld.angle=math.radians(8)
        scene.world=bpy.data.worlds.new('QA-world'); scene.world.use_nodes=True
        scene.render.resolution_x=960; scene.render.resolution_y=640; scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG'; scene.cycles.samples=12
        for name,(energy,color,strength,wcolor) in lights.items():
            ld.energy=energy; ld.color=color; bg=scene.world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value=(*wcolor,1); bg.inputs['Strength'].default_value=strength
            p=root/'qa/previews'/f'coupons-{size}m-{name}.png'; scene.render.filepath=str(p)
            bpy.ops.render.render(write_still=True); files.append(str(p.relative_to(root)))
            records.append({'file':str(p.relative_to(root)),'sha256':digest(p),'condition':name,'couponSizeM':size,'physicalRepeatM':[2,2],'imports':imported,'samples':12,'resolution':[960,640],'renderer':'Cycles CPU','threads':2,'camera':list(cam.location),'orthoScaleM':camd.ortho_scale,'sunEnergy':energy,'worldStrength':strength,'exposure':0,'qaReferences':{'rulerLengthM':1,'humanHeightsM':[1.75,1.81]},'note':'Offline study lighting, not the city renderer or calibrated Vancouver illuminance.'})
    dump(root/'qa/render-evidence.json',{'status':'pass','renders':records,'referenceObjectsExported':False})
    return files

def run(args):
    root=args.output.resolve(); require(not root.is_relative_to(ROOT/'public'),'Do not export to public')
    if args.from_source:
        src=args.from_source.resolve(); require(src.is_dir(),'source directory missing')
        require(not root.is_relative_to(src) and root!=HERE,'source-preserving export needs separate output directory')
    else:
        require(args.defaults,'Use --defaults for generator, or --from-source for edited nodes'); src=root/'source'
        require(not any(src.glob('*.blend')),'Refusing to overwrite existing editable sources; use --from-source or new output')
    for f in ['source/textures','exports/textures','qa/previews']: (root/f).mkdir(parents=True,exist_ok=True)
    report={'baseRevision':BASE,'blender':bpy.app.version_string,'device':'CPU','threads':2,'bakeSamples':8,'sourceBakeResolution':[512,512],'runtimeResolution':[256,256],'surfaces':[],'sourcePreserved':True,'pipelineReuse':'city-materials/export_material_library.py: principled validation, material copy, actual Cycles bake, linear filter/normal renormalization and PNG writer','startedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    for sid,color,rough in SURFACES:
        source=src/f'{sid}.lod0.blend'
        if not args.from_source: create_source(sid,color,rough,source)
        before=digest(source)
        if args.from_source: shutil.copy2(source,root/'source'/source.name)
        bpy.context.preferences.filepaths.use_scripts_auto_execute=False
        bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False); config(bpy.context.scene)
        matches=[m for m in bpy.data.materials if m.get('surface_id')==sid]; require(len(matches)==1,'source surface ID')
        original=matches[0]; bake.principled(original); require(list(original['tile_metres'])==[2.,2.],'2m source repeat')
        obs=[bpy.data.objects.get(f'{sid}-coupon-{s}m') for s in [2,10]]; require(all(obs),'editable coupons missing')
        source_info={'source':f'source/{source.name}','sourceSha256':before,'sourceReopened':True,'proceduralNodeCount':len(original.node_tree.nodes),'textureInputCount':sum(n.type=='TEX_IMAGE' for n in original.node_tree.nodes),'sourceObjects':[o.name for o in obs]}
        # Bake in a temporary blank scene; source objects cannot influence it.
        prior=bpy.context.window.scene; scene=bpy.data.scenes.new('BAKE_ONLY'); bpy.context.window.scene=scene; config(scene)
        groups=[]; temp=bake.material_copy(original,groups)
        data=bake.bake_tile(scene,temp,[2,2],8)
        bpy.data.materials.remove(temp)
        for g in reversed(groups): bpy.data.node_groups.remove(g,do_unlink=True)
        bpy.context.window.scene=prior; bpy.data.scenes.remove(scene)
        maps=[]
        for key,arr in data.items():
            full=bake.encoded(bake.linear_to_srgb(arr) if key=='color' else arr)
            small=bake.downsample(arr,normal=key=='normal'); encoded=bake.encoded(bake.linear_to_srgb(small) if key=='color' else small)
            for folder,pixels in [('source/textures',full),('exports/textures',encoded)]: bake.png(root/folder/f'{sid}-{key}.png',pixels,color=key=='color')
            p=root/'exports/textures'/f'{sid}-{key}.png'
            maps.append({'channel':key,'file':str(p.relative_to(root)),'sha256':digest(p),'bytes':p.stat().st_size,'sourceBake':f'source/textures/{sid}-{key}.png','sourceBakeSha256':digest(root/'source/textures'/f'{sid}-{key}.png'),'averageEncodedRGB':encoded.mean(axis=(0,1)).tolist(),'minimumRGB':encoded.min(axis=(0,1)).tolist(),'maximumRGB':encoded.max(axis=(0,1)).tolist()})
        rt=runtime_material(sid,root/'exports/textures'); exports=[]
        for ob,size in zip(obs,[2,10]):
            dup=ob.copy(); dup.data=ob.data.copy(); prior.collection.objects.link(dup); dup.hide_set(False); dup.hide_render=False
            dup.data.materials.clear(); dup.data.materials.append(rt)
            for uv in dup.data.uv_layers['UVMap'].data: uv.uv /= 2
            for o in bpy.context.view_layer.objects: o.select_set(False)
            dup.select_set(True); bpy.context.view_layer.objects.active=dup
            dup.name=f'{sid}-coupon-{size}m-inspection'
            p=root/'exports'/f'{sid}-{size}m.inspection.glb'
            bpy.ops.export_scene.gltf(filepath=str(p),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_normals=True,export_tangents=True,export_texcoords=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False,export_extras=True)
            exports.append(str(p.relative_to(root))); bpy.data.objects.remove(dup,do_unlink=True)
        require(digest(source)==before,'Source changed during export')
        report['surfaces'].append({'id':sid,**source_info,'sourceSha256AfterExport':digest(source),'maps':maps,'exports':exports})
    report['reimports']=[import_check(root/f) for s in report['surfaces'] for f in s['exports']]
    if args.render:
        report['previews']=render_previews(root)
        ds=importlib.util.spec_from_file_location('roof_detail_renderer',HERE/'render_details.py')
        details=importlib.util.module_from_spec(ds); ds.loader.exec_module(details); details.render(root)
    else: report['previews']=[]
    report['finishedUtc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()); dump(root/'qa/export-report.json',report)
    print('ROOF EXPORT COMPLETE',root,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--output',type=Path,default=HERE); p.add_argument('--from-source',type=Path); p.add_argument('--defaults',action='store_true'); p.add_argument('--render',action='store_true')
    run(p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []))
