"""Build ORIGINAL editable v2 geometry after photo review. Never used by re-export.
Uses established project geometry primitives without changing the previous package.
"""
import argparse, importlib.util, math, sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from layout import *
spec=importlib.util.spec_from_file_location('legacy_bus_builder',HERE.parent/'boardable-bus/build.py');B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)

def materials():
 colors={
 'floor':((.17,.19,.21,1),.92,0), 'panel':((.68,.70,.70,1),.56,.05),
 'seat':((.018,.14,.40,1),.52,.03), 'seat-shell':((.09,.22,.38,1),.48,.08),
 'rail':((.96,.60,.025,1),.30,.14), 'metal':((.48,.53,.57,1),.30,.70),
 'rubber':((.023,.030,.039,1),.85,0), 'glass':((.29,.40,.46,.22),.18,0),
 'marking':((.96,.70,.055,1),.65,0), 'fixture':((.88,.91,.92,1),.5,0),
 'button':((.60,.015,.025,1),.5,0)}
 for name,(col,rough,metal) in colors.items():
  m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=col
  bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=col;bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
  if name=='glass':bs.inputs['Alpha'].default_value=col[3];m.surface_render_method='DITHERED'
  m['semantic_role']={'seat-shell':'seat','metal':'rail','marking':'floor','fixture':'panel','button':'panel'}.get(name,name)
  m['shared_surface_id']='bus-v2-'+name;B.M[name]=m

def box(n,c,s,r,bevel=0,parent=None):return B.box(n,c,s,r,parent,bevel)
def tube(n,a,b,r=.023,role='rail',fine=True):return B.cylinder(n,a,b,r,role,10 if fine else 6)
def curve(n,points,r=.023,role='rail',fine=True):
 for i,(a,b) in enumerate(zip(points,points[1:])):tube(n+'-'+str(i),a,b,r,role,fine)

def seat(i,x,z,floor,group,fine):
 n=f'seat-{i:02d}';node=B.empty(n,(x,floor,z));node['seat_group']=group;node['human_reference']='pelvis, not feet root'
 # Tapered, reclined shell and separately editable blue upholstery.
 ys=[.43,.53,.86,1.04];widths=[.40,.42,.41,.35];depths=[-.215,-.245,-.285,-.29]
 verts=[]
 for offset in [-.022,.022]:
  for y,w,zz in zip(ys,widths,depths):
   verts.extend([(-w/2,y,zz+offset),(w/2,y,zz+offset)])
 faces=[]
 for k in range(3):
  a=k*2;faces.extend([(a,a+1,a+3,a+2),(a+8,a+10,a+11,a+9),(a,a+2,a+10,a+8),(a+1,a+9,a+11,a+3)])
 faces += [(0,8,9,1),(6,7,15,14)]
 B.mesh(n+'-back-shell',verts,faces,'seat-shell',node,bevel=.012 if fine else 0)
 B.box(n+'-back-pad',(0,.752,-.238),(.344,.462,.064),'seat',node,.030 if fine else .012)
 B.box(n+'-cushion',(0,.415,.010),(.42,.07,.445),'seat',node,.028 if fine else .010)
 B.box(n+'-pan',(0,.365,.006),(.414,.045,.442),'seat-shell',node,.019 if fine else 0)
 B.cylinder(n+'-leg-left',(-.135,.0,.045),(-.135,.35,.045),.018,'metal',8 if fine else 6,node)
 B.cylinder(n+'-leg-right',(.135,.0,.045),(.135,.35,.045),.018,'metal',8 if fine else 6,node)
 B.cylinder(n+'-foot',(-.175,.022,.045),(.175,.022,.045),.018,'metal',8 if fine else 6,node)
 for xx in [-.185,.185]:B.cylinder(n+'-grab-side',(xx,.98,-.294),(xx,1.105,-.294),.012,'metal',8 if fine else 6,node)
 B.cylinder(n+'-grab-top',(-.185,1.105,-.294),(.185,1.105,-.294),.012,'metal',8 if fine else 6,node)
 if fine:
  for yy in [.66,.85]:
   for xx in [-.10,.10]:B.cylinder(n+'-upholstery-button',(xx,yy,-.201),(xx,yy,-.196),.013,'seat-shell',8,node)
 B.empty(n+'-pelvis',(x,floor+.52,z+.025));B.empty(n+'-camera',(x,floor+1.11,z+.075))

def make(lod):
 B.ROOT=B.clean();B.M.clear();materials();fine=lod==0
 for name,a,b,y in FLOOR_ZONES:
  width=2.30 if name in ['low-floor','raised-rear'] else .65
  box(name+'-slab',(0,(.26+y)/2,(a+b)/2),(width,y-.26,b-a),'floor')
 # Close under-seat portions beside stairs; aisle alone is stepped.
 for side in [-1,1]:box('step-side-plinth-'+str(side),(side*.745,.47,-1.7),(.81,.42,.48),'panel')
 for name,a,b,y in FLOOR_ZONES:
  if 'step' in name:box(name+'-yellow-nosing',(0,y+.002,b-.015),(.65,.004,.030),'marking')
 box('ceiling',(0,2.65,.05),(2.27,.10,11.38),'panel')
 for side in [-1,1]:
  intervals=[(-5.65,5.72)] if side>0 else [(-5.65,-1.20),(-.05,3.70),(4.85,5.72)]
  for i,(a,b) in enumerate(intervals):
   box(f'liner-{side}-{i}',(side*1.165,.97,(a+b)/2),(.025,.30,b-a),'panel')
   box(f'window-sill-{side}-{i}',(side*1.14,1.14,(a+b)/2),(.045,.055,b-a),'rubber')
  # Sloped roof shoulder / advertising strips, below existing exterior cantrail.
  shoulder=box('roof-shoulder-'+str(side),(side*.96,2.49,.03),(.33,.15,11.18),'panel',.035 if fine else 0)
  box('ceiling-fixture-'+str(side),(side*.76,2.566,.10),(.105,.032,10.70),'fixture')
  box('ceiling-seam-'+str(side),(side*.65,2.594,.1),(.013,.01,10.72),'rubber')
  for j,z in enumerate([-4.3,-2.6,-.8,.9,2.6,4.3]):
   box(f'ad-frame-{side}-{j}',(side*.99,2.47,z),(.019,.17,1.22),'rubber')
   box(f'ad-blank-{side}-{j}',(side*.978,2.47,z),(.012,.135,1.16),'fixture')
 # Axle housings match prior exterior wheel centre and intrusion envelope.
 for z in [-3.1,3.1]:
  for side in [-1,1]:box(f'wheel-well-{side}-{z}',(side*.965,.685,z),(.35,.65,1.18),'panel',.032 if fine else 0)
 for i,(x,z,y,group) in enumerate(SEATS,1):seat(i,x,z,y,group,fine)
 # Wide wheelchair bay, lowered driver partition and fare hardware.
 box('driver-partition',(.77,1.00,4.17),(.80,1.28,.055),'panel',.018 if fine else 0)
 box('driver-partition-glass',(.77,1.93,4.17),(.80,.57,.025),'glass')
 box('driver-cushion',(.77,.81,4.90),(.48,.13,.46),'rubber',.045 if fine else 0)
 box('driver-back',(.77,1.19,4.68),(.48,.64,.11),'rubber',.04 if fine else 0)
 box('driver-pedestal',(.77,.55,4.90),(.24,.35,.24),'rubber')
 box('driver-dashboard',(.63,1.10,5.43),(1.02,.23,.40),'rubber',.04 if fine else 0)
 tube('driver-column',(.72,.91,5.1),(.72,1.19,5.26),.035,'rubber',fine)
 # Open steering ring: no opaque dinner-plate disc.
 ring=[(.72+.18*math.cos(j*math.tau/20),1.20,5.26+.18*math.sin(j*math.tau/20)) for j in range(21)]
 curve('steering-ring',ring,.013,'rubber',fine)
 tube('steering-spoke',(.54,1.20,5.26),(.90,1.20,5.26),.008,'metal',fine)
 box('fare-pedestal',(-.30,.76,4.94),(.19,.80,.19),'rubber',.018 if fine else 0)
 box('fare-reader',(-.30,1.22,4.94),(.24,.18,.16),'seat',.02 if fine else 0)
 box('fare-reader-screen',(-.30,1.23,4.848),(.17,.10,.008),'fixture')
 # Entry lines and rails, maintained outside the actual portal clearance volume.
 for group,a,b in DOORS:
  box(group+'-entry-edge',(-1.112,.364,(a+b)/2),(.060,.008,b-a),'marking')
  for z in [a-.10,b+.10]:
   tube(group+'-entry-stanchion',(-1.02,.40,z),(-1.02,2.31,z),.025,'rail',fine)
  B.empty('doorway-'+group,(-1.25,.36,(a+b)/2));B.empty('boarding-'+group,(-1.70,.36,(a+b)/2))
 # Photo-inspired bent stanchions, grab loops and over-aisle rails.
 for side in [-1,1]:
  tube('overhead-rail-'+str(side),(side*.43,2.40,-4.95),(side*.43,2.40,3.58),.023,'rail',fine)
  for j,z in enumerate([-4.72,-3.86,-3.00,-2.17,.16,1.98,3.49]):
   floor=REAR_FLOOR if z<-1.94 else FLOOR
   curve(f'stanchion-{side}-{j}',[(side*.38,floor,z),(side*.38,1.85,z),(side*.43,2.1,z),(side*.43,2.40,z)],.022,'rail',fine)
  if fine:
   for j,z in enumerate([-4.5,-3.65,-2.8,-.90,.10,1.15,2.4]):
    
    if side<0 and z==-.90:continue
    tube('strap-stem',(side*.43,2.38,z),(side*.43,2.12,z),.009,'rubber',fine)
    curve('strap-loop',[(side*.43,2.12,z),(side*.43,2.01,z-.055),(side*.43,1.99,z+.055),(side*.43,2.12,z)],.009,'rubber',fine)
  # Yellow stop cord lives against the sidewall, clear of glazing.
  
  for j,(a,b) in enumerate([(-5.0,2.44)] if side>0 else [(-5.0,-1.30),(.05,2.44)]):
   tube('stop-cord-'+str(side)+'-'+str(j),(side*1.127,1.43,a),(side*1.127,1.43,b),.004,'rail',fine)
 for z in [-2.17,1.98]:box('stop-button',(-.355,1.33,z),(.054,.10,.065),'button',.012 if fine else 0)
 # Stowed wheelchair restraint panel, not deployable seats counted as passengers.
 box('wheelchair-restraint',(-1.09,.81,.79),(.10,.76,.50),'rubber',.025 if fine else 0)
 box('wheelchair-priority-panel',(-1.142,1.30,.79),(.014,.18,.30),'seat')
 for x in [-.15,0,.15]:box('rear-vent-slat',(x,2.22,-5.63),(.055,.32,.028),'rubber')
 box('passenger-display',(0,2.47,3.93),(.70,.18,.07),'rubber',.02 if fine else 0)
 box('display-neutral-screen',(0,2.47,3.888),(.60,.125,.006),'fixture')
 for z in [-3.9,.0,3.5]:
  box('roof-hatch',(0,2.592,z),(.66,.015,.72),'rubber',.003 if fine else 0)
  box('roof-hatch-insert',(0,2.579,z),(.57,.018,.63),'panel',.003 if fine else 0)
 B.empty('driver-pelvis',(.77,.91,4.9));B.empty('driver-camera',(.77,1.51,4.95));B.empty('camera-aisle',(0,1.99,.0));B.empty('standing-center',(0,.36,0));B.empty('wheelchair-reference',(-.76,.36,.8))
 s=bpy.context.scene;s['package']='boardable-bus-v2';s['asset']='city-bus-12m-interior-v2';s['lod']=lod;s['runtime_status']='pending';s['lighting']='daytime only; all fixtures non-emissive'

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=HERE);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);(a.output/'source').mkdir(parents=True,exist_ok=True)
 for lod in [0,1]:
  p=a.output/'source'/f'city-bus-12m-interior-v2.lod{lod}.blend'
  if p.exists():raise RuntimeError('Refusing to overwrite editable artist source: '+str(p))
  make(lod);bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
if __name__=='__main__':main()
