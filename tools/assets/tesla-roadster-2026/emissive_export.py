"""Keep the constant donor red accent in glTF's non-vertex emissive factor.

glTF COLOR_0 modulates base color only. Blender's vertex-color emission link
otherwise exports a white emissive factor, so copy this single constant material
color into emissiveFactor without touching any geometry or other material.
"""
import json
from pathlib import Path
import struct


def finalize_glb(path):
    path = Path(path)
    raw = path.read_bytes()
    chunks = []
    offset = 12
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        chunks.append((kind, raw[offset+8:offset+8+size]))
        offset += 8+size
    document = json.loads(chunks[0][1])
    accents = [m for m in document['materials'] if m.get('name') == 'Atlas Roadster | accent']
    assert len(accents) == 1, 'Expected the shared pair of door ambient strips'
    accents[0]['emissiveFactor'] = [148/255, 1/255, 1/255]
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    chunks[0] = (0x4E4F534A, encoded)
    body = b''.join(struct.pack('<II', len(payload), kind)+payload for kind,payload in chunks)
    path.write_bytes(struct.pack('<III',0x46546C67,2,12+len(body))+body)


if __name__ == '__main__':
    for path in (Path(__file__).resolve().parent/'exports').glob('tesla-roadster-2026.lod*.glb'):
        finalize_glb(path)
    print('Preserved constant donor-red accent emission in three GLBs.')
