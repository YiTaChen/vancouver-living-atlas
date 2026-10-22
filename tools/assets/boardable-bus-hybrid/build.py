"""Hybrid exterior on the canonical Atlas bus frame; never rebuilds its interior.
Run with one Blender process. Existing sources outside this package are read-only.
"""
import bpy,bmesh,math,sys,json,hashlib,shutil,importlib.util,struct
from pathlib import Path
from mathutils import Vector,Matrix
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
BASE=HERE.parent/'boardable-bus'
sys.path.insert(0,str(BASE))
import build as B
from door_layout import DOORS,AXLES,FLOOR
PUBLIC=REPO/'public/models/blender/bus-hybrid'
SILVER=(.55,.60,.65,1);BLUE=(.006,.043,.19,1);YELLOW=(1,.67,.015,1);WHITE=(.90,.93,.95,1)
DARK=(.012,.018,.024,1);GREY=(.16,.19,.22,1)
DOOR_IDS=[f'door-right-{g}-{s}' for g in ['front','rear'] for s in ['a','b']]
WHEEL_IDS=[f'wheel-{a}-{s}' for a in ['front','rear'] for s in ['left','right']]
REPORT={'blenderVersion':bpy.app.version_string,'levels':[]}

def cv(p):return B.cv(p)
def uncv(p):return Vector((p[0],p[2],-p[1]))
def color_mesh(obj,color=None):
 if obj.type!='MESH':return
 attr=obj.data.color_attributes.get('Color') or obj.data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
 obj.data.color_attributes.active_color=attr
 for poly in obj.data.polygons:
  slot=obj.data.materials[poly.material_index]
  if slot.get('semantic_role')!='paint':col=(1,1,1,1)
  elif color:col=color
  else:
   coords=[uncv(obj.matrix_world@obj.data.vertices[i].co) for i in poly.vertices]
   y=sum(p.y for p in coords)/len(coords)
   name=obj.name
   if name.startswith('wheel-'):col=(.53,.59,.64,1)
   elif name.startswith('door-right'):col=BLUE
   elif 'roof' in name:col=SILVER
   else:col=SILVER if y<.94 or y>=2.52 else BLUE
  for loop in poly.loop_indices:attr.data[loop].color=col
 return obj

def box(name,c,size,role='paint',color=None,parent=None,bevel=0):
 obj=B.box(name,c,size,role,parent,bevel)
 if role=='paint':obj['hybrid_color']=color or SILVER;color_mesh(obj,color or SILVER)
 return obj

def mesh(name,vs,fs,role='paint',color=None,parent=None):
 obj=B.mesh(name,vs,fs,role,parent)
 if role=='paint':obj['hybrid_color']=color or SILVER;color_mesh(obj,color or SILVER)
 return obj

def beam(name,a,b,r,role='paint',color=None,n=8,parent=None):
 obj=B.cylinder(name,a,b,r,role,n,parent)
 for p in obj.data.polygons:p.use_smooth=len(p.vertices)==4
 if role=='paint':obj['hybrid_color']=color or SILVER;color_mesh(obj,color or SILVER)
 return obj

def letter(name,body,center,size,side='right',color=WHITE,shear=.14):
 data=bpy.data.curves.new(name,'FONT');data.body=body;data.align_x='CENTER';data.align_y='CENTER'
 data.size=size;data.shear=shear;data.resolution_u=2;data.extrude=0
 obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.parent=B.ROOT
 # Define a proper right-handed tangent/up/normal basis in runtime coordinates.
 if side=='right':u=Vector((0,0,1));v=Vector((0,1,0));normal=Vector((-1,0,0))
 elif side=='left':u=Vector((0,0,-1));v=Vector((0,1,0));normal=Vector((1,0,0))
 elif side=='front':u=Vector((1,0,0));v=Vector((0,1,0));normal=Vector((0,0,1))
 else:u=Vector((-1,0,0));v=Vector((0,1,0));normal=Vector((0,0,-1))
 basis=Matrix((cv(u),cv(v),cv(normal))).transposed()
 obj.rotation_euler=basis.to_euler();obj.location=cv(center);data.materials.append(B.M['paint'])
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.object.convert(target='MESH');obj=bpy.context.object
 obj['semantic_role']='paint';obj['hybrid_color']=color;color_mesh(obj,color)
 return obj

GLYPHS={' ':['00000']*7,'9':['01110','10001','10001','01111','00001','00001','01110'],
 'B':['11110','10001','10001','11110','10001','10001','11110'],'L':['10000','10000','10000','10000','10000','10000','11111'],
 'I':['11111','00100','00100','00100','00100','00100','11111'],'N':['10001','11001','10101','10011','10001','10001','10001'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],'U':['10001','10001','10001','10001','10001','10001','01110'],
 'C':['01111','10000','10000','10000','10000','10000','01111'],'-':['00000','00000','00000','11111','00000','00000','00000']}
def led(name,body,center,width,side='front'):
 count=len(body)*6-1;pitch=width/count;vv=[];ff=[]
 for k,ch in enumerate(body):
  for row,line in enumerate(GLYPHS.get(ch,GLYPHS[' '])):
   for col,on in enumerate(line):
    if on!='1':continue
    u=(k*6+col-(count-1)/2)*pitch;v=(3-row)*pitch;n=len(vv);r=pitch*.34
    for a,b in [(-r,-r),(r,-r),(r,r),(-r,r)]:
     if side=='front':p=(center[0]+u+a,center[1]+v+b,center[2])
     elif side=='rear':p=(center[0]-u-a,center[1]+v+b,center[2])
     else:p=(center[0],center[1]+v+b,center[2]+u+a)
     vv.append(p)
    ff.append((n,n+1,n+2,n+3))
 return mesh(name,vv,ff,'lights')

def split_paint_bands():
 for obj in list(bpy.context.scene.objects):
  if obj.type!='MESH':continue
  if not any(m and m.get('semantic_role')=='paint' for m in obj.data.materials):continue
  if obj.parent==B.ROOT and obj.name not in ['roof-equipment']:
   bm=bmesh.new();bm.from_mesh(obj.data)
   for z in [.94,2.52]:
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,
                          plane_co=(0,0,z),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
   bm.to_mesh(obj.data);bm.free();obj.data.update()
  color_mesh(obj)

def round_tires(lod):
 for name in WHEEL_IDS:
  node=bpy.data.objects[name]
  for obj in list(node.children):
   if obj.name.startswith(name+'-tyre'):bpy.data.objects.remove(obj,do_unlink=True)
  n=36 if lod==0 else 18
  vs=[];fs=[];profile=[(-.115,.435),(-.098,.478),(-.065,.49),(.065,.49),(.098,.478),(.115,.435)]
  for x,r in profile:
   for j in range(n):
    a=j*math.tau/n;vs.append((x,r*math.cos(a),r*math.sin(a)))
  for k in range(len(profile)-1):
   fs.extend((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for j in range(n))
  for side,index in [(-1,0),(1,5)]:
   start=len(vs)
   for j in range(n):
    a=j*math.tau/n;vs.append((side*.116,.26*math.cos(a),.26*math.sin(a)))
   fs.extend((index*n+j,index*n+(j+1)%n,start+(j+1)%n,start+j) for j in range(n))
  tyre=mesh(name+'-tyre',vs,fs,'rubber',parent=node)
  for p in tyre.data.polygons:p.use_smooth=True
  # Thin bright machined rim and modest recessed vent/spoke detail.
  side=-1 if name.endswith('right') else 1
  nring=24 if lod==0 else 12
  vv=[];ff=[]
  for j in range(nring):
   a=j*math.tau/nring
   for k in range(4):
    b=k*math.tau/4;r=.257+.012*math.cos(b);vv.append((side*(.135+.012*math.sin(b)),r*math.cos(a),r*math.sin(a)))
  for j in range(nring):
   for k in range(4):ff.append((j*4+k,((j+1)%nring)*4+k,((j+1)%nring)*4+(k+1)%4,j*4+(k+1)%4))
  rim=mesh(name+'-machined-rim',vv,ff,'paint',(.67,.72,.75,1),node)
  for p in rim.data.polygons:p.use_smooth=True
  if lod==0:
   for j in range(8):
    a=j*math.tau/8
    yy,zz=.194*math.cos(a),.194*math.sin(a)
    vv=[(side*.146,yy+.026*math.cos(k*math.tau/6),zz+.026*math.sin(k*math.tau/6)) for k in range(6)]
    mesh(name+'-vent',vv,[tuple(range(6)) if side>0 else tuple(reversed(range(6)))],'rubber',parent=node)
   for j in range(5):
    a=j*math.tau/5
    yy,zz=.103*math.cos(a),.103*math.sin(a)
    vv=[(side*.151,yy+.012*math.cos(k*math.tau/6),zz+.012*math.sin(k*math.tau/6)) for k in range(6)]
    mesh(name+'-lug',vv,[tuple(range(6)) if side>0 else tuple(reversed(range(6)))],'paint',(.84,.87,.89,1),node)


def livery(lod):
 for side,label in [(-1,'right'),(1,'left')]:
  x=side*1.256
  intervals=[(-6.13,5.68)]
  if side<0:
   for _,d0,d1 in DOORS:
    intervals=[p for a,b in intervals for p in [(a,min(b,d0)),(max(a,d1),b)] if p[1]>p[0]]
  for a,b in intervals:
   box('hybrid-yellow-waist-'+label,(x,1.184,(a+b)/2),(.008,.055,b-a),'paint',YELLOW)
  # Small rear shoulder sweep, entirely behind the rear wheel/door domains.
  mesh('hybrid-yellow-rear-shoulder-'+label,[(x,2.54,-6.17),(x,2.54,-5.95),(x,2.25,-4.90),
           (x,2.16,-4.90),(x,2.40,-6.17)],[(0,1,2,3,4)],'paint',YELLOW)
  if lod<2:
   letter('hybrid-TransLink-'+label,'TransLink',(x+side*.006,1.035,.72),.255,label)
   if lod==0:letter('hybrid-translink-web-'+label,'translink.ca',(x+side*.007,1.035,-4.65),.082,label)
   letter('hybrid-fleet-'+label,'V7416',(x+side*.007,2.66,-5.62),.103,label,DARK,0)
 if lod<2:
  led('hybrid-front-route','99 B-LINE UBC' if lod==0 else '99 UBC',(0,2.59,5.874),2.05)
  box('hybrid-side-route-screen',(-1.263,2.36,3.14),(.012,.175,1.04),'rubber')
  if lod==0:led('hybrid-side-route','99 UBC',(-1.273,2.36,3.14),.91,'right')
  box('hybrid-rear-route-screen',(0,2.60,-6.315),(1.40,.19,.012),'rubber')
  led('hybrid-rear-route','99',(0,2.60,-6.326),.32,'rear')


def details(lod):
 # Generic low-floor New Flyer-inspired exterior detail, fitted to Atlas geometry.
 seg=8 if lod==0 else 6
 if lod==2:
  for side in [-1,1]:box('hybrid-far-headlamp',(side*.82,.77,6.111),(.22,.16,.016),'lights')
 if lod<2:
  for side in [-1,1]:
   box('hybrid-mirror-reflective-face-'+str(side),(side*1.43,2.26,5.889),(.135,.225,.009),'paint',(.63,.70,.73,1))
   beam('hybrid-front-windshield-edge-'+str(side),(side*1.10,1.14,6.009),(side*1.10,2.47,5.819),.018,'rubber',n=seg)
   beam('hybrid-wiper-arm-'+str(side),(side*.23,1.18,6.018),(side*.63,1.72,5.944),.010,'rubber',n=6)
   beam('hybrid-wiper-blade-'+str(side),(side*.63,1.72,5.944),(side*.68,2.13,5.885),.014,'rubber',n=6)
   box('hybrid-front-light-bezel-'+str(side),(side*.82,.77,6.118),(.31,.22,.023),'rubber')
   for off in [-.065,.065]:
    beam('hybrid-headlamp-'+str(side),(side*.82+off,.77,6.134),(side*.82+off,.77,6.146),.050,'lights',n=12 if lod==0 else 8)
   for y0 in [.59,.78,.98]:
    beam('hybrid-rear-lamp-'+str(side),(side*1.02,y0,-6.320),(side*1.02,y0,-6.334),.042,'lights',n=10 if lod==0 else 6)
   for z in [-5.72,-.40,5.56]:box('hybrid-side-marker',(side*1.258,.47,z),(.014,.045,.115),'lights')
  box('hybrid-front-bumper',(0,.335,6.12),(2.30,.18,.14),'rubber',bevel=.035 if lod==0 else 0)
  box('hybrid-rear-bumper',(0,.33,-6.315),(2.34,.17,.12),'rubber',bevel=.025 if lod==0 else 0)
  box('hybrid-rear-engine-grille',(0,.76,-6.318),(1.63,.66,.018),'rubber')
  for j in range(10 if lod==0 else 6):
   box('hybrid-rear-engine-louver',(0,.49+j*(.055 if lod==0 else .094),-6.335),(1.57,.017,.015),'paint',(.34,.40,.43,1))
  for side in [-1,1]:
   box('hybrid-side-engine-inset',(side*1.259,.68,-5.58),(.014,.42,.78),'rubber')
   for j in range(8 if lod==0 else 4):box('hybrid-side-engine-louver',(side*1.272,.52+j*(.044 if lod==0 else .09),-5.58),(.013,.012,.70),'paint',SILVER)
  # Compact folded bicycle rack; no part intrudes into front-door or interior space.
  for x in [-.75,.75]:beam('hybrid-bike-rack-upright',(x,.40,6.24),(x,1.28,6.24),.020,'paint',(.34,.39,.42,1),seg)
  for y0 in [.45,.80,1.28]:beam('hybrid-bike-rack-crossbar',(-.75,y0,6.24),(.75,y0,6.24),.018,'paint',(.40,.46,.49,1),seg)
  if lod==0:
   for x in [-.44,.44]:
    for off in [-.105,.105]:beam('hybrid-bike-rack-tray',(x+off,.50,6.255),(x+off,1.15,6.255),.012,'paint',SILVER,6)
    beam('hybrid-bike-rack-yellow-hook',(x,1.02,6.28),(x,1.40,6.28),.016,'paint',YELLOW,8)
    beam('hybrid-bike-rack-hook-head',(x,1.40,6.28),(x-.10,1.40,6.28),.016,'paint',YELLOW,8)
   for j in range(18):box('hybrid-roof-HVAC-fin',(0,3.076,-3.45+j*.22),(1.38,.012,.025),'rubber')
   for z in [-4.91,.85,3.60]:box('hybrid-roof-hatch',(0,2.835,z),(.72,.025,.76),'paint',(.68,.72,.74,1),bevel=.02)
  # Door accent detail stays under its original animated leaf, never on static body.
  for name in DOOR_IDS:
   node=bpy.data.objects.get(name)
   if not node:continue
   span=.585 if 'front' in name else .435
   for zz in [-span/2+.028,span/2-.028]:
    box(name+'-hybrid-yellow-edge',(0,1.04,zz),(.052,2.03,.014),'paint',YELLOW,node)
   children=[o for o in node.children if o.type=='MESH']
   B.join_role(children,name+'-panel')


def ramp(lod):
 if lod==2:return None
 pivot=B.empty('boarding-ramp',(-1.25,.36,4.6));pivot['dynamic']='accessibility-ramp';pivot['rotationAxis']='+Z glTF'
 pivot['rampLengthM']=1.12;pivot['rampWidthM']=.86;pivot['centerOffsetM']=[0,0,-.15]
 xs=[0,.025,1.0,1.12];zs=[-.58,-.555,.255,.28]
 vv=[(x,0,z) for x in xs for z in zs];ff=[];colors=[]
 for i in range(3):
  for j in range(3):
   ff.append((i*4+j,(i+1)*4+j,(i+1)*4+j+1,i*4+j+1))
   colors.append(YELLOW if i==0 or i==2 or j in [0,2] else GREY)
 bottom={}
 for i,x in enumerate(xs[:3]):
  for j,z in enumerate(zs):bottom[i,j]=len(vv);vv.append((x,-.018,z))
 for i in range(3):
  for j in range(3):
   aa=bottom[i,j];ab=bottom[i,j+1]
   ba=bottom[i+1,j] if i<2 else 3*4+j
   bb=bottom[i+1,j+1] if i<2 else 3*4+j+1
   ff.append((aa,ab,bb,ba));colors.append(GREY)
 for j in range(3):ff.append((j,j+1,bottom[0,j+1],bottom[0,j]));colors.append(YELLOW)
 for j in [0,3]:
  for i in range(3):
   b0=bottom[i,j];b1=bottom[i+1,j] if i<2 else 12+j
   ff.append((i*4+j,b0,b1) if i==2 else (i*4+j,b0,b1,(i+1)*4+j));colors.append(YELLOW)
 obj=mesh('boarding-ramp-deck',vv,ff,'paint',GREY,pivot)
 # Recalc may reorder vertex loops but face order stays stable.
 attr=obj.data.color_attributes['Color']
 for p,c in zip(obj.data.polygons,colors):
  for li in p.loop_indices:attr.data[li].color=c
 return pivot


def prepare_materials():
 m=B.M['paint'];bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(1,1,1,1);m.diffuse_color=(1,1,1,1)
 vc=m.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';m.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
 m['vertex_color_contract']='COLOR_0 carries silver/navy/yellow/white; shared white paint factor must remain white'
 # Keep original shared role/surface identities and factors for all four roles.
 glass=B.M['glass'];glass.surface_render_method='BLENDED'
 color=B.BINDINGS['glass'][2];bs=glass.node_tree.nodes.get('Principled BSDF')
 bs.inputs['Alpha'].default_value=.19;bs.inputs['Base Color'].default_value=color;glass.diffuse_color=color
 for o in list(bpy.context.scene.objects):
  if o.name.startswith('destination-pixel'):bpy.data.objects.remove(o,do_unlink=True)


def apply_and_batch():
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o.modifiers:
   bpy.context.view_layer.objects.active=o
   for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
  if o.type=='MESH' and o.data.color_attributes.get('Color') is None:color_mesh(o)
  if o.type=='MESH':
   bm=bmesh.new();bm.from_mesh(o.data)
   bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000001)
   bmesh.ops.triangulate(bm,faces=list(bm.faces))
   tiny=[f for f in bm.faces if f.calc_area()<.00000000001]
   if tiny:bmesh.ops.delete(bm,geom=tiny,context='FACES')
   bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
 for name in WHEEL_IDS:
  node=bpy.data.objects[name]
  for role in ['paint','rubber']:
   B.join_role([o for o in node.children if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0].get('semantic_role')==role],name+('-hub' if role=='paint' else '-tyre'))
 B.merge_static(set(DOOR_IDS+WHEEL_IDS+['boarding-ramp']))
 # All editable detail remains in original .blend mesh vertices and colors; four root static batches.
 for mat in list(bpy.data.materials):
  if mat.users==0:bpy.data.materials.remove(mat)
 clean_export_precision()
 bpy.context.scene.frame_set(1)


def clean_export_precision():
 # Evaluate face area at the same FLOAT32 precision used in glTF POSITION.
 # Text tessellation may leave collinear triangles after object joining.
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  bm=bmesh.new();bm.from_mesh(o.data);bad=[]
  for f in bm.faces:
   if len(f.verts)!=3:continue
   pp=[Vector(tuple(struct.unpack('<f',struct.pack('<f',float(v.co[k])))[0] for k in range(3))) for v in f.verts]
   if (pp[1]-pp[0]).cross(pp[2]-pp[0]).length_squared<=1e-18:bad.append(f)
  if bad:bmesh.ops.delete(bm,geom=bad,context='FACES')
  bm.to_mesh(o.data);bm.free();o.data.update()


def export_loaded(path):
 opts=dict(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,
           export_texcoords=False,export_normals=True,export_materials='EXPORT',export_extras=True,
           export_animations=True,export_animation_mode='ACTIONS',export_current_frame=False,
           export_lights=False,export_cameras=False,export_keep_originals=False)
 props=bpy.ops.export_scene.gltf.get_rna_type().properties
 if 'export_vertex_color'in props:opts['export_vertex_color']='ACTIVE'
 bpy.ops.export_scene.gltf(**opts)


def setup_preview():
 s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.eevee.taa_render_samples=32
 s.render.resolution_x=960;s.render.resolution_y=640;s.render.resolution_percentage=100
 s.render.image_settings.file_format='PNG';s.render.film_transparent=False
 s.world=bpy.data.worlds.new('QA daylight');s.world.use_nodes=True
 s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.72,.82,1)
 s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
 s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=.2
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002));g=bpy.context.object;g.name='QA-ground'
 m=bpy.data.materials.new('QA matte ground');m.diffuse_color=(.28,.31,.33,1);g.data.materials.append(m)
 d=bpy.data.lights.new('QA sun','SUN');d.energy=3;d.angle=.12;o=bpy.data.objects.new('QA sun',d);s.collection.objects.link(o);o.rotation_euler=(.45,-.6,-.4)
 d=bpy.data.lights.new('QA fill','AREA');d.energy=1800;d.shape='DISK';d.size=10;o=bpy.data.objects.new('QA fill',d);s.collection.objects.link(o);o.location=(-7,2,10)
 bpy.ops.object.camera_add();s.camera=bpy.context.object;s.camera.data.lens=44;s.camera.data.clip_end=300
 return s


def preview(name,cp,target):
 s=bpy.context.scene;cam=s.camera;cam.location=cv(cp);cam.rotation_euler=(Vector(cv(target))-cam.location).to_track_quat('-Z','Y').to_euler()
 s.render.filepath=str(HERE/'qa/previews'/name);bpy.ops.render.render(write_still=True)


def run():
 for lod in range(3):
  B.exterior(lod);prepare_materials();split_paint_bands()
  if lod<2:round_tires(lod)
  livery(lod);details(lod);ramp(lod);apply_and_batch()
  scene=bpy.context.scene;scene['package']='boardable-bus-hybrid';scene['asset']='city-bus-12m-exterior';scene['lod']=lod
  source=HERE/'source'/f'city-bus-12m-exterior.lod{lod}.blend'
  bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
  path=HERE/'exports'/f'city-bus-12m-exterior.lod{lod}.glb';export_loaded(path)
  shutil.copy2(path,PUBLIC/path.name)
  REPORT['levels'].append({'level':lod,'source':str(source.relative_to(HERE)),'export':str(path.relative_to(HERE))})
  print('HYBRID_LOD_READY',lod,flush=True)
 # Preview only after immutable sources/exports have been saved.
 bpy.ops.wm.open_mainfile(filepath=str(HERE/'source/city-bus-12m-exterior.lod0.blend'))
 setup_preview();preview('hybrid-daylight-front.png',(-10,5.5,13),(0,1.35,.2))
 preview('hybrid-daylight-rear.png',(-11,5,-12),(0,1.3,-.3))
 preview('hybrid-daylight-right.png',(-19,3.5,.2),(0,1.35,-.1))
 # Load accepted Atlas closeup interior without changing any original source.
 old=set(bpy.context.scene.objects)
 bpy.ops.import_scene.gltf(filepath=str(REPO/'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod0.glb'))
 for o in set(bpy.context.scene.objects)-old:
  if o.type=='LIGHT':o.hide_render=True
 for name in DOOR_IDS:
  o=bpy.data.objects.get(name)
  if o:
   o.animation_data_clear();g,a,b=next(d for d in DOORS if d[0] in name)
   sign=-1 if name.endswith('-a') else 1
   z=(a+(b-a)/4) if sign<0 else (b-(b-a)/4)
   o.location=cv((-1.39,.36,z+sign*((b-a)/2+.045)))
 bpy.context.view_layer.update()
 preview('hybrid-doors-open-with-retained-interior.png',(-8,2.7,9),(-.4,1.1,3.6))
 # A matched eye height 1.60m above the actual floor, with the unchanged Atlas cabin.
 s=bpy.context.scene;s.camera.data.lens=24
 d=bpy.data.lights.new('QA cabin fill','AREA');d.energy=60;d.shape='DISK';d.size=2
 o=bpy.data.objects.new('QA cabin fill',d);s.collection.objects.link(o);o.location=cv((0,2.45,0))
 preview('hybrid-retained-Atlas-interior-aisle.png',(0,1.96,-2.1),(0,1.71,5.2))
 s.camera.data.lens=44
 # Representative kneeling preview: body lowers, four independent wheel roots stay at road datum.
 vehicle=bpy.data.objects['vehicle'];vehicle.location.z=-.0762
 for name in WHEEL_IDS:bpy.data.objects[name].location.z+=.0762
 # Imported interior has an independent root; lower it by the same body offset.
 for o in list(bpy.context.scene.objects):
  if o.parent is None and o.name.startswith('vehicle') and o!=vehicle:o.location.z-=.0762
 pivot=bpy.data.objects['boarding-ramp'];pivot.rotation_mode='XYZ';pivot.rotation_euler[1]=-(math.pi+math.asin((.36-.0762)/1.12))
 # Runtime +Z maps to Blender -Y, so the negative Blender-Y angle is intentional.
 bpy.context.view_layer.update()
 preview('hybrid-kneel-ramp-deployed.png',(-6,2.0,7.8),(-1.4,.65,4.45))
 # Same lighting/camera on the unmodified canonical Atlas exterior for comparison.
 B.exterior(0);setup_preview()
 preview('atlas-baseline-daylight-front.png',(-10,5.5,13),(0,1.35,.2))
 preview('atlas-baseline-daylight-right.png',(-19,3.5,.2),(0,1.35,-.1))
 # Isolated, upright original film reference: no arena, gases, thrusters or packed fonts.
 bpy.ops.wm.read_factory_settings(use_empty=True)
 sp=importlib.util.spec_from_file_location('hybrid_film_reference',HERE/'reference/film_bus_reference.py')
 film=importlib.util.module_from_spec(sp);sp.loader.exec_module(film)
 bus,wheels=film.build_bus();bus.location=(0,0,0);bus.rotation_euler=(0,0,0)
 ref=HERE/'reference/film-bus-upright-reference.blend'
 bpy.ops.wm.save_as_mainfile(filepath=str(ref),compress=True)
 deps=bpy.context.evaluated_depsgraph_get();triangles=vertices=meshes=0
 for obj in bus.children_recursive:
  if obj.type not in ['MESH','CURVE','FONT']:continue
  evaluated=obj.evaluated_get(deps);data=evaluated.to_mesh()
  if data:
   data.calc_loop_triangles();triangles+=len(data.loop_triangles);vertices+=len(data.vertices);meshes+=1
  evaluated.to_mesh_clear()
 REPORT['filmReference']={'source':str(ref.relative_to(HERE)),'sourceBytes':ref.stat().st_size,
   'sourceSha256':hashlib.sha256(ref.read_bytes()).hexdigest(),'evaluatedTriangles':triangles,
   'evaluatedVertices':vertices,'evaluatedMeshObjects':meshes,'descendants':len(bus.children_recursive),
   'passengerSeats':34,'stuntThrusters':0,'externalFontsPacked':False,
   'referenceOnly':True,'note':'Isolated neutral film geometry; not part of the runtime hybrid payload.'}
 for obj in bus.children_recursive:
  if obj.type=='LIGHT':obj.hide_render=True
 setup_preview();s=bpy.context.scene;s.camera.data.lens=24
 # Reference is +X forward/Z up; use raw Blender coordinates for this matched view.
 d=bpy.data.lights.new('QA film cabin fill','AREA');d.energy=60;d.shape='DISK';d.size=2
 o=bpy.data.objects.new('QA film cabin fill',d);s.collection.objects.link(o);o.location=(0,0,2.84)
 cam=s.camera;cam.location=(-2.1,0,2.35);target=Vector((5.2,0,2.10));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
 s.render.filepath=str(HERE/'qa/previews/film-reference-interior-aisle.png');bpy.ops.render.render(write_still=True)
 # An exterior comparison uses the same neutral daylight setup without changing source data.
 s.camera.data.lens=44;cam.location=(13,-10,5.5);target=Vector((.2,0,1.35));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
 s.render.filepath=str(HERE/'qa/previews/film-reference-daylight-front.png');bpy.ops.render.render(write_still=True)
 (HERE/'qa/build.json').write_text(json.dumps(REPORT,indent=2)+'\n')
 print('HYBRID_BUILD_COMPLETE',flush=True)

if __name__=='__main__':run()
