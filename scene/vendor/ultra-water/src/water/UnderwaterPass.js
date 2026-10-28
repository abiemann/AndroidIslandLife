import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { WATER_GLSL } from './OceanSurface.js';
import { CAUSTICS_GLSL } from './Caustics.js';
import { FLOAT_SHADOW_GLSL } from '../scene/floaterShadow.js';

// Fullscreen pass over the finished HDR frame when the camera is at or below the
// surface. Per pixel it finds whether the lens (near-plane point) is under the exact
// rendered surface, so a wave washing over the camera splits the screen with a
// meniscus line. Underwater pixels get the camera->hit water column: Beer-Lambert
// extinction towards an in-scatter colour that matches the surface underside, plus
// single-scattered sun shafts (half res) through the same wave caustics and shadows
// that light the seabed.
const COMMON = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2DShadow;
${WATER_GLSL}
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
vec3 viewPos(vec2 uv, float ndcZ) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, ndcZ, 1.0);
  return v.xyz / v.w;
}
`;

// lens depth below the surface on a coarse grid over the near plane (the exact
// waterAt is far too heavy per pixel, and the waterline is smooth at lens scale)
const LENS = COMMON + /* glsl */`
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 nearW = (uCamWorld * vec4(viewPos(vUv, -1.0), 1.0)).xyz;
  outColor = vec4(waterAt(nearW.xz, vec3(0.0)).y - nearW.y, 0.0, 0.0, 1.0);
}`;

const SHAFTS = COMMON + CAUSTICS_GLSL + FLOAT_SHADOW_GLSL + /* glsl */`
uniform highp sampler2D tDepth;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowBias;
uniform vec3 uAbsorption;
uniform vec3 uSunDir;
uniform vec4 uUnder;   // scattering coefficient (1/m), shaft strength, shaft range (m), -
uniform float uFrame;  // frame index mod 64, rotates the jitter
in vec2 vUv;
out vec4 outColor;

// light reaching a point in the water came through the surface at entry; it is lit if
// the entry point is (terrain and floater shadows, as seen on the water surface)
float lightAt(vec2 entry) {
  vec3 e = vec3(entry.x, 0.0, entry.y);
  vec4 sc = uShadowMatrix * vec4(e, 1.0);
  float s = 1.0;
  if (all(greaterThan(sc.xy, vec2(0.0))) && all(lessThan(sc.xyz, vec3(1.0)))) s = texture(uShadowMap, vec3(sc.xy, sc.z - uShadowBias));
  return min(s, floatShadow(e));
}

// per half-res pixel: in-scattered sun along the view ray (without the sun colour and
// strength), and the distance the composite uses to upsample without halos
void main() {
  float z = texture(tDepth, vUv).r;
  vec3 hitV = viewPos(vUv, z * 2.0 - 1.0);
  float dist = z > 0.999999 ? 1e5 : length(hitV);
  vec3 dir = normalize(mat3(uCamWorld) * hitV);
  vec3 camPos = uCamWorld[3].xyz;
  vec3 sigT = uAbsorption + uUnder.x;
  vec3 rs = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.33);
  vec3 acc = vec3(0.0);
  if (rs.y < -0.05) {
    float range = min(dist, uUnder.z);
    const int STEPS = 24;
    float stepL = range / float(STEPS);
    // interleaved gradient noise, shifted by the golden ratio each frame
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
    float mu = dot(dir, -rs);
    const float g = 0.7;
    float phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5)) + 0.04;
    // prefilter along the ray: mip from how far one step moves through the 12 m pattern
    // (rays sweeping across the caustics average to haze, rays along the light keep shafts)
    vec2 dbase = dir.xz - rs.xz / rs.y * dir.y;
    float lod = max(log2(max(length(dbase) * stepL * CAUSTIC_TEXELS_PER_M, 1.0)), 1.0);
    for (int i = 0; i < STEPS; i++) {
      float s = (float(i) + jit) * stepL;
      vec3 p = camPos + dir * s;
      float pd = -p.y;
      if (pd <= 0.0) continue;
      vec2 entry = p.xz + rs.xz / rs.y * pd;
      acc += waveCaustic(entry, pd, lod) * lightAt(entry) * exp(-sigT * (s + pd / -rs.y)) * smoothstep(0.0, 0.6, pd);
    }
    acc *= phase * stepL;
  }
  outColor = vec4(acc, dist);
}`;

const FRAG = COMMON + /* glsl */`
uniform sampler2D tColor;
uniform highp sampler2D tDepth;
uniform sampler2D tLens;
uniform highp sampler2D tShafts;
uniform samplerCube uSkyCube;
uniform float uSkyMaxLod;
uniform vec3 uAbsorption;
uniform vec3 uScatterColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uUnder;   // scattering coefficient (1/m), shaft strength, shaft range (m), meniscus darkening
uniform float uFull;   // 1: camera deep enough that the whole near plane is submerged
in vec2 vUv;
out vec4 outColor;

// alpha tag from the water pass: 0 underside, 1 no water, 2 top (edges average between)
float isFront(float a) { return step(1.5, a); }
float isBack(float a) { return step(a, 0.5); }

// half-res shafts back to full res, weighting the 4 nearest by distance agreement so
// shafts in front of an object don't bleed onto it
vec3 shafts(vec2 uv, float dist) {
  vec2 hs = vec2(textureSize(tShafts, 0));
  vec2 st = uv * hs - 0.5;
  vec2 f = fract(st);
  ivec2 i0 = ivec2(floor(st));
  vec3 sum = vec3(0.0);
  float wsum = 1e-5;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec4 t = texelFetch(tShafts, clamp(i0 + o, ivec2(0), ivec2(hs) - 1), 0);
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y)
            / (1e-3 + abs(t.a - dist) / max(dist, 0.5));
    sum += t.rgb * w;
    wsum += w;
  }
  return sum / wsum;
}

void main() {
  float d = uFull > 0.5 ? 10.0 : texture(tLens, vUv).r;   // lens depth

  // where the pixel sees the water surface, its facing decides; elsewhere the lens
  // test. That keeps the split consistent with the mesh even where its coarse fan
  // around the lens disagrees with the exact height.
  vec4 src = texture(tColor, vUv);
  bool under = isBack(src.a) > 0.5 || (isFront(src.a) < 0.5 && d > 0.0);

  // meniscus: a dark line where the top of the surface meets its underside on screen
  float meniscus = 1.0;
  if (uFull < 0.5) {
    vec2 px = 2.0 / vec2(textureSize(tColor, 0));
    float f = 0.0, b = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 0 ? px.x : i == 1 ? -px.x : 0.0, i == 2 ? px.y : i == 3 ? -px.y : 0.0);
      float a = texture(tColor, vUv + o).a;
      f += isFront(a);
      b += isBack(a);
    }
    // only near the lens: far front/back boundaries are folded crests, not the waterline
    meniscus -= uUnder.w * max(isFront(src.a) * min(b, 1.0), isBack(src.a) * min(f, 1.0))
              * smoothstep(0.35, 0.1, abs(d));
  }
  if (!under) {
    outColor = vec4(src.rgb * meniscus, 1.0);
    return;
  }
  d = max(d, 0.0);

  // slight refractive wobble of the whole image
  vec2 uv = vUv + vec2(sin(vUv.y * 37.0 + uTime * 1.9), cos(vUv.x * 29.0 + uTime * 1.6)) * 0.0012;
  vec3 col = texture(tColor, uv).rgb;
  float z = texture(tDepth, uv).r;
  vec3 hitV = viewPos(uv, z * 2.0 - 1.0);
  float dist = z > 0.999999 ? 1e5 : length(hitV);
  vec3 dir = normalize(mat3(uCamWorld) * hitV);

  vec3 sigT = uAbsorption + uUnder.x;
  // in-scatter: the surface underside's deep-water colour, darker with depth and
  // brighter looking up towards the light
  vec3 ambient = textureLod(uSkyCube, vec3(0.0, 1.0, 0.0), uSkyMaxLod).rgb;
  vec3 fogCol = uScatterColor * (ambient + uSunColor * max(uSunDir.y, 0.0))
              * exp(-uAbsorption * d * 0.5) * mix(0.55, 1.35, dir.y * 0.5 + 0.5);
  vec3 T = exp(-sigT * dist);
  col = col * T + fogCol * (1.0 - T);
  if (uUnder.y > 0.0) col += uSunColor * shafts(uv, dist) * (uUnder.x * uUnder.y);

  outColor = vec4(col * meniscus, 1.0);
}`;

export class UnderwaterPass {
  constructor(surface, camera, caustics) {
    this.params = { scattering: 0.03, shafts: 2, shaftRange: 40, meniscus: 0.5 };   // shafts: 1 = physical single scattering
    this.uniforms = {
      ...surface.uniforms,
      tColor: { value: null }, tDepth: { value: null }, ...caustics,
      tLens: { value: null }, tShafts: { value: null },
      uInvProj: { value: camera.projectionMatrixInverse }, uCamWorld: { value: camera.matrixWorld },
      uUnder: { value: new THREE.Vector4() }, uFull: { value: 0 }, uFrame: { value: 0 },
    };
    this.quad = new FullscreenQuad(rawPass(FRAG, this.uniforms));
    this.shaftQuad = new FullscreenQuad(rawPass(SHAFTS, this.uniforms));
    this.lensQuad = new FullscreenQuad(rawPass(LENS, this.uniforms));
    const nearest = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
    this.lens = new THREE.WebGLRenderTarget(64, 36, { ...nearest, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.uniforms.tLens.value = this.lens.texture;
    this.shaftRT = new THREE.WebGLRenderTarget(1, 1, nearest);
    this.uniforms.tShafts.value = this.shaftRT.texture;
    this.target = null;
  }

  setSize(w, h) {
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
    this.shaftRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  // src: the HDR target after the water pass (colour + depth). Returns the new colour.
  render(renderer, src, full) {
    const u = this.uniforms, p = this.params;
    u.tColor.value = src.texture;
    u.tDepth.value = src.depthTexture;
    u.uUnder.value.set(p.scattering, p.shafts, p.shaftRange, p.meniscus);
    u.uFull.value = full ? 1 : 0;
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    if (!full) this.lensQuad.render(renderer, this.lens);
    if (p.shafts > 0) this.shaftQuad.render(renderer, this.shaftRT);
    this.quad.render(renderer, this.target);
    return this.target.texture;
  }
}
