"""Positive delivery audit and deliberately broken metadata, fail-closed regressions."""
import unittest,copy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from validate import validate_manifest,common
BASE=json.loads((ROOT/'manifest.json').read_text())
class CanadaLineContractTests(unittest.TestCase):
 def broken(self,mutate,pattern):
  m=copy.deepcopy(BASE);mutate(m)
  with self.assertRaisesRegex(ValueError,pattern):validate_manifest(m,deep=False)
 def test_01_actual_delivered_glbs(self):self.assertEqual(validate_manifest(BASE)['status'],'pass')
 def test_02_common_packaging(self):self.assertEqual(common.validate(ROOT)['status'],'pass')
 def test_03_expo_profile_rejected(self):self.broken(lambda m:m['vehicles'][0].update(profileId='expo-metro-17m'),'independent')
 def test_04_expo_dimensions_rejected(self):self.broken(lambda m:m['vehicles'][0].update(nominalLengthM=17),'dimensions')
 def test_05_floor_sill_mismatch(self):self.broken(lambda m:m['vehicles'][0].update(doorSillHeightM=.95),'sill')
 def test_06_missing_pair_leaf(self):self.broken(lambda m:m['vehicles'][0]['doors'].pop(),'paired')
 def test_07_unknown_resource(self):self.broken(lambda m:m['vehicles'][0]['assetRefs'].update(interior='missing'),'asset reference')
 def test_08_frame_cycle(self):self.broken(lambda m:m['vehicles'][0]['frames'][1].update(parentFrameId=m['vehicles'][0]['frames'][1]['frameId']),'cycle')
 def test_09_wrong_open_parent(self):self.broken(lambda m:m['vehicles'][0]['doors'][0]['openTransform'].update(parentFrameId='consist'),'parent')
 def test_10_zero_normal(self):self.broken(lambda m:m['vehicles'][0]['doors'][0].update(outwardNormal=[0,0,0]),'normal')
 def test_11_reversed_floor(self):self.broken(lambda m:m['vehicles'][0]['floorSurfaces'][0].update(indices=[0,1,2,0,2,3]),'winding')
 def test_12_passenger_display_lod(self):self.broken(lambda m:m['vehicles'][0]['lodCapabilities'][2].update(passengerCapable=True),'passenger')
 def test_13_moving_gangway_claim(self):self.broken(lambda m:m['vehicles'][0]['gangways'][0].update(intercarTraversalEnabled=True),'unverified')
 def test_14_short_platform(self):self.broken(lambda m:m['composition'].update(requiredPlatformLengthM=40),'platform')
 def test_15_rear_car_heading(self):self.broken(lambda m:m['composition']['cars'][1].update(rotationQuaternionXYZW=[0,0,0,1]),'rear')
 def test_16_false_runtime_acceptance(self):self.broken(lambda m:m['runtimeChecks'].update(status='passed'),'runtime')
 def test_17_nan(self):self.broken(lambda m:m['vehicles'][0].update(headroomM=float('nan')),'nonfinite')
 def test_18_displaced_anchor_actual_mesh(self):
  m=copy.deepcopy(BASE);m['vehicles'][0]['anchors'][0]['positionM'][0]+=1
  with self.assertRaisesRegex(ValueError,'anchor mismatch'):validate_manifest(m)
 def test_19_undersized_door_sweep(self):
  m=copy.deepcopy(BASE);m['vehicles'][0]['doors'][0]['sweptBoundsM']['max'][2]-=.5
  with self.assertRaisesRegex(ValueError,'swept bounds'):validate_manifest(m)
if __name__=='__main__':unittest.main(verbosity=2)
