"""Validate the reference/adaptation schema, current bytes and CPU fit evidence.

No source edits, model exports, runtime enablement or scene acceptance occurs.
"""
from pathlib import Path
import argparse
import json
import platform
import subprocess
from geometry import HERE, ROOT, need, digest
from definitions import SCHEMA
from snapshot import collect


def validate_manifest(manifest):
    need(manifest.get('schemaVersion') == SCHEMA, 'reference schema required; this is not an exported-model package')
    need('assets' not in manifest and manifest.get('deliverableKind') == 'source-reference-adaptation-contract', 'reference-only deliverable kind')
    revision = manifest.get('baseRevision', '')
    need(isinstance(revision, str) and len(revision) == 40 and all(c in '0123456789abcdef' for c in revision), 'recorded base revision')
    expected, geometry_checks = collect(revision)
    need(manifest == expected, 'reference contract differs from current measured source or versioned fit definitions; review and refresh explicitly')
    return geometry_checks


def validate(check_saved_evidence=True):
    manifest = json.loads((HERE/'manifest.json').read_text())
    geometry_checks = validate_manifest(manifest)
    process = subprocess.run(['node', str(HERE/'source_examples.mjs')], cwd=ROOT, text=True, capture_output=True, timeout=120)
    need(process.returncode == 0, f'CPU source selection failed: {process.stderr}')
    source_examples = json.loads(process.stdout)
    geometry_evidence = {'status': 'pass', 'scope': 'actual existing GLB CPU geometry; no live placements', 'results': geometry_checks}
    if check_saved_evidence:
        need(json.loads((HERE/'qa/geometry-checks.json').read_text()) == geometry_evidence, 'stale geometry evidence')
        need(json.loads((HERE/'qa/source-examples.json').read_text()) == source_examples, 'stale source-selection evidence')
    measured = [{'id': a['id'], 'lod': l['level'], 'sha256': l['glb']['sha256'], **l['measurements']}
                for collection in ['moduleContracts', 'existingVariantReferences', 'bayReferences']
                for a in manifest[collection] for l in a['lodReferences']]
    return {
        'schemaVersion': SCHEMA, 'status': 'pass', 'contractStatus': 'offline_complete', 'runtimeStatus': 'runtime_pending_webgl',
        'scope': 'C01–C03 reference/adaptation contract only; existing geometry measured, not newly modelled or activated',
        'environment': {'python': platform.python_version(), 'platform': platform.system(),
                        'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'WebGL': 'not_run', 'BlenderReopen': 'not_run (sources unchanged; hashes verified)'},
        'counts': {'moduleTypes': 16, 'moduleLODs': 32, 'existingFittedVariantLODs': 2, 'productionBayReferenceLODs': 4,
                   'referencedGLBsMeasured': len(measured), 'openingVolumeLODs': sum('openVolumeRays' in r for r in geometry_checks),
                   'openingVolumeRays': sum(r.get('openVolumeRays', 0) for r in geometry_checks)},
        'checks': {'pinnedGLBAndEditableSourceHashes': 'pass', 'transformedBoundsTrianglesAndImageCosts': 'pass',
                   'allModuleLegacyPBRUVAndIndexChecks': 'pass', 'triangleClippedOpeningVolumes': 'pass',
                   'interiorRaysAndSolidStopControlRays': 'pass', 'versionedMetadataExactMatch': 'pass',
                   'sourceSelectedFitReplay': 'pass', 'savedEvidenceFreshness': 'pass' if check_saved_evidence else 'not_run'},
        'sourceFitCounts': source_examples['counts'],
        'preservedContracts': {'cedarCanopyYMinMaxM': [2.36, 3.10], 'residentialEntryClearM': [1.04, 2.30],
                              'modernOpeningM': [1.92, 1.47], 'cedarOpeningM': [1.28, 1.52],
                              'heritageBayCompleteDepthM': 1.2207, 'modernBayCompleteDepthM': 1.703},
        'evidence': {'geometry': 'qa/geometry-checks.json', 'sourceFits': 'qa/source-examples.json', 'measurements': 'qa/measurements.json'},
        'runtimeChecks': manifest['runtimeChecks'],
        'measurements': measured,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = validate()
    measurements = report.pop('measurements')
    if args.report:
        # Only package-local QA output is permitted by this entry point.
        destination = args.report.resolve()
        need(destination.is_relative_to(HERE), 'report must remain inside facade-fit-contracts')
        destination.write_text(json.dumps(report, indent=2)+'\n')
        (HERE/'qa/measurements.json').write_text(json.dumps({'scope': 'existing referenced GLBs, root-local transformed geometry', 'results': measurements}, indent=2)+'\n')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
