import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('ground handoff hashes use immutable consumers and still reject changed live GIS/assets', () => {
  const result = spawnSync('python3', ['-c', String.raw`
import ast,hashlib,json,subprocess
from pathlib import Path
from types import SimpleNamespace
root=Path.cwd(); file=root/'tools/assets/ground-planting-details/validate.py'
source=ast.parse(file.read_text()); function=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='check_source_reference_hashes')
def need(condition,message):
 if not condition:raise ValueError(message)
namespace={'Path':Path,'ROOT':root,'hashlib':hashlib,'subprocess':subprocess,'c':SimpleNamespace(need=need)}
exec(compile(ast.Module(body=[function],type_ignores=[]),str(file),'exec'),namespace)
check=namespace['check_source_reference_hashes']; base=json.loads((file.parent/'manifest.json').read_text())['baseRevision']
check(json.loads((file.parent/'source-references.json').read_text())['files'],base)
historical=b'original runtime';current=b'current GIS';seen=[]
def blob(path,revision):
 assert path=='lib/city/engine.ts' and revision==base;seen.append('historical');return historical
def live(path):
 assert path in ['public/data/buildings.geojson','lib/city/landmark-footprints.json'];seen.append('current');return current
record=lambda path,data:{'file':path,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
rows=[record('lib/city/engine.ts',historical),record('public/data/buildings.geojson',current),record('lib/city/landmark-footprints.json',current)]
check(rows,base,live,blob);assert seen==['historical','current','current']
for rows in [[record('lib/city/engine.ts',current)],[record('public/data/buildings.geojson',historical)],[record('lib/city/landmark-footprints.json',historical)]]:
 try:check(rows,base,live,blob)
 except ValueError as error:assert 'hash changed' in str(error)
 else:raise AssertionError('corrupt provenance or live GIS accepted')
try:check([record('lib/city/engine.ts',historical)],'0'*40)
except RuntimeError as error:assert 'Fetch full repository history' in str(error)
else:raise AssertionError('missing immutable baseline fell back to current runtime')
try:check([record('../private',current)],base,live,blob)
except ValueError as error:assert 'path' in str(error)
else:raise AssertionError('source path traversal accepted')
print('Historical consumer, false hash, current GIS drift and unavailable revision: pass')
`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('facade and window Python provenance keeps JSON live even inside lib/city', () => {
  const result = spawnSync('python3', ['-c', String.raw`
import ast,hashlib,tempfile
from pathlib import Path
from types import SimpleNamespace
repository=Path.cwd();baseline='1'*40;original=b'original consumer';current=b'updated geographic JSON'
def need(condition,message):
 if not condition:raise ValueError(message)
sha=lambda data:hashlib.sha256(data).hexdigest()
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);jsonfile=root/'lib/city/landmark-footprints.json';jsonfile.parent.mkdir(parents=True);jsonfile.write_bytes(current)
 for suffix in ['ts','js']:(root/f'lib/city/consumer.{suffix}').write_bytes(b'updated consumer')
 calls=[]
 def git_blob(args,**kwargs):
  assert args[:2]==['git','show'];assert args[2] in [baseline+':lib/city/consumer.ts',baseline+':lib/city/consumer.js'];calls.append(args[2]);return original
 namespace={'ROOT':root,'hashlib':hashlib,'subprocess':SimpleNamespace(check_output=git_blob),'need':need,'digest':lambda path:sha(path.read_bytes()),'common':SimpleNamespace(digest=lambda path:sha(path.read_bytes()))}
 for relative,name in [('tools/assets/facade-fit-contracts/snapshot.py','file_reference'),('tools/assets/source-fitted-window-variants/validate.py','check_source_fingerprints')]:
  file=repository/relative;node=next(n for n in ast.parse(file.read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name)
  exec(compile(ast.Module(body=[node],type_ignores=[]),str(file),'exec'),namespace)
 reference=namespace['file_reference'];check=namespace['check_source_fingerprints']
 for suffix in ['ts','js']:
  assert reference(root/f'lib/city/consumer.{suffix}',baseline)['sha256']==sha(original)
 assert reference(jsonfile,baseline)=={'path':'lib/city/landmark-footprints.json','sha256':sha(current),'bytes':len(current)}
 check({'lib/city/consumer.ts':sha(original),'lib/city/consumer.js':sha(original),'lib/city/landmark-footprints.json':sha(current)},baseline)
 for path,bad in [('lib/city/consumer.ts',current),('lib/city/landmark-footprints.json',original)]:
  try:check({path:sha(bad)},baseline)
  except ValueError as error:assert 'drift' in str(error)
  else:raise AssertionError('corrupt history or changed current JSON accepted')
 assert len(calls)==5
print('Two Python guards: TS/JS immutable; JSON current; false hashes rejected')
`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('window JavaScript provenance rejects changed lib/city JSON without reading a historical blob', async () => {
  const { validateSourceFixtures } = await import('../tools/assets/source-fitted-window-variants/source_fixtures.mjs');
  const base = '1'.repeat(40);
  const saved = { fixtures: [], sourceFingerprints: { 'lib/city/landmark-footprints.json': 'current-json-hash' } };
  assert.doesNotThrow(() => validateSourceFixtures(structuredClone(saved), saved, base));
  const changed = structuredClone(saved);
  changed.sourceFingerprints['lib/city/landmark-footprints.json'] = 'outdated-json-hash';
  assert.throws(() => validateSourceFixtures(changed, saved, base), /protected asset drift/);
});
