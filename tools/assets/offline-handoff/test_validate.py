import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('handoff_validator', HERE / 'validate.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
SOURCE = validator.ROOT / 'tools/assets/architecture-details/assets/sandstone-sill.lod0.glb'


class IntegrityTests(unittest.TestCase):
    def test_actual_export(self):
        result = validator.audit_glb(SOURCE)
        self.assertEqual(result['triangles'], 32)
        self.assertEqual(result['materials'], 1)

    def test_reject_bad_length(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.glb'
            path.write_bytes(SOURCE.read_bytes()[:-4])
            with self.assertRaisesRegex(ValueError, 'header'):
                validator.audit_glb(path)

    def test_reject_nonfinite_position(self):
        data = bytearray(SOURCE.read_bytes())
        json_size = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + json_size])
        accessor = doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['POSITION']]
        view = doc['bufferViews'][accessor['bufferView']]
        start = 28 + json_size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        struct.pack_into('<f', data, start, float('nan'))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'nan.glb'
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'non-finite'):
                validator.audit_glb(path)

    def test_reject_index_outside_positions(self):
        data = bytearray(SOURCE.read_bytes())
        json_size = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + json_size])
        primitive = doc['meshes'][0]['primitives'][0]
        accessor = doc['accessors'][primitive['indices']]
        view = doc['bufferViews'][accessor['bufferView']]
        start = 28 + json_size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        fmt = {5121: 'B', 5123: 'H', 5125: 'I'}[accessor['componentType']]
        struct.pack_into('<' + fmt, data, start, doc['accessors'][primitive['attributes']['POSITION']]['count'])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'index.glb'
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'index outside'):
                validator.audit_glb(path)

    def test_reject_nonfinite_node_transform(self):
        data = SOURCE.read_bytes()
        json_size = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + json_size])
        doc['nodes'][0]['translation'] = [float('inf'), 0, 0]
        encoded = json.dumps(doc).encode()
        encoded += b' ' * (-len(encoded) % 4)
        tail = data[20 + json_size:]
        packed = struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(tail)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + tail
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'transform.glb'
            path.write_bytes(packed)
            with self.assertRaisesRegex(ValueError, 'non-finite JSON'):
                validator.audit_glb(path)

    def test_manifest_hash_and_duplicates(self):
        data = SOURCE.read_bytes()
        entry = {'path': str(SOURCE.relative_to(validator.ROOT)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.assertEqual(validator.validate({'files': [entry]})['status'], 'pass')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            validator.validate({'files': [entry, entry]})
        entry['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'digest'):
            validator.validate({'files': [entry]})

    def test_path_escape(self):
        with self.assertRaisesRegex(ValueError, 'outside'):
            validator.validate({'files': [{'path': '../../../../etc/passwd', 'bytes': 0, 'sha256': ''}]})


if __name__ == '__main__':
    unittest.main()
