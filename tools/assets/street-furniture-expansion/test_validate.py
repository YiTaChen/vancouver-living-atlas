"""Positive and adversarial package-acceptance fixtures; never edits shipped sources."""
import json,tempfile,unittest,shutil
from pathlib import Path
from validate import check
HERE=Path(__file__).resolve().parent
class ContractFixtures(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(prefix='furniture-validator-');self.root=Path(self.t.name)/'candidate';shutil.copytree(HERE,self.root,ignore=shutil.ignore_patterns('__pycache__','*.blend1'));self.m=json.loads((self.root/'manifest.json').read_text())
    def tearDown(self):self.t.cleanup()
    def reject(self):
        (self.root/'manifest.json').write_text(json.dumps(self.m))
        with self.assertRaises((AssertionError,ValueError,FileNotFoundError,KeyError)):check(self.root,write=False)
    def test_positive(self):self.assertEqual(check(self.root,write=False)['status'],'pass')
    def test_no_missing_lod(self):self.m['assets'][0]['lods'].pop();self.reject()
    def test_no_false_triangle_budget(self):self.m['assets'][0]['lodPolicy']['triangleCaps'][0]=1;self.reject()
    def test_no_false_byte_budget(self):self.m['assets'][0]['lodPolicy']['geometryByteCaps'][0]=1;self.reject()
    def test_no_false_dimensions(self):self.m['assets'][0]['expectedDimensionsM']['width']=4;self.reject()
    def test_no_stale_source(self):self.m['assets'][0]['sourceSha256']='0'*64;self.reject()
    def test_no_stale_output(self):self.m['assets'][0]['lods'][0]['sha256']='0'*64;self.reject()
    def test_no_role_guessing(self):self.m['assets'][0]['materialBindings'][0]['role']='stone';self.reject()
    def test_no_runtime_pass_claim(self):self.m['assets'][0]['runtimeChecks']['status']='pass';self.reject()
    def test_no_source_escape(self):self.m['assets'][0]['source']='../../../../LICENSE';self.reject()
    def test_no_missing_artist_test(self):(self.root/'qa/artist-edit.json').unlink();self.reject()
    def test_no_missing_render(self):next((self.root/'qa/previews').glob('*.png')).unlink();self.reject()
if __name__=='__main__':unittest.main(verbosity=2)
