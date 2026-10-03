"""Read-only CPU + optional independent Blender source/reimport audit of B01.

Does not generate source or exports. All geometry/costs come from actual GLB
bytes; generated manifest assertions are cross-checked against the catalog.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('package_contract',HERE.parent/'package-contract/validate.py')
c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
CAT=json.loads((HERE/'catalog.json').read_text())


def validate(root=HERE,blender_audit=False):
    root=Path(root).resolve();m=json.loads((root/'manifest.json').read_text())
    common=c.validate(root)
    c.need(m['packageId']=='rooftop-equipment' and m['schemaVersion']==1,'package identity')
    c.need(m['baseRevision']==CAT['baseRevision'],'base revision')
    c.need(m['units']=='metres' and m['coordinateSystem']['gltf']=={'up':'+Y','front':'+Z'},'axis/units contract')
    c.need(not m['textures'],'zero new maps')
    c.need([a['id'] for a in m['assets']]==[a['id'] for a in CAT['assets']],'exact three HVAC variants')
    c.need(m['provenance']['catalogSha256']==c.digest(HERE/'catalog.json'),'catalog provenance')
    c.need(m['provenance']['generatorSha256']==c.digest(HERE/'build.py'),'generator provenance')
    c.need(m['provenance']['exporterSha256']==c.digest(HERE/'export.py'),'exporter provenance')
    measurements=[]
    for a,spec in zip(m['assets'],CAT['assets']):
        c.need(a['taskId']=='B01' and [l['level'] for l in a['lods']]==[0,1],'B01 two LOD family')
        c.need(a['expectedDimensionsM']==spec['dimensionsM'] and a['dimensionToleranceM']<=.02,'target dimensions/tolerance')
        c.need(a['attachmentDatum']['planeY']==0 and a['frontAxis']=='+Z','roof contact datum')
        c.need(a['textureMode']=='shared' and a['textureCost']['uniqueTexelBytesWithMips']==0,'shared role costs')
        c.need(a['runtimeChecks']['status']=='not_run','offline-only runtime status')
        w,h,d=spec['dimensionsM'];expectedpoly=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]
        c.need(a['clearance']['footprintPolygonXZ']==expectedpoly and a['clearance']['roofExclusionMarginM']==1,'footprint and exclusions')
        c.need(a['collision']['primitives'][0]['sizeM']==spec['dimensionsM'],'collision conservative full bound')
        for lod in a['lods']:
            level=lod['level'];file=root/lod['file'];r=c.measure_glb(file);doc,bin=c.read_glb(file)
            c.need(r['triangles']<=CAT['budget']['triangles'][level] and r['geometryBytes']<=CAT['budget']['geometryBytes'][level],'B-ROOF budget')
            c.need(r['primitives']==2 and len(doc['meshes'])==1,'two material primitives, one static role mesh')
            c.need(not r['images'] and not doc.get('textures') and not doc.get('skins') and not doc.get('animations'),'no maps/rig/animations')
            c.need(r['nodeNames']==['body-shell'],'stable runtime node, references excluded')
            c.need(set(r['materialNames'])=={s['material'] for s in CAT['materials']},'semantic materials')
            c.need({b['material'] for b in a['materialBindings']}==set(r['materialNames']),'material bindings complete')
            for mat in doc['materials']:
                expected=next(s for s in CAT['materials'] if s['material']==mat['name'])
                c.need(mat['extras']['semantic_role']==expected['role'] and mat['extras']['city_surface_id']=='painted-metal','material semantic extras')
                c.need(mat.get('alphaMode','OPAQUE')=='OPAQUE' and not mat.get('doubleSided',False),'opaque single-sided roles')
                pbr=mat['pbrMetallicRoughness']
                c.need(pbr.get('baseColorFactor',[1,1,1,1])[3]==1,'opaque alpha')
                c.need(0<=pbr.get('metallicFactor',1)<=1 and 0<=pbr.get('roughnessFactor',1)<=1,'PBR factors')
            for k in range(3):
                c.need(abs(r['boundsM']['size'][k]-spec['dimensionsM'][k])<.02,'full bound target')
            c.need(abs(r['boundsM']['min'][1])<1e-6,'roof contact ground datum')
            c.need((root/lod['source']).stat().st_size<=CAT['budget']['sourceBytes'],'compressed source size target')
            c.need((root/lod['source']).read_bytes()[:4]==b'\x28\xb5\x2f\xfd','compressed zstd Blender source')
            triangles=set();count=0
            for prim in doc['meshes'][0]['primitives']:
                attrs=prim['attributes'];c.need(all(k in attrs for k in ['POSITION','NORMAL','TEXCOORD_0','TANGENT']),'UV/tangents required for future shared maps')
                pos=c.accessor(doc,bin,attrs['POSITION']);uv=c.accessor(doc,bin,attrs['TEXCOORD_0']);norm=c.accessor(doc,bin,attrs['NORMAL']);tan=c.accessor(doc,bin,attrs['TANGENT'])
                c.need(all(abs(sum(v*v for v in t[:3])-1)<.005 and abs(abs(t[3])-1)<.001 for t in tan),'unit tangent frames')
                c.need(all(abs(sum(n[k]*t[k] for k in range(3)))<.005 for n,t in zip(norm,tan)),'normal tangent orthogonal')
                inds=[i[0] for i in c.accessor(doc,bin,prim['indices'])]
                for j in range(0,len(inds),3):
                    tri=tuple(sorted(tuple(round(v,7) for v in pos[i]) for i in inds[j:j+3]))
                    c.need(tri not in triangles,'duplicate coplanar triangle');triangles.add(tri);count+=1
            r.update({'assetId':a['id'],'lod':level,'sourceBytes':(root/lod['source']).stat().st_size,'sourceSha256':c.digest(root/lod['source']),'sha256':c.digest(file),'checks':['finite indexed geometry','unit normals/tangents','no duplicate triangles','metre bounds and ground datum','2 material-role primitives','no embedded or external images','no QA references/cameras/lights']})
            measurements.append(r)
        for side in ['min','max','size']:
            c.need(all(abs(a['lods'][0]['boundsM'][side][k]-a['lods'][1]['boundsM'][side][k])<.0001 for k in range(3)),'LOD common bounds')
    adapter_file=root/'parapet-adapter.json'
    adapter_result={'status':'not_run','reason':'source-preserving reexport directory may omit optional legacy adapter'}
    if adapter_file.exists():
        adapter=json.loads(adapter_file.read_text());legacy=HERE.parent/'architecture-expansion'
        c.need(c.digest(legacy/'manifest.json')==adapter['sourceManifestSha256'],'legacy parapet manifest changed')
        old=json.loads((legacy/'manifest.json').read_text());existing=next(a for a in old['assets'] if a['id']=='modern-parapet-cap')
        c.need(existing==adapter['sourceAsset'],'legacy parapet contract preserved')
        c.need(adapter['wallThicknessM']['existing']+2*adapter['wallThicknessM']['minimumSideClearanceM']<=adapter['wallThicknessM']['insertionClearanceM'],'parapet wall insertion width')
        c.need(adapter['drainage']['fallDirectionLocal']=='+Z roof interior' and adapter['drainage']['topHeightAtOutboardM']>adapter['drainage']['topHeightAtInboardM'],'parapet drain toward roof')
        c.need(adapter['localOriginShiftM']==[0,0,-.25],'explicit legacy centre shift')
        for l in existing['lods']:
            c.need(c.digest(legacy/l['file'])==l['sha256'] and c.digest(legacy/l['source'])==l['sourceSha256'],'legacy parapet sources/exports unchanged')
            measured=c.measure_glb(legacy/l['file']);c.need(all(abs(x-y)<1e-5 for x,y in zip(measured['boundsM']['size'],[2.4,.19,.46])),'parapet measured bounds')
        adapter_result={'status':'pass','legacyManifestUnchanged':True,'insertionWidthM':.388,'wallThicknessM':.24,'drainDirection':'+Z roof interior','runtimeChecks':'not_run'}
    report={'status':'pass','scope':'offline CPU package audit','blenderAudit':'not_run','commonContract':common['status'],'parapetAdapter':adapter_result,'measurements':measurements,'runtimeChecks':{'status':'not_run','reason':'No WebGL or city runtime acceptance in this package'}}
    if blender_audit:
        with tempfile.TemporaryDirectory(prefix='rooftop-blender-audit-') as tmp:
            resultpath=Path(tmp)/'audit.json'
            proc=subprocess.run(['blender','--background','--factory-startup','--threads','2','--python-exit-code','1','--python',str(HERE/'audit_blender.py'),'--','--root',str(root),'--report',str(resultpath)],text=True,capture_output=True)
            c.need(proc.returncode==0,'Blender audit failed\n'+proc.stdout+'\n'+proc.stderr)
            report['blenderAudit']=json.loads(resultpath.read_text())
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=HERE);p.add_argument('--blender-audit',action='store_true');p.add_argument('--report',type=Path);a=p.parse_args()
    r=validate(a.root,a.blender_audit)
    if a.report:a.report.write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps(r,indent=2))
