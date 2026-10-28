import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { Atmosphere, ATMOSPHERE_GLSL, OBSERVER_ALTITUDE, atmosphereCoefficients, transmittance } from './atmosphere.js';

// Hillaire 2020 atmosphere (atmosphere.js) + clouds baked into a mipmapped HDR cube whenever the
// sun or sky params change; nothing runs per frame. The cube is the background, the water's
// reflection/fog source and the terrain IBL. The sun disc is analytic (background shader + water
// specular), so it's left out of the cube; alpha holds the cloud transmittance (1 = clear) so the
// disc can hide behind clouds.
//
// Units: the sky is lit by sun illuminance pi * sunIntensity at the top of the atmosphere, i.e. the
// cube is radiance in the same units as sunColor (sunColor = E_sun,ground / pi, what main.js feeds
// the DirectionalLight as pi * sunColor). No extra scale: against the old Preetham cube the +Y face
// averages ~0.55x at 52 deg sun, ~1.2x at 22 deg and ~3x at 3.5 deg (Preetham's sky dims too fast
// near the horizon).
const CUBE_SIZE = 256;
const CLOUD_H = 2.5;   // cloud deck altitude for lighting / aerial perspective (km)

const BG_VERT = /* glsl */`
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // far plane
}`;

const BG_FRAG = /* glsl */`
uniform samplerCube uCube;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
in vec3 vDir;
out vec4 fragColor;
void main() {
  vec3 d = normalize(vDir);
  vec4 sky = textureLod(uCube, vec3(d.x, max(d.y, 0.0), d.z), 0.0);
  float c = dot(d, uSunDir);
  // 0.27 deg disc with limb darkening, plus a tight glow; hidden by clouds (cube alpha)
  float disc = smoothstep(0.999985, 0.999992, c) * (0.6 + 0.4 * smoothstep(0.999985, 1.0, c));
  vec3 col = sky.rgb + uSunColor * (disc * 900.0 + pow(max(c, 0.0), 2200.0) * 1.5) * step(0.0, d.y) * sky.a;
  fragColor = vec4(col, 1.0);
}`;

// One cube face per draw: GL cube-map texel -> world direction (three's cube render targets are
// sampled with plain world directions).
const CUBE_FRAG = ATMOSPHERE_GLSL + /* glsl */`
const float CLOUD_H = ${CLOUD_H.toFixed(2)};
const vec3 WATER = vec3(0.02, 0.035, 0.045);  // deep-water body reflectance for the lower hemisphere
uniform int uFace;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloudCoverage;
in vec2 vUv;
out vec4 fragColor;

vec3 faceDir(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  if (uFace == 0) return vec3(1.0, -c.y, -c.x);
  if (uFace == 1) return vec3(-1.0, -c.y, c.x);
  if (uFace == 2) return vec3(c.x, 1.0, c.y);
  if (uFace == 3) return vec3(c.x, -1.0, -c.y);
  if (uFace == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

// cloud layer ported from three's Sky.js (static: time = 0, its cloudScale/elevation/density)
vec2 gradient(vec2 i) {
  vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
float fbm(vec2 p) {
  float s = 0.0, a = 1.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); a *= 0.5; p *= 2.0; }
  return s;
}

void main() {
  vec3 d = normalize(faceDir(vUv));
  vec3 up = skyView(vec3(0.0, 1.0, 0.0), uSunDir);
  if (d.y < 0.0) {
    // below the horizon: sea, Fresnel between the mirrored sky and a dark water body
    float F = 0.02 + 0.98 * pow(1.0 + d.y, 5.0);
    vec3 body = WATER * (uSunColor * max(uSunDir.y, 0.0) + up);
    fragColor = vec4(mix(body, skyView(vec3(d.x, -d.y, d.z), uSunDir), F), 1.0);
    return;
  }
  vec3 col = skyView(d, uSunDir);
  float vis = 1.0;
  if (d.y > 1e-3 && uCloudCoverage > 0.0) {
    vec2 p = d.xz / d.y * 0.396;   // cloudScale 2e-4 * 1000 / mix(1, 0.1, cloudElevation 0.55)
    float n = clamp(fbm(p) * 0.7 + 0.5, 0.0, 1.0);
    float th = 1.0 - clamp(uCloudCoverage + noise(p * 0.3) * 0.222, 0.0, 1.0);  // clear gaps / dense banks
    float fade = smoothstep(0.0, 0.063, d.y);
    float mask = smoothstep(th, th + 0.3, n) * fade;
    float depth = max(0.0, n - th);
    float beer = exp(-4.0 * depth);
    float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));  // beer-powder
    float c = dot(d, uSunDir);
    float silver = clamp(0.51 / pow(1.49 - c * 1.4, 1.5), 0.0, 3.0);  // HG g = 0.7 rim toward the sun
    float edge = mask * (1.0 - mask) * 4.0;
    float alpha = (1.0 - exp(-depth * 6.6)) * fade;                    // cloudDensity 0.55

    // the deck point along d: sunlight through the atmosphere (and planet shadow) to it, and the
    // eye-to-deck transmittance so distant clouds dissolve into the haze
    float r0 = RB + OBS_H, rc = RB + CLOUD_H;
    float t = -r0 * d.y + sqrt(r0 * r0 * d.y * d.y + (rc - r0) * (rc + r0));
    float muV = (r0 * d.y + t) / rc;
    float muS = clamp((r0 * uSunDir.y + t * c) / rc, -1.0, 1.0);
    vec3 sun = uSunIllum * transmittance(CLOUD_H, muS) * sunVisible(CLOUD_H, rc, muS) * 0.22;  // albedo/pi
    vec3 cloud = up + sun * (shade + silver * edge * 0.6);
    vec3 tv = clamp(transmittance(OBS_H, d.y) / max(transmittance(CLOUD_H, muV), vec3(1e-4)), 0.0, 1.0);
    col = mix(col, mix(col, cloud, tv), alpha);
    vis = 1.0 - alpha;
  }
  fragColor = vec4(col, vis);
}`;

export class SkySystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.cubeSize = CUBE_SIZE;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Vector3(1, 1, 1);
    this.params = { elevation: 3.5, azimuth: 205, turbidity: 2, rayleigh: 1, cloudCoverage: 0.38, sunIntensity: 9 };

    this.atmosphere = new Atmosphere();
    this.cubeRT = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, {
      type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.cube = this.cubeRT.texture;
    this.cubePass = new FullscreenQuad(rawPass(CUBE_FRAG, {
      ...this.atmosphere.uniforms,
      uFace: { value: 0 }, uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor },
      uCloudCoverage: { value: 0 },
    }));
    this.camera = new THREE.Camera();   // unused by the fullscreen vertex shader

    this.background = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: BG_VERT, fragmentShader: BG_FRAG,
        uniforms: { uCube: { value: this.cube }, uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor } },
        side: THREE.BackSide, depthWrite: false,
      }),
    );
    this.background.frustumCulled = false;
    // drawn after the opaque scene at the far plane, so only visible sky pixels shade
    this.background.renderOrder = 1000;
  }

  update() {
    const p = this.params, r = this.renderer;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    // sun radiance factor at sea level: sunIntensity x transmittance (same integral as the LUT),
    // faded out as the disc sinks below the horizon
    const c = atmosphereCoefficients(p);
    const T = transmittance(c, OBSERVER_ALTITUDE, Math.max(this.sunDir.y, 0));
    const fade = THREE.MathUtils.smoothstep(p.elevation, -2, 2);
    this.sunColor.set(T[0], T[1], T[2]).multiplyScalar(p.sunIntensity * fade);

    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    this.atmosphere.update(r, c, this.sunDir.y, Math.PI * p.sunIntensity);
    const u = this.cubePass.material.uniforms;
    u.uCloudCoverage.value = p.cloudCoverage;
    // three builds the mip chain after a render into the cube, so only after the last face
    for (let f = 0; f < 6; f++) {
      u.uFace.value = f;
      this.cube.generateMipmaps = f === 5;
      r.setRenderTarget(this.cubeRT, f);
      r.render(this.cubePass.mesh, this.camera);
    }
    r.setRenderTarget(target, face, mip);
    this.cube.needsPMREMUpdate = true;
  }
}
