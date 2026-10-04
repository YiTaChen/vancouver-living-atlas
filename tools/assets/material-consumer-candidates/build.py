"""Original editable furniture modules, shared role placeholders, CPU reimports.
One Blender process, fixed two CPU threads. --from-source never rebuilds meshes.
"""
import bpy, json, math, os, sys, argparse, hashlib, shutil
sys.dont_write_bytecode = True
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent
ROOT=P.parents[2]
SHARED=P.parent/'role-materials'/'exports'/'textures'
ROLE_COLOURS={'interior-oak-veneer':(.58,.31,.13,1),'landmark-brushed-aluminum':(.52,.59,.62,1),'interior-matte-plaster':(.74,.73,.66,1)}

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s=bpy.context.scene; s.unit_settings.system='METRIC';s.unit_settings.scale_length=1
    s.render.threads_mode='FIXED';s.render.threads=2

def material(role, mapped=True):
    m=bpy.data.materials.get(role) or bpy.data.materials.new(role);m.use_nodes=True;m['surface_id']=role
    m.diffuse_color=ROLE_COLOURS.get(role,(.5,.5,.5,1))
    n=m.node_tree.nodes;n.clear();p=n.new('ShaderNodeBsdfPrincipled');p.name='EDIT_PBR';p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.6
    o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],o.inputs['Surface'])
    if mapped and (SHARED/(role+'-basecolor.png')).exists():
        p.inputs['Base Color'].default_value=(1,1,1,1)
        for channel in ('basecolor','normal','orm'):
            image=bpy.data.images.load(str(SHARED/(role+'-'+channel+'.png')),check_existing=True)
            image.colorspace_settings.name='sRGB' if channel=='basecolor' else 'Non-Color'
            t=n.new('ShaderNodeTexImage');t.image=image;t.extension='REPEAT';t.name='SHARED_'+channel
            uv=n.get('METRE_UV') or n.new('ShaderNodeTexCoord');uv.name='METRE_UV'
            mapping=n.get('PHYSICAL_REPEAT') or n.new('ShaderNodeVectorMath');mapping.name='PHYSICAL_REPEAT';mapping.operation='SCALE';mapping.inputs[3].default_value=2 if role.startswith('vehicle-') else 1
            m.node_tree.links.new(uv.outputs['UV'],mapping.inputs[0]);m.node_tree.links.new(mapping.outputs[0],t.inputs['Vector'])
            if channel=='basecolor':m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
            elif channel=='normal':
                nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=1;m.node_tree.links.new(t.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
            else:
                sep=n.new('ShaderNodeSeparateColor');m.node_tree.links.new(t.outputs['Color'],sep.inputs[0]);m.node_tree.links.new(sep.outputs['Green'],p.inputs['Roughness']);m.node_tree.links.new(sep.outputs['Blue'],p.inputs['Metallic'])
    return m

def metre_uv(obj):
    uv=obj.data.uv_layers.new(name='metre-uv')
    # Axis-aligned authored furniture faces use coherent physical metre charts.
    for poly in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(poly.normal[i])); axes={0:(1,2),1:(0,2),2:(0,1)}[axis]
        for li in poly.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv=(v[axes[0]],v[axes[1]])

def box(name,size,pos,role,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);metre_uv(o);o.data.materials.append(material(role));o['semantic_role']=role
    if bevel:
        m=o.modifiers.new('EDIT_edge_bevel','BEVEL');m.width=bevel;m.segments=1
        m=o.modifiers.new('EDIT_weighted_normals','WEIGHTED_NORMAL');m.keep_sharp=True
    return o

def chair(lod):
    # Existing Canada lecture-chair footprint 0.65 x 0.70, seat top 0.45.
    b=.007 if lod==0 else 0
    box('seat',(.62,.60,.07),(0,0,.415),'interior-oak-veneer',b)
    for x in (-.265,.265):
        for y in (-.25,.25):box('leg-%s-%s'%(x,y),(.045,.045,.38),(x,y,.19),'landmark-brushed-aluminum',b)
    for x in (-.27,.27):box('back-upright-%s'%x,(.04,.04,.61),(x,.28,.695),'landmark-brushed-aluminum',b)
    if lod==0:
        for i in range(3):box('back-slat-%02d'%i,(.60,.055,.135),(0,.28,.60+i*.17),'interior-oak-veneer',b)
    else:box('back-simplified',(.60,.055,.48),(0,.28,.755),'interior-oak-veneer')

def counter(lod):
    # Four 1.5 m modules occupy existing Science admissions 6 x 1.5 x 1.1.
    b=.008 if lod==0 else 0
    box('counter-top',(1.5,1.5,.08),(0,0,1.06),'interior-oak-veneer',b)
    box('counter-front',(1.46,.065,.87),(0,-.68,.565),'interior-oak-veneer',b)
    for x in (-.68,.68):box('counter-side-%s'%x,(.065,1.35,.92),(x,0,.54),'interior-matte-plaster',b)
    box('recessed-plinth',(1.32,1.27,.14),(0,0,.07),'interior-matte-plaster',b)
    if lod==0:
        box('working-shelf',(1.28,1.23,.045),(0,0,.54),'interior-matte-plaster',b)
        box('front-inset-rail',(1.37,.025,.05),(0,-.72,.78),'interior-matte-plaster',.003)

ASSETS={'lecture-chair-module':{'build':chair,'dimensions':[.62,1,.60],'sourceUse':'lib/city/interiors.ts Canada lecture chairs: obstacle(x,zz,0.65,0.7,0.45); back at f+0.7. Existing footprint preserved.','collision':{'sizeM':[.65,1,.70],'centreM':[0,.5,0]},'anchors':{'seatTopM':[0,.45,0]},'roles':['interior-oak-veneer','landmark-brushed-aluminum']},'admissions-counter-module':{'build':counter,'dimensions':[1.5,1.1,1.5],'sourceUse':'lib/city/interiors.ts Science admissions obstacle(49,-34,6,1.5,1.1). Four modules width 1.5 m fill the existing 6 m rectangle; screens and sign remain existing nodes.','collision':{'sizeM':[1.5,1.1,1.5],'centreM':[0,.55,0]},'anchors':{'worktopM':[0,1.1,0]},'roles':['interior-oak-veneer','interior-matte-plaster']}}

def export_current(path, batched=True):
    # Source edit preservation: export evaluated current editable mesh/modifiers.
    # Replace material *only during export*, never source; no private image copy.
    originals=[]
    for o in bpy.context.scene.objects:
        if o.type!='MESH':continue
        originals.append((o,list(o.data.materials)));o.data.materials.clear()
        for m in originals[-1][1]:
            role=m.get('surface_id',m.name)
            placeholder=bpy.data.materials.get('EXPORT_'+role)
            if not placeholder:
                placeholder=bpy.data.materials.new('EXPORT_'+role);placeholder.use_nodes=True;placeholder.diffuse_color=m.diffuse_color;placeholder['surface_id']=role
                node=placeholder.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=m.diffuse_color;node.inputs['Roughness'].default_value=.6
            o.data.materials.append(placeholder)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=False,export_apply=True,export_cameras=False,export_lights=False,export_extras=True,export_yup=True,export_materials='EXPORT')
    for o,mats in originals:
        o.data.materials.clear()
        for m in mats:o.data.materials.append(m)
    if batched:
        sys.path.insert(0,str(P))
        from batch_static import batch
        batch(path)

def reimport(path):
    reset();bpy.ops.import_scene.gltf(filepath=str(path));objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in objects:
        assert o.data.uv_layers and len(o.data.vertices)>0
        for v in o.data.vertices:assert all(math.isfinite(c) for c in v.co)
    return objects

def assign_shared(objects):
    for o in objects:
        for i,m in enumerate(o.data.materials):
            role=m.get('surface_id',m.name.replace('EXPORT_','').split('.')[0])
            if (SHARED/(role+'-basecolor.png')).exists():o.data.materials[i]=material(role)

def label(text,position,size=.16):
    bpy.ops.object.text_add(location=position,rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.body=text;o.data.size=size;o.data.extrude=0.0002
    m=material('qa-text',False);m.diffuse_color=(.025,.035,.04,1);m.node_tree.nodes['EDIT_PBR'].inputs['Base Color'].default_value=m.diffuse_color;o.data.materials.append(m)

def human(height,x,y):
    box('qa-height-body',(.33,.18,height*.43),(x,y,height*.56),'qa-human',0)
    for dx in [-.09,.09]:box('qa-height-leg',(.11,.12,height*.43),(x+dx,y,height*.215),'qa-human',0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=height*.068,location=(x,y,height*.932));bpy.context.object.data.materials.append(material('qa-human',False))
    label('%s m'%height,(x-.22,y-.15,.02),.12)

def render(path,centre,distance,roadster=False):
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=20;s.cycles.use_denoising=False
    s.render.resolution_x=960;s.render.resolution_y=600;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
    s.world=bpy.data.worlds.new('QA bright overcast');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.8,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    bpy.ops.object.light_add(type='AREA',location=(-3,-4,7));bpy.context.object.data.energy=1600;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=6
    bpy.ops.object.camera_add(location=Vector(centre)+Vector((distance,-distance,distance*.65)));cam=bpy.context.object;cam.rotation_euler=(Vector(centre)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=distance*1.4;s.camera=cam
    box('qa-ground',(30,30,.04),(0,0,-.10),'qa-ground',0)
    s.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main(args):
    if args.from_source:
        bpy.ops.wm.open_mainfile(filepath=str(args.from_source.resolve()));export_current(args.output.resolve(),not args.unbatched);print('Preserved source edit export:',args.output);return
    reports=[];batch_results=[]
    for aid,config in ASSETS.items():
        for lod in [0,1]:
            source=P/'source'/f'{aid}.lod{lod}.blend';out=P/'exports'/f'{aid}.lod{lod}.glb'
            if args.refresh_existing:
                before_source_hash=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source))
            else:
                reset();config['build'](lod)
                bpy.context.scene['asset_id']=aid;bpy.context.scene['lod']=lod;bpy.context.scene['units']='metres';bpy.context.scene['source_use']=config['sourceUse']
                bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
                bpy.ops.file.make_paths_relative();bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
                before_source_hash=sha(source)
            source_objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
            assert all(o.data.uv_layers for o in source_objects)
            source_count=len(source_objects);modifier_count=sum(len(o.modifiers) for o in source_objects)
            # The independently retained normal export is direct evidence for exact ranges.
            baseline=P/'qa'/'.batch-baseline';baseline.mkdir(exist_ok=True)
            unbatched=baseline/out.name;export_current(unbatched,False)
            shutil.copyfile(unbatched,out)
            sys.path.insert(0,str(P));from batch_static import batch
            from audit_batch import audit
            batch(out);batch_results.append(audit(unbatched,out));objs=reimport(out)
            assert sha(source)==before_source_hash
            reports.append({'assetId':aid,'lod':lod,'sourceReopened':False,'glbReimported':True,'objects':len(objs),'UV':True,'editableMeshObjects':source_count,'editableModifiers':modifier_count,'sourceSha256':before_source_hash,'sourceUnchanged':True,'generatorInvoked':not args.refresh_existing})
            bpy.ops.wm.open_mainfile(filepath=str(source));assert bpy.context.scene['asset_id']==aid
            assert any(o.modifiers for o in bpy.context.scene.objects if o.type=='MESH') if lod==0 else True
            reports[-1]['sourceReopened']=True
    # Actual edited source -> exported GLB -> reimported visible seat surface.
    editSource=P/'source'/'lecture-chair-module.lod0.blend';beforeHash=sha(editSource)
    bpy.ops.wm.open_mainfile(filepath=str(editSource));seat=bpy.data.objects['seat'];before=max(v.co.z+seat.location.z for v in seat.data.vertices)
    for v in seat.data.vertices:
        if v.co.z>0:v.co.z+=.01
    seat['qa_edit']='Raised seat upper vertices by 0.01 m in editable source'
    edited=P/'qa'/'edited-chair.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(edited));editedGLB=P/'qa'/'edited-chair.inspection.glb';export_current(editedGLB)
    objs=reimport(editedGLB)
    # Read the real seat component vertices from the batched GLB, not its Empty anchor.
    from batch_static import C
    doc,binary=C.read_glb(editedGLB)
    batch_node=next(n for n in doc['nodes'] if any(r['componentId']=='seat' for r in n.get('extras',{}).get('componentRanges',[])))
    component=next(r for r in batch_node['extras']['componentRanges'] if r['componentId']=='seat')
    primitive=doc['meshes'][batch_node['mesh']]['primitives'][0]
    points=C.accessor(doc,binary,primitive['attributes']['POSITION'])[component['vertexStart']:component['vertexStart']+component['vertexCount']]
    after=max(v[1] for v in points)
    hit,point,*_=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),Vector((0,0,2)),Vector((0,0,-1)),distance=3)
    assert hit and abs(point.z-after)<2e-6
    assert bpy.data.objects['seat'].type=='EMPTY'
    assert abs((after-before)-.01)<2e-6,(before,after)
    assert sha(editSource)==beforeHash
    assign_shared(objs);human(1.75,1.1,.2);label('Reimport: edited seat +10 mm',(-1,-.8,1.25));render(P/'qa'/'previews'/'edited-chair-reimport.png',(0,0,.85),2.7)
    edit={'status':'pass','edit':'Raise authored seat upper vertices +0.01 m; reopen edited blend; export current evaluated mesh; reimport GLB','beforeTopM':before,'afterTopM':after,'deltaM':after-before,'originalSourceUnchanged':True,'actualBatchRangeVerticesMeasured':True,'reimportSeatRayHitM':point.z,'zeroDrawSeatAnchor':True,'editedGLBSha256':sha(editedGLB),'render':'qa/previews/edited-chair-reimport.png'}
    # Furniture contact scene built solely from the four actual delivered GLBs.
    reset()
    for i,(aid,lod) in enumerate([(a,l) for a in ASSETS for l in [0,1]]):
        existing=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(P/'exports'/f'{aid}.lod{lod}.glb'));objs=[o for o in bpy.data.objects if o not in existing];roots=[o for o in objs if not o.parent]
        x=(i%2)*2.7-1.4;y=(i//2)*2.6
        for o in roots:o.location.x+=x;o.location.y+=y
        assign_shared([o for o in objs if o.type=='MESH']);label(('Chair' if i<2 else 'Counter')+' LOD '+str(lod),(x-.6,y-.9,.04),.16)
    human(1.75,-3.0,1.5);human(1.81,-2.3,1.5)
    box('qa-1m-ruler',(.035,.035,1),(-3.8,1.2,.5),'qa-ruler');label('1 m',(-4,1,1.02),.14)
    render(P/'qa'/'previews'/'furniture-reimport.png',(0,1.2,.6),5.8)
    roadsterGLB=P/'qa'/'roadster.candidate.inspection.glb'
    if roadsterGLB.exists() and not args.refresh_existing:
        objs=reimport(roadsterGLB);assign_shared(objs);human(1.81,-2.2,0);label('Actual Roadster candidate / same geometry',(-2,-3,0),.17);render(P/'qa'/'previews'/'roadster-reimport.png',(0,0,.6),4.2,True)
    (P/'qa'/'blender-validation.json').write_text(json.dumps({'status':'pass','blender':bpy.app.version_string,'renderEngine':'Cycles CPU','threads':2,'sourceReopenAndGLBReimport':reports,'editPreservation':edit,'artifactHashes':{str(x.relative_to(P)):sha(x) for folder in ['source','exports'] for x in (P/folder).glob('*') if x.suffix in ['.blend','.glb']},'referencesM':[1,1.75,1.81],'newMaps':0,'scope':'Offline reimport images only; no WebGL/gameplay acceptance'},indent=2)+'\n')
    from audit_batch import write_report
    write_report(batch_results)
    # Editing test artifacts retain proof GLB; duplicate edited source is disposable.
    edited.unlink()
    for f in (P/'source').glob('*.blend1'):f.unlink()
    for f in (P/'qa').glob('*.blend1'):f.unlink()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--from-source',type=Path);parser.add_argument('--output',type=Path);parser.add_argument('--refresh-existing',action='store_true',help='Reopen all delivered .blend files, reexport and audit; never rebuild/save source');parser.add_argument('--unbatched',action='store_true',help='With --from-source only: export normal GLB for geometry-equivalence auditing')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.from_source and not args.output:parser.error('--output required with --from-source')
    if args.unbatched and not args.from_source:parser.error('--unbatched requires --from-source')
    main(args)
