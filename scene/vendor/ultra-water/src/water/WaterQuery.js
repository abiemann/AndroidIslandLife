import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { WATER_GLSL } from './OceanSurface.js';

// GPU -> CPU water surface queries. Each frame the caller submits world xz points; one
// tiny pass evaluates exactly the surface the water mesh draws (FFT + shore waves,
// choppy displacement inverted) and the result is read back asynchronously through a
// PBO, so it never stalls the GPU. Results lag 1-3 frames, fine for buoyancy.
const FRAG = /* glsl */`
precision highp float;
precision highp int;
${WATER_GLSL}
uniform highp sampler2D uQueries;
out vec4 outColor;
void main() {
  vec2 q = texelFetch(uQueries, ivec2(gl_FragCoord.xy), 0).xy;
  vec3 d = waterAt(q, vec3(0.0));
  outColor = vec4(d.y, d.x, d.z, 1.0);
}`;

export class WaterQuery {
  constructor(renderer, surface, capacity = 256) {
    this.renderer = renderer;
    this.capacity = capacity;
    this.input = new THREE.DataTexture(new Float32Array(capacity * 4), capacity, 1, THREE.RGBAFormat, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(capacity, 1, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.quad = new FullscreenQuad(rawPass(FRAG, { ...surface.uniforms, uQueries: { value: this.input } }));
    this.inFlight = 0;
    // latest completed read: (height, dispX, dispZ, 1) per point, plus what was asked
    this.result = new Float32Array(capacity * 4);
    this.resultCount = 0;
    this.resultTag = -1;
    this.resultTime = 0;
  }

  // xz: Float32Array of x,z pairs. tag identifies the point layout (ignored results
  // from an old layout are the caller's job to detect).
  submit(xz, count, tag, time) {
    if (this.inFlight >= 2 || count === 0) return;
    count = Math.min(count, this.capacity);
    const d = this.input.image.data;
    for (let i = 0; i < count; i++) { d[i * 4] = xz[i * 2]; d[i * 4 + 1] = xz[i * 2 + 1]; }
    this.input.needsUpdate = true;
    this.quad.render(this.renderer, this.target);
    this.inFlight++;
    const buf = new Float32Array(count * 4);
    this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, count, 1, buf)
      .then(() => {
        this.result.set(buf);
        this.resultCount = count;
        this.resultTag = tag;
        this.resultTime = time;
      })
      .catch(() => {})
      .finally(() => { this.inFlight--; });
  }
}
