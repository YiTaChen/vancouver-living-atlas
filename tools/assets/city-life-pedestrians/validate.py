"""Read-only package audit by default; --report records verified measurements.
No GPU, WebGL, runtime placement, gait contact, or performance acceptance implied.
"""
import argparse, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from package_utils import common, animated_bounds, primitive_data

def validate(root=ROOT):
    root=Path(root).resolve();m=json.loads((root/'manifest.json').read_text());common.validate(root)
    assert m['packageId']=='city-life-pedestrians' and len(m['assets'])==4
    assert m['status']=='offline_complete' and m['integrationStatus']=='runtime_pending_webgl'
    assert m['runtimeChecks']['status']=='not_run' and m['textures']==[]
    assert m['provenance']['generatorSha256']==common.digest(root/'build.py')
    assert m['provenance']['exporterSha256']==common.digest(root/'export.py')
    sources=json.loads((root/'qa/source-audit.json').read_text());previews=json.loads((root/'qa/preview-index.json').read_text())
    assert sources['status']=='pass' and sources['manualEditProof']['status']=='pass'
    assert sources['manualEditProof']['originalSourceUnchanged']
    assert previews['status']=='pass' and previews['source']=='actual GLB reimport' and previews['runtimeAcceptance']=='not_run'
    results=[]
    for a in m['assets']:
        assert len(a['lods'])==2 and a['animation']['states']==['walk','idle','look','yield']
        assert a['runtimeChecks']['status']=='not_run' and not a['intendedConsumer']['productionEnabled']
        pivots_by_lod=[]
        for lod in a['lods']:
            file=root/lod['file'];doc,prim,attrs=primitive_data(file);measured=common.measure_glb(file)
            assert len(doc['meshes'])==len(doc['nodes'])==len(doc['materials'])==1
            assert len(doc['meshes'][0]['primitives'])==1
            assert not doc.get('textures') and not doc.get('images') and not doc.get('skins') and not doc.get('animations')
            assert not doc.get('extensionsRequired') and not doc.get('cameras')
            mat=doc['materials'][0];assert mat.get('alphaMode','OPAQUE')=='OPAQUE'
            assert mat.get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1])[3]==1
            assert not any(k.endswith('Texture') for k in mat.get('pbrMetallicRoughness',{}))
            assert set(attrs)==set(['POSITION','NORMAL','COLOR_0','_LIMB','_PIVOT_X','_PIVOT_Y','_PIVOT_Z','_PALETTE'])
            assert 300<=lod['triangles']<=1000 if lod['level']==0 else 80<=lod['triangles']<=250
            assert abs(measured['boundsM']['min'][1])<1e-6
            assert abs(measured['boundsM']['size'][1]-a['expectedDimensionsM']['dressedHeight'])<.02
            assert 1.55<=measured['boundsM']['size'][1]<=1.95
            assert all(len(c)==3 or len(c)==4 and c[3] in (1,255,65535) for c in attrs['COLOR_0'])
            assert {int(p[0]) for p in attrs['_LIMB']}==set(range(6))
            assert all(v[0]==int(v[0]) and 0<=v[0]<=6 for v in attrs['_PALETTE'])
            pivots={}
            for i,limb in enumerate(attrs['_LIMB']):
                key=int(limb[0]);p=[attrs['_PIVOT_'+axis][i][0] for axis in 'XYZ']
                if key in pivots:assert p==pivots[key]
                pivots[key]=p
            pivots_by_lod.append(pivots)
            actual_envelope=animated_bounds(file)
            for k in ('min','max','size'):assert all(abs(x-y)<1e-7 for x,y in zip(actual_envelope[k],lod['animatedBoundsM'][k]))
            assert previews['glbSha256References'][lod['file']]==common.digest(file)
            source_record=next(r for r in sources['sources'] if r['source']==Path(lod['source']).name)
            assert source_record['sha256']==common.digest(root/lod['source']) and source_record['sourceUnchanged']
            assert source_record['candidateGlbSha256']==common.digest(file)
            assert source_record['reexportGlbSha256']==common.digest(file)
            assert (root/lod['source']).stat().st_size<20*1024**2
            results.append({'assetId':a['id'],'lod':lod['level'],'triangles':lod['triangles'],'vertices':lod['vertices'],'bytes':lod['bytes'],'retainedAttributes':list(attrs),'analyticEnvelopeVerified':True,'sourceReexportIdentical':True})
        assert pivots_by_lod[0]==pivots_by_lod[1], 'LOD pivot drift'
    for preview in previews['previews']:assert (root/preview['file']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    assert len(previews['previews'])>=3
    assert m['costSummary']['mainPassSubmissionTarget']==8
    assert m['costSummary']['worst32MediumActorTriangles']<=32000
    assert m['costSummary']['glbTotalBytes']==sum(r['bytes'] for r in results)
    return {'status':'pass','scope':'actual GLB accessor/material/triangle/bounds/hash audit, analytic gait envelope, source-preserving reexport and reimport-preview evidence; runtime tests not run','results':results,'runtimeAcceptance':'not_run'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--package',type=Path,default=ROOT);p.add_argument('--report',type=Path);a=p.parse_args()
    r=validate(a.package)
    if a.report:a.report.write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps(r,indent=2))
