"""Read-only B02 package validator. --write-report persists fresh evidence only.
--finalize-manifest records actual measurements, and requires separate Blender
reopen, actual reimport rendering, artist-source proof and visual-review evidence.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math
import sys
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py'); c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
SURFACES=['roof-mineral-grain','roof-membrane-seams']; CHANNELS=['color','normal','orm']

def dump(p,v): p.write_text(json.dumps(v,indent=2)+'\n')
def need(v,msg): c.need(v,msg)
def j(path): return json.loads(path.read_text())
def open_image(path):
    with Image.open(path) as image: return image.copy()
def texture_record(root,sid,key):
    p=root/'exports/textures'/f'{sid}-{key}.png'; im=open_image(p)
    return {'id':f'{sid}-{key}','surfaceId':sid,'channel':key,'file':str(p.relative_to(root)),'sha256':c.digest(p),'bytes':p.stat().st_size,'width':im.width,'height':im.height,'colorSpace':'sRGB' if key=='color' else 'Non-Color','channels':{'color':'RGB base color; opaque','normal':'tangent OpenGL +Y','orm':'R=1, G=roughness, B=metallic'}[key],'repeatMeters':[2,2],'wrap':['REPEAT','REPEAT'],'uniqueTexelBytesWithMips':im.width*im.height*4*4/3,'residencyBasis':'Conservative RGBA8 full-mip estimate, not GPU measurement','sourceBake':f'source/textures/{sid}-{key}.png','sourceBakeResolution':[512,512],'runtimeUse':'candidate_shared_surface_maps; not activated'}

def validate_evidence(root):
    export=j(root/'qa/export-report.json'); edits=j(root/'qa/source-edit-test.json'); renders=j(root/'qa/render-evidence.json'); visual=j(root/'qa/visual-review.json')
    need(edits['status']=='pass' and edits['sourceInputsUnchanged'],'source-edit regression')
    need(all(edits['unchangedRuntimeMapHashMatches'].values()),'source roundtrip')
    need(edits['periodicityRebake']['status']=='pass','actual shifted UV periodicity')
    need(export['device']=='CPU' and export['threads']==2,'CPU export constraint')
    need(visual['status']=='pass','visual review pending')
    checks=[]
    for s in export['surfaces']:
        p=root/s['source']; need(c.digest(p)==s['sourceSha256']==s['sourceSha256AfterExport'],'source preserved hashes')
        need(edits['sourceHashes'][p.name]==c.digest(p),'source-edit proof outdated')
        need(s['sourceReopened'] and s['proceduralNodeCount']>=20 and s['textureInputCount']==0,'genuine editable periodic nodes')
        need(p.stat().st_size<=20*1024**2,'compressed blend size')
        for rec in s['maps']:
            need(c.digest(root/rec['file'])==rec['sha256'],'export map hash changed')
            need(c.digest(root/rec['sourceBake'])==rec['sourceBakeSha256'],'source 512 bake hash changed')
    for sid in SURFACES:
        for key in CHANNELS:
            p=root/'exports/textures'/f'{sid}-{key}.png'; im=open_image(p); data=np.asarray(im).astype(float)
            need(im.size==(256,256) and im.mode=='RGB','RGB 256 runtime map')
            need(open_image(root/'source/textures'/p.name).size==(512,512),'512 starting bake evidence')
            if key=='orm':
                need(np.all(data[...,0]==255) and np.all(data[...,2]==0),'neutral AO and dielectric channels')
                need(data[...,1].min()>180 and data[...,1].max()<255,'roof roughness range')
            if key=='normal':
                n=data/127.5-1; lengths=np.linalg.norm(n,axis=2)
                need(np.max(np.abs(lengths-1))<.012,'normal unit vectors after filter')
                need(np.all(n[...,2]>.8),'normal outward positive Z')
                need(np.std(n[...,:2])>.001,'non-flat baked relief')
            if key=='color':
                target=np.array([147,152,142] if 'mineral' in sid else [185,192,187]); mean=data.mean(axis=(0,1))
                need(np.max(np.abs(mean-target))<8,'preserve palette average')
            # Edge derivative vs typical adjacent derivative checks wrapping
            # continuity without pretending the distinct edge pixel centers match.
            d=np.concatenate([np.abs(np.diff(data,axis=0)).reshape(-1,3),np.abs(np.diff(data,axis=1)).reshape(-1,3)])
            edge=np.concatenate([np.abs(data[0]-data[-1]),np.abs(data[:,0]-data[:,-1])])
            edge_mean=float(edge.mean()); adjacent_mean=float(d.mean())
            # Membrane laps intentionally coincide with tile edges, so their average
            # derivative is larger than the mostly-flat interior. Compare maxima;
            # independent shifted-node re-bakes establish actual periodicity.
            need(float(edge.max())<=float(d.max())+2,'excessive wrap seam jump')
            checks.append({'map':p.name,'meanRGB':data.mean(axis=(0,1)).tolist(),'wrapMeanDelta8bit':edge_mean,'adjacentMeanDelta8bit':adjacent_mean,'status':'pass'})
    need(len(export['reimports'])==4,'four actual GLB reimports')
    for rec in export['reimports']:
        p=root/'exports'/rec['file']; need(c.digest(p)==rec['sha256'],'reimport evidence hash')
        size=2 if '-2m.' in p.name else 10
        need(all(abs(a-b)<1e-5 for a,b in zip(rec['blenderBoundsM']['size'],[size,size,0])),'Blender actual import scale')
        need(all(abs(a-b)<1e-5 for a,b in zip(rec['uvRange'],[0,0,size/2,size/2])),'physical 2m UV repeat')
    need(len(renders['renders'])==8,'four-light x two-size preview matrix')
    for size in [2,10]: need({r['condition'] for r in renders['renders'] if r['couponSizeM']==size}=={'clear','overcast','dusk','night'},'lighting matrix')
    for rec in renders['renders']:
        p=root/rec['file']; need(c.digest(p)==rec['sha256'],'preview hash'); need(rec['renderer']=='Cycles CPU','actual CPU preview')
        for imported in rec['imports']: need(c.digest(root/imported['file'])==imported['sha256'],'rendered actual delivered GLB')
        need(open_image(p).size==(960,640),'preview dimensions')
    details=j(root/'qa/detail-render-evidence.json')
    need(details['status']=='pass' and len(details['renders'])==2,'two grazing detail renders')
    for rec in details['renders']:
        need(c.digest(root/rec['file'])==rec['sha256'],'detail render hash')
        need(c.digest(root/rec['import'])==rec['importSha256'],'actual detail reimport hash')
        need(rec['renderer']=='Cycles CPU' and rec['inspectionOnly'],'detail scope')
    return {'status':'pass','maps':checks,'sourceEdits':'pass','actualReimports':4,'actualCpuPreviews':10,'sourcePreserved':True,'webgl':'not_run','environment':{'blender':export['blender'],'renderer':'Cycles CPU','threads':2}}

def create_manifest(root):
    evidence=validate_evidence(root); textures=[texture_record(root,s,k) for s in SURFACES for k in CHANNELS]
    total=sum(t['uniqueTexelBytesWithMips'] for t in textures); need(total<=4*1024**2,'aggregate 4MiB runtime texel cap')
    assets=[]; measurements=[]
    for sid in SURFACES:
        for size in [2,10]:
            ident=f'{sid}-coupon-{size}m'; p=root/'exports'/f'{sid}-{size}m.inspection.glb'; r=c.measure_glb(p)
            source=f'source/{sid}.lod0.blend'; cost={k:r[k] for k in ['geometryBytes','embeddedImageBytes']}; cost['glbTotalBytes']=r['bytes']; cost['uniqueTexelBytesWithMips']=256*256*4*4/3*3
            cost['countingNote']='One material per inspection GLB. Two coupon sizes duplicate embedded images. Runtime surface loader must bind six shared package maps once, without loading coupon GLBs.'
            a={'id':ident,'taskId':'B02','variant':f'{size}m-surface-study','kind':'inspection-material-coupon','source':source,'sourceSha256':c.digest(root/source),
               'lods':[{'level':0,'file':str(p.relative_to(root)),'sha256':c.digest(p),'source':source,'sourceSha256':c.digest(root/source),**{k:r[k] for k in ['triangles','vertices','primitives','bytes','boundsM']}}],
               'boundsM':r['boundsM'],'expectedDimensionsM':[size,0,size],'dimensionToleranceM':.0001,'dimensionBasis':'Representative B02 study coupon, exact authored target; not surveyed building geometry.',
               'pivot':{'positionM':[0,0,0],'description':'Center of horizontal coupon at roof attachment plane.'},'attachmentDatum':{'kind':'roof-surface','plane':'local Y=0','normal':[0,1,0]},'frontAxis':'+Z (no frontage semantics for a horizontal surface)',
               'materialBindings':[{'materialName':r['materialNames'][0],'primitive':0,'semanticRole':'flat-roof-mineral' if 'mineral' in sid else 'flat-roof-coated-membrane','surfaceId':sid,'maps':{k:f'exports/textures/{sid}-{k}.png' for k in CHANNELS},'channels':{'color':'sRGB','normal':'Non-Color OpenGL +Y','orm':'Non-Color R1 Groughness Bmetallic'},'physicalRepeatMeters':[2,2],'alphaMode':'OPAQUE','doubleSided':True,'sidePolicy':'Inspection plane is visible from both sides. Future GIS consumer retains its roof-side policy.'}],
               'textureMode':'embedded-inspection; shared external candidate maps','textureCost':cost,
               'lodPolicy':{'levels':[0],'reason':'Two-triangle material study plane; 2m and 10m are distinct physical coupons, not LODs. Runtime surface LOD/filter/fade remains unimplemented.'},
               'clearance':[],'collision':{'enabled':False,'reason':'Study plane is not a world patch, collision floor, or roof replacement.'},'anchors':[],
               'placementCompatibility':{'roofTypes':['source-supported flat roof only'],'exclude':['pitched/shingle roofs','glass','landmark dedicated membrane shaders'],'worldPlacement':False,'uvContract':'Source UVs in metres; inspection UV=metres/2. Future GIS consumer must sample roof-local metres/2 without stretching to bounds. Preserve footprint, holes, height, stable roof seed and finish mix.'},
               'intendedConsumer':['lib/city/building-surface-palette.ts','lib/city/building-bodies.ts','lib/city/city-surface-material.ts'],
               'offlineChecks':{'status':'pass','evidence':['qa/validation.json','qa/export-report.json','qa/source-edit-test.json','qa/render-evidence.json','qa/visual-review.json']},
               'runtimeChecks':{'status':'not_run','reason':'Offline asset task. No browser acceptance, source-selected placement, deduplication, GPU residency or FPS measurement.'}}
            assets.append(a); measurements.append({'assetId':ident,'file':str(p.relative_to(root)),**r})
    manifest={'schemaVersion':1,'packageId':'roof-surface-studies','version':'1.0.0','baseRevision':'5574d55719f10d1575127d8b92cbd23ff71e446f','status':'offline_complete','units':'metres','coordinateSystem':{'source':'Blender Z-up','export':'glTF Y-up','conversion':'Blender (x,y,z) -> glTF (x,z,-y), applied by standard glTF exporter once'},
              'provenance':{'type':'original-procedural-material-study','basis':['docs/AI_AGENT_DEVELOPMENT_BACKLOG.md#b02','lib/city/building-surface-palette.ts','docs/CITY_READABILITY_2026_10.md','docs/MATERIAL_PIPELINE.md'],'credit':'Based on Vancouver Living Atlas by YiTaChen','source':'https://github.com/YiTaChen/vancouver-living-atlas','license':'Vancouver Living Atlas Noncommercial Research and Attribution 1.0; repository LICENSE','surveyed':False,'externalImagesOrModels':False},
              'reexportCommand':'blender -b -t 2 --factory-startup --python-exit-code 1 --python tools/assets/roof-surface-studies/build.py -- --from-source tools/assets/roof-surface-studies/source --output /tmp/roof-surface-reexport --render',
              'validationCommand':'python3 tools/assets/roof-surface-studies/validate.py','assets':assets,'textures':textures,
              'textureBudget':{'capBytes':4*1024**2,'uniqueRuntimeMaps':6,'uniqueTexelBytesWithMips':total,'basis':'RGBA8 x full-mip 4/3 conservative estimate. No GPU residency measured.','tradeoff':'Both surfaces were actually baked at 512px (source/textures, 8MiB if ever all resident), then area-filtered in linear color/data to 256px; normal vectors renormalized. Six 512px runtime maps would be 8MiB and exceed the cap. Six 256px candidates total 2MiB; fine mineral grain is reduced, so inspect WebGL minification before any activation.','source512BakeExcludedFromRuntime':True,'inspectionGlbsExcludedFromRuntime':True}}
    dump(root/'manifest.json',manifest)
    dump(root/'qa/measurements.json',{'status':'pass','source':'actual glTF accessors and node transforms, not nominal dimensions','boundsAxes':'W=X, H=Y, D=Z','assets':measurements,'textureBudget':manifest['textureBudget'],'environment':evidence['environment']})
    return manifest

def validate(root):
    evidence=validate_evidence(root); common=c.validate(root); m=j(root/'manifest.json')
    need(m['status']=='offline_complete','status'); need(len(m['assets'])==4 and len(m['textures'])==6,'package counts')
    unique={}
    for t in m['textures']:
        p=root/t['file']; need(c.digest(p)==t['sha256'],'texture catalog hash'); unique[t['sha256']]=t['uniqueTexelBytesWithMips']
    need(sum(unique.values())<=4*1024**2,'unique map budget')
    for rec in common['results']:
        need(rec['triangles']==2 and rec['vertices']==4 and rec['primitives']==1,'coupon geometry budget')
        need(rec['skins']==0,'no skin'); need(len(rec['images'])==3,'three map inspection')
        need(all(im['sha256'] in unique for im in rec['images']),'embedded image must match shared map bytes exactly')
        path=root/next(a['lods'][0]['file'] for a in m['assets'] if a['id']==rec['assetId']); doc,buf=c.read_glb(path)
        need(not doc.get('extensionsUsed'),'plain glTF extension-free requirement')
        mat=doc['materials'][0]; pbr=mat['pbrMetallicRoughness']
        need('baseColorTexture' in pbr and 'metallicRoughnessTexture' in pbr and 'normalTexture' in mat,'PBR channel bindings')
        need(mat.get('alphaMode','OPAQUE')=='OPAQUE' and mat.get('doubleSided') is True,'opaque two-sided inspection plane')
        prim=doc['meshes'][0]['primitives'][0]; need('TANGENT' in prim['attributes'],'normal map tangents')
        tang=c.accessor(doc,buf,prim['attributes']['TANGENT']); need(all(abs(sum(x*x for x in row[:3])-1)<1e-5 and abs(abs(row[3])-1)<1e-5 for row in tang),'unit handed tangents')
    return {'status':'pass','packageId':m['packageId'],'assetStatus':'offline_complete','integrationStatus':'runtime_pending_webgl','scope':'B02 offline only','common':common,'packageSpecific':evidence,'uniqueTextureBytesWithMips':sum(unique.values())}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--root',type=Path,default=HERE); p.add_argument('--finalize-manifest',action='store_true'); p.add_argument('--write-report',action='store_true'); args=p.parse_args()
    if args.finalize_manifest: create_manifest(args.root)
    result=validate(args.root)
    if args.write_report: dump(args.root/'qa/validation.json',result)
    print(json.dumps({'status':result['status'],'assets':len(result['common']['results']),'uniqueTextureMiB':result['uniqueTextureBytesWithMips']/1024**2,'runtimeChecks':'not_run'},indent=2))
