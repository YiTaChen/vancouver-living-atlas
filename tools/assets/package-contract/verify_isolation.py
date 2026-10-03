"""Fail if a specified offline package's files/URLs leak into public output.
Read-only companion to normal Firebase build verification; no global allowlist.
"""
import argparse
import hashlib
import json
from pathlib import Path


def verify(package, dist):
    package=Path(package).resolve(); dist=Path(dist).resolve()
    if not package.is_dir() or not dist.is_dir(): raise ValueError('package and built dist directories required')
    source={hashlib.sha256(p.read_bytes()).hexdigest():p.relative_to(package).as_posix() for p in package.rglob('*') if p.is_file() and p.suffix.lower() in ('.glb','.blend','.png')}
    if not source: raise ValueError('no asset payloads to protect')
    needles={package.name.encode(),f'/__offline-assets/{package.name}/'.encode()}
    for p in package.rglob('*.glb'): needles.add(p.name.encode())
    checked=0
    for p in dist.rglob('*'):
        if not p.is_file(): continue
        checked+=1; data=p.read_bytes()
        if hashlib.sha256(data).hexdigest() in source: raise ValueError(f'offline payload copied to {p.relative_to(dist)}')
        if p.suffix in ('.js','.html','.json','.css') and any(n in data for n in needles): raise ValueError(f'offline package URL/name in {p.relative_to(dist)}')
    return {'status':'pass','packageId':package.name,'protectedPayloadHashes':len(source),'distFilesChecked':checked,'scope':'exact payload hash and package/GLB URL name exclusion; no runtime network observation','runtimeFetchInspection':'not_run'}

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('package',type=Path); p.add_argument('--dist',type=Path,default=Path('dist/client')); a=p.parse_args()
    print(json.dumps(verify(a.package,a.dist),indent=2))
