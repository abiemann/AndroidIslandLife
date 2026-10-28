// Small seeded value-noise helpers for CPU-side terrain generation.

function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x, z, octaves = 5, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, z, seed + i * 17);
    norm += amp;
    // rotate each octave to hide the lattice
    const nx = 1.6 * x - 1.2 * z, nz = 1.2 * x + 1.6 * z;
    x = nx; z = nz; amp *= 0.5;
  }
  return sum / norm;
}

export function ridged(x, z, octaves = 5, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x, z, seed + i * 31));
    sum += amp * n * n;
    norm += amp;
    const nx = 1.6 * x - 1.2 * z, nz = 1.2 * x + 1.6 * z;
    x = nx; z = nz; amp *= 0.5;
  }
  return sum / norm;
}
