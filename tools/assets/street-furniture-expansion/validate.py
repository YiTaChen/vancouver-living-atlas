"""CPU acceptance: never promotes a package with missing render/reopen/edit evidence."""
import json,hashlib,importlib.util,struct,platform,sys,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)

def check(root=HERE,write=True):
    m=json.loads((root/'manifest.json').read_text());common=c.validate(root);results=[]
    for a in m['assets']:
        assert len(a['lods'])==2 and [l['level'] for l in a['lods']]==[0,1]
        for l in a['lods']:
            r=c.measure_glb(root/l['file']);doc,binary=c.read_glb(root/l['file']);level=l['level'];caps=a['lodPolicy']
            assert r['triangles']<=caps['triangleCaps'][level],a['id']+' triangle budget'
            assert r['geometryBytes']<=caps['geometryByteCaps'][level],a['id']+' byte budget'
            assert r['embeddedImageBytes']==0 and not r['images']
            assert (root/l['source']).stat().st_size<=20*1024*1024
            assert abs(r['boundsM']['min'][1])<.0001
            for side in ['min','max','size']:
                assert all(abs(r['boundsM'][side][i]-a['boundsM'][side][i])<=.02 for i in range(3)),a['id']+' LOD envelope'
            for i,key in enumerate(['width','height','depth']):assert abs(r['boundsM']['size'][i]-a['expectedDimensionsM'][key])<=.02,a['id']+' target dimensions'
            roles={b['role'] for b in a['materialBindings']};assert set(r['materialNames'])==roles
            assert set(r['nodeNames'])==roles and len(r['nodeNames'])==len(roles),r['nodeNames']
            assert r['primitives']==len(roles),'per-role material batching'
            assert not doc.get('images') and not doc.get('textures') and not doc.get('animations') and not doc.get('skins')
            for mesh in doc['meshes']:
                for p in mesh['primitives']:assert all(k in p['attributes'] for k in ['POSITION','NORMAL','TEXCOORD_0','TANGENT'])
            for mat in doc['materials']:
                if mat['name']=='glass':assert mat.get('alphaMode')=='BLEND' and mat.get('doubleSided') is True
                else:assert mat.get('alphaMode','OPAQUE')=='OPAQUE' and not mat.get('doubleSided',False)
            results.append({'id':a['id'],'lod':level,**{k:r[k] for k in ['boundsM','triangles','vertices','primitives','bytes','geometryBytes','embeddedImageBytes']}})
        assert a['placementCompatibility']['noRandomPopulationIncrease'] and not a['placementCompatibility']['nonuniformScaleAllowed']
        assert a['runtimeChecks']['status']=='not_run' and a['runtimeChecks']['state']=='runtime_pending_webgl'
    assert len(m['assets'])==8 and len(common['results'])==16
    qa=root/'qa'
    for name in ['blender-audit.json','artist-edit.json','source-roundtrip.json','preview-index.json']:
        data=json.loads((qa/name).read_text());assert data['status']=='pass',name
    reopen=json.loads((qa/'source-roundtrip.json').read_text());assert len(reopen['records'])==16
    for r in reopen['records']:
        assert r['sourceSha256']==c.digest(root/'source'/(r['id']+'.blend')) and r['glbSha256']==c.digest(root/'exports'/(r['id']+'.glb'))
    rendered=json.loads((qa/'preview-index.json').read_text());assert rendered['renderCount']==88 and rendered['device']=='CPU' and rendered['threads']==2
    for sheet in rendered['sheets']:
        p=root/sheet['file'];assert c.digest(p)==sheet['sha256'];raw=p.read_bytes();assert raw.startswith(b'\x89PNG\r\n\x1a\n');assert max(struct.unpack_from('>II',raw,16))<=1280
        for r in sheet['renders']:assert r['glbSha256']==c.digest(root/'exports'/f"{r['assetId']}.lod{r['lod']}.glb")
    assert len(rendered['sheets'])==16
    for aid in [a['id'] for a in m['assets']]:
        rs=[r for s in rendered['sheets'] if s['assetId']==aid for r in s['renders']]
        assert all(any(r['lod']==lod and r['view']==v for r in rs) for lod in [0,1] for v in ['front','side','rear','top'])
        assert {r['lighting'] for r in rs}=={'sunny','overcast','dusk','night'}
    visual=json.loads((qa/'visual-review.json').read_text());assert visual['status']=='pass' and len(visual['assetsReviewed'])==8
    for f in visual['reviewedSheets']:assert c.digest(root/f['file'])==f['sha256']
    proposal=json.loads((root/'placement-proposal.json').read_text());assert proposal['populationDelta']==0 and not proposal['activePlacements'] and not proposal['worldXYZOverrides']
    subprocess.run([sys.executable,str(root/'test_placement.py')],check=True,capture_output=True)
    measurements={'schemaVersion':1,'packageId':m['packageId'],'environment':{'python':platform.python_version(),'platform':platform.platform(),'blender':m['provenance']['blenderVersion'],'renderDevice':'Cycles CPU','renderThreads':2},'assets':results,'totals':{'glbBytes':sum(r['bytes'] for r in results),'geometryBytes':sum(r['geometryBytes'] for r in results),'embeddedImageBytes':0,'sourceBytes':sum((root/l['source']).stat().st_size for a in m['assets'] for l in a['lods']),'uniqueTexelBytesWithMips':0,'glbCount':16,'sourceCount':16},'accounting':'Geometry bytes includes GLB JSON and buffer padding. Untextured semantic PBR roles; 0 new maps, not measured GPU VRAM.'}
    report={'status':'pass','packageId':m['packageId'],'assetCount':8,'lodCount':16,'checks':{'commonContract':'pass','sourceHashAndReopen':'pass','sourcePreservingReexport':'pass','actualArtistEdits':'pass','dimensionAndGroundDatum':'pass','lodEnvelope':'pass','triangleAndByteBudgets':'pass','semanticRoleAndUvTangents':'pass','glassAndDiffuserSemantics':'pass','geometryClearanceRays':'pass','exactDuplicateTriangleTest':'pass','placementFixtures':'pass (13 tests)','cyclesCpuActualGlb88Renders':'pass','visualReview':'pass'},'runtime':'not_run','integrationStatus':'runtime_pending_webgl','limitations':['Clearance sampled using CPU rays and simple conservative proxies; not legal accessibility certification.','Not a city WebGL placement/performance/render validation.','No source-selected props enabled; proposed F02 slots remain empty.','Only untextured Principled semantic role materials accepted by exporter.']}
    if write:(qa/'measurements.json').write_text(json.dumps(measurements,indent=2)+'\n');(qa/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
if __name__=='__main__':print(json.dumps(check(),indent=2))
