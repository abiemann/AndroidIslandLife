import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';

// Physically based atmosphere after Hillaire 2020, "A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique" (sebh/UnrealEngineSkyAtmosphere): transmittance LUT,
// multiple-scattering LUT and a sky-view LUT for an observer at sea level. Everything is
// rebuilt in update() (well under a millisecond); nothing runs per frame.
// Distances in km. Radiance is relative to the sun illuminance uSunIllum (see sky.js).

const RB = 6360, RT = 6460, OBS_H = 0.01;   // ground, top of atmosphere, observer altitude (km)
const TRANS_W = 256, TRANS_H = 64, MS_RES = 32, SKY_W = 192, SKY_H = 108;

// Earth defaults from sebh / Bruneton 2017 (per km at sea level). turbidity scales the aerosol
// density as turbidity^2: 1 = sebh/Bruneton (very clean, aerosol optical depth 0.005),
// 2 = clear maritime (default, ~0.02), 5 = ~0.13, 10 = heavy haze (~0.5).
// rayleigh scales the molecular density.
export function atmosphereCoefficients(p) {
  const m = p.turbidity * p.turbidity;
  return {
    rayleigh: [5.802e-3, 13.558e-3, 33.1e-3].map((v) => v * p.rayleigh),
    mieScattering: 3.996e-3 * m,
    mieExtinction: 4.44e-3 * m,
    ozone: [0.65e-3, 1.881e-3, 0.085e-3],
  };
}

// --- CPU mirror of the transmittance LUT integral (for the sun colour) ------------------
function altitudeAt(h, mu, t) {
  const q = h * (2 * RB + h) + t * (2 * (RB + h) * mu + t);
  return q / (Math.sqrt(RB * RB + q) + RB);
}

// transmittance from altitude h (km) along zenith cosine mu to space, same quadrature as the LUT
export function transmittance(c, h, mu, out = [0, 0, 0]) {
  const r = RB + h;
  const d = Math.max(-r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + RT * RT, 0)), 0);
  const od = [0, 0, 0];
  for (let i = 0; i < 40; i++) {
    const a = Math.max(altitudeAt(h, mu, d * ((i + 0.5) / 40) ** 2), 0);
    const w = (2 * i + 1) * d / 1600;
    const dR = Math.exp(-a / 8) * w, dM = Math.exp(-a / 1.2) * w, dO = Math.max(0, 1 - Math.abs(a - 25) / 15) * w;
    for (let k = 0; k < 3; k++) od[k] += c.rayleigh[k] * dR + c.mieExtinction * dM + c.ozone[k] * dO;
  }
  for (let k = 0; k < 3; k++) out[k] = Math.exp(-od[k]);
  return out;
}
export const OBSERVER_ALTITUDE = OBS_H;

// --- GLSL ---------------------------------------------------------------------------------
// Shared by the LUT passes and the cube bake: uniforms, medium, LUT parameterisations.
export const ATMOSPHERE_GLSL = /* glsl */`
precision highp float;
precision highp sampler2D;
#define PI 3.14159265359
const float RB = ${RB.toFixed(1)}, RT = ${RT.toFixed(1)}, OBS_H = ${OBS_H};
const float H_TOP = ${Math.sqrt(RT * RT - RB * RB).toFixed(4)};  // sqrt(RT^2 - RB^2)
const float MIE_G = 0.8;
const float GROUND_ALBEDO = 0.1;
const vec2 SKY_RES = vec2(${SKY_W}.0, ${SKY_H}.0);
uniform vec3 uRayleigh;     // Rayleigh scattering at sea level (1/km)
uniform vec2 uMie;          // aerosol scattering, extinction at sea level (1/km)
uniform vec3 uOzone;        // ozone absorption at the layer peak (1/km)
uniform float uSunIllum;    // sun illuminance outside the atmosphere
uniform sampler2D uTransLut;
uniform sampler2D uMsLut;
uniform sampler2D uSkyView;

vec2 toSub(vec2 u, vec2 n) { return u * (n - 1.0) / n + 0.5 / n; }
vec2 fromSub(vec2 u, vec2 n) { return (u - 0.5 / n) * n / (n - 1.0); }

// altitude after travelling t along a ray from altitude h with zenith cosine mu; r = radius
float altAt(float h, float mu, float t, out float r) {
  float q = h * (2.0 * RB + h) + t * (2.0 * (RB + h) * mu + t);  // r^2 - RB^2 without cancellation
  r = sqrt(RB * RB + q);
  return q / (r + RB);
}

struct Medium { vec3 ray; float mie; vec3 scat; vec3 ext; };
Medium medium(float h) {
  h = max(h, 0.0);
  float dM = exp(-h / 1.2);
  Medium m;
  m.ray = uRayleigh * exp(-h / 8.0);
  m.mie = uMie.x * dM;
  m.scat = m.ray + m.mie;
  m.ext = m.ray + uMie.y * dM + uOzone * max(0.0, 1.0 - abs(h - 25.0) / 15.0);  // ozone: tent 10..40 km
  return m;
}

float distTop(float r, float mu) { return max(-r * mu + sqrt(max(r * r * (mu * mu - 1.0) + RT * RT, 0.0)), 0.0); }

// Bruneton's transmittance parameterisation (covers the rays that miss the ground)
vec2 transUv(float h, float mu) {
  float r = RB + h, rho = sqrt(max(h, 0.0) * (2.0 * RB + h));
  float dMin = RT - r, dMax = rho + H_TOP;
  return vec2((distTop(r, mu) - dMin) / (dMax - dMin), rho / H_TOP);
}
vec3 transmittance(float h, float mu) { return textureLod(uTransLut, transUv(h, mu), 0.0).rgb; }

// 0 where the planet hides the sun from altitude h (radius r)
float sunVisible(float h, float r, float muS) { return step(-sqrt(max(h, 0.0) * (2.0 * RB + h)) / r, muS); }

// sky-view LUT, upper hemisphere only (the observer is at sea level): u = sqrt of the azimuth
// cosine to the sun, v = sqrt(elevation / 90deg) so texels crowd the horizon
vec3 skyView(vec3 d, vec3 sunDir) {
  float v = sqrt(asin(clamp(d.y, 0.0, 1.0)) / (0.5 * PI));
  float cosPhi = dot(d.xz, sunDir.xz) * inversesqrt(max(dot(d.xz, d.xz) * dot(sunDir.xz, sunDir.xz), 1e-12));
  float u = sqrt(clamp(0.5 - 0.5 * cosPhi, 0.0, 1.0));
  return textureLod(uSkyView, toSub(vec2(u, v), SKY_RES), 0.0).rgb;
}
`;

const PASS_IO = /* glsl */`
in vec2 vUv;
out vec4 fragColor;
`;

// in-scattered radiance (unit sun illuminance) along a ray from altitude h, zenith cosine mu,
// sun zenith cosine muS, view.sun = nu; n samples spaced quadratically, each segment integrated
// analytically (Frostbite 2015 energy-conserving step). MS_PASS: isotropic phase, no multiple-scattering
// input, plus the lit ground; fms returns the transfer integral of eq. 7.
const INTEGRATE = /* glsl */`
float rayleighPhase(float c) { return 0.0596831 * (1.0 + c * c); }
float miePhase(float c) {
  float k = 1.0 + MIE_G * MIE_G - 2.0 * MIE_G * c;
  return (1.0 - MIE_G * MIE_G) / (4.0 * PI * k * sqrt(k));
}
vec3 multiScatter(float h, float muS) {
  vec2 uv = clamp(vec2(muS * 0.5 + 0.5, h / (RT - RB)), 0.0, 1.0);
  return textureLod(uMsLut, toSub(uv, vec2(${MS_RES}.0)), 0.0).rgb;
}
vec3 integrate(float h, float mu, float muS, float nu, int n, out vec3 fms) {
  float r0 = RB + h;
  float gd = r0 * r0 * (mu * mu - 1.0) + RB * RB;
  bool ground = mu < 0.0 && gd >= 0.0;
  float tMax = ground ? max(-r0 * mu - sqrt(gd), 0.0) : distTop(r0, mu);
#ifdef MS_PASS
  float pR = 1.0 / (4.0 * PI), pM = pR;
#else
  float pR = rayleighPhase(nu), pM = miePhase(nu);
#endif
  vec3 L = vec3(0.0), T = vec3(1.0);
  fms = vec3(0.0);
  float k = tMax / float(n * n);
  for (int i = 0; i < n; i++) {
    float fi = float(i);
    float t = k * (fi + 0.5) * (fi + 0.5), dt = k * (2.0 * fi + 1.0);
    float r;
    float ht = altAt(h, mu, t, r);
    float muSt = clamp((r0 * muS + t * nu) / r, -1.0, 1.0);
    Medium m = medium(ht);
    vec3 S = transmittance(ht, muSt) * sunVisible(ht, r, muSt) * (m.ray * pR + m.mie * pM);
#ifndef MS_PASS
    S += m.scat * multiScatter(ht, muSt);
#endif
    vec3 Ts = exp(-m.ext * dt);
    vec3 seg = (1.0 - Ts) / max(m.ext, vec3(1e-7));
    L += T * S * seg;
    fms += T * m.scat * seg;
    T *= Ts;
  }
#ifdef MS_PASS
  if (ground) {
    float muSg = clamp((r0 * muS + tMax * nu) / RB, -1.0, 1.0);
    L += T * transmittance(0.0, muSg) * max(muSg, 0.0) * (GROUND_ALBEDO / PI);
  }
#endif
  return L;
}
`;

const TRANS_FRAG = ATMOSPHERE_GLSL + PASS_IO + /* glsl */`
void main() {
  float rho = H_TOP * vUv.y;
  float r = sqrt(rho * rho + RB * RB), h = rho * rho / (r + RB);
  float dMin = RT - r, d = mix(dMin, rho + H_TOP, vUv.x);
  float mu = d <= 0.0 ? 1.0 : clamp((H_TOP * H_TOP - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 od = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float fi = float(i), rr;
    od += medium(altAt(h, mu, d * (fi + 0.5) * (fi + 0.5) / 1600.0, rr)).ext * (2.0 * fi + 1.0);
  }
  fragColor = vec4(exp(-od * (d / 1600.0)), 1.0);
}`;

// Psi_ms (Hillaire eq. 10) for unit illuminance: 2nd-order radiance and transfer factor averaged
// over 64 directions, summed as the geometric series L2 / (1 - f_ms)
const MS_FRAG = '#define MS_PASS\n' + ATMOSPHERE_GLSL + PASS_IO + INTEGRATE + /* glsl */`
void main() {
  vec2 uv = fromSub(vUv, vec2(${MS_RES}.0));
  float muS = uv.x * 2.0 - 1.0, h = max(uv.y * (RT - RB), OBS_H);
  float sinS = sqrt(max(1.0 - muS * muS, 0.0));
  vec3 L = vec3(0.0), F = vec3(0.0), fms;
  for (int j = 0; j < 8; j++) {
    float mu = 1.0 - 2.0 * (float(j) + 0.5) / 8.0, sinV = sqrt(1.0 - mu * mu);
    for (int i = 0; i < 8; i++) {
      float nu = cos(2.0 * PI * (float(i) + 0.5) / 8.0) * sinV * sinS + mu * muS;
      L += integrate(h, mu, muS, nu, 20, fms);
      F += fms;
    }
  }
  fragColor = vec4((L / 64.0) / (1.0 - F / 64.0), 1.0);
}`;

const SKY_FRAG = ATMOSPHERE_GLSL + PASS_IO + INTEGRATE + /* glsl */`
uniform float uSunMu;
void main() {
  vec2 uv = fromSub(vUv, SKY_RES);
  float cosPhi = 1.0 - 2.0 * uv.x * uv.x, elev = 0.5 * PI * uv.y * uv.y;
  float mu = sin(elev), cosE = cos(elev);
  vec3 v = vec3(cosE * cosPhi, mu, cosE * sqrt(max(1.0 - cosPhi * cosPhi, 0.0)));
  vec3 s = vec3(sqrt(max(1.0 - uSunMu * uSunMu, 0.0)), uSunMu, 0.0);
  vec3 fms;
  fragColor = vec4(integrate(OBS_H, mu, uSunMu, dot(v, s), 32, fms) * uSunIllum, 1.0);
}`;

const lutTarget = (w, h) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});

export class Atmosphere {
  constructor() {
    this.transRT = lutTarget(TRANS_W, TRANS_H);
    this.msRT = lutTarget(MS_RES, MS_RES);
    this.skyRT = lutTarget(SKY_W, SKY_H);
    // shared by reference with every pass that includes ATMOSPHERE_GLSL
    this.uniforms = {
      uRayleigh: { value: new THREE.Vector3() },
      uMie: { value: new THREE.Vector2() },
      uOzone: { value: new THREE.Vector3() },
      uSunIllum: { value: 1 },
      uTransLut: { value: this.transRT.texture },
      uMsLut: { value: this.msRT.texture },
      uSkyView: { value: this.skyRT.texture },
    };
    // each pass only gets the LUTs it reads, never the one it renders into
    const { uTransLut, uMsLut, uSkyView, ...medium } = this.uniforms;
    this.transPass = new FullscreenQuad(rawPass(TRANS_FRAG, medium));
    this.msPass = new FullscreenQuad(rawPass(MS_FRAG, { ...medium, uTransLut }));
    this.skyPass = new FullscreenQuad(rawPass(SKY_FRAG, { ...medium, uTransLut, uMsLut, uSunMu: { value: 0 } }));
  }

  // c: atmosphereCoefficients(); sunMu: sun zenith cosine; sunIllum: illuminance at the top
  update(renderer, c, sunMu, sunIllum) {
    const u = this.uniforms;
    u.uRayleigh.value.fromArray(c.rayleigh);
    u.uMie.value.set(c.mieScattering, c.mieExtinction);
    u.uOzone.value.fromArray(c.ozone);
    u.uSunIllum.value = sunIllum;
    this.skyPass.material.uniforms.uSunMu.value = sunMu;
    this.transPass.render(renderer, this.transRT);
    this.msPass.render(renderer, this.msRT);
    this.skyPass.render(renderer, this.skyRT);
  }
}
