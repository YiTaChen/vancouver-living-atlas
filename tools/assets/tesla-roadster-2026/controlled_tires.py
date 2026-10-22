"""Continuous closed LOD rubber skins using the donor rounded tyre profile.

The .3505 m crown represents the original .35 m carcass plus its tread crest.
An inward .1 mm quantization allowance keeps every full-spin vertex above the
tyre plane. Surface connectivity is preserved, without collapse decimation.
"""
import array
import base64
import hashlib
import json
import math
from pathlib import Path

SCALE = .0001
SEGMENTS = {'low':48, 'medium':64, 'high':80}
NOTE = {'method':'Continuous closed donor-profile LOD rubber, never collapse-decimated',
        'axis':'Atlas local X; radial plane YZ', 'profileRings':10,
        'segments':SEGMENTS, 'donorCarcassRadiusM':.35, 'donorTreadCrestRadiusM':.3505,
        'quantizationInwardAllowanceM':.0001,
        'widthHalfM':{'front':.131,'rear':.142}}


def encode(values, kind):
    return base64.b64encode(array.array(kind,values).tobytes()).decode()


def tyre_part(assembly, quality):
    width = .131 if assembly.startswith('front') else .142
    profile = [(-width*.82,.274),(-width,.292),(-width*1.035,.323),
               (-width*.95,.344),(-width*.73,.3505),(width*.73,.3505),
               (width*.95,.344),(width*1.035,.323),(width,.292),(width*.82,.274)]
    count = SEGMENTS[quality]
    positions, normals, colors, indices = [], [], [], []
    for k,(depth,radius) in enumerate(profile):
        previous, following = profile[(k-1)%len(profile)],profile[(k+1)%len(profile)]
        dx,dr = following[0]-previous[0],following[1]-previous[1]
        length = math.hypot(dx,dr)
        radius = min(radius,.3504)
        for j in range(count):
            angle = math.tau*j/count
            c,s = math.cos(angle),math.sin(angle)
            positions.extend(round(v/SCALE) for v in (depth,radius*c,radius*s))
            normals.extend(round(v*127) for v in (-dr/length,dx*c/length,dx*s/length))
            colors.extend((3,4,5))
    for k in range(len(profile)):
        following = (k+1)%len(profile)
        for j in range(count):
            next_j = (j+1)%count
            a,b,c,d = k*count+j,k*count+next_j,following*count+next_j,following*count+j
            indices.extend((a,b,c,a,c,d))
    part = {'assembly':assembly,'role':'rubber','positions':encode(positions,'h'),
            'normals':encode(normals,'b'),'colors':encode(colors,'B'),
            'indices':encode(indices,'H'),'vertexCount':len(positions)//3,'indexCount':len(indices)}
    return part,(positions,normals,colors,indices)


def non_rubber_hashes(data):
    return {quality:{p['assembly']+':'+p['role']:hashlib.sha256(
        json.dumps(p,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        for p in lod['parts'] if p['role']!='rubber'} for quality,lod in data['lods'].items()}


def repair_payload(package):
    package = Path(package)
    path = package/'exports/tesla-roadster-detailed-data.json'
    raw = path.read_bytes()
    data = json.loads(raw)
    before = non_rubber_hashes(data)
    for quality,lod in data['lods'].items():
        lod['parts'] = [tyre_part(p['assembly'],quality)[0]
                        if p['role']=='rubber' and p['assembly'].endswith('-roll') else p
                        for p in lod['parts']]
        lod['triangles'] = sum(p['indexCount']//3 for p in lod['parts'])
        assert lod['triangles']<{'low':12000,'medium':30000,'high':60000}[quality]
    assert before == non_rubber_hashes(data), 'A non-rubber chunk changed'
    data['source']['controlledTyres'] = NOTE
    result = json.dumps(data,separators=(',',':')).encode()
    path.write_bytes(result)
    (package.parents[2]/'lib/city/assets/tesla-roadster-detailed-data.json').write_bytes(result)
    report = {'schemaVersion':1,'priorPayloadSha256':hashlib.sha256(raw).hexdigest(),
              'payloadSha256':hashlib.sha256(result).hexdigest(),'nonRubberPartsUnchanged':True,
              'nonRubberPartHashes':before,'controlledTyres':NOTE,
              'triangles':{q:l['triangles'] for q,l in data['lods'].items()}}
    (package/'qa/tyre-repair.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='nonRubberPartHashes'}))


if __name__=='__main__':
    repair_payload(Path(__file__).resolve().parent)
