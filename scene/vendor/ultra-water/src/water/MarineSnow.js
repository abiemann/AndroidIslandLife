import * as THREE from 'three';

// Drifting particulate underwater: points in a box that wraps around the camera, so
// a fixed set always surrounds it. They write depth and alpha 1 like any opaque
// object, so the underwater pass fogs each by its own distance.
const BOX = 24;

const VERT = /* glsl */`
in vec3 aSeed;
uniform float uTime;
uniform vec3 uScatterColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uPx;      // pixels per metre at 1 m (projection scale)
out vec3 vCol;
void main() {
  // slow drift + wobble, wrapped into a box centred on the camera
  vec3 p = aSeed * ${BOX.toFixed(1)} + vec3(0.11, -0.03, 0.07) * uTime
         + 0.3 * sin(uTime * (0.3 + aSeed.yzx) + aSeed.zxy * 40.0);
  p = cameraPosition + mod(p - cameraPosition + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  float size = (0.004 + 0.01 * fract(aSeed.x * 91.7)) * uPx / max(-view.z, 0.1);
  gl_PointSize = clamp(size, 1.0, 6.0);
  vCol = uScatterColor * (uSunColor * max(uSunDir.y, 0.0) + 1.0) * 4.0 * (0.4 + fract(aSeed.y * 37.1));
  // too close to the lens: skip
  if (-view.z < 0.4 || p.y > 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
in vec3 vCol;
out vec4 fragColor;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  fragColor = vec4(vCol, 1.0);
}`;

export class MarineSnow {
  constructor(surface, count = 6000) {
    const seeds = new Float32Array(count * 3);
    let s = 3;
    for (let i = 0; i < seeds.length; i++) seeds[i] = (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    const u = surface.uniforms;
    this.uniforms = { uTime: u.uTime, uScatterColor: u.uScatterColor, uSunColor: u.uSunColor, uSunDir: u.uSunDir, uPx: { value: 1000 } };
    this.mesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  update(camera, height, visible) {
    this.mesh.visible = visible;
    this.uniforms.uPx.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
