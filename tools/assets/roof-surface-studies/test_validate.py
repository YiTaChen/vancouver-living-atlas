"""Fast positive/negative package-contract regressions (no Blender process)."""
from pathlib import Path
import importlib.util
import json
import shutil
import tempfile
import unittest
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('roof_validate',HERE/'validate.py'); v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

class PackageValidation(unittest.TestCase):
    def altered(self, change, target='manifest.json'):
        with tempfile.TemporaryDirectory(prefix='roof-invalid-fixture-') as d:
            root=Path(d)/'package'; shutil.copytree(HERE,root,ignore=shutil.ignore_patterns('__pycache__'))
            p=root/target; data=json.loads(p.read_text()); change(data); p.write_text(json.dumps(data))
            with self.assertRaises(ValueError): v.validate(root)
    def test_delivered_package(self): self.assertEqual(v.validate(HERE)['status'],'pass')
    def test_reject_stale_source_hash(self): self.altered(lambda m:m['assets'][0].__setitem__('sourceSha256','0'*64))
    def test_reject_wrong_transformed_bounds(self): self.altered(lambda m:m['assets'][0]['lods'][0]['boundsM']['size'].__setitem__(0,20))
    def test_reject_wrong_primitive_count(self): self.altered(lambda m:m['assets'][0]['lods'][0].__setitem__('primitives',2))
    def test_reject_stale_texture_hash(self): self.altered(lambda m:m['textures'][0].__setitem__('sha256','0'*64))
    def test_reject_unproven_periodicity(self): self.altered(lambda m:m['periodicityRebake'].__setitem__('status','not_run'),'qa/source-edit-test.json')
    def test_reject_stale_preview_evidence(self): self.altered(lambda m:m['renders'][0].__setitem__('sha256','0'*64),'qa/render-evidence.json')
    def test_reject_unrendered_detail(self): self.altered(lambda m:m.__setitem__('renders',[]),'qa/detail-render-evidence.json')

if __name__=='__main__': unittest.main()
