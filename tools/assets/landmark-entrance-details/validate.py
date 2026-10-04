"""Read-only B04 geometry/semantic/instance-cost validator, with independently decoded GLBs."""
import argparse,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');contract=importlib.util.module_from_spec(s);s.loader.exec_module(contract)
CAT=json.loads((HERE/'catalog.json').read_text())
need=contract.need

def geometry(path):
    d,b=contract.read_glb(path);tris=[];uvs=[]
    def walk(i,parent):
        node=d['nodes'][i];m=contract.matmul(parent,contract.transform(node))
        if 'mesh' in node:
            for p in d['meshes'][node['mesh']]['primitives']:
                a=p['attributes'];need('TEXCOORD_0' in a and 'TANGENT' in a,'missing metric UV/tangent')
                pos=[contract.point(m,v) for v in contract.accessor(d,b,a['POSITION'])]
                ids=[x[0] for x in contract.accessor(d,b,p['indices'])] if 'indices' in p else list(range(len(pos)))
                tris.extend([[pos[q] for q in ids[j:j+3]] for j in range(0,len(ids),3)])
                uvs.extend(contract.accessor(d,b,a['TEXCOORD_0']))
                tangents=contract.accessor(d,b,a['TANGENT']);need(all(abs(sum(v*v for v in t[:3])-1)<.005 and abs(abs(t[3])-1)<.001 for t in tangents),'tangent vector contract')
        for c in node.get('children',[]):walk(c,m)
    for i in d['scenes'][d.get('scene',0)]['nodes']:walk(i,contract.IDENTITY)
    need(not d.get('images') and not d.get('textures'),'unexpected duplicated map')
    need(all(m.get('alphaMode','OPAQUE')=='OPAQUE' and not m.get('doubleSided',False) for m in d.get('materials',[])),'opaque culling semantic')
    signatures=[tuple(sorted(tuple(round(v,7) for v in p) for p in t)) for t in tris]
    need(len(set(signatures))==len(signatures),'duplicate coplanar triangle')
    return tris,uvs

def zray(tri,x,y):
    # Barycentric projection: whether +Z/-Z ray meets this actual triangle.
    a,b,c=tri;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)<1e-12:return False
    u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
    v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
    return min(u,v,1-u-v)>1e-7

def check_opening(aid,tris):
    samples=[]
    if aid=='waterfront-window-recess':
        samples=[(-1.495+i*2.99/18,.165+j*4.99/28) for i in range(19) for j in range(29)]
    elif aid=='marine-archivolt-relief':
        for i in range(37):
            x=-2.545+i*5.09/36;top=3.7+2.82*math.sqrt(1-(x/2.55)**2)
            samples.extend((x,.18+j*(top-.185)/36) for j in range(37))
    elif aid=='marine-copper-grille':samples=[(-2.5+i*5/12,.2+j*2.94/12) for i in range(13) for j in range(13)]
    for x,y in samples:need(not any(zray(t,x,y) for t in tris),f'{aid}: blocked opening at {x},{y}')
    return len(samples)

def check_semantics(m,assembly):
    need(m['units']=='metres','metre contract')
    need(assembly['worldCoordinateOverrides'] is False,'world-coordinate override forbidden')
    need(assembly['integrationStatus']=='runtime_pending_webgl','offline status cannot imply runtime acceptance')
    for a in m['assets']:
        need(a['frontAxis']=='+Z','front axis')
        need(a['pivot']['positionM']==[0,0,0],'local pivot')
        need(a['collision']['kind']=='retain-existing' and not a['collision']['addPrimitives'],'collision changed')
        need(a['runtimeChecks']['status']=='not_run','WebGL must be not_run')
        if a['id'].startswith('marine'):
            c=a['clearance'];need(c['newWalkableSpace'] is False,'Marine must not be navigable')
            for k,v in [('halfWidthM',2.55),('springY',3.7),('archRiseM',2.82),('bottomY',.16),('topY',6.52),('projectionMaxM',.24)]:need(c[k]==v,'Marine datum drift '+k)
    need('thresholdY-.16' in assembly['assemblies'][2]['frame']['transform'],'Marine lift contract')


def cost_report(m,assembly):
    assets={a['id']:a for a in m['assets']};reports=[]
    for a in assembly['assemblies']:
        levels=[]
        for level in range(3):
            sums={k:sum(assets[i['assetId']]['lods'][level][k]*i['count'] for i in a['instances']) for k in ['triangles','primitives','geometryBytes','bytes']}
            need(sums['triangles']<=CAT['budget']['triangles'][level],a['id']+': aggregate triangle budget')
            need(sums['geometryBytes']<=CAT['budget']['geometryBytes'][level],a['id']+': aggregate geometry bytes budget')
            levels.append({'level':level,**sums,'drawInterpretation':'instance-counted primitives before batching; not measured renderer draw calls'})
        reports.append({'assemblyId':a['id'],'lods':levels})
    return reports

def check_bounds(item,b):
    for k in range(3):
        need(abs(b['min'][k]-item['expectedMinM'][k])<=.02,'datum/bounds minimum')
        need(abs(b['size'][k]-item['dimensionsM'][k])<=.02,'dimension tolerance')
    if item['id'].startswith('marine'):need(b['max'][2]<=.240001,'Marine protrusion')

def validate(root):
    root=Path(root);m=json.loads((root/'manifest.json').read_text());assembly=json.loads((HERE/'assembly-plan.json').read_text());common=contract.validate(root);check_semantics(m,assembly);records=[]
    need(len(m['assets'])==len(CAT['assets']),'complete asset set')
    for a,item in zip(m['assets'],CAT['assets']):
        need(a['id']==item['id'],'asset set/order')
        need([l['level'] for l in a['lods']]==[0,1,2],'complete LOD family')
        mat=next(x for x in CAT['materials'] if x['name']==item['material'])
        need(a['materialBindings'][0]['role']==mat['role'] and a['materialBindings'][0]['surfaceId']==mat['surfaceId'],'semantic material binding')
        need(a['expectedDimensionsM']==item['dimensionsM'],'declared expected dimensions')
        for l in a['lods']:
            r=contract.measure_glb(root/l['file']);b=r['boundsM']
            check_bounds(item,b)
            need(r['materialNames']==[item['material']] and r['primitives']==1,'semantic single-material part')
            tris,uvs=geometry(root/l['file']);samples=check_opening(a['id'],tris)
            need(not any('QA' in n or 'ruler' in n or 'human' in n for n in r['nodeNames']),'QA reference in export')
            if a['id'].startswith('marine'):need(b['max'][2]<=.240001,'Marine protrusion')
            records.append({'id':a['id'],'level':l['level'],'openingRaySamples':samples,**r})
    return {'status':'pass','checks':['common schema/hashes/finite geometry/indices/normals/transforms','glTF Y-up,+Z-front bounds and fixed local datums','metric UV and tangent validity','no duplicate identical coplanar triangles','real geometry aperture rays','all 3 LODs fixed dimensions and openings','instance-counted B-HERO budgets','semantic materials without new images','preserved closed Marine collision and unlifted datum','no QA objects in GLB'],'assets':records,'assemblyCosts':cost_report(m,assembly),'runtimeChecks':{'status':'not_run','reason':'No city WebGL acceptance performed'}}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=HERE);p.add_argument('--report',type=Path);args=p.parse_args();r=validate(args.root)
    if args.report:args.report.write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps({'status':r['status'],'lods':len(r['assets']),'assemblyCosts':r['assemblyCosts']},indent=2))
