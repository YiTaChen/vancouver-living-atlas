"""Inventory canonical asset files after all track-specific audits succeed.
Run deliberately after editing/revalidating assets; updating hashes is not a
substitute for the track-specific Blender and visual checks.
"""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TRACKS = {
    'architecture-expansion': ('new', ROOT / 'tools/assets/architecture-expansion'),
    'vegetation-ground': ('new', ROOT / 'tools/assets/vegetation_ground'),
    'role-materials': ('new', ROOT / 'tools/assets/role-materials'),
    'citizen-optimization': ('new', ROOT / 'tools/assets/citizen/optimization'),
    'existing-architecture-sources': ('reused', ROOT / 'tools/assets/architecture-details/source'),
    'existing-architecture-exports': ('reused', ROOT / 'tools/assets/architecture-details/assets'),
    'existing-perennial-sources': ('reused', ROOT / 'tools/assets/residential-perennial/source'),
    'existing-shared-surface-maps': ('reused', ROOT / 'tools/assets/city-materials/source/textures'),
}


def main():
    files = []
    for track, (status, folder) in TRACKS.items():
        if not folder.is_dir():
            raise ValueError('missing finalized track: ' + track)
        for path in sorted(folder.rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts or path.suffix in ('.blend1', '.pyc'):
                continue
            data = path.read_bytes()
            files.append({'path': path.relative_to(ROOT).as_posix(), 'track': track, 'status': status, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {
        'schemaVersion': 1,
        'baselineCommit': '4967c72dfda532eb8151bf477b29eafe54a93d5d',
        'scope': 'Offline editable Blender assets for owner integration. No runtime/public replacement, placement, population or GPU acceptance.',
        'license': 'LicenseRef-Vancouver-Living-Atlas-NC-1.0',
        'coordinateNotes': 'Metres; glTF Y-up. Per-track manifests define origins/forward directions. Material study layout is not city placement.',
        'inventoryNotes': 'New tracks plus selected reused architectural/perennial sources and shared texture dependencies. Not an inventory of the entire repository.',
        'files': files,
    }
    (HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'files': len(files), 'bytes': sum(x['bytes'] for x in files)}))


if __name__ == '__main__':
    main()
