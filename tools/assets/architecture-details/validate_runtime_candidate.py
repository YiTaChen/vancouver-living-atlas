"""Independently open fitted Blender sources and validate actual candidate GLBs."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from validate_architecture_details import BLENDER_AUDIT, digest, require, validate_lod

HERE = Path(__file__).resolve().parent
ROOT = HERE/'runtime-candidate'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    manifest = json.loads((ROOT/'manifest.json').read_text())
    require(manifest['builderSha256'] == digest(HERE/'build_runtime_candidate.py'), 'fitted builder hash')
    base = json.loads((HERE/'manifest.json').read_text())
    asset = {'id': 'sandstone-sill', 'lods': manifest['lods']}
    results = []
    for lod in manifest['lods']:
        results.append(validate_lod(ROOT, asset, lod))
        require(lod['inputSourceSha256'] == digest(HERE/'source'/f"sandstone-sill.lod{lod['level']}.blend"), 'original artist source changed')
        require(lod['bounds'] == {'min': [-.7, 0, .02], 'max': [.7, .16, .24]}, 'fit envelope changed')
    # Reuse the source auditor with a two-LOD manifest, leaving inputs read-only.
    replacement = "manifest={'sourceMaps':"+repr(base['sourceMaps'])+",'assets':"+repr([asset])+"}"
    script = BLENDER_AUDIT.replace("manifest=json.loads((root/'manifest.json').read_text())", replacement)
    blender = shutil.which('blender')
    require(blender, 'Blender required for actual source inspection')
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp)/'audit.py'
        path.write_text(script)
        result = subprocess.run([blender, '--background', '--factory-startup', '--threads', '2', '--python-exit-code', '1', '--python', str(path), '--', str(ROOT)], capture_output=True, text=True, timeout=120)
        require(result.returncode == 0 and 'BLENDER_SOURCE_AUDIT_PASSED' in result.stdout, result.stdout+'\n'+result.stderr)
    report = {'passed': True, 'blenderSources': 'passed', 'checks': ['actual independently opened fitted LOD sources', 'original artist inputs unchanged', 'physical metre UVs and shared packed maps', 'fitted height/depth containment envelope', 'actual GLB origin axes triangles normals tangents source hashes'], 'assets': results, 'runtimeVisualAndGpuGate': 'unverified'}
    text = json.dumps(report, indent=2)+'\n'
    if args.report:
        args.report.write_text(text)
    print(text)


if __name__ == '__main__':
    main()
