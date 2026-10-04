import importlib.util
from pathlib import Path
import tempfile
import unittest
s=importlib.util.spec_from_file_location('isolation',Path(__file__).with_name('verify_isolation.py')); v=importlib.util.module_from_spec(s); s.loader.exec_module(v)
class IsolationTests(unittest.TestCase):
    def test_payload_and_url_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); package=root/'candidate'; dist=root/'dist'; package.mkdir(); dist.mkdir()
            (package/'object.glb').write_bytes(b'example glb'); (dist/'main.js').write_text('production')
            self.assertEqual(v.verify(package,dist)['status'],'pass')
            (dist/'renamed.bin').write_bytes(b'example glb')
            with self.assertRaises(ValueError): v.verify(package,dist)
            (dist/'renamed.bin').unlink(); (dist/'main.js').write_text('fetch("object.glb")')
            with self.assertRaises(ValueError): v.verify(package,dist)
    def test_missing_payloads_not_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): v.verify(tmp,tmp)
if __name__=='__main__': unittest.main()
