"""Explicit regeneration of proposed local cockpit parts. Existing editable sources
must be re-exported with export.py. Never imports/writes the Roadster or character.
"""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from export import export_one
S=json.loads((HERE/'specs.json').read_text())
SEATS=json.loads((HERE/'qa/original-driver-seat-geometry.json').read_text())
def pos(v):return (v[0],-v[2],v[1])
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def material(name,hexv,rough,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*[linear(((hexv>>s)&255)/255) for s in (16,8,0)],1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def finish(ob,name,mat,role):
 ob.name=name;ob.data.materials.append(mat);ob['export_asset']=True;ob['source_role']=role;ob['packageId']='roadster-driver-fit';bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if not ob.data.uv_layers:ob.data.uv_layers.new(name='UVMap')
 return ob
def box(name,lo,hi,mat,role):
 c=[(a+b)/2 for a,b in zip(lo,hi)];d=[b-a for a,b in zip(lo,hi)];bpy.ops.mesh.primitive_cube_add(size=1,location=pos(c));o=bpy.context.object;o.dimensions=(d[0],d[2],d[1]);return finish(o,name,mat,role)
for lod,(major,minor,beamverts) in enumerate([(20,8,8),(16,8,8),(12,6,6)]):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1;s['packageId']='roadster-driver-fit';s['source_kind']='original-editable-authoring';s['lod']=lod;s['version']='1.0.0';s['root_frame']='original Roadster identity; no rebasing';s['coordinate_conversion']='Blender (x,y,z) -> glTF (x,z,-y), once'
 dark=material('cockpit-dark',0x142127,.65);metal=material('cockpit-metal',0xa8b7bb,.30,.65)
 box('dashboard-preserved-passenger-and-center',[-.785,.71,.445],[.20,.89,.775],dark,'dashboard')
 box('dashboard-driver-clearance-header',[.20,.85,.445],[.68,.89,.775],dark,'dashboard')
 box('dashboard-preserved-outboard',[.68,.71,.445],[.785,.89,.775],dark,'dashboard')
 box('driver-floor-extension',S['floorExtension']['min'],S['floorExtension']['max'],dark,'floor-extension')
 bpy.ops.mesh.primitive_torus_add(major_segments=major,minor_segments=minor,location=pos(S['steering']['candidateCenter']),rotation=(math.pi/2+.25,0,0),major_radius=.16,minor_radius=.019);o=finish(bpy.context.object,'steering-rim',dark,'steering-rim')
 for p in o.data.polygons:p.use_smooth=True
 for i,(a,b)in enumerate(S['steering']['spokes']):
  a,b=Vector(pos(a)),Vector(pos(b));d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=beamverts,radius=.013,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');finish(o,'steering-spoke-'+('horizontal' if i==0 else 'lower'),metal,'steering-spoke')
 # The seat is one rigid translated ORIGINAL assembly, identical geometry at all
 # LODs to preserve support and source-callsite suppression identity exactly.
 if 'driverSeatTranslation' in S:
  delta=Vector(pos(S['driverSeatTranslation']))
  for part in SEATS['parts']:
   pts=[pos(part['position'][i:i+3]) for i in range(0,len(part['position']),3)];idx=part['index']or list(range(len(pts)));faces=[idx[i:i+3]for i in range(0,len(idx),3)];me=bpy.data.meshes.new(part['id']);me.from_pydata(pts,[],faces);me.update();ob=bpy.data.objects.new(part['id'].replace('/','-'),me);s.collection.objects.link(ob);ob.location=delta;ob.data.materials.append(dark);ob['export_asset']=True;ob['source_role']=part['role'];ob['original_source_part']=part['id'];ob['rigidSeatTranslationGltf']=S['driverSeatTranslation'];uv=me.uv_layers.new(name='UVMap')
   if part['uv']:
    for loop in me.loops:uv.data[loop.index].uv=part['uv'][2*loop.vertex_index:2*loop.vertex_index+2]
   normals=[pos(part['normal'][i:i+3])for i in range(0,len(part['normal']),3)];me.normals_split_custom_set_from_vertices(normals)
 source=HERE/'source'/f'roadster-cockpit-local.lod{lod}.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True);export_one(source,HERE/'exports'/f'roadster-cockpit-local.lod{lod}.glb')
print('BUILT_LOCAL_COCKPIT_3_LODS')
