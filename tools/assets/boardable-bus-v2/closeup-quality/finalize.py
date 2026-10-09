"""Seal only a fully measured, independently inspected offline quality package."""
import hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def main():
 m=read(HERE/'manifest.json');index=read(HERE/'qa/previews/index.json');review=read(HERE/'qa/visual-review.json')
 expected={f'{view}-{profile}.png' for profile in ['baseline-master','budget-candidate'] for view in ['cabin','seat','roof-rail']}|{f'{view}-{profile}.png' for profile in ['quality-lod0','quality-lod1'] for view in ['cabin','seat','roof-rail','front','rear']}
 assert review['status']=='pass_with_documented_limitations'
 assert {r['file'] for r in index['renders']}==expected
 assert {r['file'] for r in review['reviewedRenders']}==expected
 reviewed={r['file']:r for r in review['reviewedRenders']}
 for r in index['renders']:
  assert sha(HERE/'qa/previews'/r['file'])==r['sha256']==reviewed[r['file']]['sha256']
  for source in r['actualGLBInputs']:assert sha(HERE.parent.parent/source['file'])==source['sha256']
  assert r['samples']==(96 if r['profile'].startswith('quality-') else 48)
  assert r['denoising'] is False and r['exposure']==0
 for p in ['validation','common-validation','blender-validation']:assert read(HERE/'qa'/f'{p}.json')['status']=='pass'
 for r in read(HERE/'qa/blender-validation.json')['sourceChecks']:
  assert sha(HERE/r['source'])==r['sha256'] and r['reexportBinaryIdentical'] and r['sidecarBinaryIdentical']
 for lod in m['assets'][0]['lods']:
  assert sha(HERE/lod['file'])==lod['sha256'] and sha(HERE/lod['source'])==lod['sourceSha256']
  assert sha(HERE/lod['componentSidecar']['file'])==lod['componentSidecar']['sha256']
 assert 'Ran 41 tests' in (HERE/'qa/regression-tests.txt').read_text() and '\nOK\n' in (HERE/'qa/regression-tests.txt').read_text()
 assert 'pass 6' in (HERE/'qa/adapter-tests.txt').read_text() and 'fail 0' in (HERE/'qa/adapter-tests.txt').read_text()
 assert 'pass 8' in (HERE/'qa/default-tests.txt').read_text() and 'fail 0' in (HERE/'qa/default-tests.txt').read_text()
 m['status']='offline_quality_review_complete';m['assets'][0]['offlineChecks']['status']='pass';write(HERE/'manifest.json',m)
 index['status']='all_16_images_rendered_and_pixels_reviewed';index['comparisonRule']='Exact camera/daylight/exposure match; original profiles 48 samples, final quality profiles 96 samples; no denoising.';write(HERE/'qa/previews/index.json',index)
 files=[p for p in sorted(HERE.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.blend1','.blend2','.pyc'] and p.name!='hash-inventory.json']
 write(HERE/'qa/hash-inventory.json',{'scope':'Independent close-up-quality deliverable; no inherited assets rewritten','files':[{'file':str(p.relative_to(HERE)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],'defaultTest':{'file':'tests/bus-closeup-quality.test.mjs','sha256':sha(ROOT/'tests/bus-closeup-quality.test.mjs')}})
 print('QUALITY_FINALIZED',len(files),'files; 16 actual-GLB renders; 41 Python, 6 adapter, 8 default tests')
if __name__=='__main__':main()
