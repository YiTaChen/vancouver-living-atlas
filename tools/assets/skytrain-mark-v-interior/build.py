"""Original photo-informed Mark V A-car study. Never run to re-export artist edits.
All explicit dimensions are representative, not measured from the photos.
Coordinates: glTF metres, +Y up, +Z toward the observation end; floor datum Y=0.
"""
import argparse,importlib.util,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('geom',HERE.parent/'boardable-bus/build.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
FINE=True
L=15.6; HALF=1.245; DOORS=[-4.9,0,4.9]; SEATS=[]
def mat(name,col,rough,metal=0,tex=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=col
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=col;bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 if tex:
  im=bpy.data.images.load(str(HERE/'textures'/tex));im.pack();t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=im;m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color'])
 if name=='glass':bs.inputs['Alpha'].default_value=col[3];m.surface_render_method='DITHERED';bs.inputs['Roughness'].default_value=.16
 m['semantic_role']=name;m['shared_surface_id']='mark-v-'+name;B.M[name]=m
 return m

def materials():
 for args in [('panel',(.79,.79,.755,1),.43),('shell',(.37,.40,.395,1),.36),('rubber',(.022,.027,.03,1),.67),('metal',(.48,.53,.56,1),.29,.75),('rail',(.98,.69,.013,1),.24,.12),('seat',(1,1,1,1),.52,0,'original-blue-fabric.png'),('floor',(1,1,1,1),.56,0,'original-rubber-floor.png'),('glass',(.32,.50,.56,.15),.17),('diffuser',(.96,.97,.94,1),.32),('information',(1,1,1,1),.48,0,'original-information-atlas.png')]:mat(*args)
def mesh(n,vs,fs,role,smooth=False,bevel=0):
 o=B.mesh(n,vs,fs,role,bevel=bevel)
 if smooth:
  for p in o.data.polygons:p.use_smooth=True
 if bevel:o.modifiers[0].segments=3 if FINE else 1
 return o

def box(n,c,s,role='panel',bevel=0):
 o=B.box(n,c,s,role,bevel=bevel)
 if bevel:o.modifiers[0].segments=3 if FINE else 1
 return o

def sweep(n,points,r=.020,role='rail',segments=None):
 """Continuous tube along a smoothed Catmull-Rom path; true curved elbows."""
 raw=[Vector(p) for p in points];pts=[]
 steps=5 if FINE else 2
 for i in range(len(raw)-1):
  p0=raw[max(0,i-1)];p1=raw[i];p2=raw[i+1];p3=raw[min(len(raw)-1,i+2)]
  for j in range(steps):
   t=j/steps;pts.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
 pts.append(raw[-1]);N=segments or (12 if FINE else 7);vs=[]
 for i,p in enumerate(pts):
  tangent=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized();u=tangent.cross(Vector((0,0,1)))
  if u.length<.02:u=tangent.cross(Vector((1,0,0)))
  u.normalize();v=tangent.cross(u)
  for j in range(N):vs.append(tuple(p+r*(math.cos(j*math.tau/N)*u+math.sin(j*math.tau/N)*v)))
 fs=[]
 for i in range(len(pts)-1):
  for j in range(N):fs.append((i*N+j,i*N+(j+1)%N,(i+1)*N+(j+1)%N,(i+1)*N+j))
 fs.extend([tuple(reversed(range(N))),tuple((len(pts)-1)*N+j for j in range(N))]);return mesh(n,vs,fs,role,True)
def tube(n,a,b,r=.02,role='rail'):
 o=B.cylinder(n,a,b,r,role,12 if FINE else 7)
 for p in o.data.polygons:
  if len(p.vertices)==4:p.use_smooth=True
 return o

def rounded(w,h,r,n=None):
 n=n or (8 if FINE else 4);p=[]
 for cx,cy,st in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
  for i in range(n):
   t=math.radians(st+i*90/(n-1));p.append((cx+r*math.cos(t),cy+r*math.sin(t)))
 return p

def side_ring(n,s,z,y,w,h,r,band,depth,role='panel',x=None):
 """Rounded rectangle with thick profiled opening; no panel behind the hole."""
 x=x if x is not None else s*1.225
 outer=rounded(w,h,r);inner=rounded(w-2*band,h-2*band,max(.025,r-band));N=len(outer);vs=[]
 for xx,pts in [(x+s*depth/2,outer),(x-s*depth/2,outer),(x-s*depth/2,inner),(x+s*depth/2,inner)]:
  vs.extend((xx,y+b,z+a) for a,b in pts)
 fs=[]
 for k in range(4):
  for j in range(N):fs.append((k*N+j,k*N+(j+1)%N,((k+1)%4)*N+(j+1)%N,((k+1)%4)*N+j))
 return mesh(n,vs,fs,role,False)
def side_glass(n,s,z,y,w,h,r):
 pts=rounded(w,h,r);o=mesh(n,[(s*1.25,y+b,z+a) for a,b in pts],[tuple(range(len(pts)))],'glass');return o

def sign(n,c,u,v,w,h,row):
 c=Vector(c);u=Vector(u);v=Vector(v);vs=[tuple(c+u*a*w/2+v*b*h/2) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 o=mesh(n,vs,[(0,1,2,3)],'information');uv=o.data.uv_layers.active
 y0,y1=(0,256) if row==0 else (256+(row-1)*128,384+(row-1)*128)
 coords=[(0,1-y1/1024),(1,1-y1/1024),(1,1-y0/1024),(0,1-y0/1024)]
 for i,loop in enumerate(o.data.loops):uv.data[i].uv=coords[loop.vertex_index]
 o['passenger_uv_fixed']=True
 return o

def orient_seat(p,c,forward):
 u,y,v=p;fx,fz=forward;return (c[0]+fz*u+fx*v,y,c[1]-fx*u+fz*v)

def seat(n,c,forward=(0,1)):
 """Continuous shaped upholstery with waterfall front, lumbar curve and wrapped shell."""
 fx,fz=forward
 profile=[(.485,.445),(.478,.477),(.445,.500),(.350,.505),(.220,.490),(.105,.495),(.040,.530),(.005,.600),(-.010,.720),(-.030,.905),(-.055,1.065),(-.044,1.110)]
 nx=12 if FINE else 6
 def skin(name,role,shift,width,thickness):
  vs=[]
  for back in [False,True]:
   for j,(v,y) in enumerate(profile):
    taper=1-.055*max(0,(y-.85)/.26)
    for i in range(nx+1):
     q=-1+2*i/nx;uu=q*width/2*taper
     # depressed central seat and rounded bolsters, wrapping around both vertical edges
     edge=abs(q)**4; yy=y+.014*edge if j<7 else y;vv=v+(.021*(1-q*q) if j>=7 else 0)
     yy+=shift;vv-=.027 if shift<0 else 0
     if back:yy-=thickness if j<7 else .007;vv-=thickness if j>=6 else 0
     vs.append(orient_seat((uu,yy,vv),c,forward))
  rows=len(profile);K=rows*(nx+1);fs=[]
  for layer in [0,1]:
   for j in range(rows-1):
    for i in range(nx):
     a=layer*K+j*(nx+1)+i;f=(a,a+1,a+nx+2,a+nx+1);fs.append(f if layer==0 else tuple(reversed(f)))
  for j in range(rows-1):
   for i in [0,nx]:a=j*(nx+1)+i;fs.append((a,a+nx+1,a+nx+1+K,a+K))
  for j in [0,rows-1]:
   for i in range(nx):a=j*(nx+1)+i;fs.append((a,a+K,a+K+1,a+1))
  ob=mesh(name,vs,fs,role,True)
  # Material-scaled texcoords: fabric weave survives ordinary glTF export.
  if role=='seat':
   for loop in ob.data.loops:
    k=loop.vertex_index%K;j=k//(nx+1);i=k%(nx+1);ob.data.uv_layers.active.data[loop.index].uv=(i/nx*1.7,j/(rows-1)*4)
  return ob
 skin(n+'-molded-shell','shell',-.022,.454,.025);skin(n+'-sculpted-upholstery','seat',0,.425,.018)
 # Open integral handhold follows rounded top corners rather than solid block.
 pts=[(-.205,1.07,-.073),(-.210,1.22,-.073),(-.175,1.26,-.073),(.175,1.26,-.073),(.210,1.22,-.073),(.205,1.07,-.073)]
 sweep(n+'-integral-grip',[orient_seat(p,c,forward) for p in pts],.018,'shell')
 for u in [-.158,.158]:
  sweep(n+'-support-'+str(u),[orient_seat(p,c,forward) for p in [(u,.38,.32),(u,.36,.07),(u,.30,-.035)]],.019,'metal')
 # Underseat crossmember + pedestal, kept back from feet clear space.
 tube(n+'-crossmember',orient_seat((-.20,.345,.07),c,forward),orient_seat((.20,.345,.07),c,forward),.028,'metal')
 box(n+'-pedestal',orient_seat((0,.185,.00),c,forward),(.065,.30,.075),'metal',.007 if FINE else 0)
 box(n+'-base',orient_seat((0,.025,0),c,forward),(.18,.045,.15),'metal',.01 if FINE else 0)
 # Back insert gives layered molded structure rather than single slab.
 if FINE:
  for u in [-.175,.175]:tube(n+'-rear-seam',orient_seat((u,.61,-.085),c,forward),orient_seat((u,1.045,-.108),c,forward),.005,'metal')
 o=B.empty(n+'-pelvis',orient_seat((0,.55,.16),c,forward));o['anchor_type']='seat-pelvis';o['representative']=True
 B.empty(n+'-camera',orient_seat((0,1.14,.19),c,forward));SEATS.append({'id':n,'originXZ':list(c),'facingXZ':list(forward),'pelvisM':list(orient_seat((0,.55,.16),c,forward))})

def divider(s,z):
 box(f'divider-plinth-{s}-{z}',(s*.985,.30,z),(.48,.58,.045),'panel',.03 if FINE else .01)
 # Explicit glass top shape, corner chamfered; metal fixing brackets.
 vs=[(s*.735,.61,z),(s*1.20,.61,z),(s*1.20,1.79,z),(s*.79,1.79,z),(s*.735,1.73,z)]
 mesh(f'divider-glass-{s}-{z}',vs,[tuple(range(5))],'glass')
 for y in [.70,1.72]:box(f'divider-clamp-{s}-{z}-{y}',(s*.764,y,z),(.085,.07,.085),'metal',.008 if FINE else 0)
 sweep(f'divider-rail-{s}-{z}',[(s*.71,.07,z),(s*.71,.40,z),(s*.72,1.63,z),(s*.74,1.91,z),(s*.90,2.055,z),(s*1.03,2.12,z)],.022)
 tube('rail-base-collar',(s*.71,.02,z),(s*.71,.14,z),.028,'metal')
 if FINE:
  for y in [.70,1.72]:
   for dx in [-.021,.021]:tube('clamp-screw',(s*.764+dx,y,z-.045),(s*.764+dx,y,z-.051),.006,'metal')

def make(lod):
 global FINE,SEATS
 FINE=lod==0;SEATS=[];B.ROOT=B.clean();B.M.clear();materials()
 B.ROOT['modelIdentity']='Alstom Mark V, representative A end-car interior';B.ROOT['line']='Expo';B.ROOT['compatibility']='independent candidate; no CanadaLine3m or legacy Expo binding'
 box('floor-slab',(0,-.045,0),(2.52,.09,15.6),'floor')
 # Original floor texture is tiled at 0.65m; all textures are ordinary packed images.
 for o in bpy.context.scene.objects:
  if o.name=='floor-slab':
   for uv in o.data.uv_layers.active.data:uv.uv*=1.5
 # Flat center ceiling segmented with true curved coves at the shoulders.
 for j in range(10):
  zz=-7.02+j*1.56
  box('ceiling-center-panel-'+str(j),(0,2.30,zz),(1.43,.065,1.548),'panel',.009 if FINE else 0)
  if FINE:
   for x in [-.60,.60]:tube('ceiling-fastener',(x,2.264,zz+.62),(x,2.261,zz+.62),.006,'metal')
 for s in [-1,1]:
  vs=[];cross=[(.70,2.265),(.83,2.25),(.98,2.205),(1.11,2.13),(1.24,2.025)]
  for z in [-7.79,7.58]:vs.extend((s*x,y,z) for x,y in cross)
  mesh('curved-ceiling-cove-'+str(s),vs,[(i,i+1,i+1+len(cross),i+len(cross)) for i in range(len(cross)-1)],'panel',True)
  for x,y,w in [(.86,2.238,.104),(.985,2.18,.032)]:
   box('light-recess-channel',(s*x,y+.011,-.05),(w+.03,.045,15.35),'metal',.012 if FINE else 0)
   if w>.05:box('continuous-diffuser',(s*x,y-.017,-.05),(w,.013,15.3),'diffuser',.004 if FINE else 0)
   else:
    for xx in [-.012,.003,.018]:box('longitudinal-vent-slot',(s*x+xx,y-.014,-.05),(.009,.008,15.3),'rubber')
  # Wall sections avoid all three door portals. Window + lower plinth are separate.
  intervals=[(-7.8,-5.70),(-4.10,-.80),(.80,4.10),(5.70,7.62)]
  for k,(a,b) in enumerate(intervals):
   z=(a+b)/2;w=b-a
   box(f'lower-side-liner-{s}-{k}',(s*1.247,.305,z),(.064,.61,w),'panel',.014 if FINE else 0)
   box(f'steel-kickplate-{s}-{k}',(s*1.205,.12,z),(.024,.23,w-.025),'metal',.007 if FINE else 0)
   # Rounded reveals follow observed tall windows; wall pillars complete the solid shell.
   ww=w-.30
   side_ring(f'window-reveal-{s}-{k}',s,z,1.27,ww,1.35,.15,.07,.085)
   side_ring(f'window-rubber-seal-{s}-{k}',s,z,1.27,ww-.125,1.225,.10,.020,.025,'rubber',s*1.204)
   side_glass(f'window-glass-{s}-{k}',s,z,1.27,ww-.165,1.185,.083)
   for zz in [a+.06,b-.06]:box('wall-pillar',(s*1.247,1.32,zz),(.064,1.40,.14),'panel',.026 if FINE else 0)
   box('upper-wall-header',(s*1.247,2.017,z),(.064,.14,w),'panel',.02 if FINE else 0)
   tube('yellow-window-safety-line',(s*1.188,1.565,z-ww/2+.12),(s*1.188,1.565,z+ww/2-.12),.008)
   side_ring('top-opening-window-frame',s,z,1.715,ww-.21,.32,.055,.020,.026,'rubber',s*1.185)
   if ww>2:
    sign('window-hold-on-label',(s*1.18,1.49,z),(0,0,s),(0,1,0),.63,.079,2)
   if FINE:
    for zz in [z-.35,z+.35]:box('window-latch',(s*1.158,1.59,zz),(.035,.04,.09),'shell',.008)
    for j in range(int(w/.11)):
     box('underseat-vent-slit',(s*1.188,.225,a+.10+j*.11),(.009,.06,.043),'rubber')
  # Six static paired doors: true reveals, transparent windows, steel threshold and independent semantic leaves.
  for k,z in enumerate(DOORS):
   side_ring(f'door-outer-reveal-{s}-{k}',s,z,1.075,1.64,2.15,.075,.060,.10)
   for dz in [-.382,.382]:
    zz=z+dz;leaf=f'door-{s}-{k}-'+('a' if dz<0 else 'b')
    # opaque panel is a ring, leaving the tall narrow window physically open.
    side_ring(leaf+'-shell',s,zz,1.05,.755,2.075,.045,.135,.046,'panel',s*1.251)
    box(leaf+'-bottom',(s*1.249,.25,zz),(.046,.46,.74),'panel',.014 if FINE else 0)
    side_ring(leaf+'-window-seal',s,zz,1.24,.52,1.475,.055,.026,.022,'rubber',s*1.215)
    side_glass(leaf+'-window',s,zz,1.24,.478,1.425,.038)
    sign(leaf+'-clear-label',(s*1.20,1.53,zz),(0,0,s),(0,1,0),.44,.056,1)
   box('door-center-seam',(s*1.213,1.05,z),(.017,2.09,.014),'rubber')
   box('door-brushed-threshold',(s*1.13,.010,z),(.26,.020,1.52),'metal')
   for zz in [z-.78,z+.78]:tube('door-jamb-seal',(s*1.203,.02,zz),(s*1.203,2.10,zz),.012,'rubber')
   box('LCD-bezel',(s*1.076,2.135,z),(.082,.255,1.53),'rubber',.045 if FINE else .018)
   sign('LCD-original-route-screen',(s*1.028,2.13,z),(0,0,s),(0,1,0),1.30,.191,0)
   for zz in [z-.706,z+.706]:box('LCD-indicator',(s*1.026,2.137,zz),(.010,.16,.027),'diffuser',.008 if FINE else 0)
   B.empty(f'doorway-{s}-{k}',(s*1.25,0,z))['state']='static closed presentation; not animated/boardable'
   for edge in [-1,1]:divider(s,z+edge*.93)
 # Longitudinal seating and transverse seats reproduce Mark V's mixed visual vocabulary.
 for j in range(5):seat(f'seat-long-left-{j+1}',(1.105,-3.56+j*.48),(-1,0))
 for j in range(3):seat(f'seat-single-right-{j+1}',(-.91,1.31+j*.91),(0,1))
 for j in range(3):seat(f'seat-single-rear-left-{j+1}',(.91,-7.02+j*.73),(0,1))
 for j,z in enumerate([-6.95,-6.10]):
  for k,x in enumerate([-.96,-.49]):seat(f'seat-paired-rear-{j}-{k}',(x,z),(0,1))
 for j,z in enumerate([6.05,6.53]):seat(f'seat-front-left-{j}',(1.105,z),(-1,0))
 seat('seat-front-right',(-1.105,6.77),(1,0));seat('seat-front-transverse',(-.83,5.90),(0,1));seat('seat-observation',(0,6.37),(0,1))
 # Photo-specific two separate padded leaning rests in each end-car flex bay.
 for s,z in [(1,2.45),(-1,-2.45)]:
  tube('bicycle-leaning-rail',(s*1.08,.88,z-1.30),(s*1.08,.88,z+1.30),.027)
  for dz in [-.59,.59]:
   # Curved convex padded face, not a rectangular seat bench.
   vs=[];N=12 if FINE else 6
   for y in [.76,1.16]:
    for j in range(N+1):
     u=-.28+j*.56/N;xx=s*(1.042-.048*math.cos(u/.28*math.pi/2));vs.append((xx,y,z+dz+u))
   o=mesh('bicycle-sculpted-leaning-pad',vs,[(j,j+1,j+N+2,j+N+1) for j in range(N)],'seat',True)
   sol=o.modifiers.new('Padded rest thickness','SOLIDIFY');sol.thickness=.036
   be=o.modifiers.new('Soft padded rest perimeter','BEVEL');be.width=.024;be.segments=3 if FINE else 1
   tube('leaning-pad-support',(s*1.09,.59,z+dz),(s*1.09,.82,z+dz),.022)
   box('leaning-pad-wall-mount',(s*1.165,.58,z+dz),(.12,.075,.09),'metal',.009 if FINE else 0)
  sweep('bicycle-strap',[(s*1.05,.82,z-.48),(s*.995,.53,z-.47),(s*1.017,.43,z-.43)],.014,'rubber',6)
  sign('bicycle-area-sign',(s*1.18,1.14,z+1.31),(0,0,s),(0,1,0),.40,.10,3)
  B.empty('flex-bay-'+str(s),(s*.84,0,z))['use']='bicycle / accessibility reference; no certification'
 # Continuous rails, curved supports, collars and exposed mount hardware.
 for x in [0,-.80,.80]:
  tube('longitudinal-overhead-rail',(x,2.075,-7.22),(x,2.075,7.18),.022)
  for z in [-6.6,-3.1,1.8,5.8]:
   tube('roof-drop-mount',(x,2.08,z),(x,2.26,z),.030,'metal')
   box('roof-mount-foot',(x,2.255,z),(.09,.022,.09),'metal',.014 if FINE else 0)
 for z in [-4.90,0,4.90]:
  # Central poles observed in official aisle view; clear path passes either side.
  tube('center-stanchion',(0,.08,z),(0,2.075,z),.022)
  tube('center-stanchion-base',(0,.01,z),(0,.14,z),.028,'metal')
 # Only a few represented short loops. Mark V references principally show solid grab rails.
 if FINE:
  for s,z in [(-1,1.75),(-1,2.65),(1,-2.8),(1,-1.85)]:
   tube('strap-hanger',(s*.80,2.06,z),(s*.80,1.90,z),.012,'rubber')
   sweep('open-grab-loop',[(s*.80,1.92,z),(s*.80,1.80,z-.055),(s*.80,1.74,z),(s*.80,1.80,z+.055),(s*.80,1.92,z)],.011,'shell')
 # Wide rear gangway, short connector only, open at its distal end.
 for s in [-1,1]:
  box('rear-gangway-shoulder',(s*.99,1.04,-7.72),(.49,2.08,.13),'panel',.045 if FINE else .02)
  box('gangway-side-bellows',(s*.745,1.04,-8.12),(.085,2.08,.80),'rubber')
  for j in range(11 if FINE else 6):
   z=-7.78-j*(.071 if FINE else .14)
   box('gangway-pleat',(s*.712,1.035,z),(.09,2.07,.025),'shell',.010 if FINE else 0)
  tube('gangway-hand-rail',(s*.66,.97,-7.73),(s*.66,.97,-8.49),.022,'metal')
 box('gangway-header',(0,2.165,-7.73),(2.49,.18,.14),'panel',.035 if FINE else .01)
 box('gangway-ceiling',(0,2.15,-8.11),(1.48,.10,.8),'rubber')
 box('gangway-bridge',(0,-.015,-8.12),(1.49,.035,.83),'metal')
 for j in range(14 if FINE else 7):box('bridge-tread-strip',(0,.006,-7.76-j*(.058 if FINE else .116)),(1.40,.007,.014),'rubber')
 B.empty('gangway-end',(0,0,-8.52))
 # Observation end: sloping trapezoidal front glazing and low control enclosure.
 box('front-lower-bulkhead',(0,.46,7.66),(2.49,.92,.14),'panel',.10 if FINE else .025)
 for s in [-1,1]:
  vs=[(s*.84,.90,7.65),(s*1.24,.90,7.65),(s*1.24,2.10,7.49),(s*1.02,2.10,7.49)]
  o=mesh('front-swept-pillar',vs,[(0,1,2,3)],'panel');sol=o.modifiers.new('Molded pillar thickness','SOLIDIFY');sol.thickness=.08
  sweep('front-windscreen-seal',[(s*.82,.92,7.63),(s*.94,1.49,7.55),(s*1.02,2.045,7.47)],.018,'rubber')
 mesh('front-trapezoid-windscreen',[(-.82,.93,7.64),(.82,.93,7.64),(1.02,2.045,7.49),(-1.02,2.045,7.49)],[(0,1,2,3)],'glass')
 box('front-roof-header',(0,2.16,7.49),(2.49,.23,.18),'panel',.055 if FINE else .02)
 box('observation-console',(0,.87,7.39),(1.20,.14,.36),'panel',.06 if FINE else .02)
 box('console-inset',(0,.955,7.40),(.94,.024,.24),'shell',.02 if FINE else 0)
 for x in [-.30,.15,.35]:box('console-instrument',(x,.975,7.40),(.15,.014,.15),'rubber',.009 if FINE else 0)
 sweep('observation-front-handrail',[(-.50,.72,7.31),(-.44,.70,7.25),(.44,.70,7.25),(.50,.72,7.31)],.022)
 # Service hatches and intercom details outside portal clearances.
 for s,z in [(1,.95),(-1,-.95),(1,5.86)]:
  box('intercom-housing',(s*1.188,1.35,z),(.062,.28,.145),'panel',.035 if FINE else .012)
  box('intercom-grille',(s*1.151,1.395,z),(.012,.095,.098),'rubber',.008 if FINE else 0)
  tube('intercom-pushbutton',(s*1.144,1.29,z),(s*1.13,1.29,z),.017,'metal')
  if FINE:
   for j in range(5):box('intercom-grille-slat',(s*1.143,1.365+j*.014,z),(.010,.003,.087),'metal')
  sign('intercom-label',(s*1.153,1.56,z),(0,0,s),(0,1,0),.19,.071,5)
 for z in [-6.2,-2.5,2.5,6.2]:
  tube('ceiling-speaker',(0,2.258,z),(0,2.25,z),.072,'shell')
  if FINE:
   for j in range(-4,5):
    half=math.sqrt(max(0,.061**2-(j*.013)**2));box('speaker-grille',(0,2.243,z+j*.013),(2*half,.005,.004),'rubber')
  tube('camera-white-mount',(.28,2.26,z+.32),(.28,2.22,z+.32),.037,'panel')
  tube('camera-dome',(.28,2.22,z+.32),(.28,2.196,z+.32),.021,'rubber')
 B.empty('camera-aisle',(0,1.65,3.9));B.empty('standing-reference',(.33,0,1.0));B.empty('floor-datum',(0,0,0))
 s=bpy.context.scene;s['package']='skytrain-mark-v-interior';s['lod']=lod;s['runtime_status']='not_run';s['model_scope']='Representative A/end-car and short gangway; not full five-car engineering profile';s['seat_count']=len(SEATS);s['dimensions_basis']='Authoring assumptions; photo-informed, not measured'
 return SEATS

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=HERE);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 (a.output/'source').mkdir(exist_ok=True,parents=True)
 for lod in [0,1]:
  p=a.output/'source'/f'mark-v-a-car-interior.lod{lod}.blend'
  if p.exists():raise RuntimeError('Refuse to overwrite editable source: '+str(p))
  seats=make(lod);bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
 import json
 (a.output/'layout-assumptions.json').write_text(json.dumps({'coordinateSystem':'glTF metres +Y up +Z observation end; floor Y=0','bodyModuleLengthM':15.6,'interiorWallWidthM':2.49,'centerCeilingHeightM':2.265,'doorCentersZ':DOORS,'doorWidthM':1.52,'doorHeightM':2.09,'gangwayWidthM':1.4,'gangwayEndZ':-8.52,'seats':seats,'seatCount':len(seats),'surveyed':False,'officialFacts':{'model':'Alstom Mark V','lineAtIntroduction':'Expo','serviceIntroduction':'2025-07-10','trainLengthM':84.8,'cars':5},'runtimeBinding':'none','note':'A-car visual study. Individual car dimensions, seat coordinates and gangway dimensions are authoring assumptions, not full engineering survey. Two flex bays based on end-car diagram. No existing vehicle profile reused.'},indent=2)+'\n')
if __name__=='__main__':main()
