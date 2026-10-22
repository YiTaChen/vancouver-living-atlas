"""Re-export the editable hybrid LOD sources without regenerating geometry."""
import bpy,importlib.util,hashlib,json,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('hybrid_generator',HERE/'build.py');G=importlib.util.module_from_spec(s);s.loader.exec_module(G)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
results=[]
for level in range(3):
 name=f'city-bus-12m-exterior.lod{level}';source=HERE/'source'/f'{name}.blend';out=HERE/'exports'/f'{name}.glb'
 before=digest(out) if out.exists() else None
 bpy.ops.wm.open_mainfile(filepath=str(source));G.export_loaded(out);shutil.copy2(out,G.PUBLIC/out.name)
 results.append({'level':level,'source':str(source.relative_to(HERE)),'beforeSha256':before,'afterSha256':digest(out),'byteIdentical':before==digest(out)})
(HERE/'qa/source-reexport.json').write_text(json.dumps({'status':'pass' if all(r['byteIdentical'] for r in results) else 'changed_bytes_refresh_manifest','results':results},indent=2)+'\n')
print('SOURCE_REEXPORT_COMPLETE',flush=True)
