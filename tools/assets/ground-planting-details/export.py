"""Source-preserving export: reopen editable .blend, export current mesh/UV/material values.
Never regenerates defaults or writes sources. Inspection bindings are explicit shared maps.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, math, struct, sys
import bpy
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location('ground_build',HERE/'build.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
def write_glb(path,d,blob):
 d['buffers']=[{'byteLength':len(blob)}];j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);blob+=b'\0'*((-len(blob))%4);path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(blob))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(blob),b'BIN\0')+blob)
def externalize(path,edge=False):
 data=path.read_bytes();size=struct.unpack_from('<I',data,12)[0];d=json.loads(data[20:20+size]);blob=data[28+size:];imageviews={im['bufferView']for im in d.get('images',[])if 'bufferView'in im};out=b'';remap={};views=[];records=[]
 for i,v in enumerate(d['bufferViews']):
  if i in imageviews:continue
  out+=b'\0'*((-len(out))%4);new=dict(v);new['byteOffset']=len(out);out+=blob[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];remap[i]=len(views);views.append(new)
 for im in d.get('images',[]):
  v=d['bufferViews'][im.pop('bufferView')];raw=blob[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];h=hashlib.sha256(raw).hexdigest();name=h[:20]+'.png';target=path.parent/'textures'/name;target.parent.mkdir(parents=True,exist_ok=True)
  if not target.exists():target.write_bytes(raw)
  im['uri']='textures/'+name;records.append({'file':'exports/textures/'+name,'sha256':h,'bytes':len(raw),'imageName':im.get('name','')})
 for a in d.get('accessors',[]):
  if 'bufferView'in a:a['bufferView']=remap[a['bufferView']]
 d['bufferViews']=views
 for s in d.get('samplers',[]):s['wrapS']=33071 if edge else 10497;s['wrapT']=10497
 for m in d.get('materials',[]):
  m['name']=m['name'].split('.')[0];m.setdefault('extras',{})['semantic_role']=m['name'].removeprefix('role-');m['alphaMode']='OPAQUE'
  if m['name']=='role-foliage':m['doubleSided']=True
 write_glb(path,d,out);return records

def image_maps(role,out):
 if role in ['soil','grass','soil-grass-edge']:
  name=role.replace('-','_');return {k:HERE.parent/'vegetation_ground/maps'/f'{name}_{suffix}.png'for k,suffix in [('color','basecolor'),('normal','normal'),('orm','orm')]}
 if role=='sand':return {k:(out/'source/textures' if (out/'source/textures/sand-color.png').exists() else HERE/'source/textures')/f'sand-{k}.png'for k in ['color','normal','orm']}
 if role in ['concrete','asphalt','street-brick']:
  # Same pixel-centre rectangle as cityMaterialRect(), extracted only for offline inspection.
  catalog=json.loads((ROOT/'public/materials/city/manifest.json').read_text());i=next(i for i,m in enumerate(catalog['materials'])if m['id']==role);files={}
  for k in ['color','normal','orm']:
   p=out/'qa/atlas-inspection'/f'{role}-{k}.png';p.parent.mkdir(parents=True,exist_ok=True)
   if not p.exists():
    im=bpy.data.images.load(str(ROOT/'public/materials/city'/f'{k}.png'),check_existing=False);im.colorspace_settings.name='Non-Color';import numpy as np
    a=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4);x=(i%4)*256+8;y=(i//4)*256+8;cut=a[y:y+240,x:x+240,:3]
    # Read PNG bytes as Non-Color for exact crop; retain sRGB intent on output, with no second gamma encoding.
    sp=importlib.util.spec_from_file_location('png_bake',HERE.parent/'city-materials/export_material_library.py');pb=importlib.util.module_from_spec(sp);sp.loader.exec_module(pb)
    # Read normal/data as Non-Color before sampling.
    if k!='color':im.colorspace_settings.name='Non-Color';a=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4);cut=a[y:y+240,x:x+240,:3]
    pb.png(p,pb.encoded(cut),color=k=='color');bpy.data.images.remove(im)
   files[k]=p
  return files
 return {}

def bind_inspection(m,out):
 role=m.get('semantic_role',m.name.removeprefix('role-'));maps=image_maps(role,out)
 if not maps:return
 nt=m.node_tree;bs=nt.nodes.get('Principled BSDF')
 for k,path in maps.items():
  im=bpy.data.images.load(str(path),check_existing=True);im.colorspace_settings.name='sRGB'if k=='color'else'Non-Color';im.name=role+'-'+k
  n=nt.nodes.new('ShaderNodeTexImage');n.image=im;n.extension='REPEAT';n.name='SHARED-'+role+'-'+k
  if k=='color':nt.links.new(n.outputs['Color'],bs.inputs['Base Color'])
  elif k=='normal':
   nm=nt.nodes.new('ShaderNodeNormalMap');nm.uv_map='UVMap';nt.links.new(n.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
  else:
   sp=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(n.outputs['Color'],sp.inputs[0]);nt.links.new(sp.outputs[1],bs.inputs['Roughness']);nt.links.new(sp.outputs[2],bs.inputs['Metallic'])

def source_check():
 obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];b.need(obs,'empty source')
 for o in obs:
  b.need(not o.modifiers and not o.animation_data and not o.parent,'Unsupported modifier/rig/animation/parent: apply authoring change explicitly first')
  b.need(all(math.isfinite(v)for row in o.matrix_world for v in row),'nonfinite transform');b.need(o.matrix_world.determinant()>0,'negative scale');b.need('UVMap'in o.data.uv_layers,'missing UVMap')
  for m in o.data.materials:
   b.need(m and m.use_nodes,'node material required');b.need(all(n.type in ['BSDF_PRINCIPLED','OUTPUT_MATERIAL']for n in m.node_tree.nodes),'Unsupported source node graph: role-only model source supports editable opaque Principled values. Sand master uses separate bake_sand entry.')
   bs=m.node_tree.nodes.get('Principled BSDF');b.need(bs and bs.inputs['Alpha'].default_value==1 and bs.inputs['Transmission Weight'].default_value==0,'opaque role source required')
 return obs

def export_one(source,out):
 before=b.digest(source);bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);b.config();obs=source_check();
 # Triangulate editable n-gons on private in-memory mesh copies so Blender can export tangents.
 import bmesh
 for ob in obs:
  if any(len(f.vertices)>4 for f in ob.data.polygons):
   ob.data=ob.data.copy();bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
 aid=bpy.context.scene['asset_id'];lod=bpy.context.scene['lod'];study=aid.startswith('surface-');items=[]
 for inspection in ([True]if study else[False,True]):
  if inspection:
   for m in set(m for o in obs for m in o.data.materials):bind_inspection(m,out)
  bpy.ops.object.select_all(action='DESELECT')
  for o in obs:o.select_set(True)
  path=out/'exports'/f'{aid}.lod{lod}'+Path('') if False else out/'exports'/f'{aid}.lod{lod}{".inspection"if inspection else""}.glb';path.parent.mkdir(parents=True,exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_texcoords=True,export_normals=True,export_tangents=True,export_attributes=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False,export_extras=True)
  maps=externalize(path,aid=='soil-grass-edge-1m');items.append({'file':str(path.relative_to(out)),'sha256':b.digest(path),'inspection':inspection,'maps':maps})
 b.need(b.digest(source)==before,'Source was modified');return {'assetId':aid,'lod':lod,'source':str(source),'sourceSha256':before,'sourceSha256After':b.digest(source),'sourceReopened':True,'objects':[o.name for o in obs],'exports':items}
def run(source,out,asset=None,rebake_sand=False):
 b.need(not out.resolve().is_relative_to(ROOT/'public'),'Never export candidates into public')
 sand_report=None
 if rebake_sand:
  b.need(out.resolve()!=source.resolve().parent,'Source-preserving sand rebake requires a separate output folder')
  (out/'source/textures').mkdir(parents=True,exist_ok=True);sand_report=b.bake_sand(source/'sand-procedural-master.blend',out/'source/textures')
 files=sorted(source.glob('*.lod*.blend'))
 if asset:files=[p for p in files if p.name.startswith(asset+'.')]
 b.need(files,'No source models');report={'status':'pass','blender':bpy.app.version_string,'device':'CPU','sourcePreserved':True,'sandRebake':sand_report,'sources':[export_one(p,out)for p in files]};b.dump(out/'qa/export-report.json',report)
 # Discard only unreferenced generated inspection PNGs in this output folder.
 used=set()
 for p in (out/'exports').glob('*.glb'):
  raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);used.update(im['uri'].split('/')[-1] for im in doc.get('images',[]) if 'uri' in im)
 for p in (out/'exports/textures').glob('*.png'):
  if p.name not in used:p.unlink()
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=HERE/'source');p.add_argument('--output',type=Path,default=HERE);p.add_argument('--asset');p.add_argument('--rebake-sand',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else[]);run(a.source.resolve(),a.output.resolve(),a.asset,a.rebake_sand)
