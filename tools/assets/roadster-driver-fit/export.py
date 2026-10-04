"""Source-preserving exporter. Reopens saved artist source; never regenerates it.
Unsupported scene/material features fail rather than resetting edited values.
"""
import bpy,sys,json,hashlib,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def check_material(m):
 assert m.use_nodes and m.use_backface_culling,'PBR, single-sided contract';nt=m.node_tree
 assert sorted(n.type for n in nt.nodes)==['BSDF_PRINCIPLED','OUTPUT_MATERIAL'],'Unsupported material graph needs exporter extension'
 bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED');out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
 assert not any(n.mute for n in nt.nodes) and len(nt.links)==1 and out.inputs['Surface'].links[0].from_node==bs
 assert bs.inputs['Alpha'].default_value==1 and bs.inputs['Transmission Weight'].default_value==0
 ref=bpy.data.materials.new('_ref');ref.use_nodes=True;r=ref.node_tree.nodes.get('Principled BSDF')
 for s in bs.inputs:
  if not hasattr(s,'default_value') or not r.inputs.get(s.name) or s.name in ['Base Color','Roughness','Metallic']:continue
  a,b=s.default_value,r.inputs[s.name].default_value
  assert (all(abs(x-y)<1e-7 for x,y in zip(a,b)) if hasattr(a,'__len__') else abs(a-b)<1e-7),'Unsupported edited PBR socket '+s.name
 bpy.data.materials.remove(ref)
def export_one(source,out):
 source,out=Path(source).resolve(),Path(out).resolve();assert source!=out and out.suffix=='.glb';before=digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene
 assert sc.get('packageId')=='roadster-driver-fit' and sc.unit_settings.scale_length==1
 assert all(o.type=='MESH' and o.get('export_asset') and all(abs(v-1)<1e-6 for v in o.scale) and o.data.uv_layers.active for o in sc.objects)
 for m in bpy.data.materials:check_material(m)
 bpy.ops.object.select_all(action='SELECT');out.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
 assert before==digest(source),'Source changed';return {'source':str(source),'sourceSha256':before,'output':str(out),'sha256':digest(out),'sourceUnchanged':True}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print(json.dumps(export_one(a.source,a.output),indent=2))
