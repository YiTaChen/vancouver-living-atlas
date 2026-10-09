"""Finalize the candidate's own offline report/inventory only. No master writes."""
import hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 for name in ['validation.json','common-validation.json','blender-validation.json','visual-review.json']:assert json.loads((HERE/'qa'/name).read_text())['status']=='pass',name
 tests=(HERE/'qa/regression-tests.txt').read_text();assert 'Ran 39 tests' in tests and tests.rstrip().endswith('OK')
 adapter=(HERE/'qa/adapter-tests.txt').read_text();assert 'pass 6' in adapter and 'fail 0' in adapter
 m=json.loads((HERE/'manifest.json').read_text())
 index=json.loads((HERE/'qa/previews/index.json').read_text());review=json.loads((HERE/'qa/visual-review.json').read_text());assert len(index['renders'])==4 and len(review['images'])==4
 for render in index['renders']:
  assert sha(HERE/'qa/previews'/render['file'])==render['sha256']
  for item in render['actualGLBInputs']:assert sha(HERE/item['file'])==item['sha256'],'Preview bound to stale GLB'
 for item in review['images']:
  assert sha(HERE/item['file'])==item['sha256']
  for glb in item['actualGLBInputs']:assert sha(HERE/glb['file'])==glb['sha256'],'Visual review bound to stale GLB'
 m['status']='offline_complete';m['assets'][0]['offlineChecks']['status']='pass';m['assets'][0]['offlineChecks']['evidence']=['qa/validation.json','qa/common-validation.json','qa/blender-validation.json','qa/regression-tests.txt','qa/adapter-tests.txt','qa/visual-review.json','qa/previews/index.json'];m['scope']['runtimeIntegration']='pending';m['scope']['WebGL']='not_run';(HERE/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 source=json.loads((HERE/'qa/provenance.json').read_text())
 for p in source['masterInputs']:assert sha(HERE/p['file'])==p['sha256'],'Master source changed'
 handoff={'status':'offline_complete','runtimeStatus':'runtime_pending_webgl','WebGL':'not_run','scope':'Separately delivered B-CAB-compliant bus interior derivative. Not integrated, not a byte-identical rear geometry proof.','measuredLods':[{'level':l['level'],'file':l['file'],'sha256':l['sha256'],'triangles':l['triangles'],'bytes':l['bytes'],'primitives':l['primitives'],'offlineSidecarBytes':l['componentSidecar']['bytes'],'sidecarRuntimeRequired':False} for l in m['assets'][0]['lods']],'validation':{'actualGLBGeometry':'pass','B-CABBudget':'pass','negativeAndPositivePythonTests':39,'actualTriangleSupport':'coplanar complete floor rectangles, continuous portal joins, 3306 vertical rays and negative real-GLB sloped-face fixture','actualPassengerAdapterTests':6,'sourceReopenReexport':'binary identical GLBs and sidecars','editableCopyProbe':'pass','actualReducedGLBCPUPreviews':4,'visualReview':'pass'},'preservedContract':['24 active pelvis anchors and camera positions, 1 lowfloor standing feet anchor','3 inward navy seats; 3 opposite stowed places not counted active; 4 forward lowfloor seats; 17 rear seats','left driver/cabinet, right unseated wheelhouse/guardrail','metre vehicle frame, doors, seat yaw and original four floor/step planes; two explicit flush portal support extensions added'],'integrationNotes':['Choose either detailed master or this derivative; never load both interiors.','Keep original hash-pinned exterior and its door animation.','Component sidecars are offline evidence; runtime does not need them. Loading them requires accounting for additional bytes.','Proxy metadata is LOD0 measured; continuous LOD switching collisions and game navigation remain untested.','1.95 m standing reference restricted to lowfloor; rear seated-only with 1.92 m headroom.','No production scripts, runtime assets or consumer code changed.'],'nextStep':'Parent integrate this directory as a separate offline candidate with its own inventory; later consumer/WebGL verification is separate.'}
 (HERE/'qa/handoff.json').write_text(json.dumps(handoff,indent=2)+'\n')
 files=[p for p in sorted(HERE.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.name!='hash-inventory.json' and not p.name.endswith('.blend1')]
 rows=[{'file':str(p.relative_to(HERE)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files];report={'schemaVersion':1,'scope':'Only runtime-candidate files. Excludes this self-referential inventory, Python caches and Blender backups. Detailed master has a separate inventory.','fileCount':len(rows),'totalBytes':sum(r['bytes'] for r in rows),'files':rows};(HERE/'qa/hash-inventory.json').write_text(json.dumps(report,indent=2)+'\n')
 assert all(sha(HERE/r['file'])==r['sha256'] and (HERE/r['file']).stat().st_size==r['bytes'] for r in rows)
 print(json.dumps({'status':'offline_complete','files':len(rows),'bytes':report['totalBytes'],'WebGL':'not_run'}))
if __name__=='__main__':main()
