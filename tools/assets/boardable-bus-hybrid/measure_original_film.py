"""CPU-only evaluation of unmodified film donor, for comparison provenance."""
import bpy,importlib.util,json,hashlib,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if len(args)!=1:raise SystemExit('Usage: blender --background --python tools/assets/boardable-bus-hybrid/measure_original_film.py -- /path/to/production/bus_model_v2.py')
source=Path(args[0]).expanduser().resolve()
# The package remains re-exportable without this optional original-workspace audit.
if not source.is_file():raise FileNotFoundError(source)
bpy.ops.wm.read_factory_settings(use_empty=True)
s=importlib.util.spec_from_file_location('original_film_bus',source);M=importlib.util.module_from_spec(s);s.loader.exec_module(M)
root,wheels=M.build_bus();bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();tri=verts=count=0
for o in root.children_recursive:
 if o.type not in ['MESH','CURVE','FONT']:continue
 e=o.evaluated_get(deps);m=e.to_mesh()
 if m:m.calc_loop_triangles();tri+=len(m.loop_triangles);verts+=len(m.vertices);count+=1
 e.to_mesh_clear()
r={'sourceOrigin':'film workspace production/bus_model_v2.py','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'evaluatedTriangles':tri,'evaluatedVertices':verts,'evaluatedMeshObjects':count,'descendants':len(root.children_recursive),'includesThrusterHardware':True,'notRuntimePayload':True}
(HERE/'qa/original-film-metrics.json').write_text(json.dumps(r,indent=2)+'\n');print('ORIGINAL_FILM_METRICS',json.dumps(r))
