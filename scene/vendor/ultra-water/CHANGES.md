# Vendored Ultra-Water

Source: https://github.com/Humpalumps/Ultra-Water

Pinned revision: `e58ddcdc18ea779b9386a2e5c76f2c6329c8bab9`.

MIT licensed; the original LICENSE is retained. The upstream `src` modules are copied here except the desktop demo `main.js`. Island Life supplies its own integration in `scene/src/main.js`, without the desktop GUI, benchmark, floating props or underwater camera.

Local changes:

- `water/OceanSim.js`: FFT 256→128, log size 8→7.
- `water/OceanSurface.js`: angular grid 384→192, final slope mip 8→7.
- `water/OceanSurface.js`: fade seabed transmission over 22–32m depth, before the upstream optimized mesh ends at 34m. This removes a visible boundary in clear tropical water.
- `scene/sky.js`: environment cube 1024→256.
- `scene/terrain.js`: terrain subdivisions 384→256.
- `scene/terrain.js`: place rocks near the app's inland tree positions, checking elevation and footprint slope to leave the beach clear. Original instanced rock geometry and shading are retained.
- `water/Caustics.js`: near/deep targets 512/256→256/128.

Other water simulation and shading behavior is retained. The integration separately caps render pixels, uses a 2048px static shadow map and 40% reflection targets, and chooses a supported multisample count of 2 or 4.
