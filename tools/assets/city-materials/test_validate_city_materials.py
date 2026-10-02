"""Small negative/regression checks for the dependency-free asset decoder."""
import struct
import unittest
import zlib
from validate_city_materials import png, normal_stats


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def fixture(filters):
    width, channels = 3, 3
    rows = [bytes((row * 47 + i * 19) % 256 for i in range(width * channels)) for row in range(len(filters))]
    raw = bytearray()
    previous = bytes(width * channels)
    for filter_type, current in zip(filters, rows):
        raw.append(filter_type)
        for i, value in enumerate(current):
            left = current[i - channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i - channels] if i >= channels else 0
            if filter_type == 0: prediction = 0
            elif filter_type == 1: prediction = left
            elif filter_type == 2: prediction = up
            elif filter_type == 3: prediction = (left + up) // 2
            else:
                p = left + up - corner
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - corner)
                prediction = left if pa <= pb and pa <= pc else up if pb <= pc else corner
            raw.append((value - prediction) & 255)
        previous = current
    result = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', width, len(rows), 8, 2, 0, 0, 0))
    result += chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    return result, b''.join(rows)


class DecoderTests(unittest.TestCase):
    def test_all_standard_scanline_filters(self):
        raw, expected = fixture([0, 1, 2, 3, 4])
        self.assertEqual(png(raw, 'fixture')['pixels'], expected)

    def test_rejects_corruption_and_truncation(self):
        raw, _ = fixture([0, 1])
        corrupted = bytearray(raw)
        corrupted[45] ^= 1
        with self.assertRaisesRegex(ValueError, 'CRC'):
            png(bytes(corrupted), 'corrupt')
        with self.assertRaises(ValueError):
            png(raw[:-5], 'truncated')

    def test_data_normals_cannot_be_arbitrary_rgb_or_back_facing(self):
        self.assertLess(normal_stats({'channels': 3, 'pixels': bytes([128, 128, 255])}, 'flat')['maxUnitLengthError'], .001)
        with self.assertRaisesRegex(ValueError, 'unit normal'):
            normal_stats({'channels': 3, 'pixels': bytes([255, 255, 255])}, 'white')
        with self.assertRaisesRegex(ValueError, 'behind'):
            normal_stats({'channels': 3, 'pixels': bytes([128, 128, 0])}, 'flipped')


if __name__ == '__main__':
    unittest.main()
