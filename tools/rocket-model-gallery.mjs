import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// A deliberate model-inspection fixture, never evidence of a natural flight.
const temporary = await fs.mkdtemp('/private/tmp/rocket-model-gallery-');
const repository = new URL('../', import.meta.url);
const workDirectory = new URL('work/rocket-model-gallery/', repository);
const outputDirectory = new URL('../../outputs/', repository);
const imageName = 'rocket-three-designs.png';
const report = {
  method:
    'Production createRocketModel(kind), build(1), stage(createRocket(kind)). Display heights are normalized to 100 units to compare architecture; actual dimensions remain labelled 18/48/110 metres. This isolated model QA fixture is not natural-flight evidence.',
  startedAt: new Date().toISOString(),
  errors: [],
  consoleErrors: [],
  httpFailures: [],
  checks: {},
};
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--enable-gpu', '--use-angle=metal'],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
    deviceScaleFactor: 1,
  });
  await page.route('**/favicon.ico', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  page.on('pageerror', (error) =>
    report.errors.push(error.stack || String(error)),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.httpFailures.push({
        status: response.status(),
        url: response.url(),
      });
  });
  await page.goto(
    process.env.ROCKET_GALLERY_URL ||
      'http://127.0.0.1:5173/?inspect&graphics=compatible',
    { waitUntil: 'domcontentloaded', timeout: 120000 },
  );
  await page.waitForFunction(
    () =>
      window.__atlas?.renderReady &&
      window.__atlas?.renderer &&
      window.__atlas?.rocket,
    null,
    { timeout: 120000 },
  );
  report.gallery = await page.evaluate(async () => {
    const engine = window.__atlas;
    engine.setCabinDisplayActive(true);
    cancelAnimationFrame(engine.raf);
    const { createRocketModel, disposeRocketObject } =
      await import('/lib/city/assets/rocket.ts');
    const { createRocket, ROCKET_CONFIGS } =
      await import('/lib/city/rocket-state.ts');
    const scene = new engine.scene.constructor();
    scene.background = engine.sun.color.clone().set('#0b1422');
    const camera = engine.camera.clone();
    camera.position.set(130, 110, 350);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 45, 0);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = 27;
    camera.near = 5;
    camera.far = 1200;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const source of [engine.sun, engine.ambient]) {
      const light = source.clone();
      light.castShadow = false;
      scene.add(light);
      if (light.target) scene.add(light.target);
    }
    const renderer = new engine.renderer.constructor({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(1);
    renderer.toneMapping = engine.renderer.toneMapping;
    renderer.toneMappingExposure = engine.renderer.toneMappingExposure;
    renderer.outputColorSpace = engine.renderer.outputColorSpace;
    const wrapper = document.createElement('main');
    wrapper.id = 'rocket-model-qa-gallery';
    wrapper.setAttribute(
      'aria-label',
      '正式火箭模型外形比較，同高顯示，非實際比例',
    );
    wrapper.style.cssText =
      "position:fixed;inset:0;z-index:9999;overflow:hidden;background:#0b1422;color:#eff5fa;font-family:system-ui,-apple-system,'PingFang TC',sans-serif";
    renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
    wrapper.appendChild(renderer.domElement);
    const heading = document.createElement('header');
    heading.style.cssText =
      'position:absolute;top:48px;left:64px;right:64px;z-index:2';
    heading.innerHTML =
      '<div style="font-size:12px;font-weight:650;letter-spacing:3px;color:#9daec0">VANCOUVER LIVING ATLAS · PRODUCTION MODEL QA</div><h1 style="font-size:37px;letter-spacing:1px;margin:12px 0 10px;font-weight:650">三款火箭，三種結構</h1><div style="display:flex;align-items:center;gap:20px"><strong style="color:#f4d6a1;font-size:19px">同高外形比較，非實際比例</strong><span style="font-size:14px;color:#97abc0">保留正式模型幾何與材質 · 此圖不代表自然升空</span></div>';
    wrapper.appendChild(heading);
    const models = [],
      results = [];
    const descriptions = {
      small: ['SCOUT', '單芯箭體 · 後掠穩定翼 · 尖錐整流罩'],
      large: ['ATLAS', '橘色主芯 · 雙側助推器 · 寬型整流罩'],
      'super-heavy': ['TITAN', '不鏽鋼船體 · 熱盾 · 格柵舵與前後控制翼'],
    };
    for (const [index, kind] of ['small', 'large', 'super-heavy'].entries()) {
      const model = createRocketModel(kind),
        config = ROCKET_CONFIGS[kind],
        state = createRocket(kind, 0, 0, 0);
      model.build(1);
      model.stage(state);
      model.fire(0, 0);
      model.group.scale.setScalar(100 / config.height);
      model.group.position.x = (index - 1) * 70;
      scene.add(model.group);
      model.group.updateMatrixWorld(true);
      models.push(model);
      const structural = [];
      model.group.traverse((object) => {
        if (object.isMesh && object.castShadow) structural.push(object);
      });
      let minimum = Infinity,
        maximum = -Infinity;
      let minX = Infinity,
        maxX = -Infinity;
      const points = [],
        vector = camera.position.clone();
      for (const mesh of structural) {
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          vector
            .fromBufferAttribute(position, i)
            .applyMatrix4(mesh.matrixWorld);
          minimum = Math.min(minimum, vector.y);
          maximum = Math.max(maximum, vector.y);
          minX = Math.min(minX, vector.x);
          maxX = Math.max(maxX, vector.x);
          points.push(vector.clone().project(camera));
        }
      }
      const labelPoint = camera.position
        .clone()
        .set((index - 1) * 70, 0, 0)
        .project(camera);
      const label = document.createElement('section');
      label.style.cssText = `position:absolute;left:${((labelPoint.x + 1) * innerWidth) / 2}px;bottom:48px;width:380px;transform:translateX(-50%);text-align:center;z-index:2`;
      label.innerHTML = `<div style="font-size:12px;letter-spacing:3px;color:#93a7bd">${String(index + 1).padStart(2, '0')} / ${kind === 'super-heavy' ? 'SUPER HEAVY' : kind.toUpperCase()}</div><h2 style="font-size:27px;font-weight:650;letter-spacing:3px;margin:9px 0 5px">${descriptions[kind][0]}</h2><div style="font-size:18px;color:#f3d09c">實際高度 ${config.height} m</div><p style="font-size:14px;color:#a5b5c5;white-space:nowrap">${descriptions[kind][1]}</p>`;
      wrapper.appendChild(label);
      results.push({
        kind,
        actualHeightMeters: config.height,
        normalizedHeight: maximum - minimum,
        normalizedTop: maximum,
        normalizedBottom: minimum,
        normalizedWidth: maxX - minX,
        sourceMeshCount: structural.length,
        engineCount: structural.filter((mesh) =>
          mesh.name.includes('main engine'),
        ).length,
        features: {
          scoutFins: structural.filter(
            (mesh) => mesh.name === 'Scout swept stabilizer',
          ).length,
          atlasBoosters: structural.filter(
            (mesh) => mesh.name === 'Atlas side booster',
          ).length,
          titanGridFins: structural.filter(
            (mesh) => mesh.name === 'Titan lattice grid fins',
          ).length,
          titanFlaps: structural.filter(
            (mesh) =>
              mesh.name.includes('Titan') && mesh.name.includes('control flap'),
          ).length,
        },
        ndc: {
          minX: Math.min(...points.map((p) => p.x)),
          maxX: Math.max(...points.map((p) => p.x)),
          minY: Math.min(...points.map((p) => p.y)),
          maxY: Math.max(...points.map((p) => p.y)),
        },
      });
    }
    const footer = document.createElement('footer');
    footer.style.cssText =
      'position:absolute;left:64px;right:64px;bottom:17px;border-top:1px solid #223346;padding-top:10px;font-size:11px;color:#687f98;letter-spacing:1px';
    footer.textContent =
      'MODEL INSPECTION FIXTURE / ALL THREE VEHICLES NORMALIZED TO 100 DISPLAY UNITS / ORIGINAL PROCEDURAL GAME ASSETS';
    wrapper.appendChild(footer);
    document.body.appendChild(wrapper);
    await document.fonts.ready;
    renderer.render(scene, camera);
    await new Promise(requestAnimationFrame);
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    window.__rocketGalleryCleanup = () => {
      models.forEach((model) => disposeRocketObject(model.group));
      renderer.dispose();
      wrapper.remove();
    };
    return {
      models: results,
      camera: camera.position.toArray(),
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      webglVersion: gl.getParameter(gl.VERSION),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lights: scene.children
        .filter((object) => object.isLight)
        .map((light) => ({ type: light.type, intensity: light.intensity })),
    };
  });
  report.checks.actualSizesLabelled =
    report.gallery.models.map((model) => model.actualHeightMeters).join(',') ===
    '18,48,110';
  report.checks.completeModelsInFrame = report.gallery.models.every(
    (model) =>
      model.ndc.minX > -0.96 &&
      model.ndc.maxX < 0.96 &&
      model.ndc.minY > -0.72 &&
      model.ndc.maxY < 0.66,
  );
  report.checks.normalizedHeight = report.gallery.models.every(
    (model) =>
      Math.abs(model.normalizedTop - 100) < 1e-4 &&
      model.normalizedBottom >= -0.001,
  );
  report.checks.distinctArchitectures =
    report.gallery.models[0].engineCount === 1 &&
    report.gallery.models[1].engineCount === 7 &&
    report.gallery.models[2].engineCount === 19 &&
    report.gallery.models[0].features.scoutFins === 4 &&
    report.gallery.models[1].features.atlasBoosters === 2 &&
    report.gallery.models[2].features.titanGridFins === 1 &&
    report.gallery.models[2].features.titanFlaps === 4;
  await page.screenshot({ path: temporary + '/' + imageName });
  await page.evaluate(() => window.__rocketGalleryCleanup());
  for (const [check, pass] of Object.entries(report.checks))
    assert(pass, check);
  assert.equal(
    report.errors.length,
    0,
    'gallery has no page or WebGL shader errors',
  );
  assert.equal(report.consoleErrors.length, 0, 'gallery has no console errors');
} catch (error) {
  report.failure = error.stack || String(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(
    temporary + '/report.json',
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  // Chrome writes only into /private/tmp; copy evidence after the browser has closed.
  await fs.mkdir(workDirectory, { recursive: true });
  await fs.cp(temporary, workDirectory, { recursive: true });
  if (!report.failure) {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.copyFile(
      temporary + '/' + imageName,
      new URL(imageName, outputDirectory),
    );
  }
  console.log(
    JSON.stringify(
      {
        checks: report.checks,
        failure: report.failure,
        models: report.gallery?.models,
        renderer: report.gallery?.renderer,
        errors: report.errors,
        consoleErrors: report.consoleErrors,
        report: fileURLToPath(new URL('report.json', workDirectory)),
        image: !report.failure
          ? fileURLToPath(new URL(imageName, outputDirectory))
          : undefined,
      },
      null,
      2,
    ),
  );
}
if (report.failure) process.exitCode = 1;
