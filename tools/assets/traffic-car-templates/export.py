"""Export saved artist sources; never rebuild defaults or save over originals."""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy
from mathutils import Matrix
HERE=Path(__file__).resolve().parent
ROLES={'paint','glass','rubber'}
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def graph_check(mat):
 assert mat.name in ROLES and mat.use_nodes,'unknown material role'
 nt=mat.node_tree;bs=[n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'];outputs=[n for n in nt.nodes if n.type=='OUTPUT_MATERIAL'];assert len(bs)==len(outputs)==1
 assert all(n.type in {'BSDF_PRINCIPLED','OUTPUT_MATERIAL','VERTEX_COLOR'} for n in nt.nodes),'unsupported graph requires explicit export support'
 assert not outputs[0].inputs['Volume'].is_linked and not outputs[0].inputs['Displacement'].is_linked
 assert len(outputs[0].inputs['Surface'].links)==1 and outputs[0].inputs['Surface'].links[0].from_node==bs[0]
 for node in nt.nodes:
  assert not node.mute,'muted nodes need explicit review'
  if node.type=='VERTEX_COLOR':assert node.layer_name=='RoleColor'
 for socket in bs[0].inputs:
  if socket.is_linked:assert socket.name=='Base Color' and socket.links[0].from_node.type=='VERTEX_COLOR','unsupported linked shader input'
 assert bs[0].inputs['Alpha'].default_value==1 and bs[0].inputs['Transmission Weight'].default_value==0,'opaque exterior contract'
 assert mat.use_backface_culling,'single-sided authored normals required'
 reference=bpy.data.materials.new('_validation-reference');reference.use_nodes=True;rb=reference.node_tree.nodes.get('Principled BSDF')
 for socket in bs[0].inputs:
  if socket.name in {'Base Color','Metallic','Roughness'}:continue
  default=rb.inputs.get(socket.name)
  if not hasattr(socket,'default_value') or not default:continue
  actual=socket.default_value;expected=default.default_value
  assert not socket.is_linked,'unsupported edited socket'
  if hasattr(actual,'__len__'):assert all(abs(a-b)<1e-7 for a,b in zip(actual,expected)),'unsupported socket '+socket.name
  else:assert abs(actual-expected)<1e-7,'unsupported socket '+socket.name
 bpy.data.materials.remove(reference)
def join_export_group(objects,name,root=None):
 """Join evaluated copies only, retaining per-face material slots and UV/color data."""
 assert objects
 names=[o.name for o in objects];active=root or objects[0]
 bpy.ops.object.select_all(action='DESELECT')
 for ob in objects:ob.select_set(True)
 bpy.context.view_layer.objects.active=active;bpy.context.view_layer.update()
 if len(objects)>1:bpy.ops.object.join()
 ob=bpy.context.view_layer.objects.active;ob.name=name
 if root is None:
  matrix=ob.matrix_world.copy();ob.data.transform(matrix);ob.parent=None;ob.matrix_world=Matrix.Identity(4)
 ob['batched_source_parts_json']=json.dumps(names);ob['export_batch_kind']='animated-wheel' if root else 'static-semantic-role'
 if root:ob['semantic_role']='wheel-assembly'
 ob['material_roles_json']=json.dumps(sorted(m.name for m in ob.data.materials))
 return ob

def batch_export_scene(level):
 """LOD0: 3 static primitives + 4 rubber/paint wheel assemblies = 11.
 LOD1: 3 static primitives + 4 rubber wheels = 7.
 LOD2: 3 shared-role primitives + zero-draw named wheel-anchor Empties.
 """
 bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=next(iter(bpy.context.scene.objects));bpy.ops.object.convert(target='MESH');bpy.context.view_layer.update()
 objects=list(bpy.context.scene.objects);wheel_roots=[o for o in objects if o.name.startswith('wheel-')]
 anchors=[{'name':o.name,'matrix':o.matrix_world.copy(),'radius':o['wheel_radius_m'],'position':list(o['anchor_center_gltf'])} for o in wheel_roots]
 if level<2:
  dynamic=set()
  for wheel in wheel_roots:
   parts=[wheel]+list(wheel.children_recursive);dynamic.update(parts)
  static=[o for o in objects if o not in dynamic]
 else:static=objects
 groups={role:[] for role in ROLES}
 for ob in static:
  assert len(ob.data.materials)==1,'static source objects must have one semantic role; split the edited object by role before export'
  groups[ob.data.materials[0].name].append(ob)
 for role,name in [('paint','body-shell'),('glass','glass'),('rubber','trim')]:
  joined=join_export_group(groups[role],name);joined['semantic_role']=role
 if level<2:
  for wheel in wheel_roots:join_export_group([wheel]+list(wheel.children_recursive),wheel.name,root=wheel)
 else:
  for a in anchors:
   ob=bpy.data.objects.new(a['name'],None);bpy.context.scene.collection.objects.link(ob);ob.matrix_world=a['matrix'];ob['semantic_role']='wheel-anchor';ob['wheel_radius_m']=a['radius'];ob['anchor_center_gltf']=a['position'];ob['geometry_owner']='trim';ob['animated_geometry']=False
 bpy.context.view_layer.update()

def export_one(source,out):
 before=digest(source);bpy.ops.wm.open_mainfile(filepath=str(source));s=bpy.context.scene;assert s.unit_settings.system=='METRIC' and s.unit_settings.scale_length==1
 objects=list(s.objects);assert objects and all(o.type=='MESH' and o.get('export_asset') for o in objects),'unexpected QA/unsupported object'
 for ob in objects:
  assert all(abs(v-1)<1e-6 for v in ob.scale) and ob.data.uv_layers.active
  for mat in ob.data.materials:graph_check(mat)
  ob.modifiers.new('export-only-triangulation','TRIANGULATE')
 batch_export_scene(int(s['lod']))
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False)
 assert digest(source)==before,'source file changed during export'
 return {'source':str(source),'sourceSha256':before,'output':str(out),'outputSha256':digest(out),'sourceUnchanged':True}
def run(source,out):
 assert not out.exists(),'Output must be a new directory; refusing overwrite'
 assert not out.is_relative_to(source) and not source.is_relative_to(out),'overlapping source/output'
 out.mkdir(parents=True);records=[]
 for src in sorted(source.glob('*.blend')):records.append(export_one(src,out/(src.stem+'.glb')))
 assert len(records)==6,'six source LODs required';(out/'source-export-report.json').write_text(json.dumps(records,indent=2)+'\n')
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');ap.add_argument('--output',type=Path,required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);run(args.source.resolve(),args.output.resolve())
