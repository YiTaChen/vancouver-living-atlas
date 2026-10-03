"""Integrity, scope and negative tests for the immutable source inventory."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import inventory as subject


class InventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config=subject.load(subject.HERE/'requirements.json')
        cls.catalog=subject.load(subject.HERE/'package-catalog.json')
        cls.datum=subject.load(subject.HERE/'datum-contracts.json')
        cls.snapshot=subject.load(subject.HERE/'inventory.json')

    def test_all_27_requirements_and_real_asset_references(self):
        ids=subject.validate_config(self.config,self.catalog,self.datum)
        self.assertEqual(len(self.config['requirements']),27)
        self.assertEqual(len(ids),53)

    def test_deterministic_source_baseline_snapshot(self):
        self.assertEqual(subject.build(),self.snapshot)

    def test_every_recorded_file_hash_and_byte_size(self):
        subject.verify_files(subject.ROOT,self.snapshot['files'])

    def test_current_citizen_adoption_is_payload_identity_not_old_flag(self):
        check=self.snapshot['adoptionChecks']['citizenLod0']
        self.assertTrue(check['byteIdentical'])
        self.assertEqual(check['sha256'],'14d66fabe097abf82ef36800561c06ee7263c0acfd6b5ea1265a40ed35841ff8')
        package=next(p for p in self.snapshot['packages'] if p['id']=='citizen')
        self.assertFalse(package['legacyManifestSnapshots'][0]['declaredRuntimeIntegrated'])
        files={r['path']:r for r in self.snapshot['files']}
        measured=files[check['publicPath']]['currentContainerAudit']
        self.assertEqual(measured['exportedPositionVertices'],29063)
        self.assertEqual(measured['triangles'],37799)
        self.assertEqual(measured['jointCounts'],[22])

    def test_missing_requirement_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'].pop()
        with self.assertRaisesRegex(ValueError,'27 ordered'):subject.validate_config(config,self.catalog,self.datum)

    def test_duplicate_requirement_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'][1]['id']='A01'
        with self.assertRaisesRegex(ValueError,'27 ordered'):subject.validate_config(config,self.catalog,self.datum)

    def test_unknown_asset_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'][0]['assetRefs']=['city-materials:invented-material']
        with self.assertRaisesRegex(ValueError,'unknown/unmapped asset'):subject.validate_config(config,self.catalog,self.datum)

    def test_wrong_asset_package_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'][0]['assetRefs']=['citizen:lod0']
        with self.assertRaisesRegex(ValueError,'unknown/unmapped asset'):subject.validate_config(config,self.catalog,self.datum)

    def test_false_new_work_completion_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'][0]['offline']['status']='offline_complete'
        with self.assertRaisesRegex(ValueError,'cannot complete'):subject.validate_config(config,self.catalog,self.datum)

    def test_false_new_webgl_pass_rejected(self):
        config=copy.deepcopy(self.config);config['requirements'][0]['runtime']['webglChecks']='pass'
        with self.assertRaisesRegex(ValueError,'no acceptance'):subject.validate_config(config,self.catalog,self.datum)

    def test_datum_drift_rejected(self):
        datum=copy.deepcopy(self.datum);datum['contracts'][0]['evidence'][0]['expected']['min'][2]=0
        with self.assertRaisesRegex(ValueError,'datum declaration changed'):subject.validate_config(self.config,self.catalog,datum)

    def test_duplicate_and_tampered_files_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'evidence.txt').write_text('source')
            entry=subject.file_record(root,'evidence.txt')
            with self.assertRaisesRegex(ValueError,'duplicate'):subject.verify_files(root,[entry,entry])
            (root/'evidence.txt').write_text('edited')
            with self.assertRaisesRegex(ValueError,'fingerprint mismatch'):subject.verify_files(root,[entry])

    def test_absolute_traversal_and_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'root';root.mkdir();outside=Path(d)/'secret';outside.write_text('outside')
            (root/'link').symlink_to(outside)
            for path in ['../secret',str(outside),'link','x/../../secret','x\\y']:
                with self.subTest(path=path),self.assertRaises(ValueError):subject.inside(root,path)

    def test_nonimage_cost_is_explicitly_not_gpu_or_geometry_payload(self):
        for record in self.snapshot['files']:
            if 'currentContainerAudit' in record:
                stats=record['currentContainerAudit']
                self.assertEqual(stats['embeddedImageBytes']+stats['containerNonImageBytes'],record['bytes'])
                self.assertGreaterEqual(stats['embeddedImageBytes'],0)
                self.assertGreater(stats['exportedPositionVertices'],0)

    def test_json_pointer_escape(self):
        self.assertEqual(subject.pointer({'a/b':{'x~y':[7]}},'/a~1b/x~0y/0'),7)


if __name__=='__main__':unittest.main()
