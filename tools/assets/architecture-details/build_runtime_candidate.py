"""Create a real Blender sill variant inside the existing street sill envelope.

Original .blend inputs remain unchanged. Only offline source height is changed
from 0.18 to 0.16 metres; metre UVs are reprojected before GLB export. Runtime
keeps height/depth at scale 1 and varies only the length of this linear trim.
"""
from pathlib import Path
import hashlib
import json
import bpy
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_architecture_details as kit

HERE = Path(__file__).resolve().parent
OUT = HERE/'runtime-candidate'
for folder in ['source', 'assets']:
    (OUT/folder).mkdir(parents=True, exist_ok=True)
manifest = {'id': 'robson-sill-blender-candidate-v1', 'status': 'QA opt-in only; integrated visual and GPU gate unverified',
            'blenderVersion': bpy.app.version_string, 'builderSha256': kit.sha(__file__),
            'catalogSha256': kit.sha(kit.CATALOG), 'units': 'metres', 'upAxis': '+Y', 'frontAxis': '+Z',
            'surface': 'sandstone', 'tileMeters': [1.2, 1.2], 'originalHeightMetres': .18,
            'fittedHeightMetres': .16, 'runtimeScale': 'X span only; Y=Z=1', 'lods': []}
for lod in [0, 1]:
    source = HERE/'source'/f'sandstone-sill.lod{lod}.blend'
    source_hash = kit.sha(source)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for vertex in obj.data.vertices:
            vertex.co.z *= .16/.18
        obj.data.update()
        kit.metric_uv(obj)
        obj['candidate_id'] = manifest['id']
        obj['fit_reason'] = 'Contained in existing 0.16 m high upper-window sill envelope'
    record = kit.export('sandstone-sill', lod, OUT)
    record['inputSourceSha256'] = source_hash
    assert kit.sha(source) == source_hash
    assert abs(record['bounds']['max'][1]-.16) < 1e-6
    manifest['lods'].append(record)
(OUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
