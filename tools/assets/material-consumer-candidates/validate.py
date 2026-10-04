"""Package audit; does not rebuild authored sources or reset regression fixtures."""
import importlib.util, subprocess, json, hashlib, math, sys
from pathlib import Path
import sys
sys.dont_write_bytecode = True
P=Path(__file__).resolve().parent;ROOT=P.parents[2]
spec=importlib.util.spec_from_file_location('package_contract',P.parent/'package-contract'/'validate.py');common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    run=[]
    for command in [['node','--test',str(P/'test-consumers.mjs')],['node',str(P/'validate-consumers.mjs')],['node',str(P/'validate-furniture.mjs')]]:
        result=subprocess.run(command,cwd=ROOT,text=True,capture_output=True)
        assert result.returncode==0,result.stderr[-3000:]+result.stdout[-2000:]
        run.append({'command':' '.join(command).replace(str(ROOT)+'/', ''),'status':'pass'})
    sys.path.insert(0,str(P))
    from audit_batch import validate_ranges,negative_tests
    batching=json.loads((P/'qa'/'static-batching.json').read_text())
    assert batching['status']=='pass' and len(batching['results'])==4 and batching['originalSourceFilesUnmodified']
    for source,digest in batching['sourceHashes'].items():assert sha(P/source)==digest,'Source changed after batch audit'
    for r in batching['results']:
        assert sha(P/'exports'/r['file'])==r['batchedSha256'],'Stale binary batching audit'
        assert r['batchedPrimitives']==r['materialRoles']==2
        assert r['allOriginalNodeTransformsPreserved']
        assert all(c['indicesIdenticalAfterVertexBaseSubtraction'] and max(c['attributeMaxErrors'].values())<1e-6 for c in r['componentRanges'])
    for r in batching.get('preBatchDeliveredGLBByteIdentity',[]):
        fresh=next(x for x in batching['results'] if x['file']==r['file'])
        assert r['byteIdentical'] and r['previousDeliverySha256']==r['freshUnbatchedSha256']==fresh['unbatchedSha256']
    assert negative_tests(P/'exports/lecture-chair-module.lod0.glb')==batching['negativeTests']
    manifest=json.loads((P/'manifest.json').read_text());report=common.validate(P)
    (P/'qa'/'common-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    for asset in manifest['assets']:
        for lod in asset['lods']:
            assert (P/lod['source']).stat().st_size<=20*1024*1024
            assert lod['triangles'] <= (1000 if lod['level']==0 else 200)
            assert lod['bytes'] <= (192*1024 if lod['level']==0 else 48*1024)
            assert lod['primitives']==2
            expected={'lecture-chair-module':[440,96],'admissions-counter-module':[308,60]}
            assert lod['triangles']==expected[asset['id']][lod['level']]
            doc,binary=common.read_glb(P/lod['file']);ranges=validate_ranges(doc,binary)
            assert ranges['triangles']==lod['triangles']
            actual=[{'nodeId':n['name'],'material':doc['materials'][doc['meshes'][n['mesh']]['primitives'][0]['material']]['name'],'componentRanges':n['extras']['componentRanges']} for n in doc['nodes'] if 'mesh' in n]
            assert actual==lod['staticBatching']['batches']
            assert lod['embeddedImageBytes']==0 and not lod['images']
            assert abs(lod['boundsM']['min'][1]) < 2e-6
            assert max(abs(a-b) for a,b in zip(asset['expectedDimensionsM'],lod['boundsM']['size'])) <= asset['dimensionToleranceM']
            assert set(lod['materialNames'])==set('EXPORT_'+x['surfaceId'] for x in asset['materialBindings'])
    catalog=json.loads((P/'shared-surface-catalog.json').read_text())
    assert len(catalog['surfaces'])==8 and catalog['newMaps']==0
    for s in catalog['surfaces']:
        assert s['map_resolution']==[256,256]
        assert s['tile_metres']==(.5 if s['id'].startswith('vehicle-') else 1)
        for channel,m in s['maps'].items():
            path=(P/m['path']).resolve();assert path.is_relative_to((P.parent/'role-materials'/'exports'/'textures').resolve())
            assert sha(path)==m['sha256']
            assert m['colorSpace']==('sRGB' if channel=='basecolor' else 'Non-Color')
    assert not list((P/'exports').rglob('*.png')),'No duplicate maps in new exports'
    blender=json.loads((P/'qa'/'blender-validation.json').read_text())
    assert blender['status']=='pass' and blender['threads']==2
    for file,digest in blender['artifactHashes'].items():
        assert sha(P/file)==digest,'Stale Blender reimport evidence: '+file
    assert len(blender['sourceReopenAndGLBReimport'])==4
    assert all(r['sourceReopened'] and r['glbReimported'] for r in blender['sourceReopenAndGLBReimport'])
    assert abs(blender['editPreservation']['deltaM']-.01)<2e-6
    assert blender['editPreservation']['originalSourceUnchanged']
    assert blender['editPreservation']['actualBatchRangeVerticesMeasured'] and blender['editPreservation']['zeroDrawSeatAnchor']
    assert sha(P/'qa/edited-chair.inspection.glb')==blender['editPreservation']['editedGLBSha256']
    assert all(r['sourceUnchanged'] and r['objects']==2 for r in blender['sourceReopenAndGLBReimport'])
    for image in ['furniture-reimport.png','roadster-reimport.png','edited-chair-reimport.png']:
        path=P/'qa'/'previews'/image;assert path.is_file() and path.stat().st_size>1000
    from PIL import Image
    visual=json.loads((P/'qa/visual-review.json').read_text())
    assert len(visual['staticBatchingPreviewHashes'])==4
    for r in visual['staticBatchingPreviewHashes']:
        assert sha(P/r['file'])==r['sha256'] and r['reviewed']
        with Image.open(P/r['file']) as image:assert hashlib.sha256(image.convert('RGB').tobytes()).hexdigest()==r['rgbPixelSha256']
    coverage=json.loads((P/'qa'/'render-coverage.json').read_text())
    assert coverage['status']=='pass' and coverage['renderCount']==24
    for a in manifest['assets']:
        aid=a['id']
        for lod in [0,1]:
            assert set(r['view'] for r in coverage['renders'] if r['assetId']==aid and r['lod']==lod and r['view']!='perspective')=={'front','side','back','top'}
        assert set(r['lighting'] for r in coverage['renders'] if r['assetId']==aid and r['view']=='perspective')=={'clear','overcast','dusk','night'}
    for sheet in coverage['contactSheets']:
        assert sha(P/sheet['file'])==sheet['sha256']
    for render in coverage['renders']:
        assert sha(P/render['sourceGLB'])==render['sourceGLBSha256']
        x,y,w,h=render['pixelRectangle']
        with Image.open(P/render['sheet']) as image:
            pixels=image.convert('RGB').crop((x,y,x+w,y+h)).tobytes()
        assert hashlib.sha256(pixels).hexdigest()==render['rgbPixelSha256']
    result={'status':'pass' ,'checks':run,'commonContract':'pass','renderCoverage':{'renders':24,'views':['front','side','back','top'],'lighting':['clear','overcast','dusk','night'],'lods':[0,1],'contactSheetPixelVerification':'pass'},'staticMaterialBatching':{'status':'pass','primitivesPerLOD':2,'exactComponentRanges':'pass','sourceGeometryUVNormalsMaterialsAndTransformsEquivalent':'pass','negativeTests':len(batching['negativeTests']),'evidence':'qa/static-batching.json'},'sourceAndLODCount':4,'newAssets':2,'newMaps':0,'sourceEditPreservation':'pass','runtime':'not_run','scope':'Offline consumer candidates, furniture source/export, source regression and shared map contracts only; no active PBR/gameplay/WebGL acceptance.'}
    (P/'qa'/'validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
