"""Temporary edit/save/reopen proof without altering delivered source scenes."""
import bpy,json,hashlib,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
source=ROOT/'source/pedestrian-commuter.blend';digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();before=digest(source)
bpy.ops.wm.open_mainfile(filepath=str(source));obj=bpy.data.objects['interactive-body'];x=obj.data.vertices[0].co.x;obj.data.vertices[0].co.x+=.01
with tempfile.TemporaryDirectory() as tmp:
 target=Path(tmp)/'edited.blend';bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True);bpy.ops.wm.open_mainfile(filepath=str(target));assert abs(bpy.data.objects['interactive-body'].data.vertices[0].co.x-x-.01)<1e-6
assert before==digest(source)
(ROOT/'qa/saved-edit-proof.json').write_text(json.dumps({'status':'pass','source':str(source.relative_to(ROOT)),'sourceSha256':before,'probe':'one mesh vertex +0.01 m X, temporary .blend saved and reopened','originalSourceUnchanged':True,'runtimeAcceptance':'not_run'},indent=2)+'\n')
