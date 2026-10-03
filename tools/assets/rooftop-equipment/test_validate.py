"""Negative fixtures alter copies, never production/source evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('roof_validation',HERE/'validate.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)

class RooftopContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'package';self.root.mkdir()
        for directory in ['exports','source']:shutil.copytree(HERE/directory,self.root/directory)
        shutil.copy2(HERE/'manifest.json',self.root/'manifest.json');self.m=json.loads((self.root/'manifest.json').read_text())
    def tearDown(self):self.tmp.cleanup()
    def save(self): (self.root/'manifest.json').write_text(json.dumps(self.m))
    def bad(self,text):
        self.save()
        with self.assertRaisesRegex(ValueError,text):v.validate(self.root)
    def edit_glb(self,edit):
        lod=self.m['assets'][0]['lods'][0];path=self.root/lod['file'];doc,bin=v.c.read_glb(path);binary=bytearray(bin);edit(doc,binary)
        js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4)
        raw=struct.pack('<4sII',b'glTF',2,28+len(js)+len(binary))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary
        path.write_bytes(raw);lod['sha256']=v.c.digest(path);lod['bytes']=len(raw);lod['geometryBytes']=len(raw)
    def test_positive(self):self.assertEqual(v.validate(self.root)['status'],'pass')
    def test_wrong_glb_hash(self):self.m['assets'][0]['lods'][0]['sha256']='0'*64;self.bad('GLB hash')
    def test_wrong_source_hash(self):self.m['assets'][0]['sourceSha256']='0'*64;self.bad('source hash')
    def test_wrong_size(self):self.m['assets'][0]['expectedDimensionsM'][0]=20;self.bad('target dimensions')
    def test_wrong_datum(self):self.m['assets'][0]['attachmentDatum']['planeY']=.15;self.bad('roof contact')
    def test_wrong_footprint(self):self.m['assets'][0]['clearance']['footprintPolygonXZ'][0][0]=-99;self.bad('footprint')
    def test_wrong_clearance(self):self.m['assets'][0]['clearance']['roofExclusionMarginM']=0;self.bad('footprint')
    def test_runtime_claim_rejected(self):self.m['assets'][0]['runtimeChecks']['status']='pass';self.bad('runtime status')
    def test_missing_common_field(self):del self.m['assets'][0]['anchors'];self.bad('required asset fields')
    def test_wrong_bounds(self):self.m['assets'][0]['lods'][0]['boundsM']['min'][1]=.1;self.bad('bounds mismatch')
    def test_transform_applied(self):self.edit_glb(lambda d,b:d['nodes'][0].update(translation=[0,.15,0]));self.bad('bounds mismatch')
    def test_negative_scale(self):self.edit_glb(lambda d,b:d['nodes'][0].update(scale=[-1,1,1]));self.bad('negative or zero')
    def test_qa_node(self):self.edit_glb(lambda d,b:d['nodes'][0].update(name='qa-human'));self.bad('stable runtime node')
    def test_no_uv(self):self.edit_glb(lambda d,b:d['meshes'][0]['primitives'][0]['attributes'].pop('TEXCOORD_0'));self.bad('UV/tangents')
    def test_no_tangent(self):self.edit_glb(lambda d,b:d['meshes'][0]['primitives'][0]['attributes'].pop('TANGENT'));self.bad('UV/tangents')
    def test_wrong_material_role(self):self.edit_glb(lambda d,b:d['materials'][0]['extras'].update(semantic_role='glass'));self.bad('material semantic')
    def test_double_sided(self):self.edit_glb(lambda d,b:d['materials'][0].update(doubleSided=True));self.bad('opaque single-sided')
    def test_nonfinite_vertex(self):
        def edit(d,b):
            a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['POSITION']];view=d['bufferViews'][a['bufferView']]
            struct.pack_into('<f',b,view.get('byteOffset',0)+a.get('byteOffset',0),float('nan'))
        self.edit_glb(edit);self.bad('nonfinite accessor')
    def test_out_of_bounds_index(self):
        def edit(d,b):
            a=d['accessors'][d['meshes'][0]['primitives'][0]['indices']];view=d['bufferViews'][a['bufferView']]
            fmt={5123:'H',5125:'I',5121:'B'}[a['componentType']];struct.pack_into('<'+fmt,b,view.get('byteOffset',0)+a.get('byteOffset',0),65535 if fmt!='B' else 255)
        self.edit_glb(edit);self.bad('triangle indices')
    def test_degenerate_triangle(self):
        def edit(d,b):
            a=d['accessors'][d['meshes'][0]['primitives'][0]['indices']];view=d['bufferViews'][a['bufferView']];pos=view.get('byteOffset',0)+a.get('byteOffset',0)
            fmt={5123:'H',5125:'I',5121:'B'}[a['componentType']];size=struct.calcsize(fmt);b[pos+size:pos+size*3]=b[pos:pos+size]*2
        self.edit_glb(edit);self.bad('degenerate triangle')
    def test_truncated_glb(self):
        lod=self.m['assets'][0]['lods'][0];path=self.root/lod['file'];path.write_bytes(path.read_bytes()[:-9]);lod['sha256']=v.c.digest(path);self.bad('GLB header')
    def test_changed_source_bytes(self):
        src=self.root/self.m['assets'][0]['source'];src.write_bytes(src.read_bytes()+b'changed');self.bad('source hash')

if __name__=='__main__':unittest.main(verbosity=2)
