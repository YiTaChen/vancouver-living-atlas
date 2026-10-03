import copy,json,unittest
from pathlib import Path
import validate as v

class B04Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=Path(__file__).resolve().parent;cls.m=json.loads((cls.root/'manifest.json').read_text());cls.a=json.loads((cls.root/'assembly-plan.json').read_text())
    def test_actual_delivery(self):self.assertEqual(v.validate(self.root)['status'],'pass')
    def test_axis_rejected(self):
        m=copy.deepcopy(self.m);m['assets'][0]['frontAxis']='-Z'
        with self.assertRaisesRegex(ValueError,'front axis'):v.check_semantics(m,self.a)
    def test_bounds_pivot_rejected(self):
        m=copy.deepcopy(self.m);m['assets'][0]['pivot']['positionM'][1]=4
        with self.assertRaisesRegex(ValueError,'local pivot'):v.check_semantics(m,self.a)
    def test_world_xyz_rejected(self):
        a=copy.deepcopy(self.a);a['worldCoordinateOverrides']=True
        with self.assertRaisesRegex(ValueError,'world-coordinate'):v.check_semantics(self.m,a)
    def test_open_collision_rejected(self):
        m=copy.deepcopy(self.m);m['assets'][-1]['clearance']['newWalkableSpace']=True
        with self.assertRaisesRegex(ValueError,'must not be navigable'):v.check_semantics(m,self.a)
    def test_spring_drift_rejected(self):
        m=copy.deepcopy(self.m);m['assets'][-1]['clearance']['springY']=3.5
        with self.assertRaisesRegex(ValueError,'datum drift'):v.check_semantics(m,self.a)
    def test_fake_webgl_rejected(self):
        m=copy.deepcopy(self.m);m['assets'][0]['runtimeChecks']['status']='pass'
        with self.assertRaisesRegex(ValueError,'WebGL'):v.check_semantics(m,self.a)
    def test_portico_budget_instance_counted(self):
        a=copy.deepcopy(self.a);a['assemblies'][0]['instances'][0]['count']=1000
        with self.assertRaisesRegex(ValueError,'aggregate triangle budget'):v.cost_report(self.m,a)
    def test_blocked_window_detected(self):
        with self.assertRaisesRegex(ValueError,'blocked opening'):v.check_opening('waterfront-window-recess',[[[-2,0,0],[2,0,0],[0,6,0]]])
    def test_blocked_marine_arch_detected(self):
        with self.assertRaisesRegex(ValueError,'blocked opening'):v.check_opening('marine-archivolt-relief',[[[-3,0,0],[3,0,0],[0,7,0]]])
    def test_low_grille_detected(self):
        with self.assertRaisesRegex(ValueError,'blocked opening'):v.check_opening('marine-copper-grille',[[[-3,0,-1.2],[3,0,-1.2],[0,3,-1.2]]])
    def test_overscale_bounds_rejected(self):
        b=copy.deepcopy(self.m['assets'][0]['boundsM']);b['size'][1]=80
        with self.assertRaisesRegex(ValueError,'dimension tolerance'):v.check_bounds(v.CAT['assets'][0],b)
    def test_recentered_bounds_rejected(self):
        b=copy.deepcopy(self.m['assets'][0]['boundsM']);b['min'][1]=-4
        with self.assertRaisesRegex(ValueError,'datum/bounds minimum'):v.check_bounds(v.CAT['assets'][0],b)
    def test_projection_beyond_limit_rejected(self):
        b=copy.deepcopy(self.m['assets'][4]['boundsM']);b['max'][2]=.25
        with self.assertRaisesRegex(ValueError,'Marine protrusion'):v.check_bounds(v.CAT['assets'][4],b)
    def test_ray_edge_on_has_no_false_hit(self):self.assertFalse(v.zray([[0,0,0],[0,1,0],[0,0,1]],.5,.5))

if __name__=='__main__':unittest.main(verbosity=2)
