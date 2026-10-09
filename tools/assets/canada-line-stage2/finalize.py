"""Seal only checked offline evidence; runtime capability remains explicitly pending."""
import json,sys,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from validate import validate_manifest,common

def read(p):return json.loads((ROOT/p).read_text())
def write(p,x):(ROOT/p).write_text(json.dumps(x,indent=2)+'\n')
m=read('manifest.json');validation=validate_manifest(m);common_report=common.validate(ROOT);source=read('qa/source-roundtrip.json');render=read('qa/render-report.json');visual=read('qa/visual-review.json')
assert source['status']=='pass' and source['editProof']['status']=='pass' and len(source['sources'])==5
for r in source['sources']:
 assert r['byteIdentical'] and r['sourceUnchanged']
 assert r['sourceSha256']==common.digest(ROOT/'source'/r['source'])
 assert r['deliveredSha256']==common.digest(ROOT/'exports'/r['output'])
assert render['status']=='rendered' and len(render['renders'])==11
for r in render['renders']:
 assert (ROOT/'qa'/r['file']).is_file()
 for p,h in r['sourceGlbSha256'].items():assert common.digest(ROOT/p)==h
assert visual['status']=='reviewed' and set(visual['reviewedImages'])=={r['file'] for r in render['renders']}
for p,h in visual['previewSha256'].items():assert common.digest(ROOT/'qa'/p)==h
log=(ROOT/'qa/tests.log').read_text();assert 'Ran 19 tests' in log and log.rstrip().endswith('OK')
m['status']='offline_complete';m['offlineChecks']={'status':'passed','validation':'qa/validation.json','commonPackaging':'qa/common-validation.json','sourceRoundtrip':'qa/source-roundtrip.json','visualReview':'qa/visual-review.json','tests':'qa/tests.log'}
for a in m['assets']:a['offlineChecks']={'status':'passed','evidence':'qa/validation.json','sourceAndRenderEvidence':'qa/source-roundtrip.json; qa/render-report.json'}
write('manifest.json',m);write('qa/validation.json',validation);write('qa/common-validation.json',common.validate(ROOT))
files=[ROOT/'manifest.json',ROOT/'references/source-review.json',*sorted((ROOT/'source').glob('*.blend')),*sorted((ROOT/'exports').glob('*.glb')),*sorted((ROOT/'qa/previews').glob('*.png'))]
write('qa/artifact-hashes.json',{'status':'pass','algorithm':'SHA-256','files':{str(p.relative_to(ROOT)):common.digest(p) for p in files}})
write('qa/handoff.json',{'status':'offline_complete','baseRevision':m['baseRevision'],'packageId':m['packageId'],'profileId':m['composition']['profileId'],'deliveredSources':5,'deliveredGLBs':5,'actualConsistLengthM':validation['measuredConsistLengthM'],'referenceReview':'references/source-review.json','sourceReexportsByteIdentical':5,'negativeAndPositiveTests':19,'previewCount':11,'renderer':'Cycles CPU, 32 samples, no denoise (this build lacks OpenImageDenoise)','runtimeChecks':m['runtimeChecks'],'hostedCI':'not_run','integrationNotes':['Use own Canada profile and stop alignment; do not map Expo doors.','Car02 local left/right becomes opposite consist side after yaw pi.','LOD2 cannot board or carry passengers.','Interior and exterior share car root rail datum; floor1.10m.','No free intercar traversal until seam/moving collision validation.','Station terrain openings, all runtime journeys, compatible/desktop/touch, lifecycle/performance remain not_run.'],'scope':'No app, workflow, package manager, old assets, merge or deployment changes.'})
print('PASS: 5 editable sources, 5 GLBs, 11 hash-linked CPU renders, 19 tests; runtime pending.')
