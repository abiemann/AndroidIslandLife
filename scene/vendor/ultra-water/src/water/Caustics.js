import * as THREE from 'three';
import { N, CASCADE_LENGTHS } from './OceanSim.js';
import { rawPass } from '../engine/fullscreen.js';

// Wave-driven caustics by area-ratio splatting (Evan Wallace's WebGL water): a grid over
// the 12 m cascade's period is refracted through its slopes onto planes at three depths,
// and every landed triangle adds (undisturbed area / landed area) to that depth's channel.
// Output, mipmapped + repeat, tiling every 12 m: intensity relative to flat water at the
// slice depths, mean 1 by construction (the mesh is watertight, so the splatted energy is
// the tile area), so it multiplies direct sun light. Two targets, sized by the sun-disc
// blur at each depth (~0.7% of the depth): near R16F 512² (2.3 cm) with 1.5 m, deep
// RG16F 256² with 4 m and 10 m.
// The landing offset of flat water is subtracted, registering the pattern to the surface
// entry point: look up at uv = entryXZ / 12 (see CAUSTICS_GLSL).

const L = CASCADE_LENGTHS[2];
const ETA = 1 / 1.33;
const MAX_RATIO = 16;  // firefly clamp (calibration knob; energy above it is dropped)
// Fold slivers are far thinner than a texel: point-sampled they hit texel centres only
// now and then and the lines break into dots, so both targets are MSAA (each sliver adds
// by coverage).
const TARGETS = [
  { res: 256, format: THREE.RedFormat },
  { res: 128, format: THREE.RGFormat },
];
// Per slice: target + channel, grid cells per tile, and a margin of cells beyond each
// tile edge that must cover the largest landing offset (wrap-around, instead of drawing
// 3×3 tiles). The cost goes with cells × target res (sliver quad overshading), and the
// B-spline slopes keep coarse grids smooth. Deeper slices are focused by longer waves,
// so they take coarser slope mips.
const SLICES = [
  { depth: 1.5, target: 0, channel: 0, cells: 128, margin: 6 },  // 0.38 m
  { depth: 4, target: 1, channel: 0, cells: 64, margin: 7 },     // 0.94 m
  { depth: 10, target: 1, channel: 1, cells: 32, margin: 8 },    // 2.25 m
];
const f = (x) => x.toPrecision(9);   // GLSL float literal
const [D0, D1, D2] = SLICES.map((s) => f(s.depth));

const VERT = /* glsl */`
precision highp float;
in vec3 position;               // PlaneGeometry vertex: cell coords - uCells / 2
uniform highp sampler2D uSlope; // cascade 2 (sx, sz, ...)
uniform vec3 uSun;              // towards the sun
uniform float uDepth, uCells, uLod, uMargin, uRes;
out vec2 vOld;

// cubic B-spline from 4 bilinear taps (GPU Gems 2, ch. 20). The landed intensity goes
// with the slope's derivative, which bilinear makes piecewise constant: every slope texel
// would land as its own bead along the caustic lines.
vec2 slopeBSpline(vec2 uv, float lod) {
  vec2 size = vec2(textureSize(uSlope, int(lod)));
  vec2 st = uv * size - 0.5, i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size, h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureLod(uSlope, h0, lod).xy + g1.x * textureLod(uSlope, vec2(h1.x, h0.y), lod).xy)
       + g1.y * (g0.x * textureLod(uSlope, vec2(h0.x, h1.y), lod).xy + g1.x * textureLod(uSlope, h1, lod).xy);
}

void main() {
  vec2 t = (position.xy + 0.5 * uCells + 0.5) / uCells;   // tile uv, at a texel centre of mip uLod
  vec2 s = slopeBSpline(t, uLod);
  vec3 r = refract(-uSun, normalize(vec3(-s.x, 1.0, -s.y)), ${f(ETA)});
  vec3 rf = refract(-uSun, vec3(0.0, 1.0, 0.0), ${f(ETA)});
  vec2 d = (r.xz / max(-r.y, 0.05) - rf.xz / -rf.y) * (uDepth / ${f(L)});
  // ponytail: offsets past the margin (steep facets at low sun) are clamped, widen the margin if it shows
  d = clamp(d, -uMargin, uMargin);
  vOld = t * uRes;
  gl_Position = vec4((t + d) * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uMask;
in vec2 vOld;
out vec4 outColor;

void main() {
  // raster space is the landed space at one texel per pixel, so the landed area is 1 and
  // the ratio is the undisturbed area (in texels) per pixel
  vec2 a = dFdx(vOld), b = dFdy(vOld);
  outColor = vec4(uMask * min(abs(a.x * b.y - a.y * b.x), ${f(MAX_RATIO)}), 0.0);
}`;

// waveCaustic(entryXZ, depth, lod) -> direct-sun multiplier, mean ~1 (uniforms from
// WaveCaustics.uniforms).
// entryXZ: world xz (m) where the flat-water refracted sun ray through the shaded point
//   crosses the surface: P.xz + rs.xz / rs.y * depth, rs = refract(-sunDir, up, 1/1.33).
// depth: metres below the surface (<= 0 gives 1.0). lod: extra mip blur in near texels,
//   e.g. log2(footprint (m) * CAUSTIC_TEXELS_PER_M).
export const CAUSTICS_GLSL = /* glsl */`
uniform sampler2D uCaustics, uCausticsDeep;
const float CAUSTIC_TEXELS_PER_M = ${f(TARGETS[0].res / L)};
float waveCaustic(vec2 entryXZ, float depth, float lod) {
  vec2 uv = entryXZ * ${f(1 / L)};
  float v = textureLod(uCaustics, uv, lod).r;
  if (depth > ${D0}) {
    // deep texels are 2x the near ones; past the deepest slice keep it, one mip blurrier
    // per doubling of depth
    vec2 d = textureLod(uCausticsDeep, uv, max(lod - 1.0, 0.0) + log2(max(depth / ${D2}, 1.0))).rg;
    v = depth < ${D1} ? mix(v, d.r, (depth - ${D0}) / (${D1} - ${D0}))
                      : mix(d.r, d.g, clamp((depth - ${D1}) / (${D2} - ${D1}), 0.0, 1.0));
  }
  return mix(1.0, v, clamp(depth / ${D0}, 0.0, 1.0));   // no caustic at zero depth
}
`;

const _color = new THREE.Color();

export class WaveCaustics {
  constructor(renderer, sim) {
    this.renderer = renderer;
    this.sim = sim;
    this.targets = TARGETS.map(({ res, format }) => new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType, format, samples: 4, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, depthBuffer: false,
    }));
    this.uniforms = { uCaustics: { value: this.targets[0].texture }, uCausticsDeep: { value: this.targets[1].texture } };
    this.slope = { value: null };
    this.sun = { value: new THREE.Vector3() };
    this.scenes = TARGETS.map(() => new THREE.Group());
    SLICES.forEach(({ depth, target, channel, cells, margin }) => {
      const mat = rawPass(FRAG, {
        uSlope: this.slope, uSun: this.sun, uRes: { value: TARGETS[target].res },
        uDepth: { value: depth }, uCells: { value: cells }, uLod: { value: Math.max(0, Math.log2(N / cells)) },
        uMargin: { value: (margin - 1) / cells }, uMask: { value: new THREE.Vector3().setComponent(channel, 1) },
      }, {
        vertexShader: VERT, side: THREE.DoubleSide,   // folds past the focus land flipped
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      });
      const span = cells + 2 * margin;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span, span, span, span), mat);
      mesh.frustumCulled = false;
      this.scenes[target].add(mesh);
    });
    this.camera = new THREE.Camera();
    this.flat = false;
    this.update(new THREE.Vector3(0, -1, 0));   // start at a flat 1.0
  }

  // once per frame, after sim.update(); sunDir points towards the sun
  update(sunDir) {
    const up = sunDir.y > 0;
    if (!up && this.flat) return;
    this.flat = !up;
    const r = this.renderer;
    const prevRT = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(_color);
    this.sun.value.copy(sunDir).normalize();
    this.slope.value = this.sim.slope[2];
    r.setClearColor(up ? 0x000000 : 0xffffff, 1);
    this.targets.forEach((rt, i) => {
      this.scenes[i].visible = up;   // hidden still renders: render() rebuilds the mips of the clear
      r.setRenderTarget(rt);
      r.clear(true, false, false);
      r.render(this.scenes[i], this.camera);
    });
    r.setRenderTarget(prevRT, face, mip);
    r.setClearColor(_color, prevAlpha);
  }
}
