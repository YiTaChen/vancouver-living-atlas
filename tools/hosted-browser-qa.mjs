/** Bounded localhost-only browser evidence. Never deploys or changes app sources. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  realpath,
} from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({
  artifacts: 20_000_000,
  reserve: 100_000,
  png: 4_000_000,
  post: 6_000_000,
  json: 64_000,
  preview: 24_000,
  events: 40,
});
export const VIEWS = [
  'atlas-aerial',
  'gastown-roofs',
  'gastown-street',
  'citizen',
];
// Playwright 1.63.0 adds these defaults itself, even with no caller args.
// Remove security-weakening defaults BEFORE launch. The exact feature bundle is
// version-pinned and regression-tested against the installed official package.
export const REMOVED_DEFAULT_ARGS = Object.freeze([
  '--enable-unsafe-swiftshader',
  '--disable-client-side-phishing-detection',
  '--disable-ipc-flooding-protection',
  '--unsafely-disable-devtools-self-xss-warnings',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion',
]);
export const LAUNCH_OPTIONS = Object.freeze({
  headless: false,
  args: ['--enable-automation'], // Allows read-only CDP inspection of effective argv.
  channel: 'chrome',
  chromiumSandbox: true,
  ignoreDefaultArgs: REMOVED_DEFAULT_ARGS,
  timeout: 30_000,
});
export const RENDERER_PROFILES = Object.freeze({
  default: Object.freeze({
    args: Object.freeze([]),
    environment: Object.freeze({}),
  }),
  mesa: Object.freeze({
    args: ['--use-gl=angle', '--use-angle=gl'],
    environment: { LIBGL_ALWAYS_SOFTWARE: 'true', GALLIUM_DRIVER: 'llvmpipe' },
  }),
});
export function launchOptionsForProfile(
  profile = 'default',
  environment = process.env,
) {
  assert(
    Object.hasOwn(RENDERER_PROFILES, profile),
    'Unknown renderer profile; use default or mesa',
  );
  const selected = RENDERER_PROFILES[profile];
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
    assert(
      environment[key] === undefined,
      `Graphics override is not allowed: ${key}`,
    );
  }
  for (const key of ['LIBGL_ALWAYS_SOFTWARE', 'GALLIUM_DRIVER']) {
    assert(
      environment[key] === undefined ||
        environment[key] === selected.environment[key],
      `Graphics environment conflicts with selected profile: ${key}`,
    );
  }
  return {
    ...LAUNCH_OPTIONS,
    args: [...LAUNCH_OPTIONS.args, ...selected.args],
    env: { ...environment, ...selected.environment },
  };
}
export function assertProfileRenderer(profile, renderer) {
  assert(Object.hasOwn(RENDERER_PROFILES, profile), 'Unknown renderer profile');
  if (profile === 'mesa')
    assert(
      /llvmpipe/i.test(renderer),
      'Mesa profile did not report an actual llvmpipe renderer',
    );
}
export function assertProfileCapability(profile, capability) {
  assert(Object.hasOwn(RENDERER_PROFILES, profile), 'Unknown renderer profile');
  assert(
    capability?.available &&
      capability.probePassed &&
      capability.contextLost === false,
    'Real WebGL2 clear/readback capability is unavailable',
  );
  assertProfileRenderer(profile, capability.renderer);
}
export function preflightEvidence(profile, details = {}) {
  assert(Object.hasOwn(RENDERER_PROFILES, profile), 'Unknown renderer profile');
  const small = (value) => boundedText(value ?? '').slice(0, 256);
  const gpu = details.gpu ?? {};
  const capability = details.capability;
  const evidence = {
    kind: 'hosted-browser-preflight-v1',
    profile,
    browser: small(details.browser),
    executable: small(details.launchArgs?.[0]),
    sandboxRequested: true,
    graphicsBlocklistBypassed: details.launchArgs
      ? details.launchArgs.some((arg) =>
          /^--ignore-gpu-blocklist(?:=|$)/.test(arg),
        )
      : null,
    gpuWatchdogDisabled: details.launchArgs
      ? details.launchArgs.some((arg) =>
          /^--disable-gpu-watchdog(?:=|$)/.test(arg),
        )
      : null,
    requestedArguments: [
      ...LAUNCH_OPTIONS.args,
      ...RENDERER_PROFILES[profile].args,
    ],
    graphicsEnvironment: RENDERER_PROFILES[profile].environment,
    effectiveArguments: (details.launchArgs ?? []).slice(0, 64).map(small),
    effectiveArgumentsTruncated:
      (details.launchArgs?.length ?? 0) > 64 ||
      (details.launchArgs ?? []).some((arg) => String(arg).length > 256),
    gpu: {
      devices: (gpu.devices ?? []).slice(0, 4).map((device) => ({
        vendor: small(device.vendorString),
        device: small(device.deviceString),
        driverVersion: small(device.driverVersion),
      })),
      glRenderer: small(gpu.auxAttributes?.glRenderer),
      glVendor: small(gpu.auxAttributes?.glVendor),
      glVersion: small(gpu.auxAttributes?.glVersion),
      featureStatus: Object.fromEntries(
        Object.entries(gpu.featureStatus ?? {})
          .slice(0, 24)
          .map(([key, value]) => [
            small(key).slice(0, 64),
            small(value).slice(0, 64),
          ]),
      ),
    },
    capability: capability
      ? {
          available: capability.available === true,
          contextLost: capability.contextLost ?? null,
          probePassed: capability.probePassed === true,
          renderer: small(capability.renderer),
          version: small(capability.version),
          reason: small(capability.reason),
          drawingBuffer: capability.drawingBuffer,
          probePixel: capability.probePixel,
        }
      : null,
    error: small(details.error),
    hardwareAcceptance: false,
  };
  assert(
    Buffer.byteLength(JSON.stringify(evidence)) <= 24_000,
    'Preflight diagnostic exceeds 24 KB cap',
  );
  return evidence;
}
export const ABBA = ['baseline-a', 'candidate-a', 'candidate-b', 'baseline-b'];
const ORIGIN = 'http://127.0.0.1:3100';
const OUTPUT = resolve('work/visual-qa/hosted-browser');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Keep failure/console text bounded and strip control sequences from evidence.
const boundedText = (text) =>
  String(text)
    .slice(0, 1000)
    .replace(/./gs, (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? ' '
        : character,
    );

export function queryString(value = '') {
  assert(
    value.length <= 256 && /^(?:\?[a-zA-Z0-9_=&.-]*)?$/.test(value),
    'Only a bounded query string is allowed',
  );
  return value;
}
export function assertSafeLaunch(args) {
  const forbidden =
    /^(--no-sandbox|--disable-setuid-sandbox|--disable-gpu-sandbox|--disable-seccomp-filter-sandbox|--disable-namespace-sandbox|--single-process|--ignore-gpu-blocklist|--disable-gpu-watchdog|--disable-web-security|--ignore-certificate-errors|--enable-unsafe-swiftshader)(=|$)/;
  assert(
    !args.some(
      (arg) =>
        forbidden.test(arg) ||
        REMOVED_DEFAULT_ARGS.includes(arg) ||
        /^--disable-features=.*(?:HttpsUpgrades|ThirdPartyStoragePartitioning|BlockOriginHeaderModificationOnRedirect)/.test(
          arg,
        ),
    ),
    'Unsafe Chromium launch flag',
  );
}
export function validateCapture(data, seen) {
  assert(data && typeof data === 'object');
  const r = data.row;
  assert(r && r.kind === 'upgrade-matched-v1' && r.quality === 'high');
  assert(
    VIEWS.includes(r.id) && data.name === `high-${r.id}` && !seen.has(r.id),
    'Unexpected/duplicate capture',
  );
  assert(
    r.valid === true &&
      r.detailReady === true &&
      r.warmupVisible === true &&
      r.instrumented === false,
    'Invalid readiness or instrumented capture',
  );
  assert.deepEqual(r.render, [1920, 1080]);
  assert(r.hour === 14 && r.fov === 48 && r.atmosphere === 'clear');
  assert(
    r.settleMs >= 5000 &&
      r.sampleMs >= 8000 &&
      r.frames > 0 &&
      r.maxPoseError < 0.05,
  );
  for (const key of ['fps', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs'])
    assert(Number.isFinite(r[key]) && r[key] >= 0);
  for (const key of ['camera', 'target'])
    assert(
      Array.isArray(r[key]) &&
        r[key].length === 3 &&
        r[key].every(Number.isFinite),
    );
  assert(typeof r.renderer === 'string' && r.renderer.length < 1000);
  assert(
    Buffer.byteLength(JSON.stringify(r)) <= LIMITS.json,
    'Oversize report',
  );
  assert(
    typeof data.screenshot === 'string' &&
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.screenshot),
  );
  const png = Buffer.from(data.screenshot.slice(22), 'base64');
  assert(png.length <= LIMITS.png && png.length >= 24, 'Oversize/empty PNG');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
  seen.add(r.id);
  return { row: r, png };
}
export function sampleInterpretation(row) {
  return {
    frames: row.frames,
    sampleMs: row.sampleMs,
    performanceGatePassed: false,
    interpretation:
      row.frames < 100
        ? 'insufficient-frame-count-for-timing-interpretation'
        : 'diagnostic-only-not-a-performance-gate',
  };
}
export function comparePoses(runs) {
  const first = runs[0];
  for (const run of runs.slice(1))
    for (const view of VIEWS) {
      const a = first.rows.find((row) => row.id === view),
        b = run.rows.find((row) => row.id === view);
      assert(a && b, `Missing matched view ${view}`);
      assert.equal(a.renderer, b.renderer, 'Renderer changed between runs');
      assert.equal(a.mode, b.mode, 'Navigation mode changed');
      for (const key of ['camera', 'target'])
        assert(
          Math.hypot(...a[key].map((x, i) => x - b[key][i])) < 0.05,
          `Unmatched ${view} ${key}`,
        );
    }
}
export async function inventory(root) {
  const files = [];
  async function walk(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name),
        relative = prefix + name,
        info = await lstat(path);
      assert(
        !info.isSymbolicLink(),
        'Evidence/build symlinks are not accepted',
      );
      if (info.isDirectory()) await walk(path, relative + '/');
      else {
        assert(info.isFile());
        files.push({
          name: relative,
          bytes: info.size,
          sha256: hash(await readFile(path)),
        });
      }
    }
  }
  await walk(root);
  return files;
}
export async function artifactWriter(root) {
  await mkdir(root, { recursive: true });
  const sizes = new Map(
    (await inventory(root)).map((file) => [file.name, file.bytes]),
  );
  return async (name, bytes, final = false) => {
    assert(/^[a-z0-9.-]+$/.test(name), 'Unsafe evidence filename');
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const total =
      [...sizes.values()].reduce((sum, n) => sum + n, 0) -
      (sizes.get(name) ?? 0) +
      body.length;
    assert(
      total <= LIMITS.artifacts - (final ? 0 : LIMITS.reserve),
      '20 MB evidence budget exceeded',
    );
    await writeFile(join(root, name), body);
    sizes.set(name, body.length);
    return name;
  };
}
export async function startServer(root, onCapture = null, port = 3100) {
  root = await realpath(root);
  const server = createServer(async (req, res) => {
    try {
      // A static build only: no application API, credentials, arbitrary file access or proxy.
      const url = new URL(req.url, ORIGIN);
      if (
        req.method === 'POST' &&
        url.pathname === '/__visual-qa' &&
        onCapture
      ) {
        assert(
          req.headers.origin === ORIGIN &&
            req.headers['content-type'] === 'application/json',
        );
        let count = 0;
        const chunks = [];
        for await (const chunk of req) {
          count += chunk.length;
          assert(count <= LIMITS.post, 'Report exceeds request cap');
          chunks.push(chunk);
        }
        await onCapture(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end('{"saved":true}');
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }
      let path = resolve(root, '.' + decodeURIComponent(url.pathname));
      assert(path === root || path.startsWith(root + sep));
      if (path === root || (await lstat(path)).isDirectory())
        path = join(path, 'index.html');
      path = await realpath(path);
      assert(path.startsWith(root + sep), 'File escapes build root');
      const body = await readFile(path);
      res
        .writeHead(200, {
          'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(body);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end('Invalid local request');
    }
  });
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
function closeServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}
async function inspectWebGL(page, selector = null) {
  return page.evaluate((selector) => {
    const canvas = selector
      ? document.querySelector(selector)
      : document.createElement('canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl)
      return {
        available: false,
        reason: 'WebGL2 unavailable under the selected renderer profile',
      };
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const result = {
      available: true,
      contextLost: gl.isContextLost(),
      renderer,
      version: gl.getParameter(gl.VERSION),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
    if (!selector) {
      gl.clearColor(0.25, 0.5, 0.75, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      result.probePixel = [...pixel];
      result.probePassed =
        Math.abs(pixel[0] - 64) <= 1 &&
        Math.abs(pixel[1] - 128) <= 1 &&
        Math.abs(pixel[2] - 191) <= 1 &&
        pixel[3] === 255;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return result;
  }, selector);
}
async function openCity(browser, query, profile = 'default') {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const events = [],
    counts = {
      consoleErrors: 0,
      pageErrors: 0,
      requestFailures: 0,
      httpErrors: 0,
      blockedExternal: 0,
    };
  const note = (kind, value) => {
    counts[kind]++;
    if (events.length < LIMITS.events)
      events.push({ kind, detail: boundedText(value) });
  };
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN || ['data:', 'blob:'].includes(url.protocol))
      return route.continue();
    note('blockedExternal', `${url.protocol}//${url.host}`);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (socket) => {
    note('blockedExternal', 'WebSocket blocked');
    socket.close();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => {
    if (message.type() === 'error') note('consoleErrors', message.text());
  });
  page.on('pageerror', (error) => note('pageErrors', error.message));
  page.on('requestfailed', (request) =>
    note('requestFailures', new URL(request.url()).pathname),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      note(
        'httpErrors',
        `${response.status()} ${new URL(response.url()).pathname}`,
      );
  });
  try {
    await page.goto(ORIGIN + '/' + queryString(query), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page
      .locator('.loading-overlay')
      .waitFor({ state: 'detached', timeout: 120_000 });
    assert(
      await page
        .getByRole('link', { name: 'Vancouver Living Atlas', exact: true })
        .isVisible(),
    );
    const zoom = page
      .getByRole('button', { name: 'Zoom in', exact: true })
      .first();
    assert(await zoom.isEnabled(), 'Production controls did not become ready');
    const gl = await inspectWebGL(page, '.scene canvas');
    assert(
      gl.available && !gl.contextLost && gl.drawingBuffer.every((n) => n > 0),
      'City WebGL context not ready',
    );
    assertProfileRenderer(profile, gl.renderer);
    return { context, page, events, counts, gl };
  } catch (error) {
    await context.close();
    error.message = `${error.message}; browser evidence: ${JSON.stringify({ counts, events })}`;
    throw error;
  }
}
function assertSanity(city) {
  assert(
    Object.values(city.counts).every((n) => n === 0),
    `Browser sanity failed: ${JSON.stringify(city.counts)}`,
  );
}
async function logPreview(browser, bytes, name, save) {
  const context = await browser.newContext({
    viewport: { width: 640, height: 360 },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const page = await context.newPage();
  try {
    const encoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      canvas.getContext('2d').drawImage(image, 0, 0, 640, 360);
      let encoded;
      for (const quality of [0.35, 0.22, 0.12]) {
        encoded = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        if (encoded.length <= 32_000) break;
      }
      return encoded;
    }, bytes.toString('base64'));
    const jpeg = Buffer.from(encoded, 'base64');
    if (jpeg.length > LIMITS.preview) {
      console.log('Preview omitted: 24 KB cap; use the run artifact.');
      return;
    }
    const file = await save(`${name}-preview.jpg`, jpeg);
    console.log(
      'VLA_QA_PREVIEW ' +
        JSON.stringify({
          name,
          file,
          mime: 'image/jpeg',
          width: 640,
          height: 360,
          bytes: jpeg.length,
          sha256: hash(jpeg),
          base64: encoded,
        }),
    );
  } finally {
    await context.close();
  }
}
export function assertCityReadySnapshot(gl, overlayCount, zoomEnabled) {
  assert(
    gl.available && !gl.contextLost && gl.drawingBuffer.every((n) => n > 0),
    'City WebGL context not ready',
  );
  assert.equal(overlayCount, 0, 'City returned to its loading/error overlay');
  assert(zoomEnabled, 'Production controls are no longer ready');
}
async function confirmCityReady(city) {
  const gl = await inspectWebGL(city.page, '.scene canvas');
  assertCityReadySnapshot(
    gl,
    await city.page.locator('.loading-overlay').count(),
    await city.page
      .getByRole('button', { name: 'Zoom in', exact: true })
      .first()
      .isEnabled(),
  );
  return gl;
}
async function runSmoke(browser, root, save, previews, profile) {
  const server = await startServer(root);
  let city;
  try {
    city = await openCity(browser, '', profile);
    assert.equal(
      await city.page.locator('#visual-qa-panel').count(),
      0,
      'Production bundle exposes local QA',
    );
    await city.page
      .getByRole('button', { name: 'Zoom in', exact: true })
      .first()
      .click();
    await city.page
      .getByRole('button', { name: 'Return to overview', exact: true })
      .click();
    await city.page.waitForTimeout(2000);
    await confirmCityReady(city);
    assertSanity(city);
    const png = await city.page.screenshot({ type: 'png', fullPage: false });
    assert(png.length <= LIMITS.png, 'Smoke screenshot exceeds cap');
    const screenshot = await save('production-smoke.png', png);
    const finalGL = await confirmCityReady(city);
    assertProfileRenderer(profile, finalGL.renderer);
    assertSanity(city);
    const result = {
      gl: finalGL,
      counts: city.counts,
      events: city.events,
      screenshot,
      qaControlsAbsent: true,
      productionControlsExercised: true,
    };
    await city.context.close();
    city = null;
    if (previews) await logPreview(browser, png, 'production-smoke', save);
    return result;
  } finally {
    await city?.context.close();
    await closeServer(server);
  }
}
async function runMatched(browser, roots, queries, save, previews, profile) {
  const runs = [],
    previewPNGs = [];
  for (const label of ABBA) {
    const variant = label.split('-')[0],
      rows = [],
      seen = new Set();
    let captureError = null;
    const server = await startServer(roots[variant], async (data) => {
      try {
        const { row, png } = validateCapture(data, seen);
        rows.push(row);
        await save(
          `${label}-${data.name}.json`,
          JSON.stringify(row, null, 2) + '\n',
        );
        if (
          label.endsWith('-a') &&
          ['citizen', 'gastown-street'].includes(row.id)
        ) {
          const name = `${label}-${data.name}`;
          await save(name + '.png', png);
          if (variant === 'candidate') previewPNGs.push({ name, png });
        }
      } catch (error) {
        captureError = error;
        throw error;
      }
    });
    let city;
    try {
      city = await openCity(browser, queries[variant], profile);
      await city.page.locator('#upgrade-qa-status').waitFor();
      await city.page
        .getByRole('button', { name: 'Upgrade matched high', exact: true })
        .click();
      await city.page.waitForFunction(
        () =>
          /^(Completed matched high: 4 views|Upgrade check failed:)/.test(
            document.querySelector('#upgrade-qa-status')?.textContent ?? '',
          ),
        null,
        { timeout: 210_000 },
      );
      if (captureError) throw captureError;
      assert.equal(
        await city.page.locator('#upgrade-qa-status').textContent(),
        'Completed matched high: 4 views',
      );
      assert.equal(rows.length, 4);
      assertSanity(city);
      const run = {
        label,
        query: queries[variant],
        gl: city.gl,
        counts: city.counts,
        events: city.events,
        rows,
        timingInterpretation: rows.map((row) => ({
          id: row.id,
          ...sampleInterpretation(row),
        })),
      };
      runs.push(run);
      console.log(
        'VLA_QA_RUN ' +
          JSON.stringify({
            label,
            renderer: city.gl.renderer,
            views: rows.map(
              ({ id, fps, p95Ms, maxMs, over100Ms, detailReady }) => ({
                id,
                fps,
                p95Ms,
                maxMs,
                over100Ms,
                detailReady,
              }),
            ),
          }),
      );
    } finally {
      await city?.context.close();
      await closeServer(server);
    }
  }
  comparePoses(runs);
  if (previews)
    for (const preview of previewPNGs)
      await logPreview(browser, preview.png, preview.name, save);
  return {
    order: ABBA,
    runs,
    matchedPoses: true,
    note: 'Two High samples per revision are diagnostic, not a statistical performance guarantee. No concurrent builds or other city pages during timing.',
  };
}
export async function main(args = process.argv.slice(2)) {
  const [mode = 'smoke', ...rest] = args;
  assert(
    ['smoke', 'matched', 'check-artifacts'].includes(mode),
    'Use smoke, matched or check-artifacts',
  );
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    assert(
      ['--root', '--baseline', '--output'].includes(rest[i]) && rest[i + 1],
    );
    options[rest[i].slice(2)] = resolve(rest[i + 1]);
  }
  const output = options.output ?? OUTPUT;
  const save = await artifactWriter(output);
  if (mode === 'check-artifacts') {
    const files = (await inventory(output)).filter(
      (file) => file.name !== 'artifact-manifest.json',
    );
    assert(
      files.reduce((n, file) => n + file.bytes, 0) <=
        LIMITS.artifacts - LIMITS.reserve,
    );
    await save(
      'artifact-manifest.json',
      JSON.stringify({ capBytes: LIMITS.artifacts, files }, null, 2) + '\n',
      true,
    );
    console.log(
      `Evidence cap checked: ${files.length} files, at most 20 MB. No traces/video/HAR.`,
    );
    return;
  }
  const profile = process.env.QA_RENDERER_PROFILE ?? 'default';
  const launchOptions = launchOptionsForProfile(profile);
  const saveProfile = (name, ...args) => save(`${profile}-${name}`, ...args);
  const diagnostic = {};
  const result = {
    mode,
    rendererProfile: profile,
    status: 'running',
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    sandboxRequested: true,
    hardwareAcceptance: false,
    limits: LIMITS,
    note: 'GitHub-hosted Linux/Xvfb only. Software rendering is identified below; this is not Radeon or phone acceptance, nor a GPU benchmark.',
  };
  let browser,
    preflightEmitted = false;
  const reportPreflight = async () => {
    const preflight = preflightEvidence(profile, diagnostic);
    await saveProfile(
      mode + '-preflight.json',
      JSON.stringify(preflight, null, 2) + '\n',
      true,
    );
    console.log('VLA_QA_PREFLIGHT ' + JSON.stringify(preflight));
    preflightEmitted = true;
  };
  // A hard harness ceiling leaves time for bounded failure evidence/upload in the 25-minute job.
  const watchdog = setTimeout(
    () => {
      console.error('Browser QA exceeded its bounded execution window');
      process.exit(1);
    },
    mode === 'smoke' ? 240_000 : 840_000,
  );
  try {
    const root = options.root ?? resolve('dist/client');
    const roots =
      mode === 'matched'
        ? { candidate: root, baseline: options.baseline }
        : { production: root };
    if (mode === 'matched')
      assert(
        roots.baseline,
        'Matched mode requires --baseline (already-built static root)',
      );
    result.builds = {};
    for (const [name, path] of Object.entries(roots)) {
      const files = await inventory(path);
      result.builds[name] = {
        revision:
          process.env[
            name === 'baseline'
              ? 'QA_BASELINE_REVISION'
              : 'QA_CANDIDATE_REVISION'
          ] ?? 'unrecorded',
        sha256: hash(JSON.stringify(files)),
        files: files.length,
      };
    }
    const { chromium } = await import('playwright');
    browser = await chromium.launch(launchOptions);
    result.browser = browser.version();
    diagnostic.browser = result.browser;
    const session = await browser.newBrowserCDPSession();
    const { arguments: launchArgs } = await session.send(
      'Browser.getBrowserCommandLine',
    );
    diagnostic.launchArgs = launchArgs;
    assertSafeLaunch(launchArgs);
    result.unsafeLaunchFlagsAbsent = true;
    result.browserChannel = LAUNCH_OPTIONS.channel;
    result.browserExecutable = launchArgs[0];
    try {
      diagnostic.gpu = (await session.send('SystemInfo.getInfo')).gpu;
    } catch (error) {
      diagnostic.error =
        'GPU diagnostics unavailable: ' + boundedText(error.message);
    }
    await session.detach();
    const probe = await browser.newPage();
    result.capability = await inspectWebGL(probe);
    await probe.close();
    diagnostic.capability = result.capability;
    assertProfileCapability(profile, result.capability);
    await reportPreflight();
    result.softwareRenderer =
      /swiftshader|llvmpipe|softpipe|software|lavapipe/i.test(
        result.capability.renderer,
      );
    result.evidence =
      mode === 'smoke'
        ? await runSmoke(
            browser,
            root,
            saveProfile,
            process.env.QA_LOG_PREVIEWS !== '0',
            profile,
          )
        : await runMatched(
            browser,
            roots,
            {
              baseline: queryString(process.env.QA_BASELINE_QUERY),
              candidate: queryString(process.env.QA_CANDIDATE_QUERY),
            },
            saveProfile,
            process.env.QA_LOG_PREVIEWS !== '0',
            profile,
          );
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = boundedText(error.message);
    diagnostic.error = result.error;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    clearTimeout(watchdog);
    if (!preflightEmitted) await reportPreflight();
    await saveProfile(
      mode + '.json',
      JSON.stringify(result, null, 2) + '\n',
      true,
    );
    console.log(
      'VLA_QA_RESULT ' +
        JSON.stringify({
          mode,
          rendererProfile: profile,
          status: result.status,
          browser: result.browser,
          renderer: result.capability?.renderer,
          softwareRenderer: result.softwareRenderer,
          error: result.error,
          artifact: `${profile}-${mode}.json`,
        }),
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
