"""Explicit 60 mm source edit: raise representative gangway header above 2.05 m target."""
from pathlib import Path
import bpy,json
HERE=Path(__file__).resolve().parent
for p in sorted((HERE/'source').glob('*.blend')):
 bpy.ops.wm.open_mainfile(filepath=str(p));ob=bpy.data.objects['gangway-header']
 if not ob.get('headroom_raised_60mm'):
  ob.location.z+=.060;ob['headroom_raised_60mm']=True;ob['underside_reference_m']=2.075
 bpy.context.scene['gangway_minimum_headroom_m']=2.075;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
p=HERE/'layout-assumptions.json';d=json.loads(p.read_text());d['gangwayHeaderUndersideM']=2.075;d['gangwayHeightBasis']='Representative header raised 60 mm to exceed 2.05 m target; no surveyed constraint';p.write_text(json.dumps(d,indent=2)+'\n')
