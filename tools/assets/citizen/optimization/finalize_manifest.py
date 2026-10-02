"""Run after all rebuild, source roundtrip, rendering and QA commands."""
import json,hashlib
from pathlib import Path
r=Path(__file__).resolve().parent;j=json.loads((r/'manifest.json').read_text())
j['coordinateSystem']={'unit':'metre','gltfUp':'+Y','gltfForward':'+Z','blenderUp':'+Z','blenderForward':'-Y'};j['runtimeIntegrated']=False;j['sourceType']='Editable reconstruction from original shipping GLB, not original procedural authoring scene';j['animations']=[{'name':'idle','seconds':2,'strideMetres':0},{'name':'walk','seconds':1,'strideMetres':1},{'name':'run','seconds':.8,'strideMetres':1.9}]
for a in j['assets']:
 a['sourceFile']=f"source/citizen-{a['id']}.blend";a['sourceSha256']=hashlib.sha256((r/a['sourceFile']).read_bytes()).hexdigest()
 if a['id']!='reference':
  a['glbFile']=f"glb/citizen-{a['id']}.glb";a['glbBytes']=(r/a['glbFile']).stat().st_size;a['glbSha256']=hashlib.sha256((r/a['glbFile']).read_bytes()).hexdigest()
  a['status']='texture-only close-view candidate' if a['id']=='lod0' else 'mid/far-distance candidate; localized cloth-edge differences require integration QA'
(r/'manifest.json').write_text(json.dumps(j,indent=2)+'\n')
files={str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(r.rglob('*')) if p.is_file() and p.name!='sha256.json' and '__pycache__' not in p.parts};(r/'sha256.json').write_text(json.dumps(files,indent=2)+'\n')
