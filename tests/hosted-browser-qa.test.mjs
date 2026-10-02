import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LIMITS,
  VIEWS,
  LAUNCH_OPTIONS,
  REMOVED_DEFAULT_ARGS,
  ABBA,
  queryString,
  assertSafeLaunch,
  validateCapture,
  comparePoses,
  artifactWriter,
  inventory,
  sampleInterpretation,
  startServer,
  assertCityReadySnapshot,
  launchOptionsForProfile,
  assertProfileCapability,
  assertProfileRenderer,
  preflightEvidence,
} from '../tools/hosted-browser-qa.mjs';

function capture(id = 'citizen') {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1080, 20);
  return {
    name: `high-${id}`,
    screenshot: 'data:image/png;base64,' + png.toString('base64'),
    row: {
      kind: 'upgrade-matched-v1',
      quality: 'high',
      id,
      valid: true,
      detailReady: true,
      warmupVisible: true,
      instrumented: false,
      render: [1920, 1080],
      hour: 14,
      fov: 48,
      atmosphere: 'clear',
      settleMs: 5001,
      sampleMs: 8001,
      frames: 240,
      maxPoseError: 0,
      fps: 30,
      p50Ms: 32,
      p95Ms: 40,
      p99Ms: 50,
      maxMs: 60,
      camera: [1, 2, 3],
      target: [4, 5, 6],
      renderer: 'ANGLE llvmpipe',
      mode: 'walk',
    },
  };
}
test('normal sandbox launch adds only benign automation and removes unsafe defaults', () => {
  assert.equal(LAUNCH_OPTIONS.chromiumSandbox, true);
  assert.equal(LAUNCH_OPTIONS.channel, 'chrome');
  assert.equal(LAUNCH_OPTIONS.headless, false);
  assert.deepEqual(LAUNCH_OPTIONS.args, ['--enable-automation']);
  assertSafeLaunch(['--enable-automation']);
  for (const flag of [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--disable-seccomp-filter-sandbox',
    '--disable-namespace-sandbox',
    '--single-process',
    '--disable-web-security',
    '--ignore-certificate-errors',
    '--enable-unsafe-swiftshader',
  ])
    assert.throws(() => assertSafeLaunch([flag]));
});
test('query configuration accepts only bounded local feature toggles', () => {
  assert.equal(queryString(), '');
  assert.equal(
    queryString('?qaCitizen=baseline&qaDetails=candidate'),
    '?qaCitizen=baseline&qaDetails=candidate',
  );
  for (const query of [
    'https://example.com',
    '/other',
    '?x=`bad`',
    '?x=hello world',
    '?x=' + 'a'.repeat(257),
  ])
    assert.throws(() => queryString(query));
});
test('matched rows require fixed image size, readiness, visible samples and uniqueness', () => {
  const seen = new Set();
  assert.equal(validateCapture(capture(), seen).row.id, 'citizen');
  assert.throws(() => validateCapture(capture(), seen));
  for (const patch of [
    { valid: false },
    { detailReady: false },
    { warmupVisible: false },
    { instrumented: true },
    { hour: 14.1 },
    { atmosphere: 'rain' },
    { render: [1280, 720] },
    { settleMs: 4900 },
    { sampleMs: 7900 },
    { frames: 0 },
    { maxPoseError: 0.1 },
    { fps: NaN },
    { id: '../escape' },
    { renderer: '' + 'x'.repeat(1001) },
  ]) {
    const data = capture();
    Object.assign(data.row, patch);
    assert.throws(
      () => validateCapture(data, new Set()),
      JSON.stringify(patch),
    );
  }
  const data = capture();
  data.screenshot =
    'data:image/png;base64,' + Buffer.alloc(24).toString('base64');
  assert.throws(() => validateCapture(data, new Set()));
});
test('matched camera/target and renderer must survive the interleaved ABBA schedule', () => {
  assert.deepEqual(ABBA, [
    'baseline-a',
    'candidate-a',
    'candidate-b',
    'baseline-b',
  ]);
  const runs = ABBA.map((label) => ({
    label,
    rows: VIEWS.map((view) => capture(view).row),
  }));
  comparePoses(runs);
  runs[1].rows[0].camera[0] += 1;
  assert.throws(() => comparePoses(runs), /Unmatched/);
  runs[1].rows[0].camera[0] -= 1;
  runs[1].rows[0].renderer = 'other';
  assert.throws(() => comparePoses(runs), /Renderer changed/);
});
test('low frame counts are preserved but never represented as a performance pass', () => {
  const row = capture().row;
  assert.equal(sampleInterpretation(row).performanceGatePassed, false);
  row.frames = 8;
  assert.equal(validateCapture({ ...capture(), row }, new Set()).row.frames, 8);
  assert.match(
    sampleInterpretation(row).interpretation,
    /insufficient-frame-count/,
  );
});
test('artifact writer caps bytes cumulatively, reserves failure evidence and rejects traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vla-browser-qa-'));
  try {
    const save = await artifactWriter(root);
    await save('large.png', Buffer.alloc(LIMITS.artifacts - LIMITS.reserve));
    await assert.rejects(save('extra.png', 'x'), /budget exceeded/);
    await save('failure.json', '{}', true);
    await assert.rejects(save('../escape', 'x'), /filename/);
    await save('large.png', 'replacement');
    assert.equal(
      (await readFile(join(root, 'large.png'))).toString(),
      'replacement',
    );
    assert.equal((await inventory(root)).length, 2);
    await symlink(join(root, 'large.png'), join(root, 'link'));
    await assert.rejects(inventory(root), /symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('workflow is bounded, read-only, SHA-pinned and can enable matched runs before merge', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/browser-qa.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /RUN_MATCHED: '(?:true|false)'/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /xvfb-run -a node tools\/hosted-browser-qa.mjs smoke/);
  for (const match of workflow.matchAll(/uses: ([^\n]+)/g))
    assert.match(
      match[1],
      /^actions\/(checkout|setup-node|upload-artifact)@[0-9a-f]{40}(?: #.*)?$/,
    );
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.doesNotMatch(
    workflow,
    /secrets\.|pull_request_target|contents: write|actions: write|id-token: write|sysctl|apparmor|chmod|chown|--no-sandbox|--enable-unsafe-swiftshader/,
  );
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url)),
  );
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url)),
  );
  assert.equal(pkg.devDependencies.playwright, '1.63.0');
  assert.equal(
    lock.packages['node_modules/playwright-core'].version,
    pkg.devDependencies.playwright,
  );
  for (const name of ['playwright', 'playwright-core'])
    assert.match(lock.packages['node_modules/' + name].integrity, /^sha512-/);
});

test('loopback server serves build files only and requires the expected capture origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vla-browser-server-'));
  let server;
  try {
    await writeFile(join(root, 'index.html'), '<html>fixture</html>');
    await symlink('/etc/hosts', join(root, 'escape'));
    const captures = [];
    server = await startServer(root, (data) => captures.push(data), 0);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(origin + '/');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<html>fixture</html>');
    assert.equal((await fetch(origin + '/escape')).status, 400);
    assert.equal((await fetch(origin + '/%2e%2e%2fetc/hosts')).status, 400);
    const post = (source) =>
      fetch(origin + '/__visual-qa', {
        method: 'POST',
        headers: { origin: source, 'content-type': 'application/json' },
        body: '{"fixture":true}',
      });
    assert.equal((await post('https://example.com')).status, 400);
    assert.equal((await post('http://127.0.0.1:3100')).status, 200);
    assert.deepEqual(captures, [{ fixture: true }]);
    assert.equal((await fetch(origin + '/', { method: 'DELETE' })).status, 405);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('pinned Playwright effective defaults remove unsafe behavior before any process launch', async () => {
  const require = createRequire(import.meta.url);
  // Package internals are used ONLY as an offline regression oracle, never to launch.
  const corePath = require
    .resolve('playwright-core/package.json')
    .replace(/package\.json$/, 'lib/coreBundle.js');
  const { server } = require(corePath);
  const playwright = server.createPlaywright({ sdkLanguage: 'javascript' });
  const original = await playwright.chromium.defaultArgs(
    LAUNCH_OPTIONS,
    false,
    '/tmp/qa-nonexistent-profile',
  );
  assert.deepEqual(LAUNCH_OPTIONS.ignoreDefaultArgs, REMOVED_DEFAULT_ARGS);
  for (const flag of REMOVED_DEFAULT_ARGS)
    assert(original.includes(flag), `Pinned default changed: ${flag}`);
  assert.throws(() => assertSafeLaunch(original), /Unsafe/);
  const effective = original.filter(
    (flag) => !LAUNCH_OPTIONS.ignoreDefaultArgs.includes(flag),
  );
  assertSafeLaunch(effective);
  assert(
    !effective.some((flag) =>
      /unsafe|sandbox|disable-web-security|ignore-certificate/.test(flag),
    ),
  );
  assert(!effective.some((flag) => flag.startsWith('--disable-features=')));
  assert(effective.includes('--remote-debugging-pipe'));
  assert(effective.includes('--disable-background-networking'));
  assert.equal(
    playwright.allBrowsers().length,
    0,
    'The oracle must not launch a browser',
  );
});

test('post-control smoke readiness rejects lost contexts and reappearing loading state', () => {
  const gl = {
    available: true,
    contextLost: false,
    drawingBuffer: [1920, 1080],
  };
  assertCityReadySnapshot(gl, 0, true);
  assert.throws(() =>
    assertCityReadySnapshot({ ...gl, contextLost: true }, 0, true),
  );
  assert.throws(() => assertCityReadySnapshot(gl, 1, true));
  assert.throws(() => assertCityReadySnapshot(gl, 0, false));
});

test('renderer profiles are exact, explicit and do not weaken browser protections', () => {
  const defaultOptions = launchOptionsForProfile('default', { DISPLAY: ':99' });
  assert.deepEqual(defaultOptions.args, ['--enable-automation']);
  assert.deepEqual(defaultOptions.env, { DISPLAY: ':99' });
  const mesa = launchOptionsForProfile('mesa', { DISPLAY: ':99' });
  assert.deepEqual(mesa.args, [
    '--enable-automation',
    '--use-gl=angle',
    '--use-angle=gl',
  ]);
  assert.deepEqual(mesa.env, {
    DISPLAY: ':99',
    LIBGL_ALWAYS_SOFTWARE: 'true',
    GALLIUM_DRIVER: 'llvmpipe',
  });
  assert.equal(mesa.chromiumSandbox, true);
  assert.equal(mesa.ignoreDefaultArgs, REMOVED_DEFAULT_ARGS);
  for (const bad of [
    'swiftshader',
    'vulkan',
    'mesa --no-sandbox',
    '',
    '__proto__',
  ])
    assert.throws(() => launchOptionsForProfile(bad, {}));
  for (const key of [
    'ANGLE_GL_VENDOR',
    'ANGLE_GL_RENDERER',
    'ANGLE_GL_VERSION',
    'MESA_GL_VERSION_OVERRIDE',
    'MESA_GLSL_VERSION_OVERRIDE',
    'MESA_EXTENSION_OVERRIDE',
    'MESA_NO_ERROR',
    'MESA_LOADER_DRIVER_OVERRIDE',
    'LIBGL_ALWAYS_INDIRECT',
  ]) {
    assert.throws(() => launchOptionsForProfile('mesa', { [key]: 'fake' }));
  }
  assert.throws(() =>
    launchOptionsForProfile('default', { GALLIUM_DRIVER: 'llvmpipe' }),
  );
  assert.throws(() =>
    launchOptionsForProfile('mesa', { LIBGL_ALWAYS_SOFTWARE: 'false' }),
  );
  assert.throws(() => assertSafeLaunch(['--disable-gpu-watchdog']));
  assert.throws(() => assertSafeLaunch(['--ignore-gpu-blocklist']));
});
test('Mesa must prove actual llvmpipe and readback before application evidence', () => {
  const gl = {
    available: true,
    probePassed: true,
    contextLost: false,
    renderer: 'ANGLE (Mesa, llvmpipe (LLVM 18.1.8), OpenGL)',
  };
  assertProfileCapability('mesa', gl);
  assertProfileRenderer('mesa', gl.renderer);
  assert.throws(() =>
    assertProfileCapability('mesa', { ...gl, available: false }),
  );
  assert.throws(() =>
    assertProfileCapability('mesa', { ...gl, probePassed: false }),
  );
  assert.throws(() =>
    assertProfileCapability('mesa', { ...gl, renderer: 'ANGLE SwiftShader' }),
  );
  assert.throws(() => assertProfileRenderer('mesa', 'WebGL 2.0'));
});
test('both pinned profiles have safe effective argv without launching any browser', async () => {
  const require = createRequire(import.meta.url);
  const { server } = require(
    require
      .resolve('playwright-core/package.json')
      .replace(/package\.json$/, 'lib/coreBundle.js'),
  );
  const playwright = server.createPlaywright({ sdkLanguage: 'javascript' });
  for (const profile of ['default', 'mesa']) {
    const options = launchOptionsForProfile(profile, {});
    const original = await playwright.chromium.defaultArgs(
      options,
      false,
      '/tmp/qa-nonexistent-profile',
    );
    const effective = original.filter(
      (flag) => !options.ignoreDefaultArgs.includes(flag),
    );
    assertSafeLaunch(effective);
    assert.equal(effective.includes('--use-angle=gl'), profile === 'mesa');
    assert.equal(effective.includes('--use-gl=angle'), profile === 'mesa');
    assert(
      !effective.some((flag) => /unsafe|sandbox|watchdog|blocklist/.test(flag)),
    );
  }
  assert.equal(playwright.allBrowsers().length, 0);
});
test('preflight JSON is bounded, profile-specific and only exposes known diagnostic fields', () => {
  const details = {
    browser: '154.0.test',
    launchArgs: [
      '/opt/google/chrome/chrome',
      '--enable-automation',
      '--use-gl=angle',
      '--use-angle=gl',
    ],
    gpu: {
      devices: [
        {
          vendorString: 'Mesa',
          deviceString: 'llvmpipe',
          driverVersion: 'test',
          secret: 'never-print',
        },
      ],
      auxAttributes: { glRenderer: 'llvmpipe', secret: 'never-print' },
      featureStatus: { webgl2: 'unavailable' },
      secret: 'never-print',
    },
    capability: {
      available: false,
      reason: 'WebGL2 unavailable under the selected renderer profile',
    },
    secret: 'never-print',
  };
  const report = preflightEvidence('mesa', details);
  assert.equal(report.profile, 'mesa');
  assert.equal(report.capability.available, false);
  assert.equal(report.hardwareAcceptance, false);
  assert.equal(report.gpu.glRenderer, 'llvmpipe');
  assert.equal(report.graphicsBlocklistBypassed, false);
  assert.equal(report.gpuWatchdogDisabled, false);
  assert.equal(preflightEvidence('default').gpuWatchdogDisabled, null);
  const rejected = preflightEvidence('mesa', {
    launchArgs: ['--disable-gpu-watchdog', '--ignore-gpu-blocklist'],
  });
  assert.equal(rejected.gpuWatchdogDisabled, true);
  assert.equal(rejected.graphicsBlocklistBypassed, true);
  assert.doesNotMatch(JSON.stringify(report), /never-print/);
  assert(Buffer.byteLength(JSON.stringify(report)) < 24_000);
  const huge = preflightEvidence('default', {
    launchArgs: Array(300).fill('x'.repeat(5000)),
  });
  assert.equal(huge.effectiveArguments.length, 64);
  assert.equal(huge.effectiveArgumentsTruncated, true);
  assert(Buffer.byteLength(JSON.stringify(huge)) < 24_000);
});
