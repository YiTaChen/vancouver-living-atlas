"""Reopen editable Blender source, import exports, verify deterministic re-bakes."""
import bpy, json, sys, math, hashlib, argparse
from pathlib import Path
P=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('--roundtrip',type=Path,required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.open_mainfile(filepath=str(P/'source/role-material-library.blend'))
roles=json.loads((P/'exports/manifest.json').read_text())['roles'];report={'source':{},'exports':[],'maps':[]}
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(meshes)==16
assert bpy.context.scene.unit_settings.scale_length==1
for role in roles:
 mat=bpy.data.materials[role['id']];assert mat.use_nodes and mat['tile_metres']==role['tile_metres']
 for ch in ['basecolor','orm','normal']:
  im=mat.node_tree.nodes['SOURCE_'+ch].image;assert im.packed_file and tuple(im.size)==(256,256);assert im.colorspace_settings.name==('sRGB' if ch=='basecolor' else 'Non-Color')
 o=next(o for o in meshes if o.name==role['id']+'-coupon');assert all(abs(v-e)<1e-5 for v,e in zip(o.dimensions,(1.2,1.2,.2)))
 for v in o.data.uv_layers.active.data:assert all(math.isfinite(x) for x in v.uv)
report['source']={'mesh_count':len(meshes),'materials':len(roles),'packed_maps':24,'metres':True,'coupon_dimensions_m':[1.2,1.2,.2]}
for p in sorted((P/'exports/textures').glob('*.png')):
 q=a.roundtrip/'textures'/p.name;assert q.exists();sha=hashlib.sha256(p.read_bytes()).hexdigest();assert sha==hashlib.sha256(q.read_bytes()).hexdigest(),p.name
 im=bpy.data.images.load(str(p),check_existing=False);im.colorspace_settings.name='Non-Color';pixels=list(im.pixels);rgb=[pixels[i:i+3] for i in range(0,len(pixels),4)];assert all(math.isfinite(v) for pix in rgb for v in pix)
 if '-orm' in p.name:assert all(abs(pix[0]-1)<1e-6 for pix in rgb)
 if '-normal' in p.name:assert all(.90<math.sqrt(sum((v*2-1)**2 for v in pix))<1.1 for pix in rgb)
 report['maps'].append({'file':'exports/textures/'+p.name,'sha256':sha,'source_roundtrip_identical':True})
for p in sorted((P/'exports').glob('*.glb')):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.import_scene.gltf(filepath=str(p));objs=[o for o in bpy.context.scene.objects if o.type=='MESH'];tri=0
 for o in objs:
  assert o.data.uv_layers;assert all(math.isfinite(x) for v in o.data.vertices for x in v.co)
  o.data.calc_loop_triangles();tri+=len(o.data.loop_triangles)
  for mat in o.data.materials:
   bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');assert bs.inputs['Base Color'].is_linked and bs.inputs['Normal'].is_linked and bs.inputs['Roughness'].is_linked and bs.inputs['Metallic'].is_linked
 assert tri<5000
 report['exports'].append({'file':'exports/'+p.name,'meshes':len(objs),'triangles':tri,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'import_PBR_UV_finite_pass':True})
report['passed']=True;(P/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
