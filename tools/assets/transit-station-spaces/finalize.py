"""Mark offline complete only with fresh CPU/source/render evidence."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from contract import ROOT,C,dump
from validate import validate
validate()
for p in ['qa/blender-validation.json','qa/source-edit-proof.json','qa/threshold-validation.json','qa/stored-contact-validation.json','qa/static-batching.json']:
 assert json.loads((ROOT/p).read_text())['status']=='pass',p
for record in json.loads((ROOT/'qa/blender-validation.json').read_text())['sourceRoundtrip']:
 stem=record['assetId']+'.lod'+str(record['lod']);assert C.digest(ROOT/'source'/(stem+'.blend'))==record['sourceSha256'];assert C.digest(ROOT/'exports'/(stem+'.glb'))==record['exportSha256']
for path,sha in json.loads((ROOT/'qa/threshold-validation.json').read_text())['inputGlbHashes'].items():assert C.digest(ROOT.parent/path)==sha
for report in json.loads((ROOT/'qa/static-batching.json').read_text())['results']:assert C.digest(ROOT/'exports'/report['file'])==report['batchedSha256']
stored=json.loads((ROOT/'qa/stored-contact-validation.json').read_text());assert stored['layoutSha256']==C.digest(ROOT/'station-layout.json')
for path,sha in stored['inputGlbHashes'].items():assert C.digest(ROOT/path)==sha
p=json.loads((ROOT/'qa/previews/index.json').read_text());assert p['imageCount']==14 and len(p['images'])==14
for im in p['images']:
 f=ROOT/'qa/previews'/im['file'];assert f.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
 for s in im['actualGlbSources']:assert C.digest(ROOT.parent/s['path'])==s['sha256'],s['path']
m=json.loads((ROOT/'manifest.json').read_text())
for dep in m['dependencies']:
 assert C.digest(ROOT/dep['manifest'])==dep['sha256AtLayoutBuild'], 'Dependency manifest changed: '+dep['packageId']
m['status']='offline_complete'
for a in m['assets']:
 a['offlineChecks']['status']='pass'
 for evidence in ['qa/threshold-validation.json','qa/stored-contact-validation.json','qa/static-batching.json']:
  if evidence not in a['offlineChecks']['evidence']:a['offlineChecks']['evidence'].append(evidence)
dump('manifest.json',m)
dump('qa/handoff.json',{'status':'offline_complete','integrationStatus':'runtime_pending_webgl','taskIds':['D01'],'completed':['Five original editable station/threshold modules, two LODs each','Static export batches by exact material role; platform LOD0 drops from 32 to 3 primitives while source parts, triangles and anchor transforms are preserved','Referenced transit shelter without duplication','Source-preserving reexport and actual edit-survival proof','Actual GLB dimensions, primitives, triangle and byte costs','Vehicle metadata-derived paired bus/74m rail research layouts','CPU floor/frame/alignment/clearance tests plus nine negative controls','All 16 stored threshold poses grounded from actual transformed exported bounds; 32 LOD contact checks reject old hovering and sunken poses','Deployed deck endpoints, actual vehicle-floor support, open-door separation and headroom checks; closed-door overlap proves state gate necessary','14 compact actual-GLB Cycles CPU previews, four lighting conditions, human and metric scale'],'notRun':['WebGL','geographic source placement','walk/rail attachment','D06 boarding/alighting','dynamic moving collision','GPU memory/frame-time','deployment'],'unresolved':['real stop/platform IDs and entrance/walk connection','portable threshold deck deployment motion and D06 activation remain disabled','inter-car traversal remains disabled'],'doorwayClearanceM':{'bus':2.084,'metro':2.034,'minimumTarget':2.0},'cabinFloorToOverheadM':{'bus':2.24,'metro':2.16,'minimumTarget':2.05},'researchIslandFloorHeightM':{'bus':.36,'metro':.95,'realGroundConnection':'unresolved'},'thresholdAudit':'qa/threshold-validation.json','storedContactAudit':'qa/stored-contact-validation.json','staticBatchingAudit':'qa/static-batching.json','floorGeometryLookup':'Exact floor componentRanges triangles plus imported batch-mesh ray; zero-draw anchors are not used as geometry','sourceAudit':'qa/source-audit.json','stationLayout':'station-layout.json','dependencies':['boardable-bus','boardable-metro','street-furniture-expansion'],'nextIntegration':'Choose source-backed stop/platform and local frame; attach walk/rail surfaces; audit authored thresholds and floor support before enabling boarding; preserve official route data','productionIsolation':'New package only; parent must run formal build/isolation audit','noCertificationClaim':True})
print('offline_complete; runtime_pending_webgl')
