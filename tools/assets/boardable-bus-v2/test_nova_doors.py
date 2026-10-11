"""Regression of official typical Nova door dimensions and actual cabin portals.

The source master intentionally retains its historical outer 0.10 m support
gap. Both deployed budget/reference derivatives must support the full threshold.
"""
import importlib.util, json, unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('bus_components',HERE/'runtime-candidate/geometry.py')
G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)

class NovaDoorGeometryTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.packages=[]
  for folder in [HERE,HERE/'runtime-candidate',HERE/'closeup-quality']:
   manifest=json.loads((folder/'manifest.json').read_text())
   loader=G.G.load if folder==HERE else G.load
   scenes=[loader(folder/lod['file'])[0] for lod in manifest['assets'][0]['lods']]
   cls.packages.append((folder,manifest,scenes))

 def test_typical_nova_dimensions_and_door_anchor_spacing(self):
  for folder,manifest,scenes in self.packages:
   vehicle=manifest['vehicles'][0]
   self.assertAlmostEqual(vehicle['nominalLengthM'],12.4)
   doors={d['doorGroupId']:d for d in vehicle['doors']}
   self.assertAlmostEqual(doors['front']['doorWidthM'],1.20)
   self.assertAlmostEqual(doors['rear']['doorWidthM'],.90)
   for scene in scenes:
    front=scene['doorway-front']['point'];rear=scene['doorway-rear']['point']
    self.assertAlmostEqual(front[2]-rear[2],6.45,places=5)
    self.assertAlmostEqual(6.10-front[2],1.50,places=5)
    self.assertAlmostEqual(6.10-rear[2],7.95,places=5)
    self.assertAlmostEqual(front[0],-1.25,places=5)
    self.assertAlmostEqual(rear[0],-1.25,places=5)

 def test_rear_door_is_entirely_on_low_floor_before_steps(self):
  for folder,manifest,scenes in self.packages:
   vehicle=manifest['vehicles'][0]
   rear=next(d for d in vehicle['doors'] if d['doorGroupId']=='rear')
   rear_edge=min(p[2] for p in rear['openingPolygonM'])
   for scene in scenes:
    step_front=max(p[2] for p in scene['rear-step-1-slab']['points'])
    self.assertGreaterEqual(rear_edge-step_front,.1999)
    self.assertEqual(len(vehicle['seats']),24)
    self.assertEqual(len([s for s in vehicle['seats'] if s['group'].startswith('rear-')]),17)

 def test_actual_clear_aperture_and_deployed_threshold_support(self):
  for folder,manifest,scenes in self.packages:
   groups={d['doorGroupId']:d for d in manifest['vehicles'][0]['doors']}
   for scene in scenes:
    obstacles=[]
    for name,item in scene.items():
     if name.endswith('-slab') or 'entry-edge' in name or not item.get('triangles'):continue
     bounds={'min':[min(p[k] for p in item['points']) for k in range(3)],'max':[max(p[k] for p in item['points']) for k in range(3)]}
     obstacles.append((bounds,item['triangles']))
    for group,door in groups.items():
     z0=min(p[2] for p in door['openingPolygonM']);z1=max(p[2] for p in door['openingPolygonM'])
     zsamples=[z0+.12,(z0+z1)/2,z1-.12]
     for z in zsamples:
      for height in [.81,1.65,2.01]:
       # Broad-phase component bounds exclude triangles that cannot cross this
       # ray; exact exported triangle intersections still establish clearance.
       triangles=[tri for bounds,tris in obstacles if bounds['max'][0]>=-1.70 and bounds['min'][0]<=-.65 and bounds['min'][1]<=height<=bounds['max'][1] and bounds['min'][2]<=z<=bounds['max'][2] for tri in tris]
       self.assertFalse(G.G.hits(triangles,[-1.70,height,z],[-.65,height,z]),(folder.name,group,z,height))
     support=list(scene['low-floor-slab']['triangles'])
     if folder!=HERE:support+=scene['door-'+group+'-threshold-slab']['triangles']
     xs=[-1.14,-.80,-.65] if folder==HERE else [-1.24,-1.20,-1.14,-.80,-.65]
     for x in xs:
      for z in zsamples:
       hit=G.G.hits(support,[x,.41,z],[x,.31,z])
       self.assertTrue(hit,(folder.name,group,x,z))
       self.assertAlmostEqual(.41-min(hit),.36,places=5)

if __name__=='__main__':unittest.main()
