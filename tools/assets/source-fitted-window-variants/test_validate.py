"""Negative actual-container, channel, aperture, stop, datum and budget regressions."""
import copy,json,struct,tempfile,unittest
from pathlib import Path
import validate as v
HERE=Path(__file__).resolve().parent
D=json.loads((HERE/'designs.json').read_text())['modern-source-window-surround'];PATH=HERE/'exports/modern-source-window-surround.lod1.glb'
def pack(doc,binary,path):
 j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binary+=b'\0'*((-len(binary))%4);path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(binary))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
class Tests(unittest.TestCase):
 def mutate(self,fn,match):
  doc,raw=v.common.read_glb(PATH);binary=bytearray(raw);fn(doc,binary)
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'mutant.glb';pack(doc,bytes(binary),p)
   with self.assertRaisesRegex(ValueError,match):v.validate_geometry(p,D,1)
 def test_full_package(self):self.assertEqual(v.validate()['status'],'pass')
 def test_four_actual_geometry_fixtures(self):
  for aid,d in json.loads((HERE/'designs.json').read_text()).items():
   for lod in [0,1]:self.assertEqual(v.validate_geometry(HERE/'exports'/f'{aid}.lod{lod}.glb',d,lod)['status'],'pass')
 def test_truncated_container(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'bad.glb';p.write_bytes(PATH.read_bytes()[:19])
   with self.assertRaises(ValueError):v.common.read_glb(p)
 def test_wrong_semantic_role(self):self.mutate(lambda d,b:d['materials'][0].update(name='glass'),'semantic role')
 def test_missing_uv(self):self.mutate(lambda d,b:d['meshes'][0]['primitives'][0]['attributes'].pop('TEXCOORD_0'),'UV tangent required')
 def test_missing_tangent(self):self.mutate(lambda d,b:d['meshes'][0]['primitives'][0]['attributes'].pop('TANGENT'),'UV tangent required')
 def test_wrong_root_datum(self):self.mutate(lambda d,b:d['nodes'][0].update(translation=[0,.031,0]),'datum drift')
 def test_nonuniform_stretch(self):self.mutate(lambda d,b:d['nodes'][0].update(scale=[1.05,1,1]),'datum drift')
 def test_qa_leak(self):self.mutate(lambda d,b:d['nodes'][0].update(name='QA-human'),'stable node')
 def test_accessor_overflow(self):self.mutate(lambda d,b:d['accessors'][0].update(count=1000000),'accessor bounds')
 def test_bad_normals(self):
  def change(d,b):
   a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['NORMAL']];view=d['bufferViews'][a['bufferView']];struct.pack_into('<fff',b,view.get('byteOffset',0)+a.get('byteOffset',0),0,0,0)
  self.mutate(change,'normal count/unit')
 def test_uv_scale_corruption(self):
  def change(d,b):
   a=d['accessors'][d['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0']];view=d['bufferViews'][a['bufferView']];struct.pack_into('<ff',b,view.get('byteOffset',0)+a.get('byteOffset',0),99,99)
  self.mutate(change,'metric shared-tile UV drift')
 def test_lod_budget(self):
  p=HERE/'exports/modern-source-window-surround.lod0.glb'
  with self.assertRaisesRegex(ValueError,'triangle budget'):v.validate_geometry(p,D,1)
 def test_visible_aperture_panel(self):
  ts,ps=v.geom.mesh_triangles(PATH);ts.append([[-.3,.6,.14],[.3,.6,.14],[0,1.2,.14]])
  with self.assertRaisesRegex(ValueError,'opening obstruction'):v.check_aperture(ts,ps,D)
 def test_tiny_between_ray_obstruction(self):
  ts,ps=v.geom.mesh_triangles(PATH);ts.append([[.002,.252,.14],[.004,.252,.14],[.003,.254,.14]])
  with self.assertRaisesRegex(ValueError,'opening obstruction'):v.check_aperture(ts,ps,D)
 def test_absent_frame_cannot_pass_open_rays(self):
  with self.assertRaisesRegex(ValueError,'aperture edge mismatch'):v.check_aperture([],[],D)
 def test_absent_physical_stop(self):
  ts,ps=v.geom.mesh_triangles(PATH);s=D['stopRearZ'];front=s+D['stopThicknessM'];ts=[t for t in ts if not all(s-1e-6<=p[2]<=front+1e-6 for p in t)]
  with self.assertRaisesRegex(ValueError,'aperture edge mismatch|physical glass stop'):v.check_aperture(ts,ps,D)
 def test_claimed_wrong_stop_depth(self):
  ts,ps=v.geom.mesh_triangles(PATH);d=copy.deepcopy(D);d['stopRearZ']+=.04
  with self.assertRaisesRegex(ValueError,'aperture edge mismatch|physical glass stop'):v.check_aperture(ts,ps,d)
 def test_wrong_manifest_hash(self):
  with tempfile.TemporaryDirectory() as td:
   import shutil
   root=Path(td)/'p';shutil.copytree(HERE,root);m=json.loads((root/'manifest.json').read_text());m['assets'][0]['lods'][0]['sha256']='0'*64;(root/'manifest.json').write_text(json.dumps(m))
   with self.assertRaisesRegex(ValueError,'GLB hash'):v.common.validate(root)
 def test_all_four_combined_glb_pairs(self):
  frames=json.loads((HERE/'designs.json').read_text());sills=json.loads((HERE/'sill-designs.json').read_text())
  for aid,d in sills.items():
   for lod in [0,1]:
    r=v.check_combined(HERE/'exports'/f'{d["frameId"]}.lod{lod}.glb',HERE/'exports'/f'{aid}.lod{lod}.glb',frames[d['frameId']],d,lod);self.assertAlmostEqual(r['actualVerticalSeparationM'],.006,places=6);self.assertTrue(r['existingSillMustBeSuppressed'])
 def test_actual_sill_shift_into_frame_rejected(self):
  d=next(iter(json.loads((HERE/'sill-designs.json').read_text()).values()));p=HERE/'exports'/f'{d["id"]}.lod1.glb';doc,b=v.common.read_glb(p);doc['nodes'][0]['translation']=[0,.02,0]
  with tempfile.TemporaryDirectory() as td:
   bad=Path(td)/'overlap.glb';pack(doc,b,bad)
   with self.assertRaisesRegex(ValueError,'sill dimensions or shared-root drift'):v.check_combined(HERE/'exports'/f'{d["frameId"]}.lod1.glb',bad,D,d,1)
 def test_sill_datum_metadata_cannot_hide_gap(self):
  d=copy.deepcopy(next(iter(json.loads((HERE/'sill-designs.json').read_text()).values())));d['topY']=.006
  with self.assertRaisesRegex(ValueError,'shared-root drift'):v.validate_sill(HERE/'exports'/f'{d["id"]}.lod1.glb',d,1)
 def test_wrong_paired_identity_rejected(self):
  d=copy.deepcopy(next(iter(json.loads((HERE/'sill-designs.json').read_text()).values())));d['frameId']='another-frame'
  with self.assertRaisesRegex(ValueError,'paired identity mismatch'):v.check_combined(PATH,HERE/'exports'/f'{d["id"]}.lod1.glb',D,d,1)
 def test_sill_uv_corruption_rejected(self):
  d=next(iter(json.loads((HERE/'sill-designs.json').read_text()).values()));doc,b=v.common.read_glb(HERE/'exports'/f'{d["id"]}.lod1.glb');b=bytearray(b);a=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0']];view=doc['bufferViews'][a['bufferView']];struct.pack_into('<ff',b,view.get('byteOffset',0)+a.get('byteOffset',0),99,99)
  with tempfile.TemporaryDirectory() as td:
   bad=Path(td)/'uv.glb';pack(doc,bytes(b),bad)
   with self.assertRaisesRegex(ValueError,'UV drift'):v.validate_sill(bad,d,1)
 def test_old_sill_intersection_evidence_retained(self):
  report=json.loads((HERE/'qa/existing-sill-coexistence.json').read_text());self.assertEqual(len(report['results']),4)
  for r in report['results']:self.assertFalse(r['assemblyAccepted']);self.assertGreater(r['jointInteriorWitnessCount'],0)
if __name__=='__main__':unittest.main()
