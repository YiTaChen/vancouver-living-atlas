import copy
import json
from pathlib import Path
import tempfile
import unittest
from geometry import HERE, ROOT, common, mesh_triangles, triangle_in_open_box, check_open_volume, check_witnesses
from snapshot import collect
from validate import validate_manifest


class ReferenceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((HERE/'manifest.json').read_text())

    def test_current_reference_and_geometry(self):
        checks = validate_manifest(self.manifest)
        self.assertEqual(len(checks), 32)
        self.assertGreater(sum(r.get('openVolumeRays', 0) for r in checks), 0)

    def test_distinct_schema_rejects_model_schema(self):
        m=copy.deepcopy(self.manifest); m['schemaVersion']=1
        with self.assertRaisesRegex(ValueError, 'reference schema'): validate_manifest(m)

    def test_source_hash_tampering_rejected(self):
        m=copy.deepcopy(self.manifest); m['moduleContracts'][0]['lodReferences'][0]['glb']['sha256']='0'*64
        with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)

    def test_historical_consumer_hash_tampering_rejected(self):
        m=copy.deepcopy(self.manifest)
        reference=next(r for r in m['sourceReferences'] if r['path']=='lib/city/architecture-plan.ts')
        reference['sha256']='0'*64
        with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)

    def test_bounds_or_cost_tampering_rejected(self):
        for field in ['bytes', 'triangles']:
            m=copy.deepcopy(self.manifest); m['moduleContracts'][0]['lodReferences'][0]['measurements'][field]+=1
            with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)
        m=copy.deepcopy(self.manifest); m['moduleContracts'][0]['lodReferences'][0]['measurements']['boundsM']['max'][1]=.16
        with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)

    def test_canopy_datum_cannot_be_rebased(self):
        m=copy.deepcopy(self.manifest)
        canopy=next(a for a in m['moduleContracts'] if a['id']=='residential-gabled-entry-canopy')
        canopy['attachmentDatum']['originM'][1]=2.36
        with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)

    def test_glass_stop_and_handedness_are_versioned(self):
        for name, edit in [('residential-cedar-window-surround', lambda c: c['glazing']['stopByLOD'].update({'1':{'backZ':.1}})),
                           ('concrete-chamfer-corner', lambda c: c['handedness'].update({'mirrorAllowed':True}))]:
            m=copy.deepcopy(self.manifest); edit(next(c for c in m['moduleContracts'] if c['id']==name))
            with self.assertRaisesRegex(ValueError, 'differs'): validate_manifest(m)

    def test_exact_triangle_clip_catches_panel_between_rays(self):
        bounds={'min':[-1,0,0], 'max':[1,2,1]}
        # Tiny panel intentionally avoids the 5x5 probe grid, yet must fail.
        tiny=[[-.981,.019,.5],[-.979,.019,.5],[-.98,.021,.5]]
        self.assertTrue(triangle_in_open_box(tiny,bounds))
        with self.assertRaisesRegex(ValueError,'opening obstruction'): check_open_volume([tiny],bounds)

    def test_triangle_clip_does_not_confuse_aabb_overlap_with_triangle_overlap(self):
        bounds={'min':[0,0,0], 'max':[1,1,1]}
        # Triangle AABB overlaps box but actual triangle lies above x+y=2.1.
        outside=[[.9,1.2,.5],[1.2,.9,.5],[1.4,1.4,.5]]
        self.assertFalse(triangle_in_open_box(outside,bounds))
        self.assertFalse(triangle_in_open_box([[0,0,0],[1,0,0],[0,1,0]],bounds))

    def test_missing_frame_fails_solid_control_probe(self):
        witness={'solidRays':[{'name':'jamb','originM':[0,0,0],'direction':[0,0,1],'lengthM':1}]}
        with self.assertRaisesRegex(ValueError,'solid control'): check_witnesses([],[],witness)

    def test_physical_stop_depth_requires_real_intersection(self):
        triangle=[[-1,-1,.5],[1,-1,.5],[0,1,.5]]
        witness={'solidRays':[{'name':'stop','originM':[0,0,0],'direction':[0,0,1],'lengthM':1,'requiredDistancesM':[.4]}]}
        with self.assertRaisesRegex(ValueError,'depth mismatch'): check_witnesses([triangle],triangle,witness)

    def test_current_glb_opening_triangle_added_is_rejected(self):
        c=next(c for c in self.manifest['moduleContracts'] if c['id']=='modern-recessed-window-surround')
        tri,_=mesh_triangles(ROOT/c['lodReferences'][0]['glb']['path'])
        tri.append([[-.1,.6,.1],[.1,.6,.1],[0,.8,.1]])
        with self.assertRaisesRegex(ValueError,'opening obstruction'): check_open_volume(tri,c['opening']['boundsM'])

    def test_corrupt_glb_container_is_rejected(self):
        p=ROOT/self.manifest['moduleContracts'][0]['lodReferences'][0]['glb']['path']
        with tempfile.TemporaryDirectory() as temp:
            copy_path=Path(temp)/'bad.glb'; copy_path.write_bytes(p.read_bytes()[:-16])
            with self.assertRaisesRegex(ValueError,'header'): common.measure_glb(copy_path)

    def test_transform_applied_once_and_no_mirror_silently_accepted(self):
        m=common.transform({'translation':[0,2.36,0], 'scale':[1,1,1]})
        self.assertAlmostEqual(common.point(m,[0,.74,0])[1],3.1,places=12)
        with self.assertRaisesRegex(ValueError,'negative'): common.transform({'scale':[-1,1,1]})

if __name__ == '__main__':
    unittest.main()
