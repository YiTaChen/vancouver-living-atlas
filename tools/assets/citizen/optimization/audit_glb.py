import json,struct,io
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent
results=[]
for p in sorted((root/'glb').glob('*.glb')):
 b=p.read_bytes();assert b[:4]==b'glTF';n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);bin=b[28+n:]
 assert len(j['skins'])==1 and len(j['skins'][0]['joints'])==22
 assert len(j['meshes'])==1 and len(j['meshes'][0]['primitives'])==1
 m=j['materials'][0];assert 'baseColorTexture' in m['pbrMetallicRoughness'] and 'metallicRoughnessTexture' in m['pbrMetallicRoughness'] and 'normalTexture' in m
 imgs=[]
 for im in j['images']:
  v=j['bufferViews'][im['bufferView']];off=v.get('byteOffset',0);data=bin[off:off+v['byteLength']];pic=Image.open(io.BytesIO(data));pic.verify();imgs.append({'name':im.get('name'),'width':pic.width,'height':pic.height,'bytes':len(data)})
 results.append({'file':p.name,'bytes':len(b),'triangles':j['accessors'][j['meshes'][0]['primitives'][0]['indices']]['count']//3,'joints':22,'primitives':1,'images':imgs,'animations':[a['name'] for a in j['animations']]})
(root/'qa/glb-audit.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
