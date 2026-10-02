"""Negative as well as positive contract tests, no Blender dependency."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from validate_architecture_details import (
    HERE, accessor, clearance_intersections, glb, validate, validate_lod,
)


class ArchitectureAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((HERE/'manifest.json').read_text())
        cls.asset = cls.manifest['assets'][0]
        cls.lod = cls.asset['lods'][0]

    def test_complete_shipped_offline_inventory(self):
        report = validate(skip_blender=True)
        self.assertTrue(report['passed'])
        self.assertEqual(report['blenderSources'], 'skipped')
        self.assertEqual(len(report['assets']), 16)

    def test_glb_container_truncation(self):
        raw = (HERE/self.lod['file']).read_bytes()
        with self.assertRaisesRegex(ValueError, 'GLB header'):
            glb(raw[:-1])

    def test_modified_asset_hash(self):
        lod = copy.deepcopy(self.lod)
        lod['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'GLB hash'):
            validate_lod(HERE, self.asset, lod)

    def test_false_dimensions(self):
        lod = copy.deepcopy(self.lod)
        lod['bounds']['max'][1] += .1
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            validate_lod(HERE, self.asset, lod)

    def test_triangle_budget_cannot_be_underreported(self):
        lod = copy.deepcopy(self.lod)
        lod['triangleCap'] = 1
        with self.assertRaisesRegex(ValueError, 'triangle budget'):
            validate_lod(HERE, self.asset, lod)

    def test_changed_tile_scale_is_rejected(self):
        lod = copy.deepcopy(self.lod)
        lod['tileMeters'][0] = 10
        with self.assertRaisesRegex(ValueError, 'physical metre UV'):
            validate_lod(HERE, self.asset, lod)

    def test_false_clearance_is_rejected(self):
        asset = copy.deepcopy(self.asset)
        asset['clearance'] = {'min': [-1, -.1, 0], 'max': [1, 1, 1]}
        with self.assertRaisesRegex(ValueError, 'opening obstruction'):
            validate_lod(HERE, asset, self.lod)

    def test_changed_source_hash_is_rejected(self):
        lod = copy.deepcopy(self.lod)
        lod['sourceSha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'source hash'):
            validate_lod(HERE, self.asset, lod)

    def test_accessors_cannot_escape_buffer(self):
        doc, binary = glb((HERE/self.lod['file']).read_bytes())
        index = doc['meshes'][0]['primitives'][0]['attributes']['POSITION']
        doc['accessors'][index]['count'] = 10**9
        with self.assertRaisesRegex(ValueError, 'exceeds buffer'):
            accessor(doc, binary, index)

    def test_clearance_boundary_is_allowed_but_intrusion_is_not(self):
        box = {'min': [-1, 0, 0], 'max': [1, 2.3, 1]}
        indices = [(0,), (1,), (2,)]
        on_header = [(-1, 2.3, .1), (1, 2.3, .1), (0, 2.3, .9)]
        self.assertEqual(clearance_intersections(on_header, indices, box), 0)
        on_header[0] = (-1, 2.2, .1)
        self.assertEqual(clearance_intersections(on_header, indices, box), 1)


if __name__ == '__main__':
    unittest.main()
