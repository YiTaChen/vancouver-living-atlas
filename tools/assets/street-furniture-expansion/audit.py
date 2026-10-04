"""Blender reopen, source/edit preservation, reimport geometry and Cycles CPU evidence."""
import bpy, sys, json, math, tempfile, shutil, importlib.util, platform
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from export import contract, export_one, run, IDS
QA=HERE/'qa';QA.mkdir(exist_ok=True);WORK=Path(tempfile.mkdtemp(prefix='street-furniture-qa-'));print('QA_WORK',WORK,flush=True)

def save(name,value): (QA/name).write_text(json.dumps(value,indent=2)+'\n')
def clean():bpy.ops.wm.read_factory_settings(use_empty=True)
def imported(aid,lod):
    clean();bpy.ops.import_scene.gltf(filepath=str(HERE/'exports'/f'{aid}.lod{lod}.glb'));return [o for o in bpy.context.scene.objects if o.type=='MESH']
def points(obs):return [o.matrix_world@v.co for o in obs for v in o.data.vertices]
def bounds(obs):
    p=points(obs);return {'min':[min(v[k] for v in p) for k in range(3)],'max':[max(v[k] for v in p) for k in range(3)]}
def bvh(obs):
    vs=[];ts=[]
    for o in obs:
        o.data.calc_loop_triangles();base=len(vs);vs.extend(o.matrix_world@v.co for v in o.data.vertices);ts.extend(tuple(base+i for i in t.vertices) for t in o.data.loop_triangles)
    return BVHTree.FromPolygons(vs,ts,all_triangles=True)
def shoot(tree,start,direction,distance=100):
    hit,n,idx,dist=tree.ray_cast(Vector(start),Vector(direction),distance);return list(hit) if hit is not None else None

if '--render-only' not in sys.argv:
    # Fresh export, original source hashes invariant; no generator invocation.
    before={p.name:contract.digest(p) for p in (HERE/'source').glob('*.blend')};round_records=run(HERE/'source',WORK/'roundtrip');after={p.name:contract.digest(p) for p in (HERE/'source').glob('*.blend')};assert before==after
    roundtrip=[]
    for aid in IDS:
        for lod in [0,1]:
            stem=f'{aid}.lod{lod}';same=contract.digest(HERE/'exports'/(stem+'.glb'))==contract.digest(WORK/'roundtrip/exports'/(stem+'.glb'));assert same
            roundtrip.append({'id':stem,'sourceSha256':before[stem+'.blend'],'sourceReopened':True,'sourceUnchanged':True,'glbByteIdentical':same,'glbSha256':contract.digest(HERE/'exports'/(stem+'.glb'))})
    save('source-roundtrip.json',{'status':'pass','blenderVersion':bpy.app.version_string,'exportCommand':'export.py --source source --output <fresh-directory>','generatorInvoked':False,'records':roundtrip})

    # Artist edit in a copied LOD1 source: vertex, UV, Principled roughness and modifier.
    edit=WORK/'artist-edited.blend';shutil.copy2(HERE/'source/cedar-bench.lod1.blend',edit);bpy.ops.wm.open_mainfile(filepath=str(edit));wood=next(o for o in bpy.context.scene.objects if o.name.startswith('cedar-seat'))
    wood.data.vertices[0].co.z+=.007;target=wood.matrix_world@wood.data.vertices[0].co;uv_before=list(wood.data.uv_layers.active.data[0].uv);wood.data.uv_layers.active.data[0].uv.x+=.125;uv_target=list(wood.data.uv_layers.active.data[0].uv)
    mat=wood.data.materials[0];mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.731
    metal=next(o for o in bpy.context.scene.objects if o.name.startswith('grounded-splayed-leg'));m=metal.modifiers.new('Artist edge edit','BEVEL');m.width=.002;m.segments=1
    bpy.ops.wm.save_as_mainfile(filepath=str(edit),compress=True);eh=contract.digest(edit);out=WORK/'artist-edited.glb';export_one(edit,out);assert contract.digest(edit)==eh
    clean();bpy.ops.import_scene.gltf(filepath=str(out));ps=points([o for o in bpy.context.scene.objects if o.type=='MESH']);assert min((p-target).length for p in ps)<1e-5
    uvs=[tuple(uv.uv) for o in bpy.context.scene.objects if o.type=='MESH' for uv in o.data.uv_layers.active.data];assert min(sum((u[k]-uv_target[k])**2 for k in range(2)) for u in uvs)<1e-8
    wm=next(m for m in bpy.data.materials if m.name=='wood');assert abs(wm.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value-.731)<1e-6
    assert contract.measure_glb(out)['triangles']>contract.measure_glb(HERE/'exports/cedar-bench.lod1.glb')['triangles']
    # Unsupported graph is rejected without source mutation.
    bpy.ops.wm.open_mainfile(filepath=str(edit));next(m for m in bpy.data.materials if m.name=='wood').node_tree.nodes.new('ShaderNodeTexNoise');bad=WORK/'unsupported.blend';bpy.ops.wm.save_as_mainfile(filepath=str(bad),compress=True);bh=contract.digest(bad)
    rejected=False
    try:export_one(bad,WORK/'unsupported.glb')
    except AssertionError as e:rejected=True;reason=str(e)
    assert rejected and bh==contract.digest(bad)
    save('artist-edit.json',{'status':'pass','sourceIsDisposableCopy':True,'shippedSourcesUnchanged':before=={p.name:contract.digest(p) for p in (HERE/'source').glob('*.blend')},'editedSourceSha256':eh,'editedGlbSha256':contract.digest(out),'checks':{'meshVertexTranslationM':.007,'vertexSurvivedReimport':True,'uvTranslationU':.125,'uvSurvivedReimport':True,'roughness':.731,'materialSurvivedReimport':True,'bevelModifierEvaluated':True,'sourceBytesPreserved':True,'unsupportedProceduralGraphRejected':True},'rejectionReason':reason})

    rows=[];proxies={}
    for aid in IDS:
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'source'/f'{aid}.lod0.blend'));dg=bpy.context.evaluated_depsgraph_get();boxes=[]
        for o in bpy.context.scene.objects:
            e=o.evaluated_get(dg);me=e.to_mesh();ps=[e.matrix_world@v.co for v in me.vertices]
            lo=[min(p[k] for p in ps) for k in range(3)];hi=[max(p[k] for p in ps) for k in range(3)];boxes.append({'part':o.name,'role':o['semantic_role'],'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]});e.to_mesh_clear()
        proxies[aid]=boxes
        for lod in [0,1]:
            obs=imported(aid,lod);bb=bounds(obs);assert abs(bb['min'][2])<1e-5;assert all(o.type=='MESH' for o in bpy.context.scene.objects);tree=bvh(obs)
            checks={'groundDatum':True,'noQaObjects':True,'uvs':all(o.data.uv_layers.active for o in obs),'finiteVertexCoordinates':all(math.isfinite(x) for p in points(obs) for x in p)}
            if aid=='cedar-bench':
                seat=shoot(tree,(0,.12,1.5),(0,0,-1));assert seat and abs(seat[2]-.509)<.002;checks['seatTopM']=seat[2]
            if aid=='transit-shelter':
                roof=[]
                for x in [-1.10,0,1.10]:
                    for y in [-.339,-.20,0,.18]:
                        hit=shoot(tree,(x,y,.05),(0,0,1));assert hit and hit[2]>=2.589;roof.append(hit[2])
                for z in [.1,.5,1,1.75,1.81,2.30,2.45]:
                    for x in [-1.10,0,1.10]:assert shoot(tree,(x,-.5,z),(0,1,0),.68) is None
                checks.update(headroomMinimumSampledM=min(roof),standingPrismGridClear=True,frontEntryGridClear=True)
            if aid=='bicycle-rack':
                assert shoot(tree,(0,-.5,.45),(0,1,0),1) is None;checks['rackCenterOpen']=True
            if aid=='garbage-bin':
                hit=shoot(tree,(0,-.6,.79),(0,1,0));assert hit and hit[1]>.20;checks['wasteMouthOpen']=True
            doc,binary=contract.read_glb(HERE/'exports'/f'{aid}.lod{lod}.glb');checks['tangents']=all('TANGENT' in p['attributes'] for m in doc['meshes'] for p in m['primitives']);assert checks['tangents']
            # Exact duplicate-triangle test, in world coordinates; intersections are a separate integration topic.
            keys=[]
            for o in obs:
                o.data.calc_loop_triangles()
                for t in o.data.loop_triangles:keys.append(tuple(sorted(tuple(round(c,6) for c in o.matrix_world@o.data.vertices[i].co) for i in t.vertices)))
            duplicate=len(keys)-len(set(keys));assert duplicate==0;checks['exactDuplicateTriangles']=duplicate
            rows.append({'assetId':aid,'lod':lod,'authoringBoundsM':bb,'checks':checks})
    save('collision-proxies.json',{'schemaVersion':1,'units':'metres','frame':'glTF Y-up, +Z-front, same asset root','kind':'source component AABBs','warning':'Broadphase candidate only; curved/angled parts use conservative boxes. Narrowphase/nav geometry and pedestrian placement need runtime review. Never use whole shelter bounds as a blocking cuboid.','assets':proxies})
    save('blender-audit.json',{'status':'pass','environment':{'blender':bpy.app.version_string,'device':'CPU','threads':2,'platform':platform.platform()},'scope':'Actual source reopen, GLB reimport, grid rays, exact duplicate triangles, UV/tangent integrity; no WebGL claim.','results':rows})
    print('BLENDER_GEOMETRY_AND_EDIT_PASS',flush=True)

if '--skip-render' in sys.argv:raise SystemExit(0)

# QA-only scale references and lighting. All geometry below is created AFTER GLB import.
def mat(name,color):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);return m
def cube(name,loc,dim,ma):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(ma);return o
def human(pos,h,color):
    m=mat('QA-human-'+str(h),color);x,y=pos
    # Segment totals calibrated: head top exactly h, soles exactly ground.
    cube('QA-human-torso',(x,y,h*.63),(.40,.21,h*.38),m)
    cube('QA-human-neck',(x,y,h*.835),(.12,.13,h*.10),m)
    for dx in [-.105,.105]:cube('QA-human-leg',(x+dx,y,h*.22),(.14,.16,h*.44),m)
    for dx in [-.26,.26]:cube('QA-human-arm',(x+dx,y,h*.56),(.10,.12,h*.34),m)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=h*.075,location=(x,y,h*.925));bpy.context.object.data.materials.append(m)
def scene(aid,lod,view,light):
    obs=imported(aid,lod);bb=bounds(obs);w=bb['max'][0]-bb['min'][0];d=bb['max'][1]-bb['min'][1];h=bb['max'][2];cx=(bb['min'][0]+bb['max'][0])/2;cy=(bb['min'][1]+bb['max'][1])/2
    if view=='side':
        human((cx,bb['min'][1]-.55),1.75,(.28,.40,.59));human((cx,bb['max'][1]+.55),1.81,(.70,.32,.16));rp=(cx,bb['min'][1]-1.02)
    else:
        human((bb['min'][0]-.5,cy),1.75,(.28,.40,.59));human((bb['max'][0]+.5,cy),1.81,(.70,.32,.16));rp=(bb['min'][0]-.95,cy)
    white=mat('QA-ruler-white',(.8,.8,.77));black=mat('QA-ruler-black',(.02,.02,.025))
    for i in range(10):cube('QA-1m-ruler-tenth',(rp[0],rp[1],.05+.1*i),(.08,.08,.1),white if i%2==0 else black)
    floor=mat('QA-ground',(.52,.55,.54));cube('QA-ground-plane',(cx,cy,-.055),(40,40,.1),floor)
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=16;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=256;s.render.resolution_y=256;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.view_settings.exposure=0
    s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True;bg=s.world.node_tree.nodes.get('Background')
    settings={'sunny':((.72,.80,1),.55,(1,.93,.80),3.0),'overcast':((.76,.82,.90),.8,(.83,.88,1),.8),'dusk':((.27,.34,.60),.20,(1,.46,.20),1.0),'night':((.10,.15,.28),.035,(.40,.58,1),.20)}
    wc,ws,sc,se=settings[light];bg.inputs[0].default_value=(*wc,1);bg.inputs[1].default_value=ws
    bpy.ops.object.light_add(type='SUN',location=(4,-5,9));sun=bpy.context.object;sun.name='QA-sun';sun.data.energy=se;sun.data.color=sc;sun.data.angle=.20 if light=='sunny' else .65;sun.rotation_euler=(.45,-.35,-.55)
    bpy.ops.object.light_add(type='AREA',location=(-3,-4,max(4,h+1)));area=bpy.context.object;area.data.energy=180 if light!='night' else 70;area.data.shape='DISK';area.data.size=7;area.rotation_euler=(Vector((cx,cy,h*.4))-area.location).to_track_quat('-Z','Y').to_euler()
    # Night area is explicitly QA environmental fill, not a runtime fixture light.
    target=Vector((cx-.16 if view!='side' else cx,cy-.14 if view=='side' else cy,max(h,1.81)*.48))
    offsets={'front':(0,-15,0),'rear':(0,15,0),'side':(15,0,0),'top':(0,0,20)}
    bpy.ops.object.camera_add(location=target+Vector(offsets[view]));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=max(h+.5, (d if view=='side' else w)+2.7,2.5);s.camera=cam
    if view=='top':cam.data.ortho_scale=max(w+2.7,d+2.7,3)
    return s
preview=[]
for aid in IDS:
    for lod in [0,1]:
        for view in ['front','side','rear','top']:
            file=WORK/f'{aid}.lod{lod}.{view}.png';s=scene(aid,lod,view,'sunny');s.render.filepath=str(file);bpy.ops.render.render(write_still=True)
            preview.append({'assetId':aid,'lod':lod,'view':view,'lighting':'sunny','workFile':str(file),'glbSha256':contract.digest(HERE/'exports'/f'{aid}.lod{lod}.glb')})
    for light in ['overcast','dusk','night']:
        file=WORK/f'{aid}.lod0.{light}.png';s=scene(aid,0,'front',light);s.render.filepath=str(file);bpy.ops.render.render(write_still=True);preview.append({'assetId':aid,'lod':0,'view':'front','lighting':light,'workFile':str(file),'glbSha256':contract.digest(HERE/'exports'/f'{aid}.lod0.glb')})
    print('RENDERED',aid,flush=True)
save('preview-work.json',{'status':'rendered','workDirectory':str(WORK),'renderer':'Cycles','device':'CPU','threads':2,'resolution':[256,256],'samples':16,'qaReferences':{'rulerM':1,'humanHeightsM':[1.75,1.81],'onlyInQa':True},'renders':preview})
print('FURNITURE_AUDIT_COMPLETE',flush=True)
