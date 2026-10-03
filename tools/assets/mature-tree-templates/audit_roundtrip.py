"""Re-export unchanged saved originals through the delivered exporter to a fresh package."""
import importlib.util,json,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('exporter',HERE/'export.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)

def main():
    m=json.loads((HERE/'manifest.json').read_text());work=Path(tempfile.mkdtemp(prefix='mature-tree-roundtrip-'))/'package';before={l['source']:e.contract.digest(HERE/l['source']) for a in m['assets'] for l in a['lods']};e.run(HERE/'source',work,m['baseRevision']);e.contract.validate(work);rows=[]
    for asset in m['assets']:
        for lod in asset['lods']:
            original=HERE/lod['file'];fresh=work/lod['file'];a,b=e.contract.read_glb(original);x,y=e.contract.read_glb(fresh)
            assert a==x and b==y,('roundtrip semantic/binary mismatch',original.name)
            assert e.contract.digest(original)==e.contract.digest(fresh)
            assert before[lod['source']]==e.contract.digest(HERE/lod['source'])
            rows.append({'assetId':asset['id'],'lod':lod['level'],'glbSha256':e.contract.digest(fresh),'glbByteIdentical':True,'savedSourceUnchanged':True})
    for texture in m['textures']:assert e.contract.digest(HERE/texture['file'])==e.contract.digest(work/texture['file'])
    (HERE/'qa/source-roundtrip.json').write_text(json.dumps({'status':'pass','sourcePreservingExporter':'export.py','freshOutput':str(work),'texturesByteIdentical':True,'records':rows},indent=2)+'\n');print('MATURE_TREE_ROUNDTRIP_PASS')
if __name__=='__main__':main()
