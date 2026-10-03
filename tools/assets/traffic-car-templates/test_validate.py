import importlib.util,json,tempfile,unittest,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('car_validator',HERE/'validate.py');v=importlib.util.module_from_spec(sp);sp.loader.exec_module(v)
class TrafficCarContractTest(unittest.TestCase):
 def test_delivered_package(self):self.assertEqual(v.validate()['status'],'pass')
 def invalid(self,change):
  with tempfile.TemporaryDirectory(prefix='car-negative-') as tmp:
   root=Path(tmp)/'package';shutil.copytree(HERE,root);p=root/'manifest.json';m=json.loads(p.read_text());change(m);p.write_text(json.dumps(m))
   with self.assertRaises((ValueError,AssertionError,KeyError)):v.validate(root)
 def test_wrong_wheel_radius(self):self.invalid(lambda m:m['assets'][0]['anchors'][1].update(radiusM=.50))
 def test_stale_source_hash(self):self.invalid(lambda m:m['assets'][0]['lods'][0].update(sourceSha256='0'*64))
 def test_primitive_binding_swap(self):self.invalid(lambda m:m['assets'][0]['materialBindings'][0]['primitiveBindingsByLod']['0'][0].update(primitive=999))
 def test_wrong_axis(self):self.invalid(lambda m:m['assets'][0].update(frontAxis='-Z'))
 def test_wrong_lod_cost(self):self.invalid(lambda m:m['assets'][0]['lods'][2].update(triangles=121))
 def test_missing_role(self):self.invalid(lambda m:m['assets'][0]['materialBindings'].pop())
 def test_short_collision(self):self.invalid(lambda m:m['assets'][0]['collision']['primitives'][0].update(sizeM=[1,1,1]))
 def test_short_turn_envelope(self):self.invalid(lambda m:m['assets'][0]['clearance']['turningEnvelope'].update(outerRadiusM=1))
if __name__=='__main__':unittest.main()
