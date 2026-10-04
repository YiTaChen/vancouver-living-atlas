"""Small dependency-free GLB repacker; external images are content-addressed."""
import json,struct,hashlib
from pathlib import Path

def read_glb(path):
 b=Path(path).read_bytes();assert b[:4]==b'glTF' and struct.unpack_from('<I',b,4)[0]==2
 n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);return d,b[28+n:]

def write_glb(path,d,b):
 d['buffers']=[{'byteLength':len(b)}];j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);b+=b'\0'*((-len(b))%4)
 Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(b))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(b),b'BIN\0')+b)

def omit_zero_area_indices(d,b):
 """Keep source vertices/UVs/skin intact; omit inherited zero-area primitives."""
 out=bytearray(b);removed=0
 def rows(index):
  a=d['accessors'][index];v=d['bufferViews'][a['bufferView']];code,size={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[a['componentType']];width={'VEC3':3,'SCALAR':1}[a['type']];start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size*width)
  return [struct.unpack_from('<'+code*width,out,start+i*stride)for i in range(a['count'])],(start,stride,code)
 for mesh in d['meshes']:
  for primitive in mesh['primitives']:
   positions,_=rows(primitive['attributes']['POSITION']);indices,(start,stride,code)=rows(primitive['indices']);indices=[i[0]for i in indices];kept=[];n=0
   for t in range(0,len(indices),3):
    a,c,e=[positions[i]for i in indices[t:t+3]];u=[c[k]-a[k]for k in range(3)];v=[e[k]-a[k]for k in range(3)];cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
    if sum(x*x for x in cross)<=1e-18:n+=1
    else:kept.extend(indices[t:t+3])
   if n:
    for i,x in enumerate(kept):struct.pack_into('<'+code,out,start+i*stride,x)
    d['accessors'][primitive['indices']]['count']=len(kept);primitive.setdefault('extras',{})['sourceZeroAreaTrianglesOmitted']=n;removed+=n
 d['asset'].setdefault('extras',{})['sourceIndexCleanup']={'removedTriangles':removed,'criterion':'cross-product squared <=1e-18 m4; actual inherited triangles have exactly zero area','positionsUvsNormalsWeightsUnchanged':True}
 return bytes(out)

def externalize(path,reference):
 path=Path(path);d,b=read_glb(path);b=omit_zero_area_indices(d,b)
 # Preserve artist-authored corrective keyframes but combine their auxiliary
 # Blender action with the named seated clip. Rest/gait default weights stay 0.
 grip=[a for a in d.get('animations',[])if a['name']=='driver-grip']
 if grip:
  assert len(grip)==1
  seated=next(a for a in d['animations']if a['name']=='driver-seated');offset=len(seated['samplers']);seated['samplers'].extend(grip[0]['samplers'])
  for channel in grip[0]['channels']:
   assert channel['target']['path']=='weights';channel=dict(channel,sampler=channel['sampler']+offset);seated['channels'].append(channel)
  d['animations'].remove(grip[0])
  for mesh in d['meshes']:
   names=mesh.get('extras',{}).get('targetNames',[])
   if 'DriverGrip'in names:mesh['weights'][names.index('DriverGrip')]=0
  for node in d['nodes']:
   if 'mesh'in node and 'weights'in node:
    names=d['meshes'][node['mesh']].get('extras',{}).get('targetNames',[])
    if 'DriverGrip'in names:node['weights'][names.index('DriverGrip')]=0
 images={im.get('bufferView'):im for im in d.get('images',[]) if 'bufferView'in im};new=bytearray();views=[];remap={};cost=[]
 for ix,v in enumerate(d['bufferViews']):
  dat=b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
  if ix in images:
   im=images[ix];sha=hashlib.sha256(dat).hexdigest();name=f'citizen-{sha[:16]}.png';dest=path.parent/'textures'/name;dest.parent.mkdir(exist_ok=True);dest.write_bytes(dat)
   im.pop('bufferView');im.pop('mimeType',None);im['uri']='textures/'+name;cost.append({'uri':im['uri'],'sha256':sha,'bytes':len(dat)});continue
  new.extend(b'\0'*((-len(new))%4));nv=dict(v,byteOffset=len(new),buffer=0);remap[ix]=len(views);views.append(nv);new.extend(dat)
 for a in d['accessors']:
  assert 'sparse'not in a,'Export ordinary backed morph accessors for the package common contract'
  if 'bufferView'in a:a['bufferView']=remap[a['bufferView']]
 d['bufferViews']=views
 # Blender's re-import/export float conversions introduce sub-micron bind drift.
 # Restore the exact baseline 22 matrices, by verified joint-name order.
 rd,rb=read_glb(reference);rs=rd['skins'][0];ra=rd['accessors'][rs['inverseBindMatrices']];rv=rd['bufferViews'][ra['bufferView']];rdata=rb[rv.get('byteOffset',0)+ra.get('byteOffset',0):rv.get('byteOffset',0)+ra.get('byteOffset',0)+ra['count']*64]
 rn=[rd['nodes'][j]['name'] for j in rs['joints']]
 for s in d.get('skins',[]):
  names=[d['nodes'][j]['name'] for j in s['joints']];assert names==rn,(names,rn)
  a=d['accessors'][s['inverseBindMatrices']];v=d['bufferViews'][a['bufferView']];start=v.get('byteOffset',0)+a.get('byteOffset',0);assert a['count']==22 and v.get('byteStride',64)==64
  actual=struct.unpack('<352f',bytes(new[start:start+len(rdata)]));expected=struct.unpack('<352f',rdata)
  assert max(abs(x-y) for x,y in zip(actual,expected))<2e-5,'Rig rest matrices changed; refuse to silently overwrite an artist retarget with original binds'
  new[start:start+len(rdata)]=rdata
 write_glb(path,d,bytes(new));return cost
