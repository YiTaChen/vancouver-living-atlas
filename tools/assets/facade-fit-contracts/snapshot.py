"""Snapshot references and metrics without rewriting any source package."""
from pathlib import Path
import argparse
import json
import hashlib
import subprocess
from geometry import HERE, ROOT, common, legacy, digest, mesh_triangles, check_open_volume, check_witnesses, need
from definitions import SCHEMA, PACKAGE_ID, VERSION, MODULE_PACKAGES, DEPENDENCIES, REJECTION_REASONS, definition, witnesses


def file_reference(path, baseline_revision=None):
    relative = str(path.relative_to(ROOT))
    # The audit records its consumer version, not a permanent ban on runtime
    # improvements. Authored assets/data/tool references still use current bytes.
    if baseline_revision and relative.startswith('lib/city/') and relative.endswith(('.ts', '.js')):
        need(len(baseline_revision) == 40 and all(c in '0123456789abcdef' for c in baseline_revision), 'recorded base revision')
        data = subprocess.check_output(['git', 'show', baseline_revision+':'+relative], cwd=ROOT)
        return {'path': relative, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return {'path': relative, 'sha256': digest(path), 'bytes': path.stat().st_size}


def lod_reference(directory, asset, lod, check_legacy=True):
    if check_legacy:
        legacy.validate_lod(directory, asset, lod)
    path = directory/lod['file']
    measured = common.measure_glb(path)
    # Old manifests round bay bounds to four decimal places. The measured
    # snapshot retains full root-local float geometry rather than relabel it.
    for side in ('min', 'max'):
        need(all(abs(a-b) < 1e-4 for a, b in zip(measured['boundsM'][side], lod['bounds'][side])), 'legacy bounds changed')
    need(measured['triangles'] == lod['triangles'], 'legacy triangle count changed')
    need(digest(path) == lod['sha256'], 'legacy GLB hash changed')
    result = {'level': lod['level'], 'glb': file_reference(path), 'measurements': measured}
    if 'source' in lod:
        result['editableSource'] = file_reference(directory/lod['source'])
        need(result['editableSource']['sha256'] == lod['sourceSha256'], 'legacy editable source hash changed')
    else:
        source = ROOT/'tools/assets/streetscape/source'/f'{asset["id"]}.lod{lod["level"]}.blend'
        result['editableSource'] = file_reference(source)
    return result


def collect(base_revision=None):
    historical_revision = base_revision
    base_revision = base_revision or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    contracts, checks, references = [], [], []
    for package in MODULE_PACKAGES:
        directory = HERE.parent/package
        manifest = json.loads((directory/'manifest.json').read_text())
        references.append(file_reference(directory/'manifest.json'))
        for asset in manifest['assets']:
            item = definition(asset, package)
            item['sourcePackageManifest'] = str((directory/'manifest.json').relative_to(ROOT))
            item['lodReferences'] = []
            for lod in asset['lods']:
                ref = lod_reference(directory, asset, lod)
                item['lodReferences'].append(ref)
                tri, points = mesh_triangles(directory/lod['file'])
                evidence = {'id': asset['id'], 'lod': lod['level'], 'status': 'pass', 'trianglesMeasured': len(tri)}
                if 'clearance' in asset:
                    evidence.update(check_open_volume(tri, asset['clearance']))
                else:
                    evidence['openingCheck'] = 'not_applicable: no empty-volume contract'
                evidence.update(check_witnesses(tri, points, witnesses(asset['id'], lod['level'])))
                checks.append(evidence)
            item['materialBinding'] = {'semanticSurfaceId': asset['lods'][0]['surface'], 'materialNamesByLOD': {str(l['level']): l['measurements']['materialNames'] for l in item['lodReferences']}, 'runtimeBinding': 'existing shared city atlas; do not retain embedded inspection-map duplicates'}
            contracts.append(item)
    # This is an existing fitted variant of one of the sixteen types, not a
    # seventeenth design and not newly authored by this package.
    candidate = HERE.parent/'architecture-details/runtime-candidate'
    cm = json.loads((candidate/'manifest.json').read_text())
    references.append(file_reference(candidate/'manifest.json'))
    fitted = {'id': cm['id'], 'moduleId': 'sandstone-sill',
              'sourcePackageManifest': str((candidate/'manifest.json').relative_to(ROOT)),
              'reason': 'Existing 0.16 m high fitted source; original 0.18 m source cannot replace a 0.16 m slot without changing section.',
              'widthRangeM': [1.4, 5.0], 'widthRangeBasis': 'actual existing Robson selectArchitectureCandidateSills predicate',
              'lodReferences': [lod_reference(candidate, {'id': 'sandstone-sill'}, lod) for lod in cm['lods']]}
    bay_root = ROOT/'public/models/streetscape'
    bay_manifest = json.loads((bay_root/'manifest.json').read_text())
    references.append(file_reference(bay_root/'manifest.json'))
    bays = []
    for asset in bay_manifest['assets']:
        if asset['id'] not in ('heritage-shop-bay', 'modern-lobby-bay'):
            continue
        bays.append({'id': asset['id'], 'taskIds': ['C01' if asset['id'].startswith('heritage') else 'C02'],
            'lodReferences': [lod_reference(bay_root, asset, lod, False) for lod in asset['lods']],
            'attachmentDatum': {'originM': [0, 0, 0], 'frameId': 'asset-root-local', 'identity': 'actual sidewalk threshold, wall plane Z=0'},
            'widthFit': 'fixed-width, unit scale; repeat only where actual streetfront source logic permits',
            'depthMeaning': 'complete exterior relief including canopy; not walkable interior depth',
            'consumerThresholdHeightM': 3.2,
            'terrainRule': {'samples': 'at least 3 actual rendered sidewalk heights', 'maxRangeM': .14, 'thresholdOffsetM': .02,
                            'upperPaneMarginM': .19 if asset['id'].startswith('heritage') else .15},
            'fitEvaluatorScope': 'width and current streetBayThreshold only; not complete streetfront source eligibility',
            'pendingConsumerGates': ['existing heritage/modern source region and height gates', 'water and sidewalk coverage', 'modern canopy-tip pavement sample at 1.75 m projection', 'source-location deduplication and runtime cell/population budgets'],
            'accessibility': 'No GIS opening, floor, navigation or entry capability is created.'})
    references += [file_reference(ROOT/path, historical_revision) for path in DEPENDENCIES]
    snapshot = {
        'schemaVersion': SCHEMA, 'packageId': PACKAGE_ID, 'version': VERSION,
        'deliverableKind': 'source-reference-adaptation-contract', 'baseRevision': base_revision,
        'status': {'contract': 'offline_complete', 'integration': 'runtime_pending_webgl'},
        'units': 'm', 'coordinateSystem': {'up': '+Y', 'front': '+Z', 'frame': 'asset-root-local or explicit source-edge-local'},
        'scope': 'No new models, exports, textures, Blender rebuilds, runtime imports, public copies or source-location exceptions.',
        'provenance': {'project': 'Vancouver Living Atlas by YiTaChen', 'source': 'https://github.com/YiTaChen/vancouver-living-atlas',
                       'license': 'LicenseRef-Vancouver-Living-Atlas-NC-1.0', 'basis': 'existing project-authored editable architecture inventory'},
        'refreshCommand': 'python3 tools/assets/facade-fit-contracts/snapshot.py --write',
        'validationCommand': 'python3 tools/assets/facade-fit-contracts/validate.py --report tools/assets/facade-fit-contracts/qa/validation.json',
        'sourceReferences': references, 'moduleContracts': contracts, 'existingVariantReferences': [fitted], 'bayReferences': bays,
        'rejectionReasons': REJECTION_REASONS,
        'runtimeChecks': {'sourcePavementSampling': 'not_run', 'streetAcceptance': 'not_run', 'WebGLVisuals': 'not_run',
                          'LODAndLifecycle': 'not_run', 'GPUAndFrameTime': 'not_run', 'productionActivation': 'not_run'},
        'materialPolicy': 'Reuse existing semantic surface IDs and shared atlas; embedded inspection images are not new runtime textures.',
        'editableSourcePolicy': 'Existing editable .blend references retained and SHA-256 verified; this adaptation does not re-export or claim a new Blender source audit.',
    }
    return snapshot, checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true', help='Refresh only this reference package after deliberate source-contract review')
    args = parser.parse_args()
    manifest, checks = collect()
    if args.write:
        (HERE/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        (HERE/'qa/geometry-checks.json').write_text(json.dumps({'status': 'pass', 'scope': 'actual existing GLB CPU geometry; no live placements', 'results': checks}, indent=2)+'\n')
        print(f'Wrote reference contract: {len(manifest["moduleContracts"])} types, {sum(len(a["lodReferences"]) for a in manifest["moduleContracts"])} module LODs; no exports created.')
    else:
        print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
