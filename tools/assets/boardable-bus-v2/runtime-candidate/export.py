"""Export editable candidate source; retain exact hash-bound offline component ranges.
Uses ordinary glTF; no decoder extension, compression, textures or runtime loader.
"""
import argparse,importlib.util,sys,json,struct
from pathlib import Path
import bpy,bmesh
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('bus_runtime_batch',HERE.parent.parent/'boardable-bus/batch_static.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)

def export_loaded(path):
 path=Path(path);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH':continue
  me=bpy.data.meshes.new_from_object(ob.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps);ob.modifiers.clear();ob.data=me
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.triangulate(bm,faces=list(bm.faces));bad=[f for f in bm.faces if f.calc_area()<1e-10]
  if bad:bmesh.ops.delete(bm,geom=bad,context='FACES')
  bm.to_mesh(me);bm.free();me.update()
 bpy.context.view_layer.update()
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_texcoords=False,export_normals=True,export_materials='EXPORT',export_extras=True,export_animations=False,export_lights=False,export_cameras=False)
 B.batch(path);doc,raw=B.C.read_glb(path);side=[];component_nodes={}
 for n in doc['nodes']:
  ranges=n.get('extras',{}).pop('componentRanges',None)
  if ranges is not None:
   for r in ranges:component_nodes[r['componentId']]=doc['nodes'][r['sourceNodeIndex']]
   side.append({'batch':n['name'],'ranges':ranges})
 keep=[i for i,n in enumerate(doc['nodes']) if 'mesh' in n or n.get('name')=='vehicle' or len(n.get('name',''))==7 and n['name'].startswith('seat-') or n.get('name','').endswith(('-pelvis','-camera')) or n.get('name','').startswith(('doorway-','boarding-','standing-','wheelchair-reference','camera-aisle'))]
 remap={old:new for new,old in enumerate(keep)};nodes=[]
 for old in keep:
  n=doc['nodes'][old]
  if 'children' in n:n['children']=[remap[k] for k in n['children'] if k in remap]
  n.pop('extras',None);nodes.append(n)
 doc['nodes']=nodes
 for s in doc['scenes']:s['nodes']=[remap[k] for k in s['nodes'] if k in remap]
 doc['extras']={'componentSidecar':path.with_suffix('.components.json').name,'componentSidecarScope':'Offline measurable geometry provenance; no runtime requirement','runtimeStatus':'not_run'}
 # uint16 indices are enough for every material batch; ordinary glTF, no decoder.
 binary=bytearray();views=[]
 for i,bv in enumerate(doc['bufferViews']):
  payload=raw[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
  refs=[a for a in doc['accessors'] if a.get('bufferView')==i]
  if len(refs)==1 and refs[0]['componentType']==5125:
   vals=struct.unpack('<'+'I'*(len(payload)//4),payload)
   if max(vals,default=0)<=65535:payload=struct.pack('<'+'H'*len(vals),*vals);refs[0]['componentType']=5123
  binary+=b'\0'*((-len(binary))%4);nv=dict(bv);nv['byteOffset']=len(binary);nv['byteLength']=len(payload);views.append(nv);binary.extend(payload)
 doc['bufferViews']=views;doc['buffers']=[{'byteLength':len(binary)}]
 blob=json.dumps(doc,separators=(',',':')).encode();blob+=b' '*((-len(blob))%4);binary+=b'\0'*((-len(binary))%4)
 path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(blob)+len(binary))+struct.pack('<I4s',len(blob),b'JSON')+blob+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
 path.with_suffix('.components.json').write_text(json.dumps({'schemaVersion':1,'glbSha256':B.C.digest(path),'scope':'Offline component provenance from actual binary ranges; not runtime navigation','sourceComponentNodes':component_nodes,'batches':side},separators=(',',':'))+'\n')
 return B.C.measure_glb(path)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 for p in sorted(a.source.glob('*.blend')):
  bpy.ops.wm.open_mainfile(filepath=str(p.resolve()));print('EXPORTED',json.dumps(export_loaded(a.output/(p.stem+'.glb'))),flush=True)
if __name__=='__main__':main()
