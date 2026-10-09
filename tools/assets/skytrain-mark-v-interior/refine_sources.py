"""Documented in-place cleanup of over-tessellated original vent slits."""
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
for p in (HERE/'source').glob('*.blend'):
 bpy.ops.wm.open_mainfile(filepath=str(p))
 for ob in bpy.data.objects:
  if ob.name.startswith('underseat-vent-slit'):ob.modifiers.clear()
 bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
