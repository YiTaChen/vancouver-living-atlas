"""Read-only package acceptance: common GLB data plus package-specific evidence."""
import json,importlib.util,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2]
s=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def read(p):return json.loads((HERE/p).read_text())
def need(v,msg):
 if not v:raise ValueError(msg)
common=c.validate(HERE);evidence=[]
for file in ['qa/adapter-preservation.json','qa/blender-audit.json','qa/source-edit-proof.json','qa/contact-kernel-tests.json','qa/driver-fit-summary.json','qa/cabin-envelope.json','qa/human-proportions.json','qa/material-composition.json']:
 d=read(file);need(d['status']=='pass',file);evidence.append(file)
for p,digest in read('qa/adapter-preservation.json')['sourceHashes'].items():need(c.digest(REPO/p)==digest,'source changed: '+p)
for lod in range(3):
 d=read(f'qa/driver-fit-lod{lod}.json');need(d['geometryContactStatus']=='pass','fit failed');p=Path(d['sourceHuman']);p=p if p.is_absolute()else REPO/p;need(p.is_file()and c.digest(p)==d['sourceHumanSha256'],'stale human fit proof');need(d['morphState'],'morph-aware final grip proof required');need(any(any(w>.99 for w in m['weights']) for m in d['morphState']),'active grip not tested')
renders=read('qa/render-evidence.json');need(len(renders)>=9,'compact full/cutaway/four-light module evidence required')
for r in renders:
 need(r['renderer']=='Cycles'and r['device']=='CPU','CPU Cycles required');need((HERE/r['file']).is_file(),'missing preview')
 if '/driver-'in r['file']:need(r.get('posedDriverBoundsGltf')and r.get('sampledMorphWeights')and all(abs(m['DriverGrip']-1)<1e-6 for m in r['sampledMorphWeights']),'rendered morph state missing')
 for i in r['inputs']:need(c.digest(REPO/i['file'])==i['sha256'],'stale render: '+r['file'])
report={'status':'pass','package':'roadster-driver-fit','common':common,'evidence':evidence,'renders':len(renders),'scope':'Static geometry/morph/contact and source-preservation only; no ergonomic, gameplay or WebGL certification'}
(HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print('ROADSTER_DRIVER_FIT_VALIDATION_PASS')
