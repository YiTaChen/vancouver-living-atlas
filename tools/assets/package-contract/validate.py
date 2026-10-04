"""Read-only common asset-package audit. Standard library; no GPU acceptance.

GLB measurements apply each scene-node transform exactly once. Skin deformation,
semantic clearance, editable-source reopening and renders remain package audits.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT_FIELDS = 'schemaVersion packageId version baseRevision status units coordinateSystem provenance reexportCommand validationCommand assets textures'.split()
ASSET_FIELDS = 'id taskId variant kind source sourceSha256 lods boundsM expectedDimensionsM dimensionToleranceM dimensionBasis pivot attachmentDatum frontAxis materialBindings textureMode textureCost lodPolicy clearance collision anchors placementCompatibility intendedConsumer offlineChecks runtimeChecks'.split()
TYPES = {5120: ('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
WIDTHS = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}
IDENTITY = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]


def need(test, message):
    if not test: raise ValueError(message)


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finite(value):
    if isinstance(value, (int,float)) and not isinstance(value,bool): need(math.isfinite(value), 'nonfinite number')
    elif isinstance(value,dict):
        for item in value.values(): finite(item)
    elif isinstance(value,list):
        for item in value: finite(item)


def inside(root, relative):
    need(isinstance(relative,str) and relative and not Path(relative).is_absolute(),'relative path required')
    p=(root/relative).resolve()
    need(p.is_relative_to(root.resolve()) and p.is_file(),f'missing/outside file: {relative}')
    return p


def matmul(a,b):
    return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]


def transform(node):
    if 'matrix' in node:
        need(not any(k in node for k in ('translation','rotation','scale')), 'matrix and TRS combined')
        m=node['matrix']; need(len(m)==16,'matrix shape')
        need(all(abs(m[k])<1e-8 for k in (3,7,11)) and abs(m[15]-1)<1e-8,'non-affine matrix')
        det=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2])
        need(det>0,'negative or singular matrix requires explicit review')
        return m
    x,y,z,w=node.get('rotation',[0,0,0,1]); need(abs(x*x+y*y+z*z+w*w-1)<1e-4,'nonunit rotation')
    sx,sy,sz=node.get('scale',[1,1,1]); tx,ty,tz=node.get('translation',[0,0,0])
    need(sx*sy*sz>0,'negative or zero determinant scale requires explicit review')
    return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*w*z)*sx,(2*x*z-2*w*y)*sx,0,
            (2*x*y-2*w*z)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*w*x)*sy,0,
            (2*x*z+2*w*y)*sz,(2*y*z-2*w*x)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1]


def point(m,p): return [sum(m[k*4+r]*p[k] for k in range(3))+m[12+r] for r in range(3)]


def read_glb(path):
    raw=Path(path).read_bytes(); need(len(raw)>=20,'truncated GLB')
    need(struct.unpack_from('<4sII',raw)==(b'glTF',2,len(raw)),'GLB header')
    chunks=[]; offset=12
    while offset<len(raw):
        need(offset+8<=len(raw),'chunk header')
        length,tag=struct.unpack_from('<I4s',raw,offset); offset+=8
        need(length%4==0 and offset+length<=len(raw),'chunk bounds')
        chunks.append((tag,raw[offset:offset+length])); offset+=length
    need(len(chunks)==2 and chunks[0][0]==b'JSON' and chunks[1][0]==b'BIN\0','JSON/BIN chunks required')
    doc=json.loads(chunks[0][1]); binary=chunks[1][1]; finite(doc)
    need(doc.get('asset',{}).get('version')=='2.0','glTF version')
    need(len(doc.get('buffers',[]))==1 and 'uri' not in doc['buffers'][0],'single local BIN')
    need(0<=len(binary)-doc['buffers'][0]['byteLength']<=3,'buffer length')
    need(not doc.get('cameras') and not doc.get('extensions',{}).get('KHR_lights_punctual'),'QA camera/light in runtime')
    for v in doc.get('bufferViews',[]):
        need(v.get('buffer',0)==0 and v.get('byteOffset',0)>=0 and v['byteLength']>=0 and v.get('byteOffset',0)+v['byteLength']<=len(binary),'bufferView bounds')
    return doc,binary


def accessor(doc,binary,index):
    need(isinstance(index,int) and 0<=index<len(doc.get('accessors',[])),'accessor ID')
    a=doc['accessors'][index]; need('sparse' not in a and 'bufferView' in a,'sparse/unbacked accessor requires dedicated support')
    code,width=TYPES[a['componentType']]; n=WIDTHS[a['type']]
    # Matrix integer column padding needs a dedicated decoder; Blender uses float matrices.
    need(not a['type'].startswith('MAT') or width==4,'padded integer matrix unsupported')
    v=doc['bufferViews'][a['bufferView']]; stride=v.get('byteStride',n*width); rel=a.get('byteOffset',0)
    need(a['count']>0 and rel>=0 and stride>=n*width and rel+(a['count']-1)*stride+n*width<=v['byteLength'],'accessor bounds')
    out=[struct.unpack_from('<'+code*n,binary,v.get('byteOffset',0)+rel+i*stride) for i in range(a['count'])]
    need(all(math.isfinite(c) for row in out for c in row),'nonfinite accessor')
    return out


def measure_glb(path):
    doc,binary=read_glb(path)
    for i in range(len(doc.get('accessors',[]))): accessor(doc,binary,i)
    mesh_stats=[]
    for mesh in doc.get('meshes',[]):
        points=[]; tris=vertices=0
        for primitive in mesh['primitives']:
            need(primitive.get('mode',4)==4,'triangles required')
            attr=primitive['attributes']; need('NORMAL' in attr and 'POSITION' in attr,'position/normal required')
            p=accessor(doc,binary,attr['POSITION']); norm=accessor(doc,binary,attr['NORMAL'])
            need(len(p)==len(norm) and all(abs(sum(c*c for c in row)-1)<.005 for row in norm),'normal count/unit')
            for key,i in attr.items(): need(len(accessor(doc,binary,i))==len(p),f'{key} count')
            if 'indices' in primitive:
                a=doc['accessors'][primitive['indices']]
                need(a['componentType'] in (5121,5123,5125) and a['type']=='SCALAR','unsigned indices')
                indices=[v[0] for v in accessor(doc,binary,primitive['indices'])]
            else: indices=list(range(len(p)))
            need(len(indices)%3==0 and all(0<=i<len(p) for i in indices),'triangle indices')
            for k in range(0,len(indices),3):
                pa,pb,pc=[p[i] for i in indices[k:k+3]]
                u=[pb[i]-pa[i] for i in range(3)]; v=[pc[i]-pa[i] for i in range(3)]
                area=sum(c*c for c in (u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]))
                need(area>1e-18,'degenerate triangle')
            points.extend(p); vertices+=len(p); tris+=len(indices)//3
        mesh_stats.append((points,tris,vertices,len(mesh['primitives'])))
    visited=set(); points=[]; tris=vertices=primitives=0
    def walk(index,parent):
        nonlocal tris,vertices,primitives
        need(index not in visited and 0<=index<len(doc['nodes']),'cycle or multiply parented scene node'); visited.add(index)
        node=doc['nodes'][index]; matrix=matmul(parent,transform(node))
        if 'mesh' in node:
            p,t,v,n=mesh_stats[node['mesh']]; points.extend(point(matrix,a) for a in p); tris+=t; vertices+=v; primitives+=n
        for child in node.get('children',[]): walk(child,matrix)
    need(doc.get('scenes'),'scene required')
    for node in doc['scenes'][doc.get('scene',0)].get('nodes',[]): walk(node,IDENTITY)
    need(points,'empty asset')
    lo=[min(p[k] for p in points) for k in range(3)]; hi=[max(p[k] for p in points) for k in range(3)]
    images=[]; embedded=0
    for im in doc.get('images',[]):
        if 'bufferView' in im:
            view=doc['bufferViews'][im['bufferView']]; start=view.get('byteOffset',0); raw=binary[start:start+view['byteLength']]; embedded+=len(raw)
        else:
            need('uri' in im and not im['uri'].startswith(('data:','http:','https:')),'external image must be local')
            raw=inside(Path(path).parent,im['uri']).read_bytes()
        need(raw.startswith(b'\x89PNG\r\n\x1a\n'),'PNG texture required')
        width,height=struct.unpack_from('>II',raw,16); need(width>0 and height>0,'PNG dimensions')
        images.append({'sha256':hashlib.sha256(raw).hexdigest(),'width':width,'height':height,'bytes':len(raw),'texelBytesWithMips':width*height*4*4/3})
    return {'boundsM':{'min':lo,'max':hi,'size':[hi[k]-lo[k] for k in range(3)]},'triangles':tris,'vertices':vertices,'primitives':primitives,'bytes':Path(path).stat().st_size,'embeddedImageBytes':embedded,'geometryBytes':Path(path).stat().st_size-embedded,'images':images,'nodeNames':[n.get('name','') for n in doc['nodes']], 'materialNames':[m.get('name','') for m in doc.get('materials',[])],'boundsScope':'rest-pose scene node transforms; no skin deformation','skins':len(doc.get('skins',[]))}


def validate(root):
    root=Path(root).resolve(); m=json.loads((root/'manifest.json').read_text()); finite(m)
    need(all(k in m for k in ROOT_FIELDS),'required root fields')
    need(m['schemaVersion']==1,'schema version'); need(len(m['baseRevision'])==40,'base revision')
    need(m['assets'] and len({a['id'] for a in m['assets']})==len(m['assets']),'unique nonempty assets')
    results=[]
    for a in m['assets']:
        need(all(k in a for k in ASSET_FIELDS),f"{a['id']}: required asset fields")
        need(digest(inside(root,a['source']))==a['sourceSha256'],'asset source hash')
        need(a['lods'] and len({l['level'] for l in a['lods']})==len(a['lods']),'unique nonempty LODs')
        for l in a['lods']:
            path=inside(root,l['file']); need(digest(path)==l['sha256'],'GLB hash')
            need(digest(inside(root,l['source']))==l['sourceSha256'],'LOD source hash')
            r=measure_glb(path)
            for k in ('triangles','vertices','primitives','bytes'): need(l[k]==r[k],f'{path.name}: {k} mismatch')
            bounds=l.get('boundsM',a['boundsM'])
            for side in ('min','max','size'):
                need(len(bounds[side])==3 and all(abs(bounds[side][k]-r['boundsM'][side][k])<1e-4 for k in range(3)),f'{path.name}: transformed bounds mismatch')
            results.append({'assetId':a['id'],'lod':l['level'],**r})
    return {'status':'pass','scope':'common packaging, source hashes, rest-pose transformed GLB geometry and costs only; package-specific Blender, semantic and runtime checks required','results':results}

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('package',type=Path); parser.add_argument('--report',type=Path); args=parser.parse_args()
    report=validate(args.package)
    if args.report: args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
