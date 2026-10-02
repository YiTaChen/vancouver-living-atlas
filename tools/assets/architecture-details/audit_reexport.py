"""Compare re-exported GLB geometry/PBR with canonical kit; verify untouched inputs."""
import argparse
import hashlib
import json
from pathlib import Path

from validate_architecture_details import HERE, accessor, digest, glb, require, validate


def geometry_signature(path):
    doc, binary = glb(path.read_bytes())
    p = doc['meshes'][0]['primitives'][0]
    names = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT']
    attributes = [accessor(doc, binary, p['attributes'][name]) for name in names]
    indices = accessor(doc, binary, p['indices'])
    # Sort triangles/vertices to ignore harmless exporter index ordering.
    triangles = []
    for start in range(0, len(indices), 3):
        vertices = []
        for index in indices[start:start+3]:
            vertices.append(tuple(round(value, 7) for attr in attributes for value in attr[index[0]]))
        triangles.append(tuple(sorted(vertices)))
    return hashlib.sha256(json.dumps(sorted(triangles)).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    root = args.candidate.resolve()
    reference = json.loads((HERE/'manifest.json').read_text())
    candidate = json.loads((root/'manifest.json').read_text())
    audit = validate(root)
    results = []
    require([a['id'] for a in reference['assets']] == [a['id'] for a in candidate['assets']], 'matching inventory')
    for before, after in zip(reference['assets'], candidate['assets']):
        for source, exported, incoming in zip(before['lods'], after['lods'], after['inputSources']):
            require(source['sourceSha256'] == digest(HERE/source['source']) == incoming['sha256'], 'edited input was changed')
            before_signature = geometry_signature(HERE/source['file'])
            after_signature = geometry_signature(root/exported['file'])
            require(before_signature == after_signature, 're-export changed geometry, normals, UVs or tangents')
            require(source['triangles'] == exported['triangles'] and source['bounds'] == exported['bounds'], 're-export changed physical geometry')
            results.append({'id': before['id'], 'lod': source['level'], 'inputSourceSha256': incoming['sha256'], 'geometryPbrSignature': before_signature, 'unchangedInput': True, 'equivalentExport': True})
    report = {'passed': True, 'checks': ['full independent Blender and GLB candidate audit', 'input sources preserved byte for byte', 'actual indexed position normal UV tangent equivalence', 'physical bounds triangles shared-map equivalence'], 'candidateAudit': audit, 'comparisons': results}
    text = json.dumps(report, indent=2)+'\n'
    if args.report:
        args.report.write_text(text)
    print(text)


if __name__ == '__main__':
    main()
