// One pending callback; capped modes share pacing between animation and touch input.
export class FrameLoop {
  constructor({
    render,
    onFps,
    onError,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
  }) {
    this.render = render;
    this.onFps = onFps;
    this.onError = onError;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.active = false;
    this.paused = false;
    this.stopped = false;
    this.frameRateLimit = null;
    this.fps = 0;
    this.dirty = true;
    this.frameId = null;
    this.lastFrame = null;
    this.nextFrame = null;
    this.fpsStart = null;
    this.fpsFrames = 0;
    this.tick = this.tick.bind(this);
  }

  requestDraw() {
    if (this.stopped) return;
    this.dirty = true;
    this.schedule();
  }

  setFrameRateLimit(value) {
    if (this.stopped || ![null, 30, 60].includes(value) || this.frameRateLimit === value) return;
    this.frameRateLimit = value;
    this.nextFrame = null;
    this.resetFps();
    this.schedule();
  }

  setPaused(value) {
    if (this.stopped || this.paused === Boolean(value)) return;
    this.paused = Boolean(value);
    this.lastFrame = null;
    this.nextFrame = null;
    this.resetFps();
    this.cancel();
    this.schedule();
  }

  setActive(value) {
    if (this.stopped || this.active === Boolean(value)) return;
    this.active = Boolean(value);
    this.lastFrame = null;
    this.nextFrame = null;
    this.resetFps();
    this.cancel();
    if (this.active) this.dirty = true;
    this.schedule();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.active = false;
    this.dirty = false;
    this.cancel();
    this.resetFps();
  }

  cancel() {
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  schedule() {
    if (!this.stopped && this.active && (!this.paused || this.dirty) && this.frameId === null) {
      this.frameId = this.requestFrame(this.tick);
    }
  }

  resetFps() {
    this.fps = 0;
    this.fpsStart = null;
    this.fpsFrames = 0;
    this.onFps(0);
  }

  tick(now) {
    this.frameId = null;
    if (this.stopped || !this.active) return;
    const interval = this.frameRateLimit === null ? 0 : 1000 / this.frameRateLimit;
    // Preserve the cadence on displays whose refresh rate is not a multiple of the cap.
    // Unlocked submits one scene frame for every available display callback.
    if (this.nextFrame === null || now >= this.nextFrame - 0.1) {
      const dt = this.lastFrame === null ? 0 : (now - this.lastFrame) / 1000;
      if (interval === 0) this.nextFrame = null;
      else if (this.nextFrame === null) this.nextFrame = now + interval;
      else
        this.nextFrame += Math.max(1, Math.floor((now - this.nextFrame) / interval) + 1) * interval;
      this.lastFrame = now;
      this.dirty = false;
      try {
        this.render(this.paused ? 0 : Math.min(dt, 0.06));
      } catch (error) {
        this.stop();
        this.onError(error);
        return;
      }
      if (this.stopped) return;
      if (!this.paused) {
        if (this.fpsStart === null) this.fpsStart = now;
        else this.fpsFrames++;
        if (now - this.fpsStart >= 1000) {
          this.fps = (this.fpsFrames * 1000) / (now - this.fpsStart);
          this.onFps(this.fps);
          this.fpsStart = now;
          this.fpsFrames = 0;
        }
      }
    }
    this.schedule();
  }
}
