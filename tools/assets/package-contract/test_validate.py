import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('contract',Path(__file__).with_name('validate.py'))
v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)


def sample(path, mutate=None, positions=None):
    positions=positions or [(0,0,0),(1,0,0),(0,1,0)]
    binary=b''.join(struct.pack('<3f',*p) for p in positions)+struct.pack('<9f',*(0,0,1)*3)+struct.pack('<3H',0,1,2)+b'\0\0'
    doc={'asset':{'version':'2.0'},'buffers':[{'byteLength':78}],
         'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':36,'byteLength':36},{'buffer':0,'byteOffset':72,'byteLength':6}],
         'accessors':[{'bufferView':0,'componentType':5126,'type':'VEC3','count':3},{'bufferView':1,'componentType':5126,'type':'VEC3','count':3},{'bufferView':2,'componentType':5123,'type':'SCALAR','count':3}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1},'indices':2}]}],
         'nodes':[{'name':'parent','translation':[2,3,4],'children':[1]},{'name':'mesh','mesh':0,'scale':[2,2,2]}],
         'scenes':[{'nodes':[0]}],'scene':0}
    if mutate: mutate(doc)
    j=json.dumps(doc).encode(); j+=b' '*((-len(j))%4)
    raw=struct.pack('<4sII',b'glTF',2,28+len(j)+len(binary))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    path.write_bytes(raw)

class ContractTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.path=Path(self.tmp.name)/'sample.glb'
    def tearDown(self): self.tmp.cleanup()
    def reject(self,fn):
        sample(self.path,fn)
        with self.assertRaises((ValueError,IndexError,KeyError)): v.measure_glb(self.path)
    def test_nested_transform_once(self):
        sample(self.path); r=v.measure_glb(self.path)
        self.assertEqual(r['boundsM'],{'min':[2,3,4],'max':[4,5,4],'size':[2,2,0]})
        self.assertEqual((r['triangles'],r['vertices'],r['primitives']),(1,3,1))
    def test_quaternion(self):
        s=2**-.5; m=v.transform({'rotation':[0,0,s,s],'translation':[1,0,0]})
        self.assertAlmostEqual(v.point(m,[1,0,0])[0],1); self.assertAlmostEqual(v.point(m,[1,0,0])[1],1)
    def test_cycle(self): self.reject(lambda d:d['nodes'][1].update(children=[0]))
    def test_multiple_parent(self): self.reject(lambda d:d['scenes'][0]['nodes'].append(1))
    def test_bad_index_accessor(self): self.reject(lambda d:d['accessors'][2].update(componentType=5126))
    def test_out_of_bounds_view(self): self.reject(lambda d:d['bufferViews'][0].update(byteLength=10000))
    def test_sparse_unsupported(self): self.reject(lambda d:d['accessors'][0].update(sparse={}))
    def test_nonfinite(self): self.reject(lambda d:d['nodes'][0].update(translation=[float('nan'),0,0]))
    def test_invalid_quaternion(self): self.reject(lambda d:d['nodes'][0].update(rotation=[0,0,0,2]))
    def test_negative_scale(self): self.reject(lambda d:d['nodes'][0].update(scale=[-1,1,1]))
    def test_reference_camera(self): self.reject(lambda d:d.update(cameras=[{}]))
    def test_reference_light(self): self.reject(lambda d:d.update(extensions={'KHR_lights_punctual':{'lights':[{}]}}))
    def test_degenerate(self):
        sample(self.path,positions=[(0,0,0)]*3)
        with self.assertRaises(ValueError): v.measure_glb(self.path)
    def test_path_escape(self):
        with self.assertRaises(ValueError): v.inside(Path(self.tmp.name),'../outside')
    def test_negative_matrix(self):
        def change(d):
            d['nodes'][0]={'matrix':[-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'children':[1]}
        self.reject(change)
    def test_nonaffine_matrix(self):
        def change(d):
            d['nodes'][0]={'matrix':[1,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1],'children':[1]}
        self.reject(change)
    def test_matrix_with_trs(self): self.reject(lambda d:d['nodes'][0].update(matrix=v.IDENTITY))

if __name__=='__main__': unittest.main()
