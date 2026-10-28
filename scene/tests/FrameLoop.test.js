import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLoop } from '../src/FrameLoop.js';

function harness(renderOverride) {
  let clock = 0,
    nextId = 0;
  const callbacks = new Map(),
    frames = [],
    reports = [],
    errors = [];
  const loop = new FrameLoop({
    render: (dt) => {
      frames.push({ time: clock, dt });
      renderOverride?.(dt, loop);
    },
    onFps: (fps) => reports.push(fps),
    onError: (error) => errors.push(error),
    requestFrame: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame: (id) => callbacks.delete(id),
  });
  function advance(count, beforeFrame = () => {}, refreshRate = 120) {
    for (let i = 0; i < count; i++) {
      clock += 1000 / refreshRate;
      beforeFrame();
      const batch = [...callbacks.values()];
      callbacks.clear();
      for (const callback of batch) callback(clock);
      assert(callbacks.size <= 1, 'Only one animation callback may be pending');
    }
  }
  return { loop, advance, callbacks, frames, reports, errors };
}

test('unlocked is the default and renders every available display callback', () => {
  for (const refreshRate of [60, 90, 120, 144]) {
    const h = harness();
    assert.equal(h.loop.frameRateLimit, null);
    h.loop.setActive(true);
    h.advance(refreshRate * 5, () => h.loop.requestDraw(), refreshRate);
    assert.equal(h.frames.length, refreshRate * 5);
    assert.equal(h.frames[0].dt, 0);
    assert(h.reports.some((fps) => Math.abs(fps - refreshRate) < 0.01));
    const elapsed = h.frames.reduce((sum, frame) => sum + frame.dt, 0);
    assert(Math.abs(elapsed - (5 - 1 / refreshRate)) < 0.0001);
  }
});

test('30 and 60 FPS modes pace animation and input on several display refresh rates', () => {
  for (const cap of [30, 60]) {
    for (const refreshRate of [60, 90, 120, 144]) {
      const h = harness();
      h.loop.setFrameRateLimit(cap);
      h.loop.setActive(true);
      h.advance(refreshRate * 5, () => h.loop.requestDraw(), refreshRate);
      assert.equal(h.frames.length, cap * 5);
      assert(h.reports.some((fps) => fps > 0));
      // Fractional display cadence may add one render to an individual sample window.
      assert(h.reports.every((fps) => fps <= cap + 1));
    }
  }
});

test('mode changes take effect immediately without duplicate callbacks or replay resets', () => {
  const h = harness();
  h.loop.setActive(true);
  for (const cap of [30, 60, null]) {
    h.loop.setFrameRateLimit(cap);
    const count = h.frames.length;
    const reports = h.reports.length;
    h.advance(120, () => h.loop.setFrameRateLimit(cap));
    assert.equal(h.frames.length - count, cap ?? 120);
    assert(h.reports.slice(reports).every((fps) => fps !== 0));
  }
  const elapsed = h.frames.reduce((sum, frame) => sum + frame.dt, 0);
  const duration = (h.frames.at(-1).time - h.frames[0].time) / 1000;
  assert(Math.abs(elapsed - duration) < 0.0001, 'Changing the limit must not lose simulation time');
  h.loop.setFrameRateLimit(45);
  assert.equal(h.loop.frameRateLimit, null);
  h.loop.setPaused(true);
  h.loop.setFrameRateLimit(30);
  assert.equal(h.callbacks.size, 0);
  h.loop.setActive(false);
  h.loop.setFrameRateLimit(60);
  assert.equal(h.callbacks.size, 0);
  h.loop.setPaused(false);
  h.loop.setActive(true);
  const count = h.frames.length;
  h.advance(120);
  assert.equal(h.frames.length - count, 60);
});

test('a stalled callback draws once with bounded simulation time, without a catch-up burst', () => {
  const h = harness();
  h.loop.setFrameRateLimit(60);
  h.loop.setActive(true);
  h.advance(1);
  h.advance(1, () => {}, 1);
  assert.equal(h.frames.length, 2);
  assert.equal(h.frames.at(-1).dt, 0.06);
  h.advance(120);
  assert.equal(h.frames.length, 62);
});

test('pause stops scheduling; a paused camera change draws once without advancing time', () => {
  const h = harness();
  h.loop.setActive(true);
  h.advance(150);
  h.loop.setPaused(true);
  assert.equal(h.callbacks.size, 0);
  const count = h.frames.length;
  h.advance(120);
  assert.equal(h.frames.length, count);
  assert.equal(h.reports.at(-1), 0);
  h.loop.requestDraw();
  h.loop.requestDraw();
  h.advance(120);
  assert.equal(h.frames.length, count + 1);
  assert.equal(h.frames.at(-1).dt, 0);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.loop.fps, 0);
});

test('inactive scenes ignore drawing requests and resume without a background time jump', () => {
  const h = harness();
  h.loop.setActive(true);
  h.advance(10);
  h.loop.setActive(false);
  const count = h.frames.length;
  h.advance(600, () => h.loop.requestDraw());
  assert.equal(h.frames.length, count);
  assert.equal(h.callbacks.size, 0);
  h.loop.setActive(true);
  h.advance(1);
  assert.equal(h.frames.at(-1).dt, 0);
});

test('repeating native state messages does not reset timing or FPS sampling', () => {
  const h = harness();
  h.loop.setActive(true);
  h.advance(600, () => {
    h.loop.setActive(true);
    h.loop.setPaused(false);
  });
  assert.equal(h.frames.length, 600);
  assert.equal(h.reports.filter((fps) => fps === 0).length, 1);
  assert(h.reports.some((fps) => fps > 0));
});

test('render failure cancels the loop once and cannot be restarted by native state replay', () => {
  let calls = 0;
  const failure = new Error('render failed');
  const h = harness(() => {
    if (++calls === 4) throw failure;
  });
  h.loop.setActive(true);
  h.advance(120);
  assert.deepEqual(h.errors, [failure]);
  assert.equal(h.loop.stopped, true);
  assert.equal(h.loop.fps, 0);
  assert.equal(h.callbacks.size, 0);
  h.loop.setActive(true);
  h.loop.setPaused(false);
  h.loop.requestDraw();
  h.loop.stop();
  h.advance(120);
  assert.equal(calls, 4);
  assert.deepEqual(h.errors, [failure]);
});

test('failure signaled during rendering cannot publish a stale nonzero FPS', () => {
  const h = harness((dt, loop) => loop.stop());
  h.loop.setActive(true);
  h.advance(120);
  assert.equal(h.frames.length, 1);
  assert(h.reports.every((fps) => fps === 0));
  assert.equal(h.callbacks.size, 0);
});
