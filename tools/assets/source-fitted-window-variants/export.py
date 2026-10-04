"""Export artist-authored .blend meshes/UV/material factors without regenerating.
Output must be fresh and distinct from source. Source bytes are never rewritten.
Supported source materials are the shared opaque Principled semantic roles with
unlinked PBR factors; unsupported nodes, transforms, images and materials fail.
"""
import argparse,bpy,bmesh,hashlib,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def need(t,m):
 if not t:raise ValueError(m)
def export_one(path,out):
 before=digest(path);bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
 meshes=[o for o in scene.objects if o.type=='MESH'];need(len(meshes)==1 and meshes[0].name==('window-sill' if scene.get('asset_kind')=='paired-window-sill' else 'window-frame'),'exactly the named editable frame or paired sill is required');obj=meshes[0]
 need(not any(abs(v)>1e-7 for v in obj.location) and all(abs(v-1)<1e-7 for v in obj.scale) and not any(abs(v)>1e-7 for v in obj.rotation_euler),'apply authored transforms; root may not drift')
 need(not obj.modifiers,'explicit mesh source; unsupported modifier must be reviewed');need(len(obj.data.materials)==1,'one shared semantic role');need('UVMap' in obj.data.uv_layers,'editable UV required')
 mat=obj.data.materials[0];need(mat.name in ('painted-metal','cedar'),'unknown semantic material');need(mat.use_nodes,'node material required');nodes=mat.node_tree.nodes;need(len(nodes)==2 and set(n.type for n in nodes)=={'BSDF_PRINCIPLED','OUTPUT_MATERIAL'},'unsupported material nodes cannot be silently flattened')
 bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');links=list(mat.node_tree.links);need(len(links)==1 and links[0].from_node==bs and links[0].to_node==output,'unsupported material wiring')
 need(bs.inputs['Alpha'].default_value==1 and bs.inputs['Transmission Weight'].default_value==0,'only opaque shared roles');need(bs.inputs['Emission Strength'].default_value==0,'emission unsupported');need(not any(n.type=='TEX_IMAGE' for n in nodes),'no private maps')
 need(mat.get('semantic_role')==obj.get('semantic_role')==mat.name,'semantic role mismatch');need(scene.get('asset_id')==obj.get('asset_id') and scene.get('lod')==obj.get('lod'),'source identity mismatch')
 # Triangulate only n-gon caps in export memory so glTF can preserve tangents.
 # Source mesh/UV edits remain intact on disk; frame quads remain unchanged.
 if any(len(p.vertices)>4 for p in obj.data.polygons):
  bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4],quad_method='FIXED',ngon_method='EAR_CLIP');bm.to_mesh(obj.data);bm.free();obj.data.update()
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_draco_mesh_compression_enable=False)
 need(digest(path)==before,'source mutated')
 return {'source':path.name,'sourceSha256':before,'sourceUnchanged':True,'output':out.name,'glbSha256':digest(out),'meshVertices':len(obj.data.vertices),'exportPolygonFaces':len(obj.data.polygons),'uvLoops':len(obj.data.uv_layers.active.data),'materialRole':mat.name,'pbr':{'baseColor':list(bs.inputs['Base Color'].default_value),'roughness':bs.inputs['Roughness'].default_value,'metallic':bs.inputs['Metallic'].default_value}}

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=HERE/'source');p.add_argument('--output',type=Path,required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 source=a.source.resolve();out=a.output.resolve();need(source!=out and not out.is_relative_to(source),'output must be separate from source');need(not out.exists() or not any(out.iterdir()),'refuse to overwrite existing export output');out.mkdir(parents=True,exist_ok=True)
 results=[export_one(path,out/(path.stem+'.glb')) for path in sorted(source.glob('*.blend'))];need(results,'no Blender sources')
 (out/'source-export-report.json').write_text(json.dumps({'status':'pass','method':'native source loaded; selected original mesh, UV and supported material factors exported unchanged','results':results},indent=2)+'\n')
if __name__=='__main__':main()
