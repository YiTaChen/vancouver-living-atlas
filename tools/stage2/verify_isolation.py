"""Verify reconstructed offline bytes and candidate code remain out of production.
Run after npm run build:firebase. Does not test browser network or GPU state.
"""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PACKAGES=['city-life-interactive','boardable-bus-v2','canada-line-stage2','skytrain-stations-stage2','skytrain-mark-v-interior']
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(dist=None):
 dist=Path(dist) if dist else ROOT/'dist/client';assert (dist/'index.html').is_file(),'production build required'
 protected={}
 for name in PACKAGES:
  package=ROOT/'tools/assets'/name;assert (package/'manifest.json').is_file(),f'missing package {name}'
  for subdir in ('source','exports','qa/previews','runtime-candidate/source','runtime-candidate/exports','runtime-candidate/qa/previews'):
   for f in (package/subdir).rglob('*'):
    if f.is_file() and f.suffix.lower() in ('.glb','.blend','.png'):protected[digest(f)]=str(f.relative_to(ROOT))
 emitted=list(p for p in dist.rglob('*') if p.is_file())
 for p in emitted:
  assert digest(p) not in protected,f'offline asset leaked: {p}'
  assert not p.name.endswith(('.blend','.blend1')),f'authoring source leaked: {p}'
  if p.suffix in ('.js','.mjs','.json','.html','.css','.map'):
   text=p.read_text(errors='replace')
   for token in PACKAGES+['InteractiveRendererCandidate','interactive-skin-v1']:
    assert token not in text,f'candidate code/reference leaked: {token} in {p}'
 return {'status':'pass','protectedDistinctPayloads':len(protected),'productionFiles':len(emitted),'scope':'static production artifact hashes/references, not browser/GPU verification'}
if __name__=='__main__':print(json.dumps(verify(),indent=2))
