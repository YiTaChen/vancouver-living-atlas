"""Seal completed offline evidence only after explicit reviewed-preview evidence.

This does not render, edit source, export geometry, or perform WebGL acceptance.
Rerun validation, source workflow and render/review before calling after edits.
"""
import datetime
import importlib.util
import json
from pathlib import Path
import platform
import subprocess
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('roof_validation',HERE/'validate.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)

def read(p):return json.loads((HERE/p).read_text())
def write(p,x):(HERE/p).write_text(json.dumps(x,indent=2)+'\n')

def main():
    m=read('manifest.json');audit=read('qa/validation.json');roundtrip=read('qa/source-roundtrip.json');preview=read('qa/preview-index.json');visual=read('qa/visual-review.json')
    assert audit['status']=='pass' and audit['blenderAudit']['status']=='pass'
    assert roundtrip['status']=='pass' and roundtrip['sourceEditsPreserved']
    assert visual['status']=='pass' and visual['reviewedGlbHashes']=={l['file']:l['sha256'] for a in m['assets'] for l in a['lods']}
    assert len(preview['records'])==48
    for a in m['assets']:
        for lod in a['lods']:
            assert v.c.digest(HERE/lod['file'])==lod['sha256']
            r=next(r for r in roundtrip['roundtrip'] if r['file']==Path(lod['file']).name)
            assert r['originalSha256']==lod['sha256'] and r['sourceSha256']==lod['sourceSha256']
            frames=[r for r in preview['records'] if r['assetId']==a['id'] and r['lod']==lod['level']]
            assert {(f['view'],f['condition']) for f in frames}=={('front','clear'),('side','clear'),('back','clear'),('top','clear'),('scale','clear'),('scale','overcast'),('scale','dusk'),('scale','night')}
            for f in frames:assert f['inputSha256']==lod['sha256'] and v.c.digest(HERE/f['file'])==f['sha256']
    tests=subprocess.run(['python3','-m','unittest','discover','-s',str(HERE),'-p','test_validate.py','-v'],capture_output=True,text=True)
    (HERE/'qa/tests.log').write_text(tests.stdout+tests.stderr);assert tests.returncode==0
    write('qa/test-results.json',{'status':'pass','tests':22,'failures':0,'scope':'CPU negative fixtures plus separate real Blender source workflow','log':'tests.log','logSha256':v.c.digest(HERE/'qa/tests.log')})
    for a in m['assets']:a['offlineChecks']['status']='pass'
    m['status']='offline_complete';write('manifest.json',m)
    # Final actual-byte verification after status changes.
    final=v.validate(HERE);assert final['status']=='pass'
    preview['status']='pass';preview['visualReview']='qa/visual-review.json';write('qa/preview-index.json',preview)
    write('qa/blender-audit.json',audit['blenderAudit'])
    measurements={'schemaVersion':1,'packageId':m['packageId'],'baseRevision':m['baseRevision'],'measuredAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':{'blenderVersion':audit['blenderAudit']['blenderVersion'],'cpu':next((l.split(':',1)[1].strip() for l in Path('/proc/cpuinfo').read_text().splitlines() if l.startswith('model name')),'unknown'),'platform':platform.platform(),'renderEngine':'Cycles','renderDevice':'CPU','renderThreads':2,'renderSamples':12,'webgl':'not_run'},'assets':final['measurements'],'totals':{'sourceBytes':sum(r['sourceBytes'] for r in final['measurements']),'glbTotalBytes':sum(r['bytes'] for r in final['measurements']),'geometryBytes':sum(r['geometryBytes'] for r in final['measurements']),'embeddedImageBytes':0,'uniqueTexelBytesWithMips':0,'drawPrimitivesAcrossAllSixFiles':sum(r['primitives'] for r in final['measurements'])},'costScope':'GLB geometryBytes includes container/material JSON plus geometry, excluding image payload. No GPU residency or frame-time measurement.'}
    write('qa/measurements.json',measurements)
    tracked=[str(p.relative_to(HERE)) for p in HERE.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name not in ['handoff.json']]
    handoff={'schemaVersion':1,'packageId':'rooftop-equipment','baseRevision':m['baseRevision'],'taskIds':['B01'],'assetStatus':'offline_complete','integrationStatus':'runtime_pending_webgl','webglAvailable':False,'manifest':'../manifest.json','sourceEditsPreserved':True,'offlineEvidence':['validation.json','blender-audit.json','measurements.json','source-roundtrip.json','test-results.json','preview-index.json','visual-review.json'],'runtimeChecks':{'status':'not_run','reason':'Asset-only CPU/Blender environment; no city renderer, browser sample or GPU evidence'},'intendedConsumers':['lib/city/architecture-plan.ts','lib/city/architecture-details.ts'],'replaces':['representative equipment/vent/duct descriptors, only after grouped source-selected pilot acceptance'],'existingAssetAdapter':'../parapet-adapter.json','sharedRoles':['shared-metal -> painted-metal','shared-metal-grille -> painted-metal'],'datum':'asset root centred on full curb, glTF Y=0 roof contact; attach at ground+part.height with scale [1,1,1]','knownLimitations':['Three original representative HVAC designs, no manufacturer or per-building measurements.','2.5 m high-rise first unit remains legacy fallback; never stretch this 1.10–1.40 m family to 2.5 m.','LOD1 deliberately simplifies fan openings/louvre blades into opaque distant silhouettes. HVAC is decorative, never a walkable or interactive opening.','Source and exported shared role factors are texture-free placeholders; consumer must explicitly bind/deduplicate shared painted-metal if maps are used.','Parapet adapter only: existing package unchanged, 2.4 m length repeats need authored remainder/corner/end geometry before scene acceptance.','48 previews use 640x480 and 12 CPU samples; visible Monte Carlo noise retained. Studio lights are not city weather matching.','No runtime edits, public copies, WebGL acceptance, FPS, GPU memory, production build or deployment claim.'],'nextIntegrationSteps':['Read manifest and rerun validation/source preservation workflow.','Resolve grouped source IDs/seed and flat roof profile; preserve roofBoxFits, polygon holes and higher-part exclusions.','Use full bounds plus 1 m exclusion on each side, suppress matching legacy equipment/vent/duct group, leave tall first-unit fallback.','Bind shared roles by name, preserve physical UV scale, confirm cache, instancing and resource disposal.','Pilot at most two cells, High 24 / Ultra 48 units; proposed 35/110 m LOD thresholds need measurement.','Validate parapet wall insertion thickness/drainage and corner/remainder conditions from original source.','Capture actual clear 14h / overcast 14h / dusk 19.8h / night 23h scene samples; measure frame time, draws, triangles, geometry/textures and repeated lifecycle.','Extend production isolation checks before any runtime/public promotion.'],'files':sorted(set(tracked+['qa/handoff.json']))}
    write('qa/handoff.json',handoff)
    print(json.dumps({'status':'offline_complete','assets':3,'lods':6,'previewFrames':48,'totals':measurements['totals']},indent=2))
if __name__=='__main__':main()
