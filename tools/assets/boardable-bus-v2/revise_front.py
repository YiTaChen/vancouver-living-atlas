"""Surgical front-cabin revision of the editable sources; rear geometry is retained.
Photo observations and approximation limits are recorded in REFERENCES.md.
"""
import argparse, math, sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build as A
B=A.B

def remove_prefixes(prefixes):
 for o in list(bpy.context.scene.objects):
  if any(o.name.startswith(p) for p in prefixes):bpy.data.objects.remove(o,do_unlink=True)

def safe_box(n,c,size,role,bevel=0):
 return A.box(n,c,size,role,min(bevel,min(size)*.20))

def cockpit(fine):
 remove_prefixes(['driver-','steering-','fare-','front-entry-assist','front-ramp-'])
 box=safe_box;tube=A.tube;curve=A.curve
 # Left-hand driving station, bounded away from the right-side entrance path.
 box('driver-platform',(.76,.41,4.98),(.78,.10,1.53),'floor',.015 if fine else 0)
 box('driver-partition',(.77,.83,4.17),(.80,.94,.065),'panel',.022 if fine else 0)
 box('driver-partition-glass',(.77,1.73,4.17),(.80,.83,.025),'glass')
 tube('driver-partition-top',(.38,2.16,4.17),(1.15,2.16,4.17),.015,'metal',fine)
 box('driver-side-gate',(.33,.78,4.78),(.045,.80,1.03),'panel',.018 if fine else 0)
 box('driver-side-shield',(.33,1.52,4.60),(.020,.67,.62),'glass')
 tube('driver-gate-handle',(.31,1.18,4.40),(.31,1.18,4.67),.014,'metal',fine)
 box('driver-pedestal',(.76,.655,4.90),(.30,.39,.31),'rubber',.04 if fine else .015)
 box('driver-cushion',(.76,.89,4.90),(.48,.13,.47),'rubber',.045 if fine else .018)
 # Tapered upholstered driver back and head support are distinct from passenger seats.
 ob=box('driver-back',(.76,1.20,4.68),(.47,.59,.14),'rubber',.045 if fine else .018)
 box('driver-headrest',(.76,1.58,4.655),(.35,.22,.12),'rubber',.038 if fine else .014)
 for x in [.51,1.01]:
  tube('driver-arm-support',(x,1.00,4.74),(x,1.16,4.74),.018,'rubber',fine)
  box('driver-armrest',(x,1.17,4.88),(.070,.060,.35),'rubber',.025 if fine else .01)
 # Curved low binnacle, not a full-width rectangular wall at the windshield.
 outline=[(.27,5.32),(.42,5.61),(.90,5.71),(1.15,5.52),(1.15,5.19),(.96,5.15),(.68,5.24),(.48,5.20)]
 verts=[(x,y,z) for y in [.92,1.16] for x,z in outline];n=len(outline)
 B.mesh('driver-dashboard',verts,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)],'rubber',bevel=.032 if fine else .01)
 box('driver-console-side',(1.055,.985,4.98),(.19,.17,.91),'rubber',.025 if fine else .01)
 box('driver-console-instrument',(.57,1.235,5.48),(.36,.19,.15),'rubber',.025 if fine else .01)
 box('driver-console-screen',(.57,1.25,5.396),(.24,.12,.012),'fixture',.01 if fine else 0)
 for x in [.47,.68]:tube('driver-gauge',(x,1.27,5.386),(x,1.27,5.381),.038,'rubber',fine)
 for i in range(5):
  box('driver-console-switch',(1.055,1.082,4.68+i*.13),(.060,.025,.046),'button' if i==0 else 'metal',.006 if fine else 0)
 tube('driver-column',(.75,.64,5.14),(.75,1.30,5.25),.055,'rubber',fine)
 c=(.75,1.33,5.23)
 ring=[(c[0]+.205*math.cos(j*math.tau/24),c[1]+.155*math.sin(j*math.tau/24),c[2]+.11*math.sin(j*math.tau/24)) for j in range(25)]
 curve('steering-ring',ring,.015,'rubber',fine)
 for j in range(3):tube('steering-spoke',c,ring[j*8],.012,'rubber',fine)
 tube('steering-hub',(c[0],c[1]-.015,c[2]),(c[0],c[1]+.015,c[2]),.045,'rubber',fine)
 for x in [.63,.84]:
  box('driver-pedal',(x,.505,5.34),(.105,.055,.24),'rubber',.012 if fine else 0)
  if fine:
   for j in range(4):box('driver-pedal-tread',(x,.537,5.25+j*.05),(.085,.007,.008),'metal')
 box('fare-pedestal',(-.29,.78,5.04),(.23,.84,.24),'rubber',.030 if fine else .01)
 box('fare-reader',(-.29,1.29,5.02),(.28,.25,.20),'seat',.032 if fine else .01)
 box('fare-reader-screen',(-.29,1.32,4.908),(.19,.13,.012),'fixture',.014 if fine else 0)
 tube('front-entry-assist',(-.55,.42,5.14),(-.55,1.48,5.14),.024,'rail',fine)
 curve('front-entry-assist-bend',[(-.55,1.48,5.14),(-.65,1.60,5.14),(-1.02,1.60,5.14)],.024,'rail',fine)
 # Flush visual ramp cassette; it does not obstruct or move the existing door sill.
 box('front-ramp-cassette',(-.77,.364,4.275),(.62,.008,.91),'rubber',.012 if fine else 0)
 for z in [3.83,4.72]:box('front-ramp-edge',(-.77,.369,z),(.60,.003,.018),'marking')
 B.empty('driver-pelvis',(.76,1.015,4.91));B.empty('driver-camera',(.76,1.605,4.96))

def priority_layout(fine):
 box=safe_box;tube=A.tube;curve=A.curve
 # Replace only active low-floor seats; all 17 rear seats and their anchors survive.
 remove_prefixes([f'seat-{i:02d}' for i in range(18,40)]+['wheelchair-','front-priority-','front-wheel-','front-equipment-'])
 for side in [-1,1]:
  remove_prefixes([f'wheel-well-{side}-3.1']+[f'stanchion-{side}-{j}' for j in [4,5,6]])
 for i,(x,z,y,group) in enumerate(A.SEATS,1):
  if i>=18:A.seat(i,x,z,y,group,fine)
 # Front arch form covers the retained original axle at Z=+3.10 m.
 for side in [-1,1]:
  zs=[2.48+1.24*j/16 for j in range(17)]
  top=[(.49+math.sqrt(max(0,.66**2-(z-3.10)**2)),z) for z in zs]
  poly=[(.36,2.48)]+top+[(.36,3.72)]
  B.slab('front-wheel-arch-'+str(side),poly,0,min(side*.73,side*1.15),max(side*.73,side*1.15),'panel')
  box('front-wheel-cap-'+str(side),(side*.94,1.16,3.10),(.43,.035,1.24),'metal',.028 if fine else .008)
 # Right wheelbox stays unseated and has a yellow guardrail. The left is enclosed.
 curve('front-wheel-guard',[(-.74,1.19,2.50),(-.74,1.46,2.50),(-.74,1.46,3.63),(-.74,1.19,3.63)],.025,'rail',fine)
 for z in [2.50,3.63]:tube('front-wheel-guard-cross',(-1.11,1.46,z),(-.74,1.46,z),.025,'rail',fine)
 box('front-equipment-cabinet',(.94,1.71,3.20),(.43,1.10,1.08),'panel',.030 if fine else .012)
 box('front-equipment-lower',(.94,.77,3.79),(.43,.82,.31),'panel',.018 if fine else .007)
 box('front-equipment-backrest',(.94,1.28,2.633),(.32,.80,.060),'seat',.040 if fine else .012)
 for y in [1.0,1.55]:tube('front-equipment-cabinet-fastener',(.715,y,3.20),(.708,y,3.20),.015,'rubber',fine)
 # Three inward-facing fold-up places on the right are visibly stowed.
 # They have no passenger nodes/pelvis anchors, so no double-counted seat capacity.
 for j,z in enumerate(A.STOWED_PRIORITY_Z):
  box(f'front-priority-stowed-back-{j}',(-1.115,1.09,z),(.06,.46,.40),'seat',.025 if fine else .008)
  box(f'front-priority-stowed-pan-{j}',(-1.055,.68,z),(.055,.39,.42),'metal',.015 if fine else .004)
  box(f'front-priority-stowed-pad-{j}',(-1.025,.69,z),(.016,.31,.34),'seat',.015 if fine else .006)
  tube(f'front-priority-hinge-{j}',(-1.03,.49,z-.19),(-1.03,.49,z+.19),.022,'rubber',fine)
  tube(f'front-priority-grab-{j}',(-1.09,1.36,z-.18),(-1.09,1.36,z+.18),.014,'metal',fine)
 # Transverse boundary rail at the front wheelbox, no obstruction across the bay.
 for side in [-1,1]:
  curve('front-priority-bay-end-'+str(side),[(side*.55,.36,2.43),(side*.55,1.67,2.43),(side*.43,2.13,2.43),(side*.43,2.40,2.43)],.023,'rail',fine)
  curve('front-priority-pair-rail-'+str(side),[(side*.37,.36,-.14 if side>0 else .66),(side*.37,1.64,-.14 if side>0 else .66),(side*.43,2.10,-.14 if side>0 else .66),(side*.43,2.40,-.14 if side>0 else .66)],.022,'rail',fine)
 # Right bay is reserved with the three seats raised. Restraint is stowed at the wall.
 box('wheelchair-restraint',(-1.10,.50,1.59),(.065,.24,.34),'rubber',.025 if fine else .006)
 box('wheelchair-priority-panel',(-1.142,1.54,1.59),(.014,.18,.30),'seat')
 for z in [.82,2.32]:box('front-priority-bay-outline',(-.71,.366,z),(.56,.005,.018),'marking')
 B.empty('wheelchair-reference',(-.71,.36,1.57))

def apply_front(lod):
 B.ROOT=bpy.data.objects['vehicle'];B.M.clear()
 for name in ['floor','panel','seat','seat-shell','rail','metal','rubber','glass','marking','fixture','button']:B.M[name]=bpy.data.materials[name]
 # Dark navy, higher roughness: explicit upholstery change, not exposure compensation.
 for name,col,rough in [('seat',(.010,.033,.073,1),.78),('seat-shell',(.028,.065,.105,1),.60)]:
  m=B.M[name];m.diffuse_color=col;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=col;bs.inputs['Roughness'].default_value=rough
 cockpit(lod==0)
 priority_layout(lod==0)
 bpy.context.scene['front_revision']='photo-verified-XD40-front-v2.1'

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=HERE/'source');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 for lod in [0,1]:
  p=a.source/f'city-bus-12m-interior-v2.lod{lod}.blend';bpy.ops.wm.open_mainfile(filepath=str(p));apply_front(lod);bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
if __name__=='__main__':main()
