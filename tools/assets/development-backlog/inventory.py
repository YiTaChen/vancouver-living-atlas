"""Read-only source-baseline inventory; --write updates only this package's JSON.

No Blender, WebGL, asset rebuild, runtime adoption or release is implied. Existing
legacy manifests are copied as evidence, not migrated to the new package schema.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = '5574d55719f10d1575127d8b92cbd23ff71e446f'
REQUIRED_IDS = [f'{letter}{i:02}' for letter, count in [('A',4),('B',4),('C',4),('D',6),('E',4),('F',5)] for i in range(1,count+1)]
DOCS = ['AI_AGENT_POLICY.md', 'LICENSE', 'DATA_SOURCES.md', 'docs/AI_AGENT_DEVELOPMENT_BACKLOG.md', 'docs/PROJECT_SPECIFICATION.md', 'docs/MATERIAL_PIPELINE.md', 'docs/OFFLINE_ASSET_INTEGRATION_2026_10.md', 'docs/CITY_READABILITY_2026_10.md', 'docs/BLENDER_ASSET_HANDOFF_2026_10.md']


def load(path):
    return json.loads(path.read_text())


def inside(root, relative):
    if not isinstance(relative,str) or not relative or '\\' in relative:
        raise ValueError('invalid relative path')
    parts = PurePosixPath(relative)
    if parts.is_absolute() or '..' in parts.parts or '.' in relative.split('/'):
        raise ValueError('unsafe path: '+relative)
    resolved = (root/relative).resolve()
    if not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
        raise ValueError('missing/outside file: '+relative)
    return resolved


def pointer(value, address):
    if address == '': return value
    if not address.startswith('/'): raise ValueError('invalid JSON pointer')
    for part in address[1:].split('/'):
        part = part.replace('~1','/').replace('~0','~')
        value = value[int(part)] if isinstance(value,list) else value[part]
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_record(root, path):
    data = inside(root,path).read_bytes()
    return {'path':path, 'bytes':len(data), 'sha256':digest(data)}


def verify_files(root, entries):
    paths = [e['path'] for e in entries]
    if not paths or len(paths) != len(set(paths)): raise ValueError('empty/duplicate file inventory')
    for item in entries:
        observed = file_record(root,item['path'])
        if observed['bytes'] != item['bytes'] or observed['sha256'] != item['sha256']:
            raise ValueError('source fingerprint mismatch: '+item['path'])


def validate_config(config, catalog, datum, root=ROOT):
    if config.get('baseRevision') != BASE: raise ValueError('wrong source base revision')
    rows=config['requirements']
    if [r['id'] for r in rows] != REQUIRED_IDS: raise ValueError('require exactly all 27 ordered requirement IDs')
    table=inside(root,'docs/AI_AGENT_DEVELOPMENT_BACKLOG.md').read_text()
    if re.findall(r'^\| ([A-F]\d{2}) ',table,re.M) != REQUIRED_IDS:
        raise ValueError('requirement table changed; review mapping')
    packages={p['id']:p for p in catalog['packages']}
    if len(packages)!=len(catalog['packages']): raise ValueError('duplicate package ID')
    asset_ids=set()
    for package in packages.values():
        for source in package['manifests']:
            entries=pointer(load(inside(root,source['path'])),source['itemsPointer'])
            for item in entries:
                asset_ids.add(package['id']+':'+item['id'])
    for row in rows:
        if row['status']!='planned' or row['offline']['status']!='planned':
            raise ValueError('baseline inventory cannot complete new backlog work')
        if row['runtime']['status']!='runtime_pending_webgl' or row['runtime']['webglChecks']!='not_run':
            raise ValueError('new runtime work has no acceptance evidence')
        if row['offline']['blenderChecks']!='not_run': raise ValueError('inventory has not reopened Blender sources')
        if not row['currentConsumers'] or not row['currentBaseline'] or not row['offline']['scope'] or not row['runtime']['scope'] or not row['remaining']:
            raise ValueError('incomplete requirement scope: '+row['id'])
        if not set(row['packageIds']) <= packages.keys(): raise ValueError('unknown package')
        for ref in row['assetRefs']:
            if ref not in asset_ids or ref.split(':',1)[0] not in row['packageIds']:
                raise ValueError('unknown/unmapped asset reference: '+ref)
        for path in row['currentConsumers']+row['evidence']: inside(root,path)
    datum_ids=set()
    for entry in datum['contracts']:
        if entry['id'] in datum_ids: raise ValueError('duplicate datum ID')
        datum_ids.add(entry['id'])
        if not set(entry['requirementIds']) <= set(REQUIRED_IDS): raise ValueError('unknown datum requirement')
        if not entry['evidence']: raise ValueError('datum lacks evidence')
        for source in entry['evidence']:
            path=inside(root,source['path'])
            if 'pointer' in source and pointer(load(path),source['pointer']) != source['expected']:
                raise ValueError('datum declaration changed: '+entry['id'])
            if 'contains' in source and source['contains'] not in path.read_text():
                raise ValueError('datum source text changed: '+entry['id'])
    return asset_ids


def glb_metrics(path):
    # Reuse the immutable baseline's finite accessor/index/container audit rather
    # than relabeling historical report numbers as current measurements.
    script=ROOT/'tools/assets/offline-handoff/validate.py'
    spec=importlib.util.spec_from_file_location('backlog_legacy_glb_audit',script)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result=module.audit_glb(path)
    data=path.read_bytes()
    size=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+size])
    positions={p['attributes']['POSITION'] for m in doc.get('meshes',[]) for p in m['primitives']}
    result['exportedPositionVertices']=sum(doc['accessors'][i]['count'] for i in positions)
    image_views={i['bufferView'] for i in doc.get('images',[]) if 'bufferView' in i}
    result['embeddedImageBytes']=sum(doc['bufferViews'][i]['byteLength'] for i in image_views)
    result['containerNonImageBytes']=len(data)-result['embeddedImageBytes']
    result['animationNames']=[a.get('name') for a in doc.get('animations',[])]
    result['jointCounts']=[len(s['joints']) for s in doc.get('skins',[])]
    result['boundsMeasurement']='not_run; declared per-asset bounds retain original manifest provenance; this inventory does not reopen or pose models'
    return result


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()


def build():
    config=load(HERE/'requirements.json');catalog=load(HERE/'package-catalog.json');datum=load(HERE/'datum-contracts.json')
    asset_ids=validate_config(config,catalog,datum)
    subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],cwd=ROOT,check=True)
    # A later task commit is allowed; the original source revision remains fixed.
    roots=[r for p in catalog['packages'] for r in p['roots']]
    paths=set(DOCS)
    for row in config['requirements']: paths.update(row['currentConsumers']+row['evidence'])
    for p in catalog['packages']: paths.update(p['historicalEvidence']);paths.update(m['path'] for m in p['manifests'])
    for d in datum['contracts']: paths.update(e['path'] for e in d['evidence'])
    entries=git('ls-tree','-r',BASE,'--',*roots).splitlines()
    base_blobs={line.split('\t')[1]:line.split()[2] for line in entries}
    paths.update(base_blobs)
    # Pin every registered consumer/evidence file to the same source baseline.
    for line in git('ls-tree','-r',BASE,'--',*sorted(paths)).splitlines():
        base_blobs[line.split('\t')[1]]=line.split()[2]
    files=[]
    for path in sorted(paths):
        record=file_record(ROOT,path)
        if path not in base_blobs or git('hash-object','--',path)!=base_blobs[path]:
            raise ValueError('file no longer matches immutable source baseline: '+path)
        record['baseGitBlob']=base_blobs[path]
        if path.endswith('.glb'): record['currentContainerAudit']=glb_metrics(ROOT/path)
        files.append(record)
    bypath={f['path']:f for f in files}
    packages=[]
    for package in catalog['packages']:
        item=dict(package)
        members=[f for f in files if any(f['path']==r or f['path'].startswith(r+'/') for r in package['roots'])]
        item['filePaths']=[f['path'] for f in members]
        item['counts']={'files':len(members),'sourceBlendFiles':sum(f['path'].endswith('.blend') for f in members),'glbFiles':sum(f['path'].endswith('.glb') for f in members),'pngFiles':sum(f['path'].endswith('.png') for f in members),'diskBytes':sum(f['bytes'] for f in members)}
        item['legacyManifestSnapshots']=[]
        for source in package['manifests']:
            doc=load(ROOT/source['path'])
            item['legacyManifestSnapshots'].append({**source,'sha256':bypath[source['path']]['sha256'],'rootFields':list(doc),'declaredStatus':doc.get('status'),'declaredRuntimeIntegrated':doc.get('runtimeIntegrated'),'assetRecords':pointer(doc,source['itemsPointer'])})
        packages.append(item)
    image_groups={}
    for f in files:
        if f['path'].endswith('.png') and ('/maps/' in f['path'] or '/textures/' in f['path'] or f['path'].startswith('public/materials/')):
            image_groups.setdefault(f['sha256'],[]).append(f)
    public=bypath['public/models/citizen/vancouver-citizen.glb']
    citizen=bypath['tools/assets/citizen/optimization/glb/citizen-lod0.glb']
    return {'schemaVersion':1,'inventoryId':'development-backlog-source-baseline','baseRevision':BASE,'requirementDocumentBaselineRevision':'614cf841d0a188d0334c101150d15cc727e2f679','scope':'Immutable original main source inventory, not the sibling packages produced after baseRevision. New backlog work remains planned.','provenance':{'repository':'https://github.com/YiTaChen/vancouver-living-atlas','license':'LicenseRef-Vancouver-Living-Atlas-NC-1.0','method':'Read actual baseline-identical files, SHA-256 and byte sizes; run baseline standard-library GLB audit and extract exported accessor/image counts. Existing manifest data is explicitly declared evidence, not remeasured bounds or Blender results.','offlineBlender':'not_run','webgl':'not_run','deployment':'not_checked'},'inputFiles':[file_record(ROOT,p.relative_to(ROOT).as_posix()) for p in [HERE/'requirements.json',HERE/'package-catalog.json',HERE/'datum-contracts.json',HERE/'inventory.py']],'summary':{'requirementCount':len(config['requirements']),'packageCount':len(packages),'legacyAssetRecordCount':len(asset_ids),'fingerprintedFiles':len(files),'fingerprintedDiskBytes':sum(f['bytes'] for f in files),'auditedGlbFiles':sum('currentContainerAudit' in f for f in files),'uniqueExternalMapPngHashes':len(image_groups),'uniqueExternalMapPngDiskBytes':sum(v[0]['bytes'] for v in image_groups.values()),'mapCostCaveat':'PNG disk-byte deduplication only. Embedded images, authored mip identity, GPU residency and VRAM are not deduced from this total.'},'requirements':config['requirements'],'datumContracts':datum['contracts'],'packages':packages,'adoptionChecks':{'citizenLod0':{'publicPath':public['path'],'candidatePath':citizen['path'],'byteIdentical':public['sha256']==citizen['sha256'],'sha256':public['sha256'],'consumer':'lib/city/citizen.ts','scope':'Current loader and payload identity only, not fresh runtime acceptance.'}},'duplicateExternalMapPngs':[{'sha256':h,'bytesEach':v[0]['bytes'],'paths':[f['path'] for f in v]} for h,v in sorted(image_groups.items()) if len(v)>1],'files':files}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write',action='store_true',help='explicitly regenerate inventory.json inside this package')
    args=parser.parse_args()
    result=build()
    output=HERE/'inventory.json'
    if args.write:
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    elif load(output)!=result:
        raise ValueError('inventory is stale; review source/config changes before explicit --write')
    print(json.dumps({'status':'pass','scope':'baseline file/GLB container integrity and 27-ID mapping only','summary':result['summary']},ensure_ascii=False))


if __name__=='__main__': main()
