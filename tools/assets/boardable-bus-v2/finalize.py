"""Seal an already-reviewed offline package; never generates a visual-review pass."""
import hashlib, json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def main():
 m=read(HERE/'manifest.json');review=read(HERE/'qa/visual-review.json');index=read(HERE/'qa/previews/index.json')
 assert review['status']=='pass_with_documented_limitations'
 expected={r['file']:r for r in index['renders']};actual={r['file']:r for r in review['reviewedRenders']};assert set(expected)==set(actual) and len(actual)==9
 for name,r in expected.items():
  assert sha(HERE/'qa/previews'/name)==r['sha256']==actual[name]['sha256']
  for source in r['actualGLBInputs']:assert sha(HERE.parent/source['file'])==source['sha256']
 for name in ['validation','common-validation','blender-validation']:assert read(HERE/'qa'/f'{name}.json')['status']=='pass'
 for source in read(HERE/'qa/blender-validation.json')['sourceChecks']:assert sha(HERE/source['source'])==source['sourceSha256'] and source['binaryIdentical']
 assert 'Ran 23 tests' in (HERE/'qa/bus-v2-regression-tests.txt').read_text() and '\nOK\n' in (HERE/'qa/bus-v2-regression-tests.txt').read_text()
 text=(HERE/'qa/bus-v2-adapter-tests.txt').read_text();assert 'pass 6' in text and 'fail 0' in text
 m['status']='offline_complete';m['assets'][0]['offlineChecks']['status']='pass';write(HERE/'manifest.json',m)
 index['status']='rendered_and_pixels_reviewed';index['visualReview']='../visual-review.json';write(HERE/'qa/previews/index.json',index)
 handoff={'status':'offline_asset_reconstruction_complete','date':'2026-10-09','baseRevision':m['baseRevision'],'runtimeIntegration':'pending','WebGL':'not_run','nightLighting':'deferred_not_implemented','seatCount':len(m['vehicles'][0]['seats']),'standingAnchorCount':len(m['vehicles'][0]['standingRegions']),'compositionHelper':'compose.mjs','adapterTests':'../../../tests/bus-v2.test.mjs','lods':[{k:l[k] for k in ['level','triangles','vertices','primitives','bytes','sourceBytes','sha256','sourceSha256']} for l in m['assets'][0]['lods']],'limitations':read(HERE/'qa/validation.json')['knownLimitations'],'budgetStatus':'over_B-CAB_limits_optimization_pending','budgetEvidence':'qa/budget-review.json','rearPreservationEvidence':'qa/front-correction-provenance.json','thirdPartyPhotoBinariesIncluded':False,'existingAssetsModified':False,'cpuRendersReviewed':9,'pythonTestsPassed':23,'realAdapterTestsPassed':6,'sourceReexportsBinaryIdentical':True,'gitPublication':'Parent task owns commit/push; this worker did not commit or push.'}
 write(HERE/'qa/handoff.json',handoff)
 files=[p for p in sorted(HERE.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.blend1','.blend2','.pyc'] and not {'references','runtime-candidate'}.intersection(p.relative_to(HERE).parts) and p!=HERE/'qa/inventory.json']
 write(HERE/'qa/inventory.json',{'date':'2026-10-09','scope':'This reconstructed package only; no third-party photos or temporary logs','files':[{'file':str(p.relative_to(HERE)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],'externalTest':{'file':'tests/bus-v2.test.mjs','bytes':(ROOT/'tests/bus-v2.test.mjs').stat().st_size,'sha256':sha(ROOT/'tests/bus-v2.test.mjs')}})
 print(json.dumps(handoff,indent=2))
if __name__=='__main__':main()
