"""Independent no-dependency GLB/PNG structural and budget checks; not GPU QA."""
from pathlib import Path
import json,struct,math,zlib,hashlib
R=Path(__file__).resolve().parent

def glb(path):
    b=path.read_bytes(); magic,version,length=struct.unpack_from('<III',b)
    assert magic==0x46546c67 and version==2 and length==len(b),path
    n,t=struct.unpack_from('<II',b,12);assert t==0x4e4f534a
    d=json.loads(b[20:20+n]);bn,bt=struct.unpack_from('<II',b,20+n); assert bt==0x004e4942
    raw=b[28+n:28+n+bn]; assert len(raw)==bn
    return d,raw

def accessor(d,b,i):
    a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];ct={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)};f,s=ct[a['componentType']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];off=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',n*s)
    vals=[struct.unpack_from('<'+f*n,b,off+j*stride) for j in range(a['count'])]
    assert all(math.isfinite(x) for row in vals for x in row)
    return vals

def png(path):
    b=path.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n'; w,h,depth,kind=struct.unpack_from('>IIBB',b,16);assert depth==8 and kind in (2,6);assert w<=1024 and h<=1024
    pos=8;raw=b''
    while pos<len(b):
        n=struct.unpack_from('>I',b,pos)[0]; k=b[pos+4:pos+8];v=b[pos+8:pos+8+n];crc=struct.unpack_from('>I',b,pos+8+n)[0];assert crc==zlib.crc32(k+v)&0xffffffff
        if k==b'IDAT':raw+=v
        pos+=12+n
    return w,h,kind,zlib.decompress(raw)

m=json.loads((R/'manifest.json').read_text()); results=[]
for item in m['assets']:
    path=R/item['file'];d,b=glb(path);tris=0;prim=0
    assert not d.get('extensionsRequired'),path
    if 'slope' in item['id']:assert all(s['wrapS']==33071 and s['wrapT']==10497 for s in d['samplers'])
    for mesh in d['meshes']:
        for p in mesh['primitives']:
            prim+=1;assert p.get('mode',4)==4
            if 'slope' in item['id']:
                assert '_GRASS_WEIGHT' in p['attributes'] and 'COLOR_0' not in p['attributes']
                assert all(0<=v[0]<=1 for v in accessor(d,b,p['attributes']['_GRASS_WEIGHT']))
            pos=accessor(d,b,p['attributes']['POSITION']);norm=accessor(d,b,p['attributes']['NORMAL']);uv=accessor(d,b,p['attributes']['TEXCOORD_0']);idx=accessor(d,b,p['indices']);tris+=len(idx)//3
            assert len(idx)%3==0 and len(pos)==len(norm)==len(uv)
            assert max(v[0] for v in idx)<len(pos)
            assert all(.98<sum(x*x for x in n)<1.02 for n in norm)
            # No degenerate triangles, including bark caps and folded foliage.
            for j in range(0,len(idx),3):
                a,c,e=[pos[idx[j+k][0]] for k in range(3)];u=[c[k]-a[k] for k in range(3)];v=[e[k]-a[k] for k in range(3)];cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert sum(t*t for t in cross)>1e-18
    assert tris==item['triangles'] and prim==item['primitives']
    assert tris <= (512 if 'slope' in item['id'] else 208)
    for mat in d['materials']:
        if 'Foliage_RGBA' in mat['name']:assert mat['alphaMode']=='MASK' and mat['alphaCutoff']==.4 and mat['doubleSided']
        else:assert mat.get('alphaMode','OPAQUE')=='OPAQUE'
    assert all('bufferView' in im and im['mimeType']=='image/png' for im in d['images'])
    results.append({'asset':item['id'],'triangles':tris,'primitives':prim,'GLBBytes':len(path.read_bytes()),'status':'pass'})
for item in m['maps']:
    p=R/item['file'];w,h,k,raw=png(p);assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
    if 'normal' in p.name:
        channels=3;rows=[raw[j*(w*3+1)+1:(j+1)*(w*3+1)] for j in range(h)];assert all(row[i+2]>=128 for row in rows for i in range(0,len(row),3))
coverage=json.loads((R/'alpha-coverage.json').read_text())
for mip in coverage['mips']:
    w,h,k,raw=png(R/f"maps/leaf_mip_{mip['level']}_{mip['size']}.png");assert k==6;n=w//2
    for i,c in enumerate(mip['cells']):
        count=sum(raw[j*(w*4+1)+1+col*4+3]>=102 for j in range(i//2*n,(i//2+1)*n) for col in range(i%2*n,(i%2+1)*n))
        assert abs(count/(n*n)-c['correctedCoverage'])<1e-12
        assert .04<c['baseCoverage']<.65
        assert abs(c['correctedCoverage']-c['baseCoverage'])<.008, (mip['level'],c)
assert (R/'source/vegetation_ground.blend').stat().st_size>100000
report={'status':'pass','checks':['GLB2 header and embedded images','finite positions, normals and UVs','unit normals, valid indices and nondegenerate triangles','manifest triangle/draw bounds','MASK foliage vs opaque bark/ground','PNG CRC/hash/dimensions and +Z normal hemisphere','per-cell mip coverage error <0.8 percentage points'], 'notValidated':['runtime integration','projected crown coverage and shadow silhouette','night/day browser rendering','FPS, GPU timings, device memory'], 'assets':results}
(R/'validation.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
