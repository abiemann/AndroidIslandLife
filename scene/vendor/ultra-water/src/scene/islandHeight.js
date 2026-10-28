import { fbm, ridged } from './noise.js';

// Island footprint in world units (metres). Terrain mesh and the shore heightmap share it.
export const ISLAND_SIZE = 2400;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Height above sea level (y = 0). Coastline sits around r ~ 330 m, seabed falls to -42 m.
export function islandHeight(x, z) {
  const warp = fbm(x * 0.0035 + 11.3, z * 0.0035 - 4.1, 4, 3);
  const r = Math.hypot(x - 40 * warp, z + 30 * warp) * (1 + 0.32 * fbm(x * 0.003, z * 0.003, 3, 7));

  let h = 62 * Math.exp(-((r / 190) ** 2)) + 15 * Math.exp(-((r / 430) ** 2)) - 10;
  h -= 32 * smooth(380, 1100, r);

  // rocky ridges only on the mountain
  const mountain = smooth(4, 40, h);
  h += mountain * 26 * (ridged(x * 0.009, z * 0.009, 5, 1) - 0.45);

  // gentle beaches above the waterline, shallow turquoise shelf below it
  if (h > 0 && h < 5) h *= 0.55 + 0.09 * h;
  else if (h <= 0 && h > -14) h = -14 * Math.pow(-h / 14, 1.8);

  h += 1.2 * fbm(x * 0.05, z * 0.05, 3, 9) * smooth(-30, 2, h);
  return h;
}
