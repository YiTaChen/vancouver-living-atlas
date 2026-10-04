"""Original editable D02/D03 representative bus. Never regenerate artist sources.
All construction coordinates below are glTF metres (X right-to-left,Y up,Z front).
Blender authoring maps these once to (x,-z,y); export maps back to standard glTF.
"""
import argparse,json,math,sys
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
BODY=(-5.8,6.2); AXLES=(-3.1,3.1); FLOOR=.36
DOORS=[('front',3.7,4.85),('rear',-1.2,-.05)]
SEATS=[(x,z) for z in [-4.85,-4.05,-1.85,.50,1.30,2.10] for x in [-.83,.83] if not (x<0 and z in [.50,1.30])]
BINDINGS={
 'paint':('paint','automotive-paint',(.055,.21,.37,1),.32,.18),
 'rubber':('rubber','rubber',(.025,.035,.045,1),.83,0),
 'glass':('glass','transit-glass',(.20,.38,.46,.19),.16,0),
 'lights':('lights','transit-lights',(1,.65,.18,1),.35,0),
 'floor':('floor','transit-floor',(.19,.24,.26,1),.82,0),
 'panel':('panel','pale-panel',(.67,.72,.68,1),.65,.02),
 'seat':('seat','transit-seat',(.06,.26,.37,1),.83,0),
 'rail':('rail','brushed-aluminum',(.90,.60,.12,1),.32,.65)}
def cv(p):return (p[0],-p[2],p[1])
def clean():
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1;s.render.fps=24;s.frame_start=1;s.frame_end=25
 root=bpy.data.objects.new('vehicle',None);bpy.context.collection.objects.link(root);root['frameId']='vehicle';root['frontAxis']='+Z glTF';return root
M={};ROOT=None

def mats():
 for name,(role,surface,color,rough,metal) in BINDINGS.items():
  m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=color;m.use_backface_culling=True
  p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
  if name=='glass': p.inputs['Alpha'].default_value=.19;m.surface_render_method='DITHERED';m.use_backface_culling=False
  if name=='lights':p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=1.2
  m['semantic_role']=role;m['shared_surface_id']=surface;M[name]=m

def mesh(name,vs,fs,role,parent=None,loc=(0,0,0),bevel=0):
 d=bpy.data.meshes.new(name);d.from_pydata([cv(v) for v in vs],[],fs);d.update();bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(d);bm.free()
 ob=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(ob);ob.parent=parent or ROOT;ob.location=cv(loc);d.materials.append(M[role]);ob['semantic_role']=role
 uv=d.uv_layers.new(name='UVMap')
 for f in d.polygons:
  axis=max(range(3),key=lambda i:abs(f.normal[i]));ij=[i for i in range(3) if i!=axis]
  for k in f.loop_indices:
   v=d.vertices[d.loops[k].vertex_index].co;uv.data[k].uv=(v[ij[0]],v[ij[1]])
 if bevel:
  mod=ob.modifiers.new('Editable rounded edge','BEVEL');mod.width=bevel;mod.segments=2
 ob['uv_units']='1 metre';return ob

def box(name,c,size,role,parent=None,bevel=0):
 vs=[(c[0]+a*size[0]/2,c[1]+b*size[1]/2,c[2]+d*size[2]/2) for a,b,d in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 return mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role,parent,bevel=bevel)

def slab(name,poly,axis,lo,hi,role):
 # Polygon is in the other two glTF axes; closed extruded polygon, including concave wheel arch sections.
 others=[i for i in range(3) if i!=axis];vs=[]
 for a in [lo,hi]:
  for p in poly:
   v=[0,0,0];v[axis]=a;v[others[0]]=p[0];v[others[1]]=p[1];vs.append(v)
 n=len(poly);return mesh(name,vs,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],role)

def cylinder(name,a,b,r,role,n=12,parent=None):
 a,b=Vector(a),Vector(b);v=(b-a).normalized();u=v.cross(Vector((0,1,0)))
 if u.length<.001:u=v.cross(Vector((1,0,0)))
 u.normalize();w=v.cross(u);vs=[tuple(p+r*(u*math.cos(i*math.tau/n)+w*math.sin(i*math.tau/n))) for p in [a,b] for i in range(n)]
 return mesh(name,vs,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],role,parent)

def empty(name,point,parent=None):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent or ROOT;o.location=cv(point);o['anchor_id']=name;return o

def join_role(objects,name):
 if not objects:return
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=name

def merge_static(exclude):
 for role in ['paint','rubber','glass','lights']:
  obs=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name not in exclude and o.parent==ROOT and o.get('semantic_role')==role]
  join_role(obs,{'paint':'body-shell','rubber':'body-trim','glass':'glass','lights':'lights'}[role])

def door_leaf(group,z,sign,lod):
 name=f'door-right-{group}-{("a" if sign<0 else "b")}'
 node=empty(name,(-1.25,FLOOR,z));node['dynamic']='independent plug-slide door leaf'
 box(name+'-frame',(0,1.04,0),(.054,2.08,.56),'paint',node)
 # Explicit glass window is inset but leaf panel is not behind it: replace broad frame by border strips.
 ob=bpy.data.objects.get(name+'-frame');bpy.data.objects.remove(ob,do_unlink=True)
 for zz in [-.255,.255]:box(name+'-stile',(0,1.04,zz),(.054,2.08,.05),'paint',node)
 for yy in [.025,1.02,2.055]:box(name+'-crossbar',(0,yy,0),(.054,.05,.46),'paint',node)
 for yy,h in [(.515,.93),(1.54,.96)]:box(name+'-glass',(0,yy,0),(.014,h,.46),'glass',node)
 # 0 -> outward plug -> longitudinal slide. Linear keys prevent hidden overshoot.
 for frame,x,zz in [(1,-1.25,z),(7,-1.39,z),(25,-1.39,z+sign*.62)]:
  node.location=cv((x,FLOOR,zz));node.keyframe_insert(data_path='location',frame=frame)
 action=node.animation_data.action;action.name=name+'-open'
 for fc in action.fcurves:
  for kp in fc.keyframe_points:kp.interpolation='LINEAR'
 bpy.context.scene.frame_set(1)
 # Combine leaf child parts into a single multi-material node mesh under animated empty.
 obs=list(node.children);bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();obs[0].name=name+'-panel'
 return name

def exterior(lod):
 global ROOT;ROOT=clean();mats();exclude=[]
 if lod==2:
  # Deliberately closed nonboarding fallback. Animated node IDs remain as anchors only.
  box('fallback-body',(0,1.54,.2015),(2.50,2.56,11.997),'paint')
  # Closed opaque far-view glazing cue; no opening or passenger capability.
  glass=M['glass'];bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Alpha'].default_value=1;bs.inputs['Base Color'].default_value=(.025,.05,.065,1);glass.diffuse_color=(.025,.05,.065,1)
  box('roof-equipment',(0,2.945,-1.45),(1.70,.25,4.5),'paint');exclude.append('roof-equipment')
  for side in [-1,1]:box('mirror-'+str(side),(side*1.43,2.26,5.70),(.18,.28,.16),'rubber')
  box('fallback-window-right',(-1.254,1.92,.2),(.01,.94,10.8),'glass')
  box('fallback-window-left',(1.254,1.92,.2),(.01,.94,10.8),'glass')
  box('fallback-windscreen',(0,1.90,6.205),(2.12,1.1,.01),'glass')
  box('fallback-rear-window',(0,1.92,-5.799),(2.12,.94,.002),'glass')
 else:
  # Side lower panels are real extruded cutout polygons. Wheels do not cover a solid wall.
  breaks=sorted(set([-5.8,5.9]+[v for z in AXLES for v in [z-.64,z+.64]]+[v for _,a,b in DOORS for v in [a,b]]))
  for side in [-1,1]:
   for i,(a,b) in enumerate(zip(breaks,breaks[1:])):
    if side<0 and any(a>=d0-1e-6 and b<=d1+1e-6 for _,d0,d1 in DOORS):continue
    wheel=next((z for z in AXLES if a>=z-.64-1e-6 and b<=z+.64+1e-6),None)
    if wheel is None:poly=[(.26,a),(.26,b),(1.16,b),(1.16,a)]
    else:
     zs=[a+(b-a)*j/(10 if lod==0 else 5) for j in range((10 if lod==0 else 5)+1)]
     lower=[(.49+math.sqrt(max(0,.64**2-(z-wheel)**2)),z) for z in zs]
     poly=lower+[(1.16,b),(1.16,a)]
    slab(f'lower-{side}-{i}',poly,0,side*1.215-.035,side*1.215+.035,'paint')
   # Upper rim / separate window mullions stop at door openings, leaving actual clear portals.
   box(f'cantrail-{side}',(side*1.22,2.63,.05),(.06,.18,11.70),'paint')
   stations=[-5.68,-4.45,-3.25,-2.05,-1.25,.0,1.25,2.5,3.65,4.90,5.70]
   if side<0:stations=[v for v in stations if not any(a<v<b for _,a,b in DOORS)]
   for i,z in enumerate(stations):box(f'pillar-{side}-{i}',(side*1.22,1.82,z),(.06,1.32,.07),'paint')
   windows=[]
   for a,b in zip(stations,stations[1:]):
    if side<0 and any(a<d1 and b>d0 for _,d0,d1 in DOORS):
     # clipped ordinary window bands on each side of each door, no glass across portal
     intervals=[(a,b)]
     for _,d0,d1 in DOORS:
      intervals=[x for aa,bb in intervals for x in ([(aa,min(bb,d0))] if aa<d0 else [])+([(max(aa,d1),bb)] if bb>d1 else []) if x[1]-x[0]>.10]
    else:intervals=[(a,b)]
    windows.extend(intervals)
   for i,(a,b) in enumerate(windows):box(f'window-{side}-{i}',(side*1.226,1.85,(a+b)/2),(.018,1.27,b-a-.08),'glass')
   for _,a,b in DOORS if side<0 else []:
    for z in [a-.025,b+.025]:box('door-jamb',(side*1.22,1.41,z),(.06,2.10,.05),'paint')
    box('door-header',(side*1.22,2.50,(a+b)/2),(.06,.08,b-a+.10),'paint')
  # Rounded/chamfered front wraps around an angled front windshield; no enclosed solid cabin box.
  frontpoly=[(-1.25,5.88),(-1.10,6.12),(-.95,6.20),(.95,6.20),(1.10,6.12),(1.25,5.88)]
  for i in range(len(frontpoly)-1):
   (x0,z0),(x1,z1)=frontpoly[i:i+2]
   # panel thickness is within front skin, not a solid hull
   mesh('curved-front-'+str(i),[(x0,.30,z0),(x1,.30,z1),(x1,1.12,z1),(x0,1.12,z0),(x0,.30,z0-.055),(x1,.30,z1-.055),(x1,1.12,z1-.055),(x0,1.12,z0-.055)],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'paint')
  mesh('front-glass',[(-1.10,1.14,6.10),(1.10,1.14,6.10),(1.10,2.47,5.91),(-1.10,2.47,5.91)],[(0,1,2,3)],'glass')
  for x in [-1.13,1.13]:cylinder('front-post',(x,1.1,6.1),(x,2.55,5.90),.045,'paint',8)
  box('front-destination',(0,2.58,5.92),(2.30,.21,.09),'rubber')
  if lod==0:
   for i in range(11):box('destination-pixel',(i*.12-.6,2.59,5.974),(.065,.065,.012),'lights')
  box('rear-lower',(0,.72,-5.765),(2.50,.90,.07),'paint')
  box('rear-header',(0,2.61,-5.765),(2.50,.22,.07),'paint')
  box('rear-glass',(0,1.86,-5.773),(2.22,1.25,.018),'glass')
  for x in [-1.2,1.2]:box('rear-post',(x,1.84,-5.765),(.10,1.36,.07),'paint')
  for group,a,b in DOORS:
   for sign,z in [(-1,a+(b-a)/4),(1,b-(b-a)/4)]:exclude.append(door_leaf(group,z,sign,lod))
  box('chassis-left',(.64,.215,.15),(.10,.09,10.8),'rubber');box('chassis-right',(-.64,.215,.15),(.10,.09,10.8),'rubber')
  box('roof',(0,2.76,.10),(2.50,.12,11.8),'paint')
  box('roof-equipment',(0,2.945,-1.45),(1.70,.25,4.5),'paint',bevel=.035 if lod==0 else 0);exclude.append('roof-equipment')
  for side in [-1,1]:
   box('mirror-'+str(side),(side*1.43,2.26,5.70),(.18,.28,.16),'rubber')
   box('mirror-arm-'+str(side),(side*1.31,2.41,5.7),(.28,.04,.04),'paint')
   box('front-light-'+str(side),(side*.82,.77,6.207),(.23,.14,.016),'lights')
   box('rear-light-'+str(side),(side*1.02,.77,-5.806),(.14,.26,.012),'lights')
  if lod==0:
   for j in range(5):box('rear-vent',(0,.53+j*.11,-5.809),(1.4,.023,.02),'rubber')
 for z,axle in [(-3.1,'rear'),(3.1,'front')]:
  for side,label in [(-1,'right'),(1,'left')]:
   name=f'wheel-{axle}-{label}';node=empty(name,(side*1.13,.49,z));node['spinAxis']='+X glTF';exclude.append(name)
   cylinder(name+'-tyre',(-.115,0,0),(.115,0,0),.49,'rubber',16 if lod==0 else 8,node)
   if lod<2:cylinder(name+'-hub',(side*.117,0,0),(side*.127,0,0),.26,'paint',12 if lod==0 else 8,node)
 for group,a,b in DOORS:
  empty('boarding-'+group,(-1.70,FLOOR,(a+b)/2));empty('doorway-'+group,(-1.25,FLOOR,(a+b)/2))
  if lod==2:
   for sign,z in [(-1,a+(b-a)/4),(1,b-(b-a)/4)]:empty(f'door-right-{group}-'+('a' if sign<0 else 'b'),(-1.25,FLOOR,z))
 empty('axle-front',(0,.49,3.1));empty('axle-rear',(0,.49,-3.1));merge_static(exclude)
 bpy.context.scene['package']='boardable-bus';bpy.context.scene['asset']='city-bus-12m-exterior';bpy.context.scene['lod']=lod

def interior(lod):
 global ROOT;ROOT=clean();mats();fine=lod==0
 box('floor',(0,.31,.035),(2.30,.10,11.43),'floor')
 box('ceiling',(0,2.65,.05),(2.27,.10,11.38),'panel')
 # Side liners occupy opaque sill bands only; they never close exterior windows or portals.
 for side in [-1,1]:
  intervals=[(-5.65,5.72)]
  if side<0:
   for _,a,b in DOORS:intervals=[x for aa,bb in intervals for x in [(aa,min(bb,a)),(max(aa,b),bb)] if x[1]>x[0]]
  for i,(a,b) in enumerate(intervals):box(f'liner-{side}-{i}',(side*1.165,.985,(a+b)/2),(.025,.30,b-a),'panel')
 for z in AXLES:
  for side in [-1,1]:
   box('wheel-well-'+str(side)+'-'+str(z),(side*.965,.685,z),(.35,.65,1.18),'panel',bevel=.025 if fine else 0)
 for i,(x,z) in enumerate(SEATS,1):
  name=f'seat-{i:02d}';node=empty(name,(x,FLOOR,z));node['passenger_reference']='pelvis, not character feet root'
  box(name+'-cushion',(0,.415,0),(.46,.07,.44),'seat',node,.018 if fine else 0)
  box(name+'-back',(0,.70,-.205),(.46,.57,.065),'seat',node,.018 if fine else 0)
  box(name+'-pedestal',(0,.20,0),(.10,.37,.12),'panel',node)
  if fine:
   cylinder(name+'-handle',(-.19,.97,-.22),(.19,.97,-.22),.017,'rail',8,node)
  empty(name+'-pelvis',(x,.88,z));empty(name+'-camera',(x,1.47,z+.025))
 box('driver-partition',(.77,1.00,4.17),(.80,1.28,.055),'panel')
 box('driver-partition-glass',(.77,1.93,4.17),(.80,.57,.025),'glass')
 box('driver-seat',(.77,.81,4.85),(.48,.13,.46),'seat',bevel=.025 if fine else 0)
 box('driver-seat-back',(.77,1.15,4.64),(.48,.62,.09),'seat')
 box('driver-console',(.65,1.07,5.43),(1.04,.24,.46),'panel')
 cylinder('steering-column',(.70,.90,5.10),(.70,1.17,5.25),.035,'rubber',8)
 cylinder('steering-wheel',(.70,1.17,5.25),(.70,1.20,5.25),.18,'rubber',12)
 for side in [-1,1]:
  cylinder('longitudinal-rail-'+str(side),(side*.49,2.30,-5.0),(side*.49,2.30,3.5),.023,'rail',10 if fine else 6)
 for z in [-4.50,-2.15,1.95,3.50]:
  for side in [-1,1]:cylinder('upright-rail',(side*.52,.36,z),(side*.52,2.30,z),.024,'rail',10 if fine else 6)
 for group,a,b in DOORS:
  cylinder('entry-rail-'+group,(-.96,.80,b+.10),(-.96,2.31,b+.10),.027,'rail',10 if fine else 6)
 box('stop-bell',(-.515,1.30,1.95),(.046,.10,.10),'lights')
 box('passenger-display',(0,2.36,3.90),(.66,.23,.045),'rubber')
 box('display-screen',(0,2.36,3.872),(.59,.16,.01),'lights')
 empty('driver-pelvis',(.77,.91,4.85));empty('driver-camera',(.77,1.51,4.9))
 empty('camera-aisle',(0,1.99,-4.8));empty('standing-center',(0,FLOOR,0));empty('wheelchair-reference',(-.79,FLOOR,.90))
 bpy.context.scene['package']='boardable-bus';bpy.context.scene['asset']='city-bus-12m-interior';bpy.context.scene['lod']=lod

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);args=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);out=args.output.resolve();(out/'source').mkdir(parents=True,exist_ok=True)
 for kind,levels in [('exterior',range(3)),('interior',range(2))]:
  for lod in levels:
   path=out/'source'/f'city-bus-12m-{kind}.lod{lod}.blend'
   if path.exists():raise RuntimeError('Refusing to overwrite editable source: '+str(path))
   globals()[kind](lod);bpy.context.scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
if __name__=='__main__':main()
