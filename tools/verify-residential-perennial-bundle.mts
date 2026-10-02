import assert from 'node:assert/strict';
import { build } from 'vite';

for (const enabled of [false, true]) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    build: {
      write: false,
      minify: true,
      lib: { entry: 'lib/city/residential-ground.ts', formats: ['es'] },
      rolldownOptions: { external: ['three'] },
    },
    define: {
      'process.env.VANCOUVER_VISUAL_QA': JSON.stringify(enabled ? '1' : '0'),
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((bundle) => {
      assert('output' in bundle, 'Expected a completed non-watching build');
      return bundle.output;
    })
    .filter((file) => file.type === 'chunk');
  const text = chunks.map((file) => file.code).join('\n');
  for (const marker of [
    'residential-perennial-qa-v1',
    'qaPerennial',
    'residentialPerennialQA',
  ])
    assert.equal(text.includes(marker), enabled, marker);
  const inputs = chunks.flatMap((chunk) => Object.entries(chunk.modules));
  const bytes = inputs
    .filter(([name]) => name.includes('residential-perennial'))
    .reduce((sum, [, v]) => sum + v.renderedLength, 0);
  assert.equal(
    bytes > 0,
    enabled,
    'candidate code/data absent from production output',
  );
}
