"""Require final-input hashes and image-file integrity for every delivered CPU view."""
import hashlib,json,math
from pathlib import Path
from PIL import Image,ImageStat
HERE=Path(__file__).resolve().parent
EXPECTED={'01-aisle-toward-gangway.png','02-seats-door-detail.png','04-gangway-return.png','05-aisle-lod1.png','06-open-gangway-continuity.png'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 manifest=json.loads((HERE/'manifest.json').read_text());inputs={l['file']:l['sha256'] for a in manifest['assets'] for l in a['lods']};index=json.loads((HERE/'qa/previews/index.json').read_text());rows=index['renders'];assert {r['file'] for r in rows}==EXPECTED,'exact final view set required'
 checked=[]
 for r in rows:
  p=HERE/'qa/previews'/r['file'];assert sha(p)==r['sha256'],'image SHA mismatch';assert sha(HERE/r['inputGLB'])==r['inputSha256']==inputs[r['inputGLB']],'stale preview GLB identity'
  assert r['renderer']=='Cycles CPU' and r['geometryRemoved'] is False and r['materialOverrides'] is False and r['runtimeWebGL'] is False
  assert 1.45<=r['eyeM'][1]<=1.80,'non-human standing eye height';im=Image.open(p).convert('RGB');assert list(im.size)==r['resolution'];std=ImageStat.Stat(im).stddev;assert max(std)>10,'uniform/unusable preview'
  if r['file'] in ['01-aisle-toward-gangway.png','05-aisle-lod1.png']:assert r['sceneScope'].startswith('Isolated A-car: no adjacent cabin;')
  if r['file']=='06-open-gangway-continuity.png':
   ctx=r['qaContext'];assert ctx['sourceGLB']==r['inputGLB'] and ctx['sourceSha256']==r['inputSha256'];assert ctx['notCcarReconstruction'] and ctx['notFullConsist'];assert ctx['geometryEdited'] is False;assert ctx['glTFTransform']['translationM']==[0,0,-17.07] and ctx['glTFTransform']['rotationYRadians']==math.pi
   proof=json.loads((HERE/'qa/adjacent-context-validation.json').read_text());assert proof['status']=='pass' and proof['blockingTriangles']==0 and proof['floorSupportProbes']==387;assert proof['sourceSha256']==r['inputSha256'] and proof['rendererScriptSha256']==sha(HERE/'qa_blender.py')
  checked.append({'file':r['file'],'imageSha256':r['sha256'],'inputSha256':r['inputSha256'],'pixelSize':list(im.size),'eyeHeightM':r['eyeM'][1]})
 report={'status':'pass','scope':'image integrity and exact final GLB provenance; human visual review is separate','views':checked,'runtime':'not_run'};(HERE/'qa/preview-integrity.json').write_text(json.dumps(report,indent=2)+'\n');print('Final preview integrity: pass')
if __name__=='__main__':main()
