"""Small regression/negative checks for this independent partial package."""
import importlib.util,json,shutil,tempfile,unittest,copy,struct
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('audit',HERE/'validate.py');A=importlib.util.module_from_spec(sp);sp.loader.exec_module(A)
class MarkVPackageTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.m=json.loads((HERE/'manifest.json').read_text());cls.asset=cls.m['assets'][0];cls.docs=[A.C.read_glb(HERE/l['file'])[0] for l in cls.asset['lods']]
 def test_two_budget_lods(self):
  self.assertEqual([0,1],[l['level'] for l in self.asset['lods']]);self.assertLessEqual(self.asset['lods'][0]['triangles'],12000);self.assertLessEqual(self.asset['lods'][1]['triangles'],3000)
 def test_actual_binary_matches_measured_counts(self):
  for l in self.asset['lods']:
   m=A.C.measure_glb(HERE/l['file'])
   for k in ['triangles','vertices','primitives','bytes']:self.assertEqual(l[k],m[k])
 def test_seat_and_door_anchors_retained(self):
  for d in self.docs:
   self.assertEqual(22,sum(n.get('name','').endswith('-pelvis') for n in d['nodes']));self.assertEqual(6,sum(n.get('name','').startswith('doorway-') for n in d['nodes']))
 def test_master_separate_and_not_budget_claimed(self):
  self.assertEqual('mark-v-a-car-study',self.m['assets'][1]['id']);self.assertGreater(self.m['assets'][1]['lods'][0]['triangles'],12000)
 def test_no_runtime_claim(self):
  self.assertEqual('not_run',self.asset['runtimeChecks']['status']);self.assertFalse(self.asset['placementCompatibility']['CanadaLine3m']);self.assertFalse(self.asset['placementCompatibility']['legacyExpoFourCar'])
 def test_packed_original_images_and_no_lights(self):
  for d in self.docs:
   self.assertEqual(3,len(d['images']));self.assertTrue(all('bufferView' in im for im in d['images']));self.assertFalse(d.get('cameras'));self.assertFalse(d.get('animations'));self.assertNotIn('KHR_lights_punctual',d.get('extensions',{}))
 def test_source_hashes(self):
  for a in self.m['assets']:
   for l in a['lods']:self.assertEqual(l['sourceSha256'],A.C.digest(HERE/l['source']))
 def test_negative_sidecar_hash_rejected(self):
  src=HERE/self.asset['lods'][1]['file']
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/src.name;shutil.copyfile(src,p);s=json.loads(src.with_suffix('.components.json').read_text());s['glbSha256']='0'*64;p.with_suffix('.components.json').write_text(json.dumps(s))
   with self.assertRaisesRegex(ValueError,'hash mismatch'):A.component_rows(p)
 def test_negative_component_bounds_rejected(self):
  src=HERE/self.asset['lods'][1]['file']
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/src.name;shutil.copyfile(src,p);s=json.loads(src.with_suffix('.components.json').read_text());s['batches'][0]['ranges'][0]['boundsM']['min'][0]-=.5;p.with_suffix('.components.json').write_text(json.dumps(s))
   with self.assertRaisesRegex(ValueError,'bounds do not match'):A.component_rows(p)
 def mutate_sidecar(self,mutator,pattern):
  src=HERE/self.asset['lods'][1]['file']
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/src.name;shutil.copyfile(src,p);s=json.loads(src.with_suffix('.components.json').read_text());mutator(s);p.with_suffix('.components.json').write_text(json.dumps(s))
   with self.assertRaisesRegex(ValueError,pattern):A.component_rows(p)
 def test_negative_empty_batches_rejected(self):
  self.mutate_sidecar(lambda s:s.update(batches=[]),'missing/empty')
 def test_negative_missing_batch_rejected(self):
  self.mutate_sidecar(lambda s:s['batches'].pop(),'every mesh')
 def test_negative_missing_obstacle_range_rejected(self):
  self.mutate_sidecar(lambda s:s['batches'][0]['ranges'].pop(),'coverage')
 def test_negative_duplicate_overlap_rejected(self):
  self.mutate_sidecar(lambda s:s['batches'][0]['ranges'].append(s['batches'][0]['ranges'][0]),'gap/overlap')
 def test_negative_out_of_bounds_rejected(self):
  self.mutate_sidecar(lambda s:s['batches'][0]['ranges'][0].update(indexStart=999999),'out of bounds')
 def test_negative_manifest_sidecar_hash_rejected(self):
  with self.assertRaisesRegex(ValueError,'manifest hash mismatch'):A.component_rows(HERE/self.asset['lods'][0]['file'],'0'*64)
 def mutated_glb(self,mutator,pattern):
  src=HERE/self.asset['lods'][1]['file'];doc,raw=A.C.read_glb(src);mutator(doc)
  payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4)
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/src.name;p.write_bytes(struct.pack('<4sII',b'glTF',2,12+8+len(payload)+8+len(raw))+struct.pack('<I4s',len(payload),b'JSON')+payload+struct.pack('<I4s',len(raw),b'BIN\0')+raw)
   side=json.loads(src.with_suffix('.components.json').read_text());side['glbSha256']=A.C.digest(p);p.with_suffix('.components.json').write_text(json.dumps(side))
   with self.assertRaisesRegex(ValueError,pattern):A.component_rows(p)
 def test_negative_translated_batch_rejected(self):
  self.mutated_glb(lambda d:next(n for n in d['nodes'] if n.get('name')=='interior-batch-rail').update(translation=[.2,0,0]),'batch transform')
 def test_negative_translated_ancestor_rejected(self):
  self.mutated_glb(lambda d:next(n for n in d['nodes'] if n.get('name')=='vehicle').update(translation=[.2,0,0]),'ancestor transform')
 def test_negative_duplicate_anchor_rejected(self):
  d=copy.deepcopy(self.docs[0]);ns=[n for n in d['nodes'] if n.get('name','').endswith('-pelvis')];ns[0]['name']=ns[1]['name']
  with self.assertRaisesRegex(ValueError,'duplicate'):A.validate_anchors(d,json.loads((HERE/'layout-assumptions.json').read_text()))
 def test_negative_displaced_pelvis_rejected(self):
  d=copy.deepcopy(self.docs[0]);next(n for n in d['nodes'] if n.get('name','').endswith('-pelvis'))['translation']=[0,20,0]
  with self.assertRaisesRegex(ValueError,'transformed position'):A.validate_anchors(d,json.loads((HERE/'layout-assumptions.json').read_text()))
 def test_negative_displaced_camera_rejected(self):
  d=copy.deepcopy(self.docs[0]);next(n for n in d['nodes'] if n.get('name','').startswith('seat-') and n['name'].endswith('-camera'))['translation']=[0,20,0]
  with self.assertRaisesRegex(ValueError,'transformed position'):A.validate_anchors(d,json.loads((HERE/'layout-assumptions.json').read_text()))
 def test_positive_floor_support_both_lods(self):
  for l in self.asset['lods']:
   doc,rows=A.component_rows(HERE/l['file'],l['componentsSha256'])
   for z in [-7.4,-4.9,0,4.9,5.35]:self.assertAlmostEqual(0,A.support_height(rows,.33,z),places=5)
   for z in [-8.38,-8.1,-7.82]:self.assertAlmostEqual(.0025,A.support_height(rows,0,z),places=5)
 def test_negative_missing_floor_not_valid(self):
  doc,rows=A.component_rows(HERE/self.asset['lods'][0]['file']);rows=[r for r in rows if r['name']!='floor-slab'];self.assertIsNone(A.support_height(rows,.33,0))
 def test_negative_truncated_glb_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'bad.glb';p.write_bytes(b'glTF')
   with self.assertRaisesRegex(ValueError,'truncated'):A.C.read_glb(p)
if __name__=='__main__':unittest.main(verbosity=2)
