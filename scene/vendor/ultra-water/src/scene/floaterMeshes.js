import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural ocean floaters: one vertex-coloured mesh per kind, origin ~ centre of mass, +y up.
// Physics lives elsewhere; each builder only returns geometry + buoyancy metadata.
export const FLOATER_KINDS = ['crate', 'barrel', 'buoy', 'boat'];

const col = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colorAttr(n, colorAt) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = colorAt(i);
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  return new THREE.BufferAttribute(a, 3);
}

const paint = (geo, c) => geo.setAttribute('color', colorAttr(geo.attributes.position.count, () => c));
const box = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);

// volume of a revolved profile of (r, y) points (frustum sum)
function latheVolume(pts) {
  let v = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    v += Math.PI * Math.abs(b.y - a.y) * (a.x * a.x + a.x * b.x + b.x * b.x) / 3;
  }
  return v;
}

// signed volume + centroid x of a closed, non-indexed triangle soup
function solid(geo) {
  const p = geo.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0, cx = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const sx = a.x + b.x + c.x, dv = a.dot(b.cross(c)) / 6;
    vol += dv; cx += dv * sx / 4;
  }
  return { vol, cx: cx / vol };
}

function crate() {
  const rnd = rng(11), S = 0.9, h = S / 2, T = 0.09, o = h - T / 2;
  const inner = S - 2 * T, N = 5, pw = inner / N;
  // dark core shows through the plank seams
  const parts = [box(0.84, 0.84, 0.84, 0, 0, 0, col(0x2e2117))];
  for (let a = 0; a < 3; a++) for (const p of [-1, 1]) for (const q of [-1, 1]) { // 12 frame beams
    const d = [T, T, T], c = [0, 0, 0];
    d[a] = S; c[(a + 1) % 3] = p * o; c[(a + 2) % 3] = q * o;
    parts.push(box(...d, ...c, col(0x6e4d2f, 0.9 + 0.2 * rnd())));
  }
  for (let n = 0; n < 3; n++) for (const s of [-1, 1]) { // 6 faces x 5 planks
    const run = (n + 1) % 3, stack = (n + 2) % 3;
    for (let i = 0; i < N; i++) {
      const d = [0, 0, 0], c = [0, 0, 0];
      d[n] = 0.04; d[run] = inner + 0.06; d[stack] = pw - 0.008;
      c[n] = s * (h - 0.04); c[stack] = (i + 0.5 - N / 2) * pw;
      parts.push(box(...d, ...c, col(0xa87b4b, 0.85 + 0.3 * rnd())));
    }
  }
  const q = S / 4, samples = [];
  for (const x of [-q, q]) for (const y of [-q, q]) for (const z of [-q, q]) samples.push(new THREE.Vector3(x, y, z));
  return { geo: mergeGeometries(parts), rough: 0.85, metal: 0, volume: S ** 3, density: 550, samples, cellHeight: S / 2 };
}

function barrel() {
  const L = 0.95, Rm = 0.32, Re = 0.27, hoop = 0.012, SEG = 24;
  const bands = [[-0.44, -0.375], [-0.22, -0.17], [-0.035, 0.035], [0.17, 0.22], [0.375, 0.44]];
  const inHoop = (y) => bands.some(([a, b]) => y > a && y < b);
  // profile (r, y): parabolic bulge, hoops raised; paired points at band edges keep the steps crisp
  const ys = [];
  for (let i = 0; i <= 40; i++) ys.push(-L / 2 + L * i / 40);
  for (const [a, b] of bands) ys.push(a - 0.0015, a + 0.0015, b - 0.0015, b + 0.0015);
  ys.sort((a, b) => a - b);
  const pts = ys.map((y) => new THREE.Vector2(Re + (Rm - Re) * (1 - (2 * y / L) ** 2) + (inHoop(y) ? hoop : 0), y));

  const body = new THREE.LatheGeometry(pts, SEG); // vertex = radial * pts.length + profile
  const rnd = rng(5), stave = Array.from({ length: SEG }, () => 0.85 + 0.3 * rnd());
  const paintRed = col(0x8d3b2d), steel = col(0x2a2d32), pos = body.attributes.position;
  body.setAttribute('color', colorAttr(pos.count, (i) =>
    inHoop(pos.getY(i)) ? steel : paintRed.clone().multiplyScalar(stave[Math.floor(i / pts.length) % SEG])));
  body.rotateZ(Math.PI / 2); // axis -> local X

  const head = [col(0x9c7248), col(0x6f4e2f)]; // oak: lighter centre, darker rim
  const caps = [-1, 1].map((s) => {
    const g = new THREE.CircleGeometry(Re, SEG).rotateY(s * Math.PI / 2).translate(s * L / 2, 0, 0);
    return g.setAttribute('color', colorAttr(g.attributes.position.count, (i) => head[i ? 1 : 0]));
  });

  // 4 along the axis x 2 half-discs (centroid of a half disc is 4r/3pi ~ 0.14 off-axis)
  const samples = [];
  for (const x of [-3 * L / 8, -L / 8, L / 8, 3 * L / 8]) for (const y of [-0.14, 0.14]) samples.push(new THREE.Vector3(x, y, 0));
  return { geo: mergeGeometries([body, ...caps]), rough: 0.7, metal: 0.1, volume: latheVolume(pts), density: 420, samples, cellHeight: Rm };
}

function buoy() {
  const R = 0.5, rb = 0.1, off = 0.06, band = 0.11; // float radius, ballast stub radius, origin below float centre, half band height
  const y0 = Math.sqrt(R * R - rb * rb), th0 = Math.asin(y0 / R);
  const ys = [];
  for (let i = 0; i <= 40; i++) ys.push(R * Math.sin(-th0 + 2 * th0 * i / 40));
  for (const e of [-band, band]) ys.push(e - 0.003, e + 0.003);
  ys.sort((a, b) => a - b);
  const pts = [
    new THREE.Vector2(0, -0.8), new THREE.Vector2(rb, -0.8), // lead ballast stub
    ...ys.map((y) => new THREE.Vector2(Math.sqrt(R * R - y * y), y)),
    new THREE.Vector2(rb, 0.56), new THREE.Vector2(0, 0.56), // mast collar
  ];
  const red = col(0xc42a1e), white = col(0xe8e4d8), dark = col(0x2a2d32);
  const float = new THREE.LatheGeometry(pts, 28);
  const pos = float.attributes.position;
  float.setAttribute('color', colorAttr(pos.count, (i) => {
    const y = pos.getY(i);
    return y < -y0 + 1e-4 || y > y0 - 1e-4 ? dark : Math.abs(y) <= band ? white : red;
  }));

  const parts = [
    float,
    paint(new THREE.CylinderGeometry(0.022, 0.028, 0.45, 8).translate(0, 0.775, 0), col(0x7b8087)), // mast
    paint(new THREE.CylinderGeometry(0.1, 0.1, 0.016, 12).translate(0, 1.0, 0), dark), // cage floor
    paint(new THREE.ConeGeometry(0.1, 0.15, 12).translate(0, 1.225, 0), red), // topmark
  ];
  for (let i = 0; i < 4; i++) { // cage struts
    const a = Math.PI / 4 + i * Math.PI / 2;
    parts.push(paint(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 4).translate(0.085 * Math.cos(a), 1.083, 0.085 * Math.sin(a)), dark));
  }
  parts.forEach((g) => g.translate(0, off, 0));

  const k = 0.19, samples = []; // octant centroids of the float sphere (3R/8)
  for (const x of [-k, k]) for (const y of [-k, k]) for (const z of [-k, k]) samples.push(new THREE.Vector3(x, off + y, z));
  return { geo: mergeGeometries(parts), rough: 0.45, metal: 0.05, volume: latheVolume(pts), density: 300, samples, cellHeight: R };
}

function boat() {
  const L = 3.6, HW = 0.65, SX = 24, SY = 5, SZ = 8;
  // deformed segmented box: box coords (u, v, w) in [-0.5, 0.5] -> hull point (x along length, +x bow)
  const hull = (u, v, w, o) => {
    const t = u + 0.5, zn = Math.abs(2 * w), vv = v + 0.5;
    // plan: squarish transom at 0.62 beam, full beam at t=0.4, pointed bow
    const f = t < 0.4 ? 0.62 + 0.38 * Math.sin(t / 0.4 * Math.PI / 2) : Math.max(0.02, 1 - ((t - 0.4) / 0.6) ** 1.8);
    const sb = Math.max(0, (t - 0.3) / 0.7), ss = Math.max(0, (0.3 - t) / 0.3);
    const top = 0.4 + 0.22 * sb * sb + 0.05 * ss * ss; // sheer rises toward bow
    const keel = -0.2 + 0.2 * Math.max(0, (t - 0.5) / 0.5) ** 1.6 + 0.05 * (1 - t) ** 2; // rocker
    const bot = keel + 0.2 * zn ** 1.5; // rounded V
    return o.set(u * L, bot + (top - bot) * vv, 2 * w * HW * f * (0.8 + 0.2 * vv)); // flared topsides
  };

  const g = new THREE.BoxGeometry(1, 1, 1, SX, SY, SZ);
  const pos = g.attributes.position, idx = g.index, orig = pos.array.slice(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    hull(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2], p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();

  // flat colour per triangle: rows of the box give the paint scheme, deck columns give planks
  const rnd = rng(3);
  const under = col(0x1c3e44), stripe = col(0x2a8f8c), white = col(0xe9e6dc), trim = col(0x4a3020);
  const rows = [under, under, stripe, white, trim];
  const planks = Array.from({ length: SZ }, (_, k) => (k === 0 || k === SZ - 1 ? trim : col(0xb08655, 0.9 + 0.2 * rnd())));
  const tri = [];
  for (const { start, count, materialIndex: face } of g.groups) { // px nx py ny pz nz
    for (let i = start; i < start + count; i += 3) {
      let v = 0, w = 0;
      for (let k = 0; k < 3; k++) { const j = idx.getX(i + k); v += orig[j * 3 + 1]; w += orig[j * 3 + 2]; }
      v = v / 3 + 0.5; w = w / 3 + 0.5;
      tri[i / 3] = face === 3 ? under : face === 2 ? planks[Math.floor(w * SZ)] : rows[Math.floor(v * SY)];
    }
  }
  const hullGeo = g.toNonIndexed();
  hullGeo.setAttribute('color', colorAttr(hullGeo.attributes.position.count, (i) => tri[Math.floor(i / 3)]));
  const { vol, cx } = solid(hullGeo);

  const parts = [hullGeo];
  for (const u of [-0.1, 0.12]) { // two thwarts resting on the deck
    hull(u, 0.5, 0.5, p);
    parts.push(box(0.26, 0.045, p.z * 2 * 0.76, p.x, p.y + 0.0125, 0, col(0xb58a58)).toNonIndexed());
  }

  const samples = [];
  for (let i = 0; i < 4; i++) for (const v of [-0.25, 0.25]) for (const w of [-0.25, 0.25]) samples.push(hull((i + 0.5) / 4 - 0.5, v, w, new THREE.Vector3()));
  const geo = mergeGeometries(parts).translate(-cx, 0, 0); // COM (along length) at origin
  samples.forEach((s) => s.x -= cx);
  return { geo, rough: 0.55, metal: 0, volume: vol, density: 280, samples, cellHeight: 0.3 };
}

const BUILDERS = { crate, barrel, buoy, boat };

export function makeFloater(kind, patchMaterial) {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`unknown floater kind: ${kind}`);
  const { geo, rough, metal, ...meta } = build();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
  patchMaterial(material);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `floater-${kind}`;
  mesh.castShadow = false;  // floaters have their own shadow map (floaterShadow.js)
  mesh.receiveShadow = true;
  mesh.layers.enable(1); // planar reflection layer
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  return { kind, object: mesh, size, volume: meta.volume, density: meta.density, samples: meta.samples, cellHeight: meta.cellHeight };
}
