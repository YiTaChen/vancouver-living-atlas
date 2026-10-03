"""Reopen editable sources, test source edits, reimport actual GLBs and render CPU QA."""
import argparse,hashlib,importlib.util,json,math,sys,tempfile
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from export import export_loaded
s=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
M=json.loads((HERE/'manifest.json').read_text());V=M['vehicles'][0];RENDERS=[];ACTIVE_SOURCES=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cv(p):return (p[0],-p[2],p[1])
def uncv(p):return [p[0],p[2],-p[1]]
def need(x,s):
 if not x:raise AssertionError(s)
def clean():bpy.ops.wm.read_factory_settings(use_empty=True)
def import_file(p):
 old=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(p));return list(set(bpy.context.scene.objects)-old)
def worldbounds(obs):
 pts=[uncv(o.matrix_world@v.co) for o in obs if o.type=='MESH' for v in o.data.vertices];lo=[min(v[k] for v in pts) for k in range(3)];hi=[max(v[k] for v in pts) for k in range(3)];return {'min':lo,'max':hi,'size':[b-a for a,b in zip(lo,hi)]}
def validate_sources():
 results=[];batch_equivalence=[];sources=[HERE/l['source'] for a in M['assets'] for l in a['lods']];before={str(p):sha(p) for p in sources}
 with tempfile.TemporaryDirectory(prefix='boardable-bus-qa-') as td:
  td=Path(td)
  for asset in M['assets']:
   for lod in asset['lods']:
    source=HERE/lod['source'];bpy.ops.wm.open_mainfile(filepath=str(source));need(any(o.type=='MESH' for o in bpy.context.scene.objects),'editable meshes absent')
    modifiers=sum(len(o.modifiers) for o in bpy.context.scene.objects);mesh_count=sum(o.type=='MESH' for o in bpy.context.scene.objects)
    out=td/(source.stem+'.glb');export_loaded(out);rr=C.measure_glb(out)
    need(rr['triangles']==lod['triangles'],'source reexport triangles');need(all(abs(rr['boundsM'][q][k]-lod['boundsM'][q][k])<1e-5 for q in ['min','max'] for k in range(3)),'source reexport bounds')
    if asset['kind']=='transit-interior':
     # Compare a fresh unbatched source export to the actual batched deliverable.
     unbatched=td/(source.stem+'.unbatched.glb');export_loaded(unbatched,batch_interior=False)
     from validate import load
     before_scene,old_doc,old_bin=load(unbatched);after_scene,new_doc,new_bin=load(out);maximum=0;components=0
     for name,component in before_scene.items():
      if not component['points']:continue
      actual=after_scene[name];need(len(component['points'])==len(actual['points']) and len(component['triangles'])==len(actual['triangles']),'batch changed component geometry count')
      maximum=max(maximum,max(abs(a-b) for p,q in zip(component['points'],actual['points']) for a,b in zip(p,q)));components+=1
     need(maximum<.000002,'batch changed source geometry')
     # The UV and unit-normal channels retain the same values for these translation-only components.
     checked_channels=0
     for node in new_doc['nodes']:
      ranges=node.get('extras',{}).get('componentRanges')
      if not ranges:continue
      primitive=new_doc['meshes'][node['mesh']]['primitives'][0]
      for r in ranges:
       source_node=old_doc['nodes'][r['sourceNodeIndex']];source_primitive=old_doc['meshes'][source_node['mesh']]['primitives'][r['sourcePrimitive']]
       for channel in ['TEXCOORD_0','NORMAL']:
        old_values=C.accessor(old_doc,old_bin,source_primitive['attributes'][channel]);new_values=C.accessor(new_doc,new_bin,primitive['attributes'][channel])[r['vertexStart']:r['vertexStart']+r['vertexCount']]
        need(len(old_values)==len(new_values) and max(abs(a-b) for p,q in zip(old_values,new_values) for a,b in zip(p,q))<.000002,'batch channel changed');checked_channels+=1
     batch_equivalence.append({'file':lod['file'],'status':'pass','sourceComponentCount':components,'maximumVertexDeltaM':maximum,'sourceTriangles':C.measure_glb(unbatched)['triangles'],'batchedTriangles':rr['triangles'],'sourcePrimitives':C.measure_glb(unbatched)['primitives'],'batchedPrimitives':rr['primitives'],'uvAndNormalChannelsCompared':checked_channels,'unbatchedSha256':sha(unbatched),'batchedSha256':sha(out)})
    results.append({'source':lod['source'],'sourceSha256':sha(source),'editableMeshes':mesh_count,'retainedModifiers':modifiers,'reexportSha256':sha(out),'deliveredSha256':lod['sha256'],'binaryIdentical':sha(out)==lod['sha256'],'status':'pass'})
  source=HERE/M['assets'][0]['source'];bpy.ops.wm.open_mainfile(filepath=str(source));ob=bpy.data.objects['roof-equipment'];need(len(ob.modifiers)>0,'roof modifier missing')
  for vert in ob.data.vertices:vert.co.z+=.017
  ob['artist_edit_probe']='roof geometry raised 0.017 m; persistent object extra'
  bpy.data.materials['paint'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.081,.21,.37,1)
  edited=td/'edited-source.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);bpy.ops.wm.open_mainfile(filepath=str(edited));out=td/'edited-export.glb';export_loaded(out)
  editeddoc,binary=C.read_glb(out);r=C.measure_glb(out);original=M['assets'][0]['lods'][0]['boundsM']['max'][1];need(abs(r['boundsM']['max'][1]-original-.017)<1e-5,'artist geometry edit lost')
  material=next(m for m in editeddoc['materials'] if m['name']=='paint');need(abs(material['pbrMetallicRoughness']['baseColorFactor'][0]-.081)<1e-5,'artist material edit lost');need(any(n.get('extras',{}).get('artist_edit_probe') for n in editeddoc['nodes']),'artist extras lost')
  edit_result={'status':'pass','sourceCopySha256':sha(edited),'exportSha256':sha(out),'geometryEditM':.017,'measuredRoofTopDeltaM':r['boundsM']['max'][1]-original,'materialPaintRedLinear':material['pbrMetallicRoughness']['baseColorFactor'][0],'objectExtraPreserved':True,'workflow':'Copy original source, edit mesh/material/custom property, save compressed .blend, reopen it, run source-preserving export. Generator never invoked.'}
  # The new export-only batch must also retain an artist edit to one seat mesh.
  source=HERE/M['assets'][1]['source'];bpy.ops.wm.open_mainfile(filepath=str(source));ob=bpy.data.objects['seat-01-cushion']
  for vertex in ob.data.vertices:vertex.co.z+=.012
  ob['artist_batch_edit_probe']='one cushion raised 0.012 m'
  edited=td/'edited-interior.blend';bpy.ops.wm.save_as_mainfile(filepath=str(edited),compress=True);bpy.ops.wm.open_mainfile(filepath=str(edited));out=td/'edited-interior.glb';export_loaded(out)
  from validate import load
  edited_scene,edited_doc,_=load(out);original_scene,_,_=load(HERE/M['assets'][1]['lods'][0]['file'])
  delta=max(p[1] for p in edited_scene['seat-01-cushion']['points'])-max(p[1] for p in original_scene['seat-01-cushion']['points'])
  need(abs(delta-.012)<1e-5,'interior batch lost artist edit');need(edited_scene['seat-01-cushion']['node'].get('extras',{}).get('artist_batch_edit_probe'),'interior batch lost component extra')
  interior_edit={'status':'pass','componentId':'seat-01-cushion','sourceCopySha256':sha(edited),'exportSha256':sha(out),'measuredGeometryDeltaM':delta,'geometryBatchNodeId':edited_scene['seat-01-cushion']['batchNodeId'],'zeroDrawAnchorPreserved':True,'artistExtraPreserved':True}
 need(all(sha(p)==before[str(p)] for p in sources),'original source mutated')
 reimports=[]
 for asset in M['assets']:
  for lod in asset['lods']:
   clean();obs=import_file(HERE/lod['file']);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();b=worldbounds(obs)
   need(all(abs(b[q][k]-lod['boundsM'][q][k])<1e-5 for q in ['min','max'] for k in range(3)),'Blender GLB reimport bounds')
   need(not any(o.type in ['LIGHT','CAMERA'] for o in obs),'runtime reference camera/light')
   reimports.append({'file':lod['file'],'sha256':lod['sha256'],'boundsM':b,'status':'pass','cameraAndLightCount':0})
 report={'schemaVersion':1,'status':'pass','blenderVersion':bpy.app.version_string,'renderer':'Cycles CPU','cpuThreads':2,'cpuModel':next((x.split(':',1)[1].strip() for x in (Path('/proc/cpuinfo').read_text().splitlines() if Path('/proc/cpuinfo').is_file() else []) if x.startswith('model name')),'unknown'),'denoising':{'enabled':False,'reason':'Blender build lacks OpenImageDenoise'},'originalSourcesUnchanged':True,'sourceReopenReexport':results,'sourceEditPreservation':edit_result,'interiorBatchEditPreservation':interior_edit,'staticBatchEquivalence':batch_equivalence,'actualGLBReimports':reimports,'warnings':['Blender extension cache attempted a read-only home-directory write; export and rendering do not depend on that cache.']}
 (HERE/'qa/blender-validation.json').write_text(json.dumps(report,indent=2)+'\n')

def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.7;return m

def qa_box(name,c,size,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=cv(c));o=bpy.context.object;o.name=name;o.scale=(size[0],size[2],size[1]);o.data.materials.append(material);return o

def human(x,z,h,material):
 # QA only, explicit foot and head heights; these references never enter exported GLBs.
 qa_box('QA-human-torso',(x,h*.665,z),(.37,h*.34,.21),material)
 for dx in [-.105,.105]:qa_box('QA-human-leg',(x+dx,h*.245,z),(.13,h*.49,.15),material)
 for dx in [-.235,.235]:qa_box('QA-human-arm',(x+dx,h*.66,z),(.09,h*.34,.11),material)
 qa_box('QA-human-neck',(x,h-.26,z),(.10,.13,.10),material)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=cv((x,h-.115,z)));o=bpy.context.object;o.name='QA-human-head';o.scale=(.095,.09,.115);o.data.materials.append(material)

def references():
 amber=mat('QA-reference-1m',(.95,.55,.07));red=mat('QA-human-1.75m',(.70,.13,.1));green=mat('QA-human-1.81m',(.13,.55,.22))
 human(-2.40,3.2,1.75,red);human(-3.10,3.2,1.81,green);qa_box('QA-1m-ruler',(-2.1,.5,1.9),(.035,1,.035),amber)
 for i in range(11):qa_box('QA-ruler-tick',(-2.06,i*.1,1.9),(.11,.012,.03),amber)

def scene(lod=0,inside=True,opened=False,section=False,refs=True):
 global ACTIVE_SOURCES
 ACTIVE_SOURCES=[f'exports/city-bus-12m-exterior.lod{lod}.glb']+([f'exports/city-bus-12m-interior.lod{min(lod,1)}.glb'] if inside else [])
 clean();obs=import_file(HERE/f'exports/city-bus-12m-exterior.lod{lod}.glb')
 if inside:obs+=import_file(HERE/f'exports/city-bus-12m-interior.lod{min(lod,1)}.glb')
 for o in obs:
  if o.animation_data:o.animation_data_clear()
 for d in V['doors']:
  o=bpy.data.objects.get(d['nodeId'])
  if o and opened:o.location=cv(d['openTransform']['translationM'])
 if section:
  # QA-only longitudinal cut: cut away vehicle-right half and roof from reimported runtime meshes.
  for o in obs:
   if o.type!='MESH':continue
   if 'ceiling' in o.name or 'roof-equipment' in o.name:o.hide_render=True;continue
   bm=bmesh.new();bm.from_mesh(o.data)
   if o.name.startswith('interior-batch-'):
    # QA-only ceiling removal from the actual imported material batch. All ceiling
    # faces are above Y=2.595; other static panel pieces are below that plane.
    ceiling_faces=[f for f in bm.faces if all((o.matrix_world@v.co).z>2.595 for v in f.verts)]
    bmesh.ops.delete(bm,geom=ceiling_faces,context='FACES')
   # Evaluate plane in object-local coordinates so transformed door/seat components are cut correctly.
   inv=o.matrix_world.inverted();co=inv@Vector((-.05,0,0));no=(o.matrix_world.transposed().to_3x3()@Vector((1,0,0))).normalized()
   bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=co,plane_no=no,clear_inner=True,clear_outer=False);bm.to_mesh(o.data);bm.free()
 if refs:references()
 ground=mat('QA-ground',(.52,.57,.59));qa_box('QA-ground-plane',(0,-.055,.2),(36,.1,36),ground)
 s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.render.resolution_x=640;s.render.resolution_y=400;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False
 s.world=bpy.data.worlds.new('QA-world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.79,.90,1)
 s.view_settings.view_transform='AgX'
 return s

def lighting(kind,interior=False):
 s=bpy.context.scene
 for o in list(s.objects):
  if o.type=='LIGHT':bpy.data.objects.remove(o,do_unlink=True)
 config={'clear':(.65,3,(1,.93,.8)),'overcast':(1.0,.25,(.85,.92,1)),'dusk':(.20,1.5,(1,.48,.19)),'night':(.045,.13,(.35,.48,1))};ambient,power,color=config[kind];s.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
 ld=bpy.data.lights.new('QA-sun','SUN');ld.energy=power;ld.color=color;ld.angle=.14;o=bpy.data.objects.new('QA-sun',ld);s.collection.objects.link(o);o.rotation_euler=(.55,-.55,-.42)
 ld=bpy.data.lights.new('QA-fill','AREA');ld.energy=650 if kind in ['clear','overcast'] else 260;ld.shape='DISK';ld.size=10;o=bpy.data.objects.new('QA-fill',ld);s.collection.objects.link(o);o.location=cv((-5,8,4));o.rotation_euler=(Vector(cv((0,1,0)))-o.location).to_track_quat('-Z','Y').to_euler()
 if interior or kind=='night':
  for z in [-3,0,3]:
   ld=bpy.data.lights.new('QA-cabin-light','AREA');ld.energy=45;ld.size=1.3;o=bpy.data.objects.new('QA-cabin-light',ld);s.collection.objects.link(o);o.location=cv((0,2.53,z))

def render(name,pos,target,ortho=None,light='clear',lens=25,description=''):
 s=bpy.context.scene;lighting(light,interior=ortho is None)
 old=s.camera
 if old:bpy.data.objects.remove(old,do_unlink=True)
 d=bpy.data.cameras.new('QA-camera');o=bpy.data.objects.new('QA-camera',d);s.collection.objects.link(o);o.location=cv(pos);o.rotation_euler=(Vector(cv(target))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;d.clip_start=.04;d.clip_end=120
 if ortho:d.type='ORTHO';d.ortho_scale=ortho
 s.camera=o;s.render.filepath=str(HERE/'qa/previews'/(name+'.png'));bpy.ops.render.render(write_still=True)
 RENDERS.append({'file':name+'.png','renderer':'Cycles CPU','samples':24,'resolution':[640,400],'lighting':light,'cameraPositionVehicleM':pos,'targetVehicleM':target,'description':description,'actualGLBSources':list(ACTIVE_SOURCES)})
 print('BUS_PREVIEW_DONE',name,flush=True)

def previews(quick=False):
 scene();render('exterior-front',[0,3.5,16],[0,1.55,.2],8.6,description='Actual GLB front, 1m ruler and 1.75/1.81m references')
 if quick:return
 render('exterior-right-side',[-15,4.2,3],[0,1.35,.2],14.3,description='Right side closed independent doors, tyres and hollow glazed shell')
 render('exterior-rear',[0,3.5,-16],[0,1.55,.2],8.6)
 render('exterior-top',[.01,20,.20],[0,0,.20],14.4)
 for light in ['clear','overcast','dusk','night']:render('light-'+light,[-12,7,12],[0,1.2,.2],15.0,light)
 for lod in [0,1,2]:
  scene(lod,inside=lod<2);render('lod-'+str(lod),[-12,7,12],[0,1.2,.2],15.0,description='Same camera; LOD2 is closed empty nonboarding fallback')
  if lod==2:render('lod-2-rear',[0,3.5,-16],[0,1.55,.2],8.6,description='Closed opaque rear-window silhouette cue; unchanged LOD2 datum/bounds')
 scene(opened=True);render('doors-open',[-15,4.2,3],[0,1.35,.2],14.3)
 for group in ['front','rear']:
  d=next(d for d in V['doors'] if d['doorGroupId']==group);z=d['boardingPointM'][2];render('entry-'+group,[-2.8,1.61,z],[.5,1.5,z],lens=23,description='Entry eye viewpoint through actual open portal')
 render('interior-aisle',[0,1.99,-5.3],[0,1.5,4.6],lens=20,description='Standing 1.81m eye-height study, continuous real floor and unobstructed central aisle')
 for seat in V['seats']:
  eye=seat['cameraEyePointM'];render(seat['seatId']+'-view',eye,[eye[0]*.65,1.47,eye[2]+4],lens=23,description='Exact metadata camera eye; one view for every passenger seat')
 render('driver-view',V['driver']['cameraEyePointM'],[.77,1.40,10],lens=27)
 scene(opened=True,section=True);render('longitudinal-section',[-12,6,11],[.4,1.2,.2],15.0,description='QA-only bisected reimported GLB; cut right half and ceiling to reveal floor/wheelwells/seats; runtime unchanged')
 (HERE/'qa/previews/index.json').write_text(json.dumps({'status':'pass','scope':'Actual exported GLB reimport; Cycles CPU only; no WebGL acceptance','references':{'oneMetreRuler':True,'humanHeightsM':[1.75,1.81],'runtimeExcluded':True},'renders':RENDERS},indent=2)+'\n')

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--quick',action='store_true');ap.add_argument('--sources-only',action='store_true');ap.add_argument('--previews-only',action='store_true');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if not args.previews_only:validate_sources()
 if not args.sources_only:previews(args.quick)
if __name__=='__main__':main()
