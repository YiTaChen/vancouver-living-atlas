import importlib.util,json
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('build_mark_v',HERE/'build.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
for lod in [0,1]:
 p=HERE/f'source/mark-v-a-car-interior.lod{lod}.blend';bpy.ops.wm.open_mainfile(filepath=str(p))
 # Replace only observation salon seat geometry, leaving remainder editable and unchanged.
 for ob in list(bpy.data.objects):
  if ob.name.startswith(('seat-front-','seat-observation')):bpy.data.objects.remove(ob,do_unlink=True)
 B.FINE=lod==0;B.B.ROOT=bpy.data.objects['vehicle'];B.B.M={m.name:m for m in bpy.data.materials};B.SEATS=[]
 for j,z in enumerate([6.44,6.92]):B.seat(f'seat-front-left-{j}',(1.105,z),(-1,0))
 B.seat('seat-front-left-transverse',(.85,5.91),(0,-1))
 B.seat('seat-front-right',(-1.105,6.92),(1,0))
 for k,x in enumerate([-.95,-.48]):B.seat(f'seat-front-pair-{k}',(x,5.91),(0,-1))
 B.seat('seat-observation',(0,6.37),(0,1))
 bpy.context.scene['seat_count']=22;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
layout=json.loads((HERE/'layout-assumptions.json').read_text());layout['seats']=[x for x in layout['seats'] if not x['id'].startswith(('seat-front-','seat-observation'))]+B.SEATS;layout['seatCount']=len(layout['seats']);layout['layoutReconciliation']='22 seats match official A-car regional counts (7 front / 3 singles / 5 longitudinal / 7 rear). Precise orientation and placement are approximate; not measured or full train capacity.';(HERE/'layout-assumptions.json').write_text(json.dumps(layout,indent=2)+'\n')
