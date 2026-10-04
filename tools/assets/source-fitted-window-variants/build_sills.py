"""New optional source-fitted paired sills; old sill files are never changed.
Shared root = actual source window bottom - chosen frame section. Sill top is
6 mm below the new frame base, eliminating the measured legacy-slot overlap.
"""
import bpy,bmesh,json,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('frame_builder',HERE/'build.py');helper=importlib.util.module_from_spec(sp);sp.loader.exec_module(helper)
frames=json.loads((HERE/'designs.json').read_text());designs={}
for fid,f in frames.items():
 d={k:f[k] for k in ['taskId','surfaceId','tileMeters','averageColor','roughness','metalness','sectionM','openingWidthM','openingHeightM','structureId','featureId','edgeKey']};d.update({'id':fid.replace('surround','paired-sill'),'frameId':fid,'kind':'paired-window-sill','widthM':f['openingWidthM']+2*f['sectionM']+.14,'depthM':.30 if f['taskId']=='C02' else .29,'backZ':.02,'frameSeparationM':.006,'topY':-.006,'variant':'folded-metal' if f['taskId']=='C02' else 'sloped-cedar','rootRule':'same frame root = actual windowBounds.bottom - sectionM; do not reuse legacy sill slot Y'})
 # Profiles are in (outward Z, vertical Y), with a real continuous sloped face.
 # Every Y is negative in the frame root; there is a verified 6 mm clear gap.
 if f['taskId']=='C02':
  fine=[(.02,-.006),(.045,-.006),(.045,-.034),(.32,-.074),(.32,-.13),(.294,-.13),(.294,-.116),(.306,-.116),(.306,-.087),(.032,-.047),(.02,-.047)]
  coarse=[(.02,-.006),(.045,-.006),(.045,-.034),(.32,-.074),(.32,-.13),(.294,-.13),(.294,-.088),(.02,-.047)]
 else:
  fine=[(.02,-.006),(.06,-.006),(.31,-.059),(.31,-.112),(.296,-.13),(.256,-.13),(.256,-.115),(.237,-.115),(.237,-.13),(.02,-.13)]
  coarse=[(.02,-.006),(.06,-.006),(.31,-.059),(.31,-.112),(.296,-.13),(.02,-.13)]
 d['profilesZYByLod']={'0':fine,'1':coarse};designs[d['id']]=d
 for lod in [0,1]:
  bpy.ops.wm.read_factory_settings(use_empty=True);profile=d['profilesZYByLod'][str(lod)];n=len(profile);vertices=[(x,-z,y) for x in [-d['widthM']/2,d['widthM']/2] for z,y in profile]
  faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  mesh=bpy.data.meshes.new('editable-sill-section');mesh.from_pydata(vertices,[],faces);mesh.update();o=bpy.data.objects.new('window-sill',mesh);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True);bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();mesh.update();helper.metric_uv(o,d)
  mat=bpy.data.materials.new(d['surfaceId']);mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');linear=lambda x:x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4;color=[linear(x) for x in d['averageColor']];bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=d['roughness'];bs.inputs['Metallic'].default_value=d['metalness'];mat.diffuse_color=(*color,1);mat['semantic_role']=d['surfaceId'];mat['shared_surface_id']=d['surfaceId'];mesh.materials.append(mat)
  o['asset_id']=d['id'];o['lod']=lod;o['semantic_role']=d['surfaceId'];o['asset_kind']='paired-window-sill';o['generator_parameters_json']=json.dumps(d,sort_keys=True);o['source_kind']='original-editable-section-mesh';o['attachment_datum']='shared-window-frame-root';scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene['asset_id']=d['id'];scene['asset_kind']='paired-window-sill';scene['lod']=lod;scene['design_json']=json.dumps(d,sort_keys=True);scene['runtime_status']='runtime_pending_webgl';bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'source'/f"{d['id']}.lod{lod}.blend"),compress=True)
(HERE/'sill-designs.json').write_text(json.dumps(designs,indent=2)+'\n');print('BUILT_TWO_NEW_PAIRED_SILLS')
