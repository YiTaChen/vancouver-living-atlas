"""Reopen .blend and export existing artist geometry. Never calls the builder."""
import argparse,importlib.util,sys,json,struct
from pathlib import Path
import bpy,bmesh
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('static_batch',HERE.parent/'boardable-bus/batch_static.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
def export_loaded(path):
 bpy.context.view_layer.update()
 # Evaluate artist modifiers in memory, triangulate and remove sub-micron degenerate
 # bevel caps. This never writes or rebuilds the editable .blend source.
 deps=bpy.context.evaluated_depsgraph_get()
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH':continue
  me=bpy.data.meshes.new_from_object(ob.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
  ob.modifiers.clear();ob.data=me
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.triangulate(bm,faces=list(bm.faces))
  bad=[f for f in bm.faces if f.calc_area()<1e-8]
  if bad:bmesh.ops.delete(bm,geom=bad,context='FACES')
  bm.to_mesh(me);bm.free();me.update()
 bpy.context.view_layer.update()
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_extras=True,export_animations=False,export_lights=False,export_cameras=False)
 B.batch(path)
 # Keep runtime payload bounded. Exact component vertex/index provenance lives in
 # a hash-paired OFFLINE sidecar, rather than hundreds of zero-draw scene nodes.
 doc,raw=B.C.read_glb(path);sidecar=[]
 for node in doc['nodes']:
  ranges=node.get('extras',{}).pop('componentRanges',None)
  if ranges is not None:sidecar.append({'batch':node['name'],'ranges':ranges})
 keep=[]
 for i,n in enumerate(doc['nodes']):
  name=n.get('name','')
  if 'mesh' in n or name=='vehicle' or name.endswith(('-pelvis','-camera')) or name.startswith(('doorway-','gangway-end','standing-reference','floor-datum','flex-bay','camera-aisle')):keep.append(i)
 remap={old:new for new,old in enumerate(keep)};nodes=[]
 for old in keep:
  n=doc['nodes'][old]
  if 'children' in n:n['children']=[remap[k] for k in n['children'] if k in remap]
  nodes.append(n)
 doc['nodes']=nodes
 for scene in doc['scenes']:scene['nodes']=[remap[k] for k in scene['nodes'] if k in remap]
 doc['extras']['staticBatching']['componentRanges']='Offline sidecar: '+Path(path).stem+'.components.json'
 doc['extras']['staticBatching']['sourceAnchorsPruned']=True
 payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4);raw+=b'\0'*((-len(raw))%4)
 Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,12+8+len(payload)+8+len(raw))+struct.pack('<I4s',len(payload),b'JSON')+payload+struct.pack('<I4s',len(raw),b'BIN\0')+raw)
 Path(path).with_suffix('.components.json').write_text(json.dumps({'glbSha256':B.C.digest(path),'scope':'Offline geometry provenance; not a runtime passenger contract','batches':sidecar},separators=(',',':'))+'\n')
 return doc['extras']['staticBatching']
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');ap.add_argument('--output',type=Path,required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
 for p in sorted(a.source.glob('*.blend')):
  bpy.ops.wm.open_mainfile(filepath=str(p.resolve()));export_loaded(a.output/(p.stem+'.glb'))
if __name__=='__main__':main()
