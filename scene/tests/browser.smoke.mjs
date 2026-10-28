import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CAMERA } from '../src/cameraConfig.js';

const sceneRoot = fileURLToPath(new URL('../', import.meta.url));
const assets = path.resolve(sceneRoot, '../app/src/main/assets/scene');
const output = path.join(sceneRoot, 'test-results/browser-smoke');
const origin = 'https://appassets.androidplatform.net/assets/scene/';
const report = { requests: [], errors: [], consoleErrors: [], checks: [] };
await fs.mkdir(output, { recursive: true });
const evidence = path.join(output, 'evidence.json');
const started = Date.now();
const softwareRendering =
  process.platform === 'linux' || process.env.PLAYWRIGHT_SOFTWARE_RENDERING === '1';
// Keep CSS dimensions and the production bundle intact. Software graphics only
// need a smaller raster; dense gesture/math cases are covered by the unit tests.
const gestureSteps = 3;
function phase(label) {
  report.phase = label;
  console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${label}`);
}
function passed(label) {
  report.checks.push(label);
  phase(`Passed: ${label}`);
}
// evaluate() and raw CDP input are not bounded by page.setDefaultTimeout().
// Keep a hung renderer or cleanup from consuming the entire Android build job.
const deadline = setTimeout(
  () => {
    report.pass = false;
    const timeout = `Browser smoke exceeded eight minutes during: ${report.phase}`;
    report.failure = report.failure ? `${report.failure}\n${timeout}` : timeout;
    writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
    console.error(report.failure);
    process.exit(1);
  },
  8 * 60 * 1000,
);
deadline.unref();
phase('Launch browser');

// Fulfill the actual Android bundle locally, including while offline. No dev
// server, external assets, Android device, or machine-specific path is needed.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  headless: true,
  args: softwareRendering
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [],
});
report.browser = { version: browser.version(), softwareRendering };
const context = await browser.newContext({
  viewport: { width: 411, height: 914 },
  deviceScaleFactor: softwareRendering ? 0.25 : 1.5,
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
let injectingFailure = false;
page.on('pageerror', (error) => {
  if (!injectingFailure) report.errors.push(String(error));
});
page.on('console', (message) => {
  if (message.type() === 'error' && !injectingFailure) report.consoleErrors.push(message.text());
});
await page.addInitScript(() => {
  window.__native = { ready: 0, failures: [], fps: [], callbacks: 0, pending: new Set() };
  window.IslandAndroid = {
    ready() {
      window.__native.ready++;
    },
    failed(message) {
      window.__native.failures.push(message);
    },
    fps(value) {
      window.__native.fps.push(value);
    },
  };
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const id = request((time) => {
      window.__native.pending.delete(id);
      window.__native.callbacks++;
      callback(time);
    });
    window.__native.pending.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    window.__native.pending.delete(id);
    cancel(id);
  };
});
await context.route('**/*', async (route) => {
  const url = route.request().url();
  report.requests.push(url);
  if (!url.startsWith(origin)) return route.abort();
  const relative = decodeURIComponent(new URL(url).pathname.slice('/assets/scene/'.length));
  const filename = path.resolve(assets, relative);
  assert.ok(filename.startsWith(assets + path.sep), 'Asset path stays inside the bundle');
  const contentType = filename.endsWith('.js')
    ? 'text/javascript'
    : filename.endsWith('.css')
      ? 'text/css'
      : 'text/html';
  await route.fulfill({ status: 200, body: await fs.readFile(filename), contentType });
});

const state = () => page.evaluate(() => window.island.getState());
const snapshot = () =>
  page.evaluate(() => ({
    state: window.island.getState(),
    callbacks: window.__native.callbacks,
    pending: window.__native.pending.size,
    fps: window.__native.fps.at(-1),
    ready: window.__native.ready,
    failures: window.__native.failures,
  }));
function near(actual, expected, label, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}
function orbit(value) {
  const offset = value.camera.map((coordinate, index) => coordinate - value.target[index]);
  const distance = Math.hypot(...offset);
  return {
    distance,
    polar: Math.acos(offset[1] / distance),
    bearing: Math.atan2(offset[0], offset[2]),
  };
}
function pair(angle = 0, separation = 180, y = page.viewportSize().height / 2) {
  const centerX = page.viewportSize().width / 2;
  const dx = (Math.cos(angle) * separation) / 2;
  const dy = (Math.sin(angle) * separation) / 2;
  return [
    { id: 1, x: centerX - dx, y: y - dy },
    { id: 2, x: centerX + dx, y: y + dy },
  ];
}

async function checkIdleModeChanges(paused, active, limits) {
  const elapsed = (await state()).elapsed;
  for (const limit of limits) {
    await page.evaluate((value) => window.island.setFrameRateLimit(value), limit);
    await page.waitForFunction(() => window.__native.pending.size === 0);
    const idle = await snapshot();
    assert.equal(idle.state.frameRateLimit, limit);
    assert.equal(idle.state.paused, paused, 'Changing the limit preserves pause');
    assert.equal(idle.state.active, active, 'Changing the limit preserves lifecycle');
    assert.equal(idle.state.elapsed, elapsed, 'Changing the limit preserves idle time');
    assert.equal(idle.fps, 0);
    await page.waitForTimeout(100);
    assert.deepEqual(await snapshot(), idle, 'An idle mode change creates no recurring work');
  }
}

try {
  phase('Offline startup');
  await context.setOffline(true);
  await page.goto(origin + 'index.html');
  await page.waitForFunction(
    () => window.__native.ready === 1 && document.getElementById('status').hidden,
  );
  await page.waitForFunction(() => window.__native.fps.some((value) => value > 0));
  report.initial = await state();
  assert.equal(report.initial.failed, false);
  assert.equal(report.initial.weather, 'sun', 'The initial weather is sunny');
  assert.equal(report.initial.frameRateLimit, null, 'The default mode is unlocked');
  await page.waitForFunction(
    (elapsed) => window.island.getState().elapsed > elapsed,
    report.initial.elapsed,
  );
  assert.ok((await state()).elapsed > report.initial.elapsed, 'Animation advances offline');
  await page.screenshot({ path: path.join(output, 'portrait.png') });
  passed('offline startup and animated portrait');

  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  async function panToOpenWater() {
    const initial = await state();
    const currentOrbit = orbit(initial);
    const viewport = page.viewportSize();
    const scale =
      (2 * currentOrbit.distance * Math.tan((CAMERA.fov * Math.PI) / 360)) / viewport.height;
    const dx = 800 - initial.target[0];
    const dz = 800 - initial.target[2];
    const dragX =
      (-Math.cos(currentOrbit.bearing) * dx + Math.sin(currentOrbit.bearing) * dz) / scale;
    const dragY =
      (-Math.sin(currentOrbit.bearing) * dx - Math.cos(currentOrbit.bearing) * dz) / scale;
    // Several realistic one-finger drags keep every touch inside the viewport.
    const gestures = Math.ceil(
      Math.max(Math.abs(dragX) / (viewport.width * 0.3), Math.abs(dragY) / (viewport.height * 0.3)),
    );
    for (let gesture = 0; gesture < gestures; gesture++) {
      const start = { id: 1, x: viewport.width / 2, y: viewport.height / 2 };
      await touch('touchStart', [start]);
      for (let step = 1; step <= gestureSteps; step++) {
        await touch('touchMove', [
          {
            ...start,
            x: start.x + (dragX * step) / (gestures * gestureSteps),
            y: start.y + (dragY * step) / (gestures * gestureSteps),
          },
        ]);
      }
      await touch('touchEnd', []);
    }
    const water = await state();
    near(water.target[0], 800, 'Real panning places focus offshore', 0.05);
    near(water.target[2], 800, 'Real panning places focus offshore', 0.05);
    near(water.target[1], 0, 'Offshore focus stays at sea level');
  }
  async function reachCloseView() {
    phase('Close view: pan offshore');
    await panToOpenWater();
    // Set tilt before the final pinch: separately dispatched finger movements
    // briefly change separation, so a vertical drag can also affect zoom.
    const viewport = page.viewportSize();
    const centerY = viewport.height / 2;
    const tiltTravel =
      ((CAMERA.maxPolarAngle - orbit(await state()).polar) * viewport.height) /
        (2 * Math.PI * CAMERA.rotateSpeed) +
      16;
    phase('Close view: lower viewing angle');
    await touch('touchStart', pair());
    for (let step = 1; step <= gestureSteps; step++) {
      await touch('touchMove', pair(0, 180, centerY - (tiltTravel * step) / gestureSteps));
    }
    await touch('touchEnd', []);
    for (
      let gesture = 0;
      gesture < 10 && orbit(await state()).distance > CAMERA.minDistance + 0.00001;
      gesture++
    ) {
      phase(`Close view: pinch ${gesture + 1}`);
      await touch('touchStart', pair(0, 50));
      for (let step = 1; step <= gestureSteps; step++)
        await touch('touchMove', pair(0, 50 + (280 * step) / gestureSteps));
      await touch('touchEnd', []);
    }
    near(orbit(await state()).distance, CAMERA.minDistance, 'Pinch reaches close limit');
    near(
      orbit(await state()).polar,
      CAMERA.maxPolarAngle,
      'Vertical two-finger drag reaches low tilt',
    );
    near(orbit(await state()).distance, CAMERA.minDistance, 'Low tilt preserves close zoom');
    await page.waitForFunction(() => window.island.getState().waterSide === 0);
    const close = await state();
    near(close.cameraNear, CAMERA.minNear, 'Close water keeps a short clipping plane');
    near(close.target[1], 0, 'Close view does not raise the focus for trees');
    assert.ok(close.camera[0] > 600 && close.camera[2] > 600, 'Close screenshots show open water');
    assert.ok(
      close.camera[1] > 0 && close.camera[1] < 0.1,
      'Eye reaches within 10 cm of sea level',
    );

    const start = { id: 1, x: viewport.width / 2, y: centerY };
    await touch('touchStart', [start]);
    await touch('touchMove', [{ ...start, x: start.x + 60, y: start.y + 30 }]);
    await touch('touchEnd', []);
    const pannedClose = await state();
    assert.notDeepEqual(pannedClose.target, close.target, 'One finger still pans at the waterline');
    near(pannedClose.target[1], 0, 'Close panning preserves sea-level focus');
    near(pannedClose.camera[1], close.camera[1], 'Close panning preserves low eye height');
    near(orbit(pannedClose).distance, CAMERA.minDistance, 'Close panning preserves zoom');
    near(pannedClose.cameraNear, CAMERA.minNear, 'Close panning preserves the clipping plane');
    await page.waitForTimeout(100);
    return pannedClose;
  }
  phase('Portrait touch gestures and close water views');
  await touch('touchStart', [{ id: 1, x: 205, y: 457 }]);
  await touch('touchMove', [{ id: 1, x: 255, y: 487 }]);
  await touch('touchEnd', []);
  const panned = await state();
  assert.ok(Math.hypot(panned.target[0], panned.target[2]) > 1, 'One finger pans');
  near(panned.target[1], CAMERA.targetY, 'Ground-plane pan');
  await page.evaluate(() => window.island.resetView());

  const before = orbit(await state());
  await touch('touchStart', pair());
  for (let step = 1; step <= gestureSteps; step++)
    await touch('touchMove', pair(((Math.PI / 4) * step) / gestureSteps));
  await touch('touchEnd', []);
  const twisted = orbit(await state());
  near(twisted.bearing - before.bearing, Math.PI / 4, 'Clockwise twist follows fingers');
  near(twisted.polar, before.polar, 'Pure twist keeps tilt');
  near(twisted.distance, before.distance, 'Pure twist keeps distance');
  report.closePortrait = await reachCloseView();
  await page.screenshot({ path: path.join(output, 'close-portrait.png') });
  await page.evaluate(() => window.island.setWeather('storm'));
  await page.waitForTimeout(1200);
  report.closeStormPortrait = await state();
  assert.deepEqual(report.closeStormPortrait.camera, report.closePortrait.camera);
  near(report.closeStormPortrait.cameraNear, CAMERA.minNear, 'Storm keeps close clipping');
  assert.equal(report.closeStormPortrait.waterSide, 0, 'Storm retains both wave faces');
  await page.screenshot({ path: path.join(output, 'storm-close-portrait.png') });
  await page.evaluate(() => window.island.setWeather('sun'));
  passed('real touch pan, twist, pinch, and tilt');

  // Exercise all runtime modes with input. A slow CI GPU is valid: caps are
  // ceilings, and Unlocked follows available browser/display performance.
  await page.evaluate(() => window.island.resetView());
  near((await state()).cameraNear, CAMERA.near, 'Recenter restores overview depth precision');
  report.frameRateModes = [];
  for (const limit of [30, 60, null]) {
    phase(`Touch input with frame limit ${limit ?? 'Unlocked'}`);
    await page.evaluate((value) => {
      window.__native.fps.length = 0;
      window.island.setFrameRateLimit(value);
    }, limit);
    assert.equal((await state()).frameRateLimit, limit, 'Runtime mode changes are reflected');
    await touch('touchStart', [{ id: 1, x: 205, y: 457 }]);
    // Cover a full FPS reporting window without forcing a slow software GPU
    // through 70 compositor acknowledgments for each limit.
    const inputStarted = Date.now();
    for (let step = 0; step < 2 || Date.now() - inputStarted < 1300; step++) {
      await touch('touchMove', [{ id: 1, x: 205 + 30 * Math.sin(step / 8), y: 457 }]);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await page.waitForFunction(() => window.__native.fps.some((value) => value > 0));
    const fps = await page.evaluate(() => window.__native.fps);
    assert.ok(
      fps.every((value) => Number.isFinite(value) && value >= 0),
      'Valid FPS is reported',
    );
    if (limit !== null) {
      // A reporting window can straddle one frame at non-divisible refresh rates.
      assert.ok(
        fps.every((value) => value <= limit + 1),
        `${limit} FPS cap holds under input`,
      );
    }
    report.frameRateModes.push({ limit, fps });
  }
  passed('runtime 30 FPS, 60 FPS, and Unlocked modes under real input');

  phase('Pause, weather changes, and background lifecycle');
  await page.evaluate(() => window.island.setPaused(true));
  await page.waitForFunction(() => window.__native.pending.size === 0);
  const paused = await snapshot();
  await page.waitForTimeout(200);
  assert.deepEqual(await snapshot(), paused, 'Pause leaves no recurring work');
  assert.equal(paused.fps, 0);
  await checkIdleModeChanges(true, true, [30, 60, null]);
  await page.evaluate(() => window.island.setLighting('golden'));
  await page.waitForFunction(() => window.__native.pending.size === 0);
  const golden = await snapshot();
  assert.equal(golden.state.lighting, 'golden');
  assert.equal(golden.state.elapsed, paused.state.elapsed, 'Lighting redraw preserves paused time');
  assert.ok(golden.callbacks > paused.callbacks, 'Lighting change redraws once while paused');
  await page.evaluate(() => window.island.setWeather('storm'));
  await page.waitForFunction(() => window.__native.pending.size === 0);
  const storm = await snapshot();
  assert.equal(storm.state.weather, 'storm');
  assert.equal(storm.state.lighting, 'golden', 'Storm preserves the chosen sunny lighting');
  assert.equal(storm.state.paused, true);
  assert.equal(storm.state.elapsed, golden.state.elapsed, 'Weather changes preserve paused time');
  assert.equal(storm.state.frameRateLimit, golden.state.frameRateLimit);
  assert.deepEqual(storm.state.camera, golden.state.camera, 'Weather keeps the current view');
  assert.deepEqual(storm.state.target, golden.state.target);
  assert.ok(storm.state.waves.windSpeed > golden.state.waves.windSpeed);
  assert.ok(storm.state.waves.waveScale > golden.state.waves.waveScale);
  assert.ok(storm.state.waves.shoreAmplitude > golden.state.waves.shoreAmplitude);
  assert.ok(storm.callbacks > golden.callbacks, 'Paused weather change requests a redraw');
  await page.evaluate(() => {
    window.island.setWeather('storm');
    window.island.setWeather('invalid');
  });
  await page.waitForTimeout(100);
  assert.deepEqual(await snapshot(), storm, 'Repeated or invalid weather adds no work');
  await page.evaluate(() => window.island.setWeather('sun'));
  await page.waitForFunction(() => window.__native.pending.size === 0);
  const sunRestored = await state();
  assert.equal(sunRestored.weather, 'sun');
  assert.equal(sunRestored.lighting, 'golden');
  assert.deepEqual(sunRestored.waves, golden.state.waves, 'Sun restores the calm wave settings');
  report.weather = { sun: golden.state, storm: storm.state, restored: sunRestored };
  await page.evaluate(() => {
    window.island.setActive(false);
    window.island.setPaused(false);
  });
  const inactive = await snapshot();
  await page.waitForTimeout(200);
  assert.deepEqual(await snapshot(), inactive, 'Background leaves no recurring work');
  assert.equal(inactive.pending, 0);
  await checkIdleModeChanges(false, false, [30, null, 60]);
  await page.evaluate(() => window.island.setWeather('storm'));
  const backgroundStorm = await snapshot();
  assert.equal(backgroundStorm.state.weather, 'storm');
  assert.equal(backgroundStorm.pending, 0, 'Background weather selection does not wake rendering');
  await page.waitForTimeout(100);
  assert.deepEqual(await snapshot(), backgroundStorm);
  await page.evaluate(() => window.island.setActive(true));
  await page.waitForFunction(
    (elapsed) => window.island.getState().elapsed > elapsed,
    inactive.state.elapsed,
  );
  assert.equal((await state()).frameRateLimit, 60, 'Resume retains the selected mode');
  assert.equal((await state()).weather, 'storm', 'Resume applies the selected weather');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(output, 'storm-portrait.png') });
  await page.evaluate(() => window.island.setWeather('sun'));
  passed('mode changes preserve pause, paused redraw, background and resume');
  passed('Storm/Sun changes, stronger waves, paused redraw, and background selection');

  phase('Landscape touch gestures and close water views');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => document.querySelector('canvas').style.width === '1280px');
  report.landscape = await state();
  assert.deepEqual(report.landscape.target, [0, CAMERA.targetY, 0]);
  assert.equal(report.landscape.failed, false);
  await page.screenshot({ path: path.join(output, 'landscape.png') });
  report.closeLandscape = await reachCloseView();
  await page.screenshot({ path: path.join(output, 'close-landscape.png') });
  await page.evaluate(() => window.island.setWeather('storm'));
  await page.waitForTimeout(1200);
  report.closeStormLandscape = await state();
  assert.deepEqual(report.closeStormLandscape.camera, report.closeLandscape.camera);
  near(report.closeStormLandscape.cameraNear, CAMERA.minNear, 'Storm keeps close clipping');
  assert.equal(report.closeStormLandscape.waterSide, 0, 'Storm retains both wave faces');
  await page.screenshot({ path: path.join(output, 'storm-close-landscape.png') });
  await page.evaluate(() => window.island.resetView());
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(output, 'storm-landscape.png') });
  passed('real offshore pan, waterline zoom/tilt, and close panning in both orientations');
  assert.equal(
    await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getError()),
    0,
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.ok(
    report.requests.every((url) => url.startsWith(origin)),
    'Only bundled resources requested',
  );
  assert.deepEqual((await snapshot()).failures, []);
  passed('landscape recenter and clean WebGL/JavaScript');

  phase('Failure and reload recovery');
  injectingFailure = true;
  await page.evaluate(() => {
    for (let index = 0; index < 2; index++) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('Smoke test failure') }));
    }
    window.island.setActive(true);
    window.island.setPaused(false);
    for (const limit of [30, 60, null]) window.island.setFrameRateLimit(limit);
    for (const weather of ['sun', 'storm']) window.island.setWeather(weather);
    window.island.resetView();
  });
  const failed = await snapshot();
  assert.equal(failed.failures.length, 1, 'Failure reports once');
  assert.equal(failed.state.failed, true);
  assert.equal(failed.pending, 0);
  assert.equal(failed.fps, 0);
  await page.waitForTimeout(200);
  assert.deepEqual(await snapshot(), failed, 'Failed rendering stays stopped');
  injectingFailure = false;
  await page.reload();
  await page.waitForFunction(() => window.__native.ready === 1 && !window.island.getState().failed);
  assert.deepEqual((await snapshot()).failures, []);
  assert.equal((await state()).frameRateLimit, null, 'A fresh scene defaults to Unlocked');
  assert.equal((await state()).weather, 'sun', 'A fresh scene defaults to Sun');
  passed('idempotent failure, mode changes stay stopped, reload recovery');
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = error.stack || String(error);
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  phase('Close browser');
  await browser.close();
  clearTimeout(deadline);
}
console.log(
  JSON.stringify(
    { pass: report.pass, checks: report.checks, failure: report.failure, output },
    null,
    2,
  ),
);
process.exitCode = report.pass ? 0 : 1;
