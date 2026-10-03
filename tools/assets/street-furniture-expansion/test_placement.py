import copy,json,unittest
from pathlib import Path
from placement import assess,convex,overlap
HERE=Path(__file__).resolve().parent
class PlacementTests(unittest.TestCase):
    def setUp(self):
        self.source=json.loads((HERE/'placement-proposal.json').read_text())['selectedSourceEdges'][0]['sourceKey']
        self.c={'sourceKey':self.source,'replacementOfExistingId':'test-existing-slot','scale':[1,1,1],'footprint':[[-.3,-.3],[.3,-.3],[.3,.3],[-.3,.3]],'walkablePolygon':[[-3,-3],[3,-3],[3,3],[-3,3]],'terrainSamplesM':[0,.03,.06],'remainingPedestrianWidthM':1.8,'exclusions':[],'checkedExclusionLayers':['doorway-approach','car-door-sweep','road-rail']}
    def test_good_candidate_still_not_runtime_accepted(self):
        r=assess(self.c,{self.source});self.assertEqual(r['status'],'candidate-only');self.assertFalse(r['runtimeAccepted'])
    def test_source_required(self):self.assertIn('missing-or-unselected-source',assess(self.c,set())['reasons'])
    def test_population_rejected(self):self.c.pop('replacementOfExistingId');self.assertIn('unapproved-population-increase',assess(self.c,{self.source})['reasons'])
    def test_scale_rejected(self):self.c['scale']=[1,2,1];self.assertIn('non-unit-furniture-scale',assess(self.c,{self.source})['reasons'])
    def test_slope_rejected(self):self.c['terrainSamplesM']=[0,.15,.04];self.assertIn('excessive-slope',assess(self.c,{self.source})['reasons'])
    def test_pedestrian_rejected(self):self.c['remainingPedestrianWidthM']=1.79;self.assertIn('pedestrian-corridor-too-narrow',assess(self.c,{self.source})['reasons'])
    def test_door_car_and_road_exclusions(self):
        for k in ['doorway-approach','car-door-sweep','road-rail']:
            self.c['exclusions']=[{'kind':k,'polygon':[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2]]}];self.assertIn('intersects-'+k,assess(self.c,{self.source})['reasons'])
    def test_missing_exclusion_layer(self):self.c['checkedExclusionLayers']=[];self.assertIn('missing-exclusion-layer',assess(self.c,{self.source})['reasons'])
    def test_missing_terrain(self):self.c['terrainSamplesM']=[0];self.assertIn('insufficient-terrain-samples',assess(self.c,{self.source})['reasons'])
    def test_outside_sidewalk(self):self.c['walkablePolygon']=[[0,0],[2,0],[2,2],[0,2]];self.assertIn('outside-authoritative-walkable-polygon',assess(self.c,{self.source})['reasons'])
    def test_nonconvex_rejected(self):self.c['footprint']=[[0,0],[1,0],[.3,.3],[1,1],[0,1]];self.assertIn('invalid-or-nonconvex-footprint',assess(self.c,{self.source})['reasons'])
    def test_rotated_intersection(self):self.assertTrue(overlap([[-1,0],[0,-1],[1,0],[0,1]],[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]))
    def test_separated_polygons(self):self.assertFalse(overlap([[0,0],[1,0],[1,1],[0,1]],[[2,0],[3,0],[3,1],[2,1]]))
if __name__=='__main__':unittest.main(verbosity=2)
