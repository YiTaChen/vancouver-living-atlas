"""Explicit regeneration only. Re-export editable sources with export.py instead.
node tools/assets/citizen-character-variants/simplify.mjs
blender -b -t 2 --python tools/assets/citizen-character-variants/build.py
"""
import bpy,json,math,sys,bmesh
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[2];sys.path.insert(0,str(ROOT))
from glb_io import externalize
INPUT=REPO/'public/models/citizen/vancouver-citizen.glb';TEMP=Path('/tmp/atlas-citizen-character-variants')
for d in ['source','exports/textures','qa/previews']:(ROOT/d).mkdir(parents=True,exist_ok=True)

def reset(path):
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.render.fps=30;sc.unit_settings.system='METRIC';sc.unit_settings.scale_length=1;bpy.context.preferences.filepaths.save_version=0
 bpy.ops.import_scene.gltf(filepath=str(path));rig=next(o for o in sc.objects if o.type=='ARMATURE');mesh=next(o for o in sc.objects if o.type=='MESH')
 rig.animation_data.action=None
 for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
 for a in bpy.data.actions:a.name=a.name.split('_CitizenRig')[0];a.use_fake_user=True
 for p in rig.pose.bones:p.matrix_basis.identity()
 sc.frame_set(0);bpy.context.view_layer.update();mesh.data.materials[0].name='citizen-atlas-protected'
 return sc,rig,mesh

def components(m):
 parent=list(range(len(m.vertices)))
 def find(a):
  while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
  return a
 def union(a,b):
  a,b=find(a),find(b)
  if a!=b:parent[b]=a
 seen={}
 for v in m.vertices:
  key=tuple(round(x,6) for x in v.co)
  if key in seen:union(v.index,seen[key])
  else:seen[key]=v.index
 for e in m.edges:union(*e.vertices)
 groups={}
 for v in m.vertices:groups.setdefault(find(v.index),set()).add(v.index)
 return sorted(groups.values(),key=len,reverse=True)

def material(name,color,rough=.65,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m

def rigid(ob,rig,bone,mat):
 ob.data.materials.append(mat);bpy.context.view_layer.objects.active=ob;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 for b in rig.data.bones:ob.vertex_groups.new(name=b.name)
 ob.vertex_groups[bone].add(list(range(len(ob.data.vertices))),1,'REPLACE');mod=ob.modifiers.new('Same citizen armature','ARMATURE');mod.object=rig;ob.parent=rig
 if any(len(p.vertices)>4 for p in ob.data.polygons):
  bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4]);bm.to_mesh(ob.data);bm.free()
 if not ob.data.uv_layers:ob.data.uv_layers.new(name='UVMap')
 for p in ob.data.polygons:p.use_smooth=True
 return ob

def shield(name,center,width,height,depth):
 x,y,z=center;outline=[(-.5,.45),(.5,.45),(.5,-.10),(.32,-.35),(0,-.55),(-.32,-.35),(-.5,-.10)]
 vs=[(x+px*width,y+side*depth,z+pz*height) for side in [-.5,.5] for px,pz in outline];n=len(outline);fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob);return ob

def police(rig,mesh):
 cs=components(mesh.data);selected_components=[]
 for component in cs:
  coords=[mesh.data.vertices[i].co for i in component];minz=min(v.z for v in coords);maxz=max(v.z for v in coords);width=max(v.x for v in coords)-min(v.x for v in coords)
  coat=.82<minz<.85 and 1.46<maxz<1.49 and width>.70
  pants=.12<minz<.14 and .95<maxz<.98 and .30<width<.36
  if coat or pants:selected_components.append(component)
 assert len(selected_components)==2,'Garment identification must use anatomical bounds, never size rank after LOD reduction'
 garments=set().union(*selected_components)
 navy=mesh.data.materials[0].copy();navy.name='police-uniform-clothing-only';p=navy.node_tree.nodes.get('Principled BSDF')
 for link in list(p.inputs['Base Color'].links):navy.node_tree.links.remove(link)
 p.inputs['Base Color'].default_value=(.018,.031,.062,1);mesh.data.materials.append(navy)
 selected=0
 for poly in mesh.data.polygons:
  if all(v in garments for v in poly.vertices):poly.material_index=1;selected+=1
 capmat=material('police-hat-fabric',(.018,.031,.062),.83);peakmat=material('police-peak-leather',(.021,.025,.031),.48);gold=material('police-original-badge-brass',(.66,.44,.12),.30,.72)
 adds=[]
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=8,location=(0,.01,1.790));ob=bpy.context.object;ob.name='police-cap-crown';ob.scale=(.097,.098,.068);adds.append(rigid(ob,rig,'head',capmat))
 bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=1,depth=.023,location=(0,.010,1.755));ob=bpy.context.object;ob.name='police-cap-band';ob.scale=(.095,.091,1);adds.append(rigid(ob,rig,'head',peakmat))
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=6,location=(0,-.090,1.749));ob=bpy.context.object;ob.name='police-cap-peak';ob.scale=(.109,.078,.009);adds.append(rigid(ob,rig,'head',peakmat))
 adds.append(rigid(shield('police-chest-badge',(.072,-.135,1.341),.032,.043,.006),rig,'chest',gold))
 adds.append(rigid(shield('police-cap-badge',(0,-.091,1.779),.025,.03,.004),rig,'head',gold))
 # Badge face inset is deliberately abstract original geometry; no official seal.
 mesh['uniformGarmentOnlyPolygonCount']=selected;mesh['skinAtlasNotRecolored']=True
 bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True)
 for ob in adds:ob.select_set(True)
 bpy.context.view_layer.objects.active=mesh;bpy.ops.object.join()
 return {'garmentOnlyFaces':selected,'hatAddsStatureM':.0535,'design':'original abstract shield; no official insignia, external textures or models'}

def remove_driver_backpack(mesh):
 """Remove only original daypack/pocket/zip/loop/harness components, driver-only."""
 m=mesh.data;removed=set();bounds=[]
 for comp in components(m):
  coords=[m.vertices[i].co for i in comp];lo=[min(v[k]for v in coords)for k in range(3)];hi=[max(v[k]for v in coords)for k in range(3)]
  bag=lo[1]>.08 and hi[2]>.97 and hi[2]<1.50
  harness=lo[2]>1.05 and hi[2]>1.43 and hi[2]<1.46 and lo[1]<-.05 and hi[1]>.06 and (hi[0]-lo[0])<.11
  if bag or harness:removed.update(comp);bounds.append({'min':lo,'max':hi,'vertices':len(comp),'role':'daypack'if bag else'harness'})
 assert len(bounds)==9,(len(bounds),bounds)
 def key(v,uv):return tuple(round(x,7)for x in (*v,*uv))
 normals=[m.corner_normals[l.index].vector.copy()for l in m.loops]
 marker=m.attributes.get('f04_source_loop')or m.attributes.new('f04_source_loop','INT','CORNER')
 for l in m.loops:marker.data[l.index].value=l.index
 removed_keys=[{'positionBlenderM':list(m.vertices[l.vertex_index].co),'uvBlender':list(m.uv_layers.active.data[l.index].uv)}for l in m.loops if l.vertex_index in removed]
 bm=bmesh.new();bm.from_mesh(m);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i]for i in removed],context='VERTS');bm.to_mesh(m);bm.free();m.update();m.normals_split_custom_set([normals[m.attributes['f04_source_loop'].data[l.index].value]for l in m.loops])
 mesh['driverOnlyRemovedBackpack']=True;return {'components':bounds,'removedVertexCount':len(removed),'removedLoopKeys':removed_keys}

def add_driver_grip(mesh,rig):
 """Pose-specific anatomical finger curl; original rest/idle hands remain Basis."""
 m=mesh.data
 def key(v,uv):return tuple(round(x,7)for x in (*v,*uv))
 normals=[m.corner_normals[l.index].vector.copy()for l in m.loops]
 marker=m.attributes.get('f04_source_loop')or m.attributes.new('f04_source_loop','INT','CORNER')
 for l in m.loops:marker.data[l.index].value=l.index
 ids={v.index for v in m.vertices if any(mesh.vertex_groups[g.group].name in ['handL','handR']and g.weight>.99 for g in v.groups)}
 assert 2000<len(ids)<3000,len(ids)
 bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);bpy.context.view_layer.objects.active=mesh;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
 for v in m.vertices:v.select=v.index in ids
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT');hands=next(o for o in bpy.context.selected_objects if o!=mesh)
 for ob in [mesh,hands]:
  ob.data.normals_split_custom_set([normals[ob.data.attributes['f04_source_loop'].data[l.index].value]for l in ob.data.loops])
 hands.name='driver-grip-hands';hands['exportRuntime']=True;hands['role']='driver-skin-pose-corrective';hands.shape_key_add(name='Basis');grip=hands.shape_key_add(name='DriverGrip');changed=0
 for v in grip.data:
  x,y,z=v.co;side=1 if x>0 else -1;xx=side*.302
  thumb=side*(x-xx)<-.032 and z>.785
  if z<.798 and not thumb:
   arc=.813-z;radius=.028;angle=(arc-.015)/radius
   digit=max(0,min(3,round((x-xx)/.016+1.5)));length=[.063,.075,.070,.055][digit]
   if arc<length*.46:centre=-.012+(-.019+.012)*arc/(length*.46)
   elif arc<length-.007:centre=-.019+(.003)*(arc-length*.46)/(length*.54-.007)
   else:centre=-.016+.005*min(1,(arc-length+.007)/.007)
   offset=y-centre
   v.co.y=-.010+(radius+offset)*math.sin(angle)
   v.co.z=.798-(radius-(radius+offset)*math.cos(angle));changed+=1
 grip.value=1;keys=hands.data.shape_keys;keys.animation_data_create();act=bpy.data.actions.new('driver-grip');act.use_fake_user=True;keys.animation_data.action=act
 for frame in [0,30]:grip.keyframe_insert(data_path='value',frame=frame)
 grip.value=0;hands['gripClipMergeTarget']='driver-seated';return {'handVertices':len(ids),'curledFingerVertices':changed,'morph':'DriverGrip','action':'driver-grip','mergedInto':'driver-seated','basisUnchanged':True}

def driver(rig,mesh,foot_forward=.50,knee_outward=.7,wheel_y=.88,spine_tilt=12,wrist_rear=.032,wrist_up=.070,steering_grip=False):
 rest={b.name:b.matrix_local.copy() for b in rig.data.bones};lengths={b.name:b.length for b in rig.data.bones}
 def orient(name,h,t):
  q=rest[name].to_quaternion();direction=Vector(t)-Vector(h);delta=(q@Vector((0,1,0))).rotation_difference(direction.normalized());rig.pose.bones[name].matrix=Matrix.Translation(Vector(h))@(delta@q).to_matrix().to_4x4();bpy.context.view_layer.update()
 def two_link(a,b,start,end,bend):
  l1=lengths[a];l2=lengths[b];d=Vector(end)-Vector(start);dist=d.length;assert abs(l1-l2)<dist<l1+l2,(a,dist,l1+l2);axis=d.normalized();bend=(Vector(bend)-axis*axis.dot(Vector(bend))).normalized();along=(l1*l1-l2*l2+dist*dist)/(2*dist);mid=Vector(start)+axis*along+bend*math.sqrt(max(0,l1*l1-along*along));orient(a,start,mid);orient(b,mid,end)
 # Character local +Z front in glTF; fit uses a translation of [.44,0,-.06]
 # at vehicle root. Hips .72 gives underside near original cushion top .615.
 hip=Vector((0,0,.72));rig.pose.bones['hips'].matrix=Matrix.Translation(hip)@rest['hips'].to_quaternion().to_matrix().to_4x4();bpy.context.view_layer.update()
 # Small forward inclination uses the same rest lengths and inverse binds.
 q=rest['spine'].to_quaternion();rig.pose.bones['spine'].rotation_quaternion=q.inverted()@Quaternion((1,0,0),math.radians(spine_tilt))@q;bpy.context.view_layer.update()
 for sign in [-1,1]:
  sf='L' if sign>0 else 'R';H=rig.pose.bones['thigh'+sf].head.copy();F=Vector((sign*.13,-foot_forward,.606));two_link('thigh'+sf,'shin'+sf,H,F,(sign*knee_outward,-1,1));orient('foot'+sf,F,F+Vector((0,-.143,-.082)))
  # Wheel rim grips at +/- .142 X and .072 lower arc; coordinate remapped to
  # citizen local using explicit placement translation, never a hidden scale.
  hand=Vector((sign*.142,-(.4-.072*math.sin(.25)+.06),wheel_y-.072*math.cos(.25)))
  # Actual wrist is 5 cm behind grip; preserve visible hand length toward rim.
  if steering_grip:
   hand=Vector((sign*.16,-(.4+.06),wheel_y));wrist=hand+Vector((0,.128,0));S=rig.pose.bones['upperArm'+sf].head.copy();two_link('upperArm'+sf,'foreArm'+sf,S,wrist,(sign*.45,.2,-1))
   # At 9/3 o'clock, knuckle width follows the rim tangent and fingers curl
   # around the 19 mm tube, rather than crossing its solid centre.
   roll=Matrix(((0,sign,0),(0,0,1),(sign,0,0))).to_4x4();rig.pose.bones['hand'+sf].matrix=Matrix.Translation(wrist)@roll@rest['hand'+sf].to_quaternion().to_matrix().to_4x4();bpy.context.view_layer.update()
  else:
   wrist=hand+Vector((0,wrist_rear,wrist_up));S=rig.pose.bones['upperArm'+sf].head.copy();two_link('upperArm'+sf,'foreArm'+sf,S,wrist,(sign*.45,.2,-1));orient('hand'+sf,wrist,wrist+(hand-wrist).normalized()*lengths['hand'+sf])
 action=bpy.data.actions.new('driver-seated');action.use_fake_user=True;rig.animation_data.action=action
 for frame in [0,30]:
  for p in rig.pose.bones:p.keyframe_insert('location',frame=frame,group=p.name);p.keyframe_insert('rotation_quaternion',frame=frame,group=p.name);p.keyframe_insert('scale',frame=frame,group=p.name)
 bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
 anchors={n:list(rig.pose.bones[n].head) for n in ['hips','head','handL','handR','footL','footR']}
 rig.animation_data.action=None
 for p in rig.pose.bones:p.matrix_basis.identity()
 bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
 return {'placementToRoadsterRoot':{'translation':[.44,0,-.06],'rotation':[0,0,0,1],'scale':[1,1,1]},'clip':'driver-seated','boneHeadsBlenderLocalM':anchors,'seatContact':'Proposed hip position in measured cushion footprint; does not reuse short decorative driver hip.','feet':'Proposed ankle at Y=.606; original floor slab top=.475, expected shoe sole=.479. Current Roadster has no pedals.','source':'lib/city/assets/roadster.ts','cameraContract':'Measured seated head to be reported; existing camera [.45,1.2,0] is not silently moved.'}

def export_source(source,target):
 bpy.ops.wm.open_mainfile(filepath=str(source));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('exportRuntime')];assert meshes,'Missing source runtime meshes'
 rig.animation_data.action=None
 for p in rig.pose.bones:p.matrix_basis.identity()
 bpy.context.scene.frame_set(0);bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
 for mesh in meshes:
  mesh.select_set(True)
  if mesh.data.shape_keys:
   for key in mesh.data.shape_keys.key_blocks:key.value=0
 bpy.context.view_layer.objects.active=rig
 bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_skins=True,export_yup=True,export_image_format='AUTO',export_apply=False,export_extras=True,export_frame_range=False,export_tangents=True,export_try_sparse_sk=False)
 return externalize(target,INPUT)

if __name__=='__main__':
 report={'blender':bpy.app.version_string,'device':'CPU','threads':2,'assets':[]}
 kinds=['driver-roadster-fit'] if '--natural-driver-fit-only'in sys.argv else (['police'] if '--police-only'in sys.argv else (['driver'] if '--driver-only'in sys.argv else ['citizen','police','driver','driver-roadster-fit']))
 if len(kinds)==1 and (ROOT/'qa/build.json').exists():
  report=json.loads((ROOT/'qa/build.json').read_text());report['assets']=[x for x in report['assets']if x['id']not in kinds]
 for kind in kinds:
  for lod in [0,1,2]:
   sc,rig,mesh=reset(TEMP/f'citizen.lod{lod}.glb');info={}
   if kind=='police':info=police(rig,mesh)
   elif kind=='driver':info=driver(rig,mesh)
   elif kind=='driver-roadster-fit':
    removed=remove_driver_backpack(mesh);(ROOT/'qa'/f'driver-roadster-fit-removed-components.lod{lod}.json').write_text(json.dumps(removed,indent=2));info=driver(rig,mesh,.72,0,1.06,-8,.112,.040,True);info['grip']=add_driver_grip(mesh,rig);info['compatibilityProfile']='roadster-driver-fit optional cockpit only';info['steeringCenterM']=[.44,1.06,.4];info['naturalLegs']='Same full-scale diagnostic trial6 hips and legs; -8 degree supported torso, driver-only backpack removal and pose-specific grip corrective'
   mesh.name=f'{kind}-body';mesh['exportRuntime']=True;rig['provenance']='Reconstructed from accepted GLB, original generator retained separately; no recovered sculpt history';mesh['role']=kind
   sc['packageId']='citizen-character-variants';sc['baselineStatureM']=1.804534;sc['frontAxis']='Blender -Y = glTF +Z';sc['baselineRevision']='aef5e31d4eb8d5d3f832d0931373bf6583227033'
   for image in bpy.data.images:
    if image.size[0] and not image.packed_file:image.pack()
   source=ROOT/'source'/f'{kind}.lod{lod}.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
   target=ROOT/'exports'/f'{kind}.lod{lod}.glb';maps=export_source(source,target);item={'id':kind,'lod':lod,'source':str(source.relative_to(ROOT)),'export':str(target.relative_to(ROOT)),'maps':maps,'info':info};report['assets'].append(item);(ROOT/'qa/build.json').write_text(json.dumps(report,indent=2));print('BUILT',kind,lod,flush=True)
