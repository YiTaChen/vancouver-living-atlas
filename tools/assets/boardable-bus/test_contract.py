"""Fast positive/negative regression checks for actual bus geometry and QA guards."""
import copy,json,struct,tempfile,unittest
from pathlib import Path
import validate as V
HERE=Path(__file__).resolve().parent
class ContractTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.m=json.loads((HERE/'manifest.json').read_text());cls.vehicle=cls.m['vehicles'][0]
  cls.scene,cls.doc,cls.bin=V.load(HERE/cls.m['assets'][0]['lods'][0]['file'])
 def test_empty_and_blocked_corridor(self):
  a=[-1.8,1.4,4.275];b=[-.73,1.4,4.275]
  self.assertFalse(V.hits([],a,b))
  blocker=([-1.25,.36,3.70],[-1.25,.36,4.85],[-1.25,2.46,4.85])
  self.assertTrue(V.hits([blocker],a,b),'Synthetic sealed portal must be detected')
 def test_real_closed_and_open_portal(self):
  a=[-1.8,1.4,4.125];b=[-.73,1.4,4.125]
  self.assertTrue(V.hits(V.alltris(self.scene),a,b))
  overrides={d['nodeId']:d['openTransform']['translationM'] for d in self.vehicle['doors']}
  scene,_,_=V.load(HERE/self.m['assets'][0]['lods'][0]['file'],overrides)
  self.assertFalse(V.hits(V.alltris(scene),a,b))
 def test_independent_door_clips(self):
  names={a['name'] for a in self.doc['animations']}
  self.assertEqual(names,{d['animationClip'] for d in self.vehicle['doors']})
  for a in self.doc['animations']:
   self.assertEqual(len(a['channels']),1)
   self.assertEqual(self.doc['nodes'][a['channels'][0]['target']['node']]['name'],a['name'].removesuffix('-open'))
 def test_swept_bounds_reject_escape(self):
  b=self.vehicle['doors'][0]['sweptBoundsM'];self.assertTrue(V.inside_bounds(self.vehicle['doors'][0]['openTransform']['translationM'],b));self.assertFalse(V.inside_bounds([-1.5,.36,4],b))
 def test_coarse_state_lock(self):
  c=self.vehicle['lodCapabilities'][2]
  self.assertFalse(c['doorsAnimated'] or c['passengerCapable'] or c['openingsPreserved'])
 def test_static_batch_draw_and_anchor_contract(self):
  for lod in self.m['assets'][1]['lods']:
   scene,doc,_=V.load(HERE/lod['file']);self.assertEqual(lod['primitives'],7)
   components=[o for o in scene.values() if o.get('batchComponent')];self.assertEqual(len(components),72 if lod['level']==0 else 62)
   self.assertTrue(all('mesh'not in o['node'] for o in components))
   self.assertEqual(len(V.alltris(scene)),lod['triangles'])
 def test_corrupt_batch_range_rejected(self):
  path=HERE/self.m['assets'][1]['lods'][0]['file'];doc,binary=V.C.read_glb(path)
  node=next(n for n in doc['nodes'] if n.get('extras',{}).get('componentRanges'));node['extras']['componentRanges'][0]['vertexStart']+=1
  jb=json.dumps(doc,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4)
  data=struct.pack('<4sII',b'glTF',2,28+len(jb)+len(binary))+struct.pack('<I4s',len(jb),b'JSON')+jb+struct.pack('<I4s',len(binary),b'BIN\0')+binary
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/'corrupt.glb';p.write_bytes(data)
   with self.assertRaisesRegex(AssertionError,'range gaps or overlap'):V.load(p)
 def test_lod2_opaque_window_role(self):
  _,doc,_=V.load(HERE/self.m['assets'][0]['lods'][2]['file']);glass=next(m for m in doc['materials'] if m['name']=='glass')
  self.assertEqual(glass.get('alphaMode','OPAQUE'),'OPAQUE');color=glass['pbrMetallicRoughness']['baseColorFactor'];self.assertEqual(color[3],1);self.assertLess(max(color[:3]),.1)
 def test_batch_normal_inverse_transpose(self):
  from batch_static import normal
  m=[0,0,-2,0, 0,3,0,0, 4,0,0,0, 0,0,0,1]
  self.assertEqual(normal(m,[1,0,0]),[0,0,-1]);self.assertEqual(normal(m,[0,1,0]),[0,1,0])
 def test_floor_winding_reversal_detectable(self):
  f=self.vehicle['floorSurfaces'][0];a,b,c=[f['verticesM'][i] for i in f['indices'][:3]]
  self.assertGreater(V.cross(V.sub(b,a),V.sub(c,a))[1],0)
  self.assertLess(V.cross(V.sub(c,a),V.sub(b,a))[1],0)
if __name__=='__main__':unittest.main()
