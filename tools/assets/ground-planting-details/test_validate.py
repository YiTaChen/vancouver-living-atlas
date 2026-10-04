"""Positive/negative package and placement research contracts. No production changes."""
from pathlib import Path
import importlib.util,json,shutil,struct,tempfile,unittest
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('validator',HERE/'validate.py');v=importlib.util.module_from_spec(sp);sp.loader.exec_module(v)
sp=importlib.util.spec_from_file_location('placement',HERE/'placement_contract.py');p=importlib.util.module_from_spec(sp);sp.loader.exec_module(p)
def save(path,d,blob):
 js=json.dumps(d,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4);path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(blob))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(blob),b'BIN\0')+blob)
class Contracts(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=Path(tempfile.mkdtemp(prefix='ground-negative-'));shutil.copytree(HERE/'exports/textures',cls.tmp/'textures')
 def mutate(self,aid,fn,inspection=True):
  src=HERE/'exports'/f'{aid}.lod0{".inspection"if inspection else""}.glb';d,bb=v.c.read_glb(src);bb=bytearray(bb);fn(d,bb);dst=self.tmp/src.name;save(dst,d,bytes(bb));return dst
 def invalid(self,aid,fn,text,inspection=True):
  dst=self.mutate(aid,fn,inspection)
  with self.assertRaisesRegex(ValueError,text):v.check_glb(dst,aid,0,aid.startswith('surface-'),inspection)
 def test_positive_package(self):self.assertEqual(v.c.validate(HERE)['status'],'pass')
 def test_wrong_edge_sampler(self):self.invalid('soil-grass-edge-1m',lambda d,b:d['samplers'][0].update(wrapS=10497),'clamp-U')
 def test_missing_weight(self):self.invalid('soil-grass-edge-1m',lambda d,b:d['meshes'][0]['primitives'][0]['attributes'].pop('_GRASS_WEIGHT'),'grass weight')
 def test_wrong_uv_period(self):
  def change(d,b):
   a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0']];view=d['bufferViews'][a['bufferView']];off=view.get('byteOffset',0)+a.get('byteOffset',0);struct.pack_into('<f',b,off,99)
  self.invalid('surface-soil-2m',change,'UV period')
 def test_nonfinite_vertex(self):
  def change(d,b):
   a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['POSITION']];view=d['bufferViews'][a['bufferView']];struct.pack_into('<f',b,view.get('byteOffset',0)+a.get('byteOffset',0),float('nan'))
  self.invalid('curb-straight-1m',change,'nonfinite',False)
 def test_degenerate_triangle(self):
  def change(d,b):
   a=d['accessors'][d['meshes'][0]['primitives'][0]['indices']];view=d['bufferViews'][a['bufferView']];off=view.get('byteOffset',0)+a.get('byteOffset',0);code,width=v.c.TYPES[a['componentType']];first=struct.unpack_from('<'+code,b,off)[0];struct.pack_into('<'+code,b,off+width,first)
  self.invalid('curb-straight-1m',change,'degenerate',False)
 def test_no_qa_camera(self):self.invalid('curb-straight-1m',lambda d,b:d.update(cameras=[{'type':'perspective'}]),'camera/light',False)
 def test_negative_scale(self):self.invalid('curb-straight-1m',lambda d,b:d['nodes'][0].update(scale=[-1,1,1]),'negative',False)
 def base(self,**kw):
  data=dict(source_id='137668',footprint=[[-.4,-.3],[.4,-.3],[.4,.3],[-.4,.3]],contour=[[-2,-1],[2,-1],[2,1],[-2,1]],heights=[0,0,0,0]);data.update(kw);return p.fit(**data)
 def test_flat_source_fit(self):self.assertEqual(self.base(),(True,'offline-research-fit-only'))
 def test_actual_source_rigid_rejection(self):
  r=v.j(HERE/'placement-reference.json');self.assertEqual(self.base(heights=[x['y']for x in r['contourSamples']])[1],'slope-relief')
 def test_actual_source_positive_fit(self):
  r=v.j(HERE/'placement-reference.json')['positiveRigidPlanterFixture'];self.assertIsNotNone(r);ok,reason=p.fit(source_id=r['sourceId'],footprint=r['candidateFootprintXZ'],contour=r['plantingContourXZ'],heights=r['candidateGroundSamplesM']);self.assertTrue(ok,reason);self.assertLess(r['contourReliefM'],.02);self.assertAlmostEqual(r['containedAreaM2'],.48)
 def test_missing_source(self):self.assertEqual(self.base(source_id='')[1],'missing-source-id')
 def test_outside_footprint(self):self.assertEqual(self.base(contour=[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2]])[1],'outside-source-contour')
 def test_narrow_concavity_crossing(self):
  contour=[[-2,-1],[2,-1],[2,1],[.5,1],[.5,0],[.25,0],[.25,1],[-2,1]];foot=[[-1,.25],[1,.25],[1,.75],[-1,.75]];self.assertEqual(self.base(footprint=foot,contour=contour)[1],'bridged-contour')
 def test_crossing_road(self):self.assertEqual(self.base(roads=[[[-2,-.05],[2,-.05],[2,.05],[-2,.05]]])[1],'road-exclusion')
 def test_road_containment(self):self.assertEqual(self.base(roads=[[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]])[1],'road-exclusion')
 def test_door_exclusion(self):self.assertEqual(self.base(doors=[[[-1,-1],[1,-1],[1,1],[-1,1]]])[1],'door-exclusion')
 def test_hole_exclusion(self):self.assertEqual(self.base(holes=[[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]])[1],'hole-exclusion')
 def test_three_samples(self):self.assertEqual(self.base(heights=[0,0])[1],'insufficient-rendered-surface-samples')
 def test_nonfinite_height(self):self.assertEqual(self.base(heights=[0,float('nan'),0])[1],'nonfinite')
 def test_deformable_relief_limit(self):self.assertEqual(self.base(heights=[0,.55,0],rigid=False)[1],'slope-relief')
 def test_planar_edge_crop(self):
  d,bb=v.c.read_glb(HERE/'exports/soil-grass-edge-1m.lod0.inspection.glb');self.assertTrue(all(abs(a-b)<1e-5 for a,b in zip(v.uv_span(d,bb),[.2,.5])))
if __name__=='__main__':unittest.main(verbosity=2)
