// Run after installing the debug APK. Explicitly targets an emulator, never a personal device.
// ANDROID_SERIAL=emulator-5560 ADB=/path/to/adb node scripts/android-smoke.mjs
// Optional SMOKE_OUTPUT_DIR saves native screenshots. The script resets only this app.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const serial = process.env.ANDROID_SERIAL;
const adbPath = process.env.ADB;
assert.match(
  serial || '',
  /^emulator-\d+$/,
  'Set ANDROID_SERIAL to an emulator serial. Physical devices are refused.',
);
assert.ok(adbPath, 'Set ADB to the adb executable path.');
const appId = 'com.islandlife.app';
const activity = `${appId}/.MainActivity`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = async (...args) =>
  (
    await run(adbPath, ['-s', serial, ...args], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout.trim();

async function until(label, check, timeout = 45_000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (caught) {
      error = caught;
    }
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`, { cause: error });
}

async function screenshot(name) {
  if (!process.env.SMOKE_OUTPUT_DIR) return;
  await mkdir(process.env.SMOKE_OUTPUT_DIR, { recursive: true });
  const result = await run(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(path.join(process.env.SMOKE_OUTPUT_DIR, `${name}.png`), result.stdout);
}

async function findButton(label) {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/islandlife-smoke.xml');
  const xml = await adb('shell', 'cat', '/sdcard/islandlife-smoke.xml');
  for (const node of xml.matchAll(/<node\s+[^>]+>/g)) {
    const attrs = Object.fromEntries(
      [...node[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
    if (attrs.text !== label || attrs.enabled !== 'true') continue;
    const bounds = attrs.bounds
      ?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
      ?.slice(1)
      .map(Number);
    if (bounds && bounds[2] > bounds[0] && bounds[3] > bounds[1]) return bounds;
  }
  return null;
}

async function click(label) {
  const [left, top, right, bottom] = await until(`native button ${label}`, () => findButton(label));
  await adb(
    'shell',
    'input',
    'tap',
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  );
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.responses = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.responseReceived')
        this.responses.push(message.params.response);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebView DevTools disconnected'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeout = 10_000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

let port;
let client;
let previousTargetId;
async function connect() {
  client?.close();
  const page = await until('debug WebView target', async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return pages.find(
      (candidate) =>
        candidate.id !== previousTargetId &&
        candidate.url.startsWith('https://appassets.androidplatform.net/assets/scene/'),
    );
  });
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools connection timeout')), 10_000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
      { once: true },
    );
  });
  client = new DevTools(socket);
  previousTargetId = page.id;
  await until('ready scene', () =>
    client.evaluate(
      `Boolean(window.island && !window.island.getState().failed && document.getElementById('status').hidden)`,
    ),
  );
  const viewport = await client.evaluate(
    `({document:document.documentElement.getBoundingClientRect().height, canvas:document.querySelector('canvas').getBoundingClientRect().height, state:window.island.getState()})`,
  );
  assert.ok(
    viewport.document > 0 && viewport.canvas > 0,
    'Document and canvas must have a visible viewport',
  );
  assert.ok(viewport.state.width > 0 && viewport.state.height > 0);
  return client;
}

try {
  assert.equal(
    await adb('shell', 'getprop', 'ro.kernel.qemu'),
    '1',
    'Target must also report itself as an emulator',
  );
  await adb('shell', 'am', 'force-stop', appId);
  await adb('shell', 'am', 'start', '-W', '-n', activity);
  const pid = await until('app process', () => adb('shell', 'pidof', appId));
  const socketName = `webview_devtools_remote_${pid}`;
  await until('WebView debug socket', async () =>
    (await adb('shell', 'cat', '/proc/net/unix')).includes(socketName),
  );
  port = await adb('forward', 'tcp:0', `localabstract:${socketName}`);
  assert.match(port, /^\d+$/);
  await connect();
  await screenshot('native-ready');
  console.log('PASS: offline launch and nonzero WebView viewport');

  await click('Pause');
  await until('paused bridge state', () => client.evaluate('window.island.getState().paused'));
  const pausedTime = await client.evaluate('window.island.getState().elapsed');
  await sleep(500);
  assert.equal(await client.evaluate('window.island.getState().elapsed'), pausedTime);
  await click('Golden light');
  await until('golden lighting bridge state', () =>
    client.evaluate(`window.island.getState().lighting === 'golden'`),
  );
  await click('Storm');
  await until('storm bridge state', () =>
    client.evaluate(`window.island.getState().weather === 'storm'`),
  );
  assert.equal(await client.evaluate('window.island.getState().elapsed'), pausedTime);
  assert.equal(await client.evaluate('window.island.getState().lighting'), 'golden');
  await screenshot('native-storm-paused');
  await click('Sun');
  await until('sun bridge state', () =>
    client.evaluate(`window.island.getState().weather === 'sun'`),
  );
  assert.equal(await client.evaluate('window.island.getState().lighting'), 'golden');
  await click('Daylight');
  await until('daylight bridge state', () =>
    client.evaluate(`window.island.getState().lighting === 'day'`),
  );
  await click('Play');
  await until('animation resumed', () => client.evaluate('!window.island.getState().paused'));
  await click('Storm');
  await until('animated storm', () =>
    client.evaluate(`window.island.getState().weather === 'storm'`),
  );
  console.log('PASS: native pause/play, lighting, and Storm/Sun controls');

  await adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await until('background suspension', () => client.evaluate('!window.island.getState().active'));
  const backgroundTime = await client.evaluate('window.island.getState().elapsed');
  await sleep(500);
  assert.equal(await client.evaluate('window.island.getState().elapsed'), backgroundTime);
  await adb('shell', 'am', 'start', '-W', '-n', activity);
  await until('foreground animation', () =>
    client.evaluate(
      `window.island.getState().active && window.island.getState().elapsed > ${backgroundTime}`,
    ),
  );
  console.log('PASS: background/foreground lifecycle');
  assert.equal(await client.evaluate('window.island.getState().weather'), 'storm');

  await client.send('Network.enable');
  const blockedLocal = await client.evaluate(
    `fetch('/blocked-probe').then(response => response.status)`,
  );
  assert.equal(blockedLocal, 403, 'Paths outside bundled scene assets must be blocked');
  const probeUrl = 'https://example.invalid/islandlife-network-probe';
  await client.evaluate(
    `fetch('${probeUrl}', {mode:'no-cors'}).then(() => true).catch(() => false)`,
  );
  const external = await until('intercepted external request', async () =>
    client.responses.find((response) => response.url === probeUrl),
  );
  assert.equal(external.status, 403, 'External request must receive the local block response');
  const via = Object.entries(external.headers).find(
    ([name]) => name.toLowerCase() === 'client-via',
  )?.[1];
  assert.equal(
    via,
    'shouldInterceptRequest',
    'Blocked response must come from the Android interceptor',
  );
  assert.equal(await client.evaluate('window.island.getState().failed'), false);
  console.log('PASS: local route restriction and external network interception');

  await client.evaluate(
    `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext(); true`,
  );
  await until('context-loss retry UI', () => findButton('Try again'));
  await screenshot('native-context-loss');
  await click('Try again');
  await connect();
  await until('storm restored after context loss', () =>
    client.evaluate(`window.island.getState().weather === 'storm'`),
  );
  console.log('PASS: graphics context loss and native retry');

  await client.send('Page.crash', {}, 5_000).catch(() => {});
  await until('renderer-crash retry UI', () => findButton('Try again'));
  assert.equal(
    await adb('shell', 'pidof', appId),
    pid,
    'Renderer crash must not kill the app process',
  );
  await screenshot('native-renderer-crash');
  await click('Try again');
  await connect();
  await until('storm restored after renderer restart', () =>
    client.evaluate(`window.island.getState().weather === 'storm'`),
  );
  await click('Sun');
  await until('sun restored after retry', () =>
    client.evaluate(`window.island.getState().weather === 'sun'`),
  );
  await screenshot('native-recovered');
  console.log('PASS: renderer process crash, app survival, and native retry');
  console.log(`All Android smoke checks passed on ${serial}.`);
} finally {
  client?.close();
  if (port) await adb('forward', '--remove', `tcp:${port}`).catch(() => {});
  await adb('shell', 'rm', '-f', '/sdcard/islandlife-smoke.xml').catch(() => {});
}
