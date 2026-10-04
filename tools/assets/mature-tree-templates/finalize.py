"""Promote offline status only after fresh source, export, renderer and visual evidence all agree."""
import json,hashlib,importlib.util
from pathlib import Path
from PIL import Image
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)

def main():
    manifest=json.loads((HERE/'manifest.json').read_text());common=c.validate(HERE);reports={}
    for name in ['validation','blender-audit','source-roundtrip','source-edit-safety','preview-index','visual-review','broadleaf-revision']:
        reports[name]=json.loads((HERE/'qa'/f'{name}.json').read_text());assert reports[name]['status']=='pass',name
    reviewed={row['file']:row['sha256'] for row in reports['visual-review']['reviewedImages']}
    index=reports['preview-index'];assert index['renderer']=='Blender Cycles CPU' and index['threads']==2 and index['samples']==24
    assert len(index['previews'])==8 and len(index['glbSha256References'])==12
    for asset in manifest['assets']:
        for lod in asset['lods']:
            assert index['glbSha256References'][lod['file']]==lod['sha256']
            record=next(r for r in reports['source-roundtrip']['records'] if r['assetId']==asset['id'] and r['lod']==lod['level']);assert record['glbSha256']==lod['sha256'] and record['savedSourceUnchanged'] and record['glbByteIdentical']
            assert (HERE/lod['source']).stat().st_size<=20*1024*1024
        asset['offlineChecks']={'status':'pass','scope':'editable Blender source, true source-preserving reexport/edit test, actual GLB reimport, CPU UV/alpha/dimensions/roles/cost, Cycles CPU previews and alpha-aware silhouette checks','evidence':['qa/validation.json','qa/common-validation.json','qa/blender-audit.json','qa/source-roundtrip.json','qa/source-edit-safety.json','qa/preview-index.json','qa/visual-review.json','qa/tests.log']}
    assert reports['source-edit-safety']['originalSourceSha256']==manifest['assets'][0]['sourceSha256']
    for r in index['previews']:
        p=HERE/r['file'];assert p.is_file();assert reviewed[r['file']]==c.digest(p),'stale visual review';image=Image.open(p);assert image.size[0]>=1000 and image.size[1]==660;r['sha256']=c.digest(p);r['pixels']=list(image.size)
    (HERE/'qa/preview-index.json').write_text(json.dumps(index,indent=2)+'\n')
    manifest['visualSuitability']={'nearBroadleaf':'offline_pass: no opaque LOD0 crown blobs','photorealism':'not_claimed','runtime':'not_run'}
    manifest['status']='offline_complete';manifest['runtimeStatus']='runtime_pending_webgl';(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (HERE/'qa/common-validation.json').write_text(json.dumps(common,indent=2)+'\n')
    validation=reports['validation'];handoff={'taskId':'B03','packageId':'mature-tree-templates','offlineStatus':'offline_complete','runtimeStatus':'runtime_pending_webgl','delivered':{'species':4,'editableBlenderSources':12,'ordinaryExternalTextureGLBs':12,'cyclesCpuViews':8,'cpuSilhouetteBoards':4,'uniqueRuntimePngs':4},'sourceRevision':manifest['baseRevision'],'packageVersion':manifest['version'],'nearBroadleafVisualSuitability':'offline_pass; opaque blobs removed and actual reimport render reviewed','requiredScaling':{'templateHeightM':10,'formula':'sourceHeightM / 10','example22_9m':2.29,'barkUvMultiplier':'same sourceHeightM/10 per instance, bark only; keep leaf atlas UV unchanged'},'candidateTextureRgba8FullMipsBytes':manifest['textureBudget']['candidateTotalBytesWithMips'],'maxActualRadiusM':max(a['maximumCrownRadiusM'] for a in validation['assets']),'worstCpuLodSilhouetteIoU':min(p['intersectionOverUnion'] for p in validation['lodProjections']),'integrationEntrypoint':['lib/city/detailed-trees.ts','lib/city/assets/tree-geometry.ts','lib/city/assets/tree-structure.ts','lib/city/tree-road-clearance.ts'],'runtimeNotTested':['WebGL color/depth/shadow alpha parity','authored mip upload or automatic mip needle retention','10/30/65m and grazing-angle city comparison','LOD transition quality','source-specific terrain/road clearance and collision','instancing/source population cap','texture dedup/cache/disposal','GPU time, overdraw and resident memory'],'importantLimitations':['Representative procedural species envelopes, not botanical scans.','LOD1 retains sampled cluster IDs but deterministic envelope adjustment changes centres; trunk and primary scaffolds are stable.','LOD2 is a coarse closed crown proxy, unsuitable for close viewing.','Near broadleaf opacity blobs are removed; conifers and lower LODs remain stylized. Offline approval is not a claim of full realism or improved city imagery.','Near broadleaf inner/outer layers now share MASK coverage; added alpha-tested surface overlap needs GPU overdraw measurement.','All candidate maps count toward 6.333 MiB; reuse from an offline library is not existing production residency.','Five authored leaf mip PNGs are not embedded or automatically consumed by ordinary GLBs.'],'productionChanges':False,'publicChanges':False,'commitCreated':False,'evidence':['qa/validation.json','qa/common-validation.json','qa/measurements.json','qa/blender-audit.json','qa/leaf-cluster-bounds.json','qa/texture-derivation.json','qa/source-roundtrip.json','qa/source-edit-safety.json','qa/tests.log','qa/preview-index.json','qa/visual-review.json','qa/broadleaf-revision.json']}
    (HERE/'qa/handoff.json').write_text(json.dumps(handoff,indent=2)+'\n');print('MATURE_TREE_OFFLINE_COMPLETE')
if __name__=='__main__':main()
