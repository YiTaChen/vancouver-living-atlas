"""Build original parameterized editable ring sections, never stretch legacy GLBs.
Run once for defaults. Artist re-export uses export.py and never calls this file.
"""
import bpy,bmesh,json,sys,importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent

def loops_for(d,lod):
 w,h,s=d['openingWidthM'],d['openingHeightM'],d['sectionM'];back=d['backZ'];front=back+d['depthM'];stop=d['stopRearZ'];t=d['stopThicknessM'];e=d['revealExtraM'];b=d['bevelM']
 def outer(inset,z):return (-w/2-s+inset,w/2+s-inset,inset,h+2*s-inset,z)
 def inner(extra,z):return (-w/2-extra,w/2+extra,s-extra,s+h+extra,z)
 # Closed solid cross-section: outer shell -> bevel -> recess -> real stop
 # lip front/back -> rear return. The minimum opening is exactly w × h.
 loops=[outer(0,back),outer(0,front-b),outer(b,front),inner(e,front),inner(e,stop+t),inner(0,stop+t),inner(0,stop),inner(e,stop),inner(e,back)]
 if lod==0:
  loops.insert(1,outer(0,back+b))
  loops.insert(4,inner(e-b,front))
  loops[5]=inner(e,front-b)
 return loops

def metric_uv(obj,d):
 uv=obj.data.uv_layers.new(name='UVMap');tile=d['tileMeters']
 for p in obj.data.polygons:
  n=(p.normal.x,p.normal.z,-p.normal.y);axis=max(range(3),key=lambda i:abs(n[i]))
  for li in p.loop_indices:
   v=obj.data.vertices[obj.data.loops[li].vertex_index].co;q=(v.x,v.z,-v.y)
   u,v=(q[2],q[1]) if axis==0 else ((q[0],q[2]) if axis==1 else (q[0],q[1]))
   uv.data[li].uv=(u/tile[0],v/tile[1])

def build(d,lod):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
 loops=loops_for(d,lod);vertices=[];faces=[]
 for left,right,bottom,top,z in loops:vertices += [(left,-z,bottom),(right,-z,bottom),(right,-z,top),(left,-z,top)]
 for j in range(len(loops)):
  nj=(j+1)%len(loops)
  for k in range(4):faces.append((j*4+k,j*4+(k+1)%4,nj*4+(k+1)%4,nj*4+k))
 mesh=bpy.data.meshes.new('editable-frame-section');mesh.from_pydata(vertices,[],faces);mesh.update()
 obj=bpy.data.objects.new('window-frame',mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();mesh.update();metric_uv(obj,d)
 mat=bpy.data.materials.new(d['surfaceId']);mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF')
 def linear(x):return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
 color=[linear(x) for x in d['averageColor']];bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=d['roughness'];bs.inputs['Metallic'].default_value=d['metalness'];mat.diffuse_color=(*color,1);mat['semantic_role']=d['surfaceId'];mat['shared_surface_id']=d['surfaceId'];mesh.materials.append(mat)
 obj['asset_id']=d['id'];obj['lod']=lod;obj['semantic_role']=d['surfaceId'];obj['frame_section_m']=d['sectionM'];obj['opening_width_m']=d['openingWidthM'];obj['opening_height_m']=d['openingHeightM'];obj['attachment_datum']='outer-frame-bottom-at-wall-plane';obj['generator_parameters_json']=json.dumps(d,sort_keys=True);obj['source_kind']='original-editable-section-mesh';obj['uv_contract']='dominant-axis metres divided by shared tileMeters; exported glTF V flip once'
 scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene['asset_id']=d['id'];scene['lod']=lod;scene['design_json']=json.dumps(d,sort_keys=True);scene['runtime_status']='runtime_pending_webgl';scene['opening_is_gis_hole']=False
 bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'source'/f"{d['id']}.lod{lod}.blend"),compress=True)

if __name__=='__main__':
 fixtures=json.loads((HERE/'qa/source-fixtures.json').read_text())['fixtures'];catalog=json.loads((HERE.parent/'city-materials/catalog.json').read_text())['materials']
 specs={}
 for fixture in fixtures:
  d=dict(fixture['design']);surface=next(m for m in catalog if m['id']==d['surfaceId']);d.update({k:surface[k] for k in ['tileMeters','averageColor','roughness','metalness']});specs[d['id']]=d
  for lod in (0,1):build(d,lod)
 (HERE/'designs.json').write_text(json.dumps(specs,indent=2)+'\n')
 print('SOURCE_FITTED_WINDOWS_BUILT')
