"""Mutation regression for the package-specific gates; never edits delivered assets."""
import importlib.util,json,shutil,tempfile,unittest,struct
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('validator',HERE/'validate.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)

class PackageTests(unittest.TestCase):
    def setUp(self):
        self.work=Path(tempfile.mkdtemp(prefix='tree-validator-test-'));self.root=self.work/'mature-tree-templates';self.root.mkdir()
        for name in ['manifest.json','exports','source']:
            source=HERE/name;dest=self.root/name
            if source.is_dir():shutil.copytree(source,dest,ignore=shutil.ignore_patterns('*.blend1','__pycache__'))
            else:shutil.copy2(source,dest)
        (self.root/'qa').mkdir();(self.work/'vegetation_ground/maps').mkdir(parents=True);shutil.copy2(HERE.parent/'vegetation_ground/maps/leaf_atlas_rgba.png',self.work/'vegetation_ground/maps/leaf_atlas_rgba.png');self.m=json.loads((self.root/'manifest.json').read_text())
    def tearDown(self):shutil.rmtree(self.work)
    def save(self): (self.root/'manifest.json').write_text(json.dumps(self.m))
    def test_delivered_package_passes(self):self.assertEqual(v.validate(self.root,False)['status'],'pass')
    def test_near_broadleaf_has_no_opaque_crown(self):
        for asset in self.m['assets'][:2]:
            _,parts=v.primitives(self.root/asset['lods'][0]['file'])
            foliage=[mat for name,ps,uv,idx,mat in parts if name.startswith('foliage')]
            self.assertEqual(len(foliage),2)
            self.assertTrue(all(mat['alphaMode']=='MASK' for mat in foliage))
    def test_source_height_double_scale_rejected(self):
        self.m['assets'][0]['templateHeightM']=1;self.save()
        with self.assertRaises(AssertionError):v.validate(self.root,False)
    def test_legacy_alpha_decoder_contract_rejected(self):
        lod=self.m['assets'][0]['lods'][0];p=self.root/lod['file'];doc,binary=v.c.read_glb(p)
        mat=next(m for m in doc['materials'] if m['name']=='foliage-straight-alpha');mat['alphaCutoff']=.1
        raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
        p.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(raw)+len(binary))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
        lod['sha256']=v.c.digest(p);lod['bytes']=p.stat().st_size;self.save()
        with self.assertRaises(AssertionError):v.validate(self.root,False)
    def test_source_tamper_rejected(self):
        p=self.root/self.m['assets'][0]['source'];p.write_bytes(p.read_bytes()+b'changed')
        with self.assertRaises(ValueError):v.validate(self.root,False)
    def test_fake_measured_bounds_rejected(self):
        self.m['assets'][0]['lods'][0]['boundsM']['max'][1]=100;self.save()
        with self.assertRaises(ValueError):v.validate(self.root,False)

if __name__=='__main__':unittest.main()
