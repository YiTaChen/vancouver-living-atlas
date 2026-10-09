"""Independent GLB skin, animation, bounds and inventory audit; no rendering claim."""
import json,hashlib,importlib.util,math,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('common',ROOT.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
CLIPS={'walk','idle','look','yield','guide','sit'}
def audit(file):
 d,b=c.read_glb(file);measure=c.measure_glb(file)
 assert len(d.get('skins',[]))==1 and len(d['skins'][0]['joints'])==14,'14-bone skin required'
 assert len(d['meshes'])==1 and len(d['meshes'][0]['primitives'])==1,'one opaque primitive'
 assert not d.get('images') and not d.get('textures'),'no texture cost'
 assert len(d['materials'])==1 and d['materials'][0].get('alphaMode','OPAQUE')=='OPAQUE'
 assert 1500<=measure['triangles']<=5000 and 1.55<=measure['boundsM']['size'][1]<=1.95
 assert abs(measure['boundsM']['min'][1])<1e-5,'sole datum'
 joints=d['skins'][0]['joints'];assert len(set(joints))==14 and all(0<=i<len(d['nodes']) for i in joints)
 inv=c.accessor(d,b,d['skins'][0]['inverseBindMatrices']);assert len(inv)==14
 attrs=d['meshes'][0]['primitives'][0]['attributes'];assert {'JOINTS_0','WEIGHTS_0','COLOR_0'}<=set(attrs)
 influenced=set()
 for js,ws in zip(c.accessor(d,b,attrs['JOINTS_0']),c.accessor(d,b,attrs['WEIGHTS_0'])):
  assert all(0<=j<14 for j in js),'joint range';assert all(0<=w<=1 for w in ws) and abs(sum(ws)-1)<1e-5,'normalized weights'
  influenced.update(j for j,w in zip(js,ws) if w>0)
 assert len(influenced)>=12,'skin must actually influence limbs, head and body'
 assert {a['name'] for a in d.get('animations',[])}==CLIPS,'six actions'
 for a in d['animations']:
  assert a['channels'],'empty animation'
  changed=False
  for ch in a['channels']:
   assert ch['target']['node'] in joints,'unowned animated node';sam=a['samplers'][ch['sampler']]
   times=[t[0] for t in c.accessor(d,b,sam['input'])];values=c.accessor(d,b,sam['output'])
   assert len(times)==len(values) and times[0]>=0 and all(x<y for x,y in zip(times,times[1:]))
   if ch['target']['path']=='rotation':assert all(abs(sum(x*x for x in q)-1)<1e-4 for q in values)
   if any(v!=values[0] for v in values[1:]):changed=True
  assert changed or a['name']=='sit','motion clip must contain movement'
 return measure

def validate():
 c.validate(ROOT)
 m=json.loads((ROOT/'manifest.json').read_text());assert m['runtimeChecks']['status']=='not_run'
 for a in m['assets']:
  measure=audit(ROOT/a['file']);assert measure==a['measurements']
  assert c.digest(ROOT/a['file'])==a['sha256'] and c.digest(ROOT/a['source'])==a['sourceSha256']
 previews=json.loads((ROOT/'qa/preview-evidence.json').read_text())
 assert previews['source']=='actual exported GLB reimport' and previews['runtimeWebGL']=='not_run'
 for row in previews['samples']:assert c.digest(ROOT/row['file'])==row['sha256'],'stale preview evidence'
 roundtrip=json.loads((ROOT/'qa/source-roundtrip.json').read_text())
 assert roundtrip['status']=='pass' and len(roundtrip['files'])==4
 for row in roundtrip['files']:assert c.digest(ROOT/row['file'])==row['exportHash']==row['roundtripHash'],'source reexport mismatch'
 assert len(m['assets'])==4
 return {'status':'pass','assets':4,'bonesEach':14,'clipsEach':6,'runtimeWebGL':'not_run'}
if __name__=='__main__':print(json.dumps(validate(),indent=2))
