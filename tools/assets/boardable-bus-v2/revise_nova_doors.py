"""Surgical Nova-typical door-layout correction of all editable interior sources.

This migrates the existing authored surfaces, preserving seat contours, material
textures, radial rail detail and artist edits. It is not a full fleet replica.
Re-export remains independent of this one-time source migration.
"""
import hashlib, importlib.util, json, sys
from pathlib import Path
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build as A
from layout import DOORS, FLOOR_ZONES, WALL_INTERVALS, INTERIOR_REAR, INTERIOR_FRONT
B = A.B
REVISION = 'nova-typical-door-layout-20261011'

def sha(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()

def shift(ob, dz):
 # All top-level authored pieces use the unchanged vehicle-local metre frame.
 ob.location.y -= dz

def range_z(ob, lo, hi):
 """Stretch only longitudinal mesh coordinates, retaining cross-section/UVs."""
 oldlo = min(-v.co.y for v in ob.data.vertices)
 oldhi = max(-v.co.y for v in ob.data.vertices)
 for v in ob.data.vertices:
  z = lo + (-v.co.y-oldlo)*(hi-lo)/(oldhi-oldlo)
  v.co.y = -z

def migrate_loaded(quality=False, lod=0):
 scene = bpy.context.scene
 if scene.get('door_layout_revision') == REVISION:
  return {'alreadyApplied': True}
 B.ROOT = bpy.data.objects['vehicle']; B.M.clear()
 for m in bpy.data.materials:
  B.M[m.name] = m
 before_seat_shapes = {o.name: len(o.data.vertices) for o in scene.objects if o.type == 'MESH' and o.name.startswith('seat-')}
 # Move complete seat roots; independent pelvis/eye empties need the same delta.
 for i in range(1,18):
  prefix = f'seat-{i:02d}'
  for name in [prefix, prefix+'-pelvis', prefix+'-camera']:
   shift(bpy.data.objects[name], -.65)
 for name, lo, hi, y in FLOOR_ZONES:
  range_z(bpy.data.objects[name+'-slab'], lo, hi)
 for ob in list(scene.objects):
  n = ob.name
  if n.startswith(('rear-step-', 'step-side-plinth-')) and not n.endswith('-slab'):
   shift(ob, -1.04)
  elif n.startswith('stanchion-') and '-3' in n:
   # Keep its 0.43 m longitudinal separation from the first shifted seat row.
   # Z=-2.82 is on the raised side plinth, outside the low-floor doorway.
   shift(ob, -.65)
  elif n.startswith('stop-button'):
   # Distinguish the retained low-floor button from the rear-step button.
   zs = [-v.co.y for v in ob.data.vertices]
   if max(zs)<0: shift(ob, -.65)
  elif n.startswith('rear-vent-slat'):
   shift(ob, -.47)
  elif n.startswith(('front-entry-assist',)):
   shift(ob, .16)
  elif n == 'front-ramp-cassette':
   range_z(ob, 4.125, 5.075)
  elif n.startswith('front-ramp-edge'):
   z = sum(-v.co.y for v in ob.data.vertices)/len(ob.data.vertices)
   shift(ob, (4.135 if z<4.275 else 5.065)-z)
  if ob.type == 'MESH' and n.startswith(('ceiling', 'roof-shoulder-')) and not n.startswith(('ceiling-cross-seam-', 'ceiling-vent-')):
   zs=[-v.co.y for v in ob.data.vertices]
   if max(zs)-min(zs)>9: range_z(ob, min(zs)-.47, max(zs))
  if n.startswith('overhead-rail-'):
   zs=[-v.co.y for v in ob.data.vertices];range_z(ob,min(zs)-.65,max(zs))
 # Stretch existing sidewall pieces around actual portals; do not translate walls
 # into a door opening. No additional material or draw-call batch is introduced.
 for side in [-1,1]:
  intervals = [(INTERIOR_REAR, INTERIOR_FRONT)] if side>0 else WALL_INTERVALS
  for i,(lo,hi) in enumerate(intervals):
   for prefix in ['liner', 'window-sill']:
    ob=bpy.data.objects.get(f'{prefix}-{side}-{i}')
    if ob:range_z(ob,lo,hi)
  for j,(lo,hi) in enumerate([(INTERIOR_REAR+.32,2.44)] if side>0 else [(INTERIOR_REAR+.32,-2.40),(-1.30,2.44)]):
   ob=bpy.data.objects.get(f'stop-cord-{side}-{j}')
   if ob:range_z(ob,lo,hi)
 for group,lo,hi in DOORS:
  centre=(lo+hi)/2
  for prefix,x in [('doorway-',-1.25),('boarding-',-1.70)]:
   bpy.data.objects[prefix+group].location=Vector(B.cv((x,.36,centre)))
  range_z(bpy.data.objects[group+'-entry-edge'],lo,hi)
  posts=sorted([o for o in scene.objects if o.name.startswith(group+'-entry-stanchion') and not o.name.endswith(('yellow-grip','floor-socket','upper-collar'))],key=lambda o:sum(-v.co.y for v in o.data.vertices)/len(o.data.vertices))
  for ob,z in zip(posts,[lo-.10,hi+.10]):
   old=sum(-v.co.y for v in ob.data.vertices)/len(ob.data.vertices);delta=z-old
   shift(ob,delta)
   for suffix in ['-yellow-grip','-floor-socket','-upper-collar']:
    child=bpy.data.objects.get(ob.name+suffix)
    if child:shift(child,delta)
  threshold=bpy.data.objects.get('door-'+group+'-threshold-slab')
  if threshold:range_z(threshold,lo,hi)
 if quality:
  # Rebuild only trim around corrected apertures, using the existing materials.
  # The expensive contoured seats, smooth tubing and packed floor tile survive.
  for ob in list(scene.objects):
   if ob.name.startswith(('window-outer-', 'window-inner-', 'window-reveal-', 'window-sill-cap-', 'lower-wall-', 'liner-panel-joint-')):
    bpy.data.objects.remove(ob,do_unlink=True)
  spec=importlib.util.spec_from_file_location('bus_closeup_refine',HERE/'closeup-quality/refine.py')
  R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);R.windows(lod)
  if lod==1:
   for ob in scene.objects:
    if ob.type=='MESH' and ob.name.startswith(('window-','lower-wall-','liner-')):
     for mod in ob.modifiers:
      if mod.type=='BEVEL':mod.segments=1
 after_seat_shapes={o.name:len(o.data.vertices) for o in scene.objects if o.type=='MESH' and o.name.startswith('seat-')}
 assert before_seat_shapes==after_seat_shapes, 'Seat topology changed during door migration'
 bpy.context.view_layer.update()
 scene['door_layout_revision']=REVISION
 scene['door_layout_basis']='TransLink 2018 infrastructure guide typical Nova bus: nose +6.10, front centre +4.60, rear centre -1.85, widths 1.20/0.90 m; not a full fleet replica'
 return {'seatShapesPreserved':True,'seatCount':24,'rearSeatDeltaZ':-.65,'stepDeltaZ':-1.04,'doorRangesM':DOORS,'floorZonesM':FLOOR_ZONES,'windowTrimRebuiltOnly':quality}

def main():
 reports=[]
 for directory,stem,quality in [(HERE,'city-bus-12m-interior-v2',False),(HERE/'runtime-candidate','city-bus-12m-interior-v2-runtime',False),(HERE/'closeup-quality','city-bus-12m-interior-v2-closeup',True)]:
  for lod in [0,1]:
   path=directory/'source'/f'{stem}.lod{lod}.blend'
   before=sha(path);bpy.ops.wm.open_mainfile(filepath=str(path));result=migrate_loaded(quality,lod)
   if not result.get('alreadyApplied'):bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
   reports.append({'file':str(path.relative_to(HERE)),'beforeSha256':before,'afterSha256':sha(path),'lod':lod,**result})
 (HERE/'qa/nova-door-source-migration.json').write_text(json.dumps({'revision':REVISION,'blenderVersion':bpy.app.version_string,'scope':'Surgical source migration; exports and runtime tests are separate','sources':reports},indent=2)+'\n')
 print(json.dumps(reports,indent=2))

if __name__=='__main__':main()
