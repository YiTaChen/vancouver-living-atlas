"""Negative contract and real-GLB regression tests, without modifying the delivery."""
import copy,json,sys,tempfile,unittest,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from validate import validate_manifest,negative_tests,ROOT,common,geometry
class MetroContractTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.m=json.loads((ROOT/'manifest.json').read_text())
 def test_actual_geometry(self):self.assertEqual(len(validate_manifest(self.m)),6)
 def test_negative_contracts(self):self.assertEqual(len(negative_tests(self.m)),12)
 def test_named_anchor_displacement_rejected(self):
  m=copy.deepcopy(self.m);m['vehicles'][0]['anchors'][0]['positionM'][0]+=.2
  with self.assertRaisesRegex(ValueError,'anchor position'):validate_manifest(m)
 def test_floor_collision_displacement_rejected(self):
  m=copy.deepcopy(self.m);p=next(p for p in m['vehicles'][0]['collision']['primitives'] if p['id']=='continuous-floor');p['boundsM']['max'][1]+=.05
  with self.assertRaisesRegex(ValueError,'floor collision'):validate_manifest(m)
 def test_consist_length_rejected(self):
  m=copy.deepcopy(self.m);m['composition']['actualBoundsM']['max'][2]+=.5
  with self.assertRaisesRegex(ValueError,'composed train bounds'):validate_manifest(m,deep=False)
 def test_batch_range_mutations_rejected(self):
  path=ROOT/self.m['assets'][3]['lods'][0]['file'];original,binary=common.read_glb(path)
  mutations=[('index gap',lambda r:r.update(indexStart=3)),('vertex range escape',lambda r:r.update(vertexCount=1)),('wrong component identity',lambda r:r.update(componentId='fake-component')),('wrong source node index',lambda r:r.update(sourceNodeIndex=999999)),('wrong bounds',lambda r:r['boundsM']['min'].__setitem__(1,-999))]
  for name,edit in mutations:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
    doc=copy.deepcopy(original);node=next(n for n in doc['nodes'] if n.get('extras',{}).get('componentRanges'));edit(node['extras']['componentRanges'][0]);raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);payload=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(binary))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(binary),b'BIN\0')+binary;p=Path(tmp)/'mutated.glb';p.write_bytes(payload)
    with self.assertRaises(ValueError):geometry(p)
 def test_batch_is_six_primitives(self):
  for l in self.m['assets'][3]['lods']:
   doc,_=common.read_glb(ROOT/l['file']);self.assertEqual(l['primitives'],6);self.assertEqual(doc['extras']['staticBatching']['renderPrimitiveCount'],6)
 def test_truncated_glb_rejected(self):
  data=(ROOT/self.m['assets'][0]['lods'][0]['file']).read_bytes()
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'bad.glb';p.write_bytes(data[:-4])
   with self.assertRaisesRegex(ValueError,'GLB header'):common.read_glb(p)
if __name__=='__main__':unittest.main()
