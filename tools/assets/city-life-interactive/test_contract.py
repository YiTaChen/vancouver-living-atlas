import unittest,json,struct,tempfile,copy
from pathlib import Path
import validate as v
class Contract(unittest.TestCase):
 def setUp(self):self.d,self.b=v.c.read_glb(v.ROOT/'exports/pedestrian-commuter.glb')
 def reject(self,change):
  d=copy.deepcopy(self.d);change(d);j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);b=self.b;b+=b'\0'*((-len(b))%4)
  raw=struct.pack('<4sII',b'glTF',2,28+len(j)+len(b))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(b),b'BIN\0')+b
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'bad.glb';p.write_bytes(raw)
   with self.assertRaises((AssertionError,ValueError,KeyError,IndexError)):v.audit(p)
 def test_missing_skin(self):self.reject(lambda d:d.pop('skins'))
 def test_wrong_bone_count(self):self.reject(lambda d:d['skins'][0]['joints'].pop())
 def test_missing_clip(self):self.reject(lambda d:d['animations'].pop())
 def test_duplicate_clip(self):self.reject(lambda d:d['animations'][0].update(name='idle'))
 def test_missing_weights(self):self.reject(lambda d:d['meshes'][0]['primitives'][0]['attributes'].pop('WEIGHTS_0'))
 def test_external_texture(self):self.reject(lambda d:d.update(textures=[{}]))
 def test_transparent_material(self):self.reject(lambda d:d['materials'][0].update(alphaMode='BLEND'))
 def test_wrong_animated_target(self):self.reject(lambda d:d['animations'][0]['channels'][0]['target'].update(node=999))
if __name__=='__main__':unittest.main()
