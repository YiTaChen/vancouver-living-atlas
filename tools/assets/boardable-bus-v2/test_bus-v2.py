"""Negative fixtures for the new bus supplement; no original assets are changed."""
import copy, importlib.util, json, tempfile, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('bus_v2_validate',HERE/'validate.py');V=importlib.util.module_from_spec(sp);sp.loader.exec_module(V)
class BusV2Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.manifest=json.loads((HERE/'manifest.json').read_text());cls.scenes=[V.G.load(HERE/l['file'])[0] for l in cls.manifest['assets'][0]['lods']]
 def reject(self,change,pattern):
  m=copy.deepcopy(self.manifest);change(m)
  with self.assertRaisesRegex((AssertionError,ValueError),pattern):V.validate_contract(m,scenes=self.scenes)
 def test_valid_delivered_package(self):self.assertEqual(V.validate_contract(self.manifest,scenes=self.scenes)['status'],'pass')
 def test_duplicate_seat_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'].append(copy.deepcopy(m['vehicles'][0]['seats'][0])),'duplicate seat')
 def test_phantom_seat_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'].pop(),'seat count')
 def test_bad_pelvis_anchor_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'][0]['pelvisPointM'].__setitem__(1,7),'seat anchor')
 def test_wrong_floor_datum_rejected(self):self.reject(lambda m:m['vehicles'][0]['floorSurfaces'][0]['verticesM'][0].__setitem__(1,.7),'floor geometry height')
 def test_tall_rear_standing_rejected(self):self.reject(lambda m:m['vehicles'][0]['standingRegions'].append({**copy.deepcopy(m['vehicles'][0]['nonStandingRegions'][0]),'maximumCharacterHeightM':1.95}),'standing headroom')
 def test_unchecked_runtime_claim_rejected(self):self.reject(lambda m:m['scope'].__setitem__('WebGL','pass'),'scope overclaim')
 def test_night_scope_change_rejected(self):self.reject(lambda m:m['scope'].__setitem__('newNightLighting','complete'),'scope overclaim')
 def test_dependency_drift_rejected(self):self.reject(lambda m:m['dependencies'][0].__setitem__('manifestSha256','0'*64),'dependency hash')
 def test_door_frame_drift_rejected(self):self.reject(lambda m:m['vehicles'][0]['doors'][0]['openTransform']['translationM'].__setitem__(0,0),'frame door datum drift')
 def test_lod2_boarding_rejected(self):self.reject(lambda m:m['vehicles'][0]['composition']['lodMapping'][2].__setitem__('boardingAllowed',True),'LOD2 capability')
 def test_fake_triangle_count_rejected(self):self.reject(lambda m:m['assets'][0]['lods'][0].__setitem__('triangles',1),'measured triangles')
 def test_missing_collision_rejected(self):self.reject(lambda m:m['vehicles'][0]['collision']['primitives'].pop(0),'collision coverage')
 def test_sideways_seat_identity_rotation_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'][-1].__setitem__('facingQuaternionXYZW',[0,0,0,1]),'orientation geometry')
 def test_sideways_camera_in_wrong_direction_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'][-1]['cameraEyePointM'].__setitem__(2,2.2),'seat anchor')
 def test_stowed_seats_counted_as_active_rejected(self):self.reject(lambda m:m['vehicles'][0]['interiorLayout'].__setitem__('stowedPlacesArePassengerAnchors',True),'active versus stowed')
 def test_bright_blue_material_claim_rejected(self):self.reject(lambda m:m['assets'][0]['appearance'].__setitem__('baseColorLinearRGBA',[.018,.14,.40,1]),'navy upholstery')
 def test_wrong_front_topology_rejected(self):self.reject(lambda m:m['vehicles'][0]['seats'][-1].__setitem__('group','low-floor-forward'),'priority seat topology')
 def test_duplicate_glb_identity_rejected(self):
  doc,_=V.C.read_glb(HERE/self.manifest['assets'][0]['lods'][0]['file']);doc['nodes'].append(copy.deepcopy(next(n for n in doc['nodes'] if n['name']=='seat-22')))
  with self.assertRaisesRegex(AssertionError,'GLB node identity'):V.validate_node_identities(doc)
 def test_nonidentity_export_root_rejected(self):
  scenes=copy.deepcopy(self.scenes);scenes[0]['vehicle']['matrix'][12]=.01
  with self.assertRaisesRegex(AssertionError,'GLB vehicle root'):V.validate_contract(self.manifest,scenes=scenes)
 def test_corrupt_glb_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'bad.glb';p.write_bytes(b'glTF'+b'\0'*30)
   with self.assertRaisesRegex(ValueError,'GLB header'):V.C.measure_glb(p)
 def test_honest_rear_height_limit(self):
  v=self.manifest['vehicles'][0];self.assertLess(v['ceiling']['rearHeadroomM'],1.95);self.assertFalse(v['nonStandingRegions'][0]['standingAllowed']);self.assertEqual(len(v['standingRegions']),1)
 def test_no_new_lights_or_emission(self):
  for l in self.manifest['assets'][0]['lods']:
   d,_=V.C.read_glb(HERE/l['file']);self.assertFalse(d.get('cameras'));self.assertNotIn('KHR_lights_punctual',d.get('extensions',{}))
   for m in d['materials']:self.assertEqual(m.get('emissiveFactor',[0,0,0]),[0,0,0])
if __name__=='__main__':unittest.main(verbosity=2)
