const SUNNY_SKY = { turbidity: 2, rayleigh: 1, sunIntensity: 9 };
const SKIES = {
  day: { ...SUNNY_SKY, elevation: 48, azimuth: 65, cloudCoverage: 0.28 },
  golden: { ...SUNNY_SKY, elevation: 14, azimuth: 235, cloudCoverage: 0.24 },
  storm: {
    elevation: 35,
    azimuth: 65,
    cloudCoverage: 1,
    turbidity: 8,
    rayleigh: 0.5,
    sunIntensity: 3.5,
  },
};

// Both presets reuse the same FFT cascades, render targets and materials. The
// spectrum changes only on a weather toggle; simulation time is never reset.
const WEATHER = {
  sun: {
    ocean: {
      windSpeed: 5,
      waveScale: 0.65,
      swellScale: 0.45,
      swellWindSpeed: 7,
      choppiness: 0.85,
      foamRecovery: 0.7,
      timeScale: 0.7,
    },
    absorption: [0.36, 0.045, 0.06],
    scatter: [0, 0.105, 0.135],
    foamTint: [0.66, 0.86, 0.84],
    foam: [0.05, 1.3, 0.35, 0.85],
    shore: [0.35, 30, 0.7, 0.75],
    optics: [0.02, 0.06, 0.04, 1 / 60000],
    glint: 0.32,
    post: { keyValue: 0.2, saturation: 1.25, contrast: 1.1, bloomStrength: 0.035 },
  },
  storm: {
    ocean: {
      windSpeed: 16,
      waveScale: 1.8,
      swellScale: 1,
      swellWindSpeed: 12,
      choppiness: 0.85,
      foamRecovery: 0.85,
      timeScale: 1,
    },
    absorption: [0.48, 0.11, 0.1],
    scatter: [0.025, 0.048, 0.06],
    foamTint: [0.5, 0.57, 0.59],
    foam: [0.05, 1.3, 0.45, 0.75],
    shore: [1.2, 38, 1, 0.8],
    optics: [0.06, 0.06, 0.055, 1 / 6500],
    glint: 0.12,
    // A darker exposure target keeps automatic exposure from cancelling the
    // overcast lighting. The island remains readable through the gray haze.
    post: { keyValue: 0.12, saturation: 0.65, contrast: 1.1, bloomStrength: 0.02 },
  },
};

export function skyForWeather(weather, lighting) {
  return SKIES[weather === 'storm' ? 'storm' : lighting];
}

export function applyWeather(weather, { ocean, water, terrain, post }) {
  const preset = WEATHER[weather];
  if (!preset) return false;
  Object.assign(ocean.params, preset.ocean);
  ocean.dirty = true;
  water.uAbsorption.value.fromArray(preset.absorption);
  water.uScatterColor.value.setRGB(...preset.scatter);
  water.uFoamTint.value.setRGB(...preset.foamTint);
  water.uFoam.value.fromArray(preset.foam);
  water.uShoreWave.value.fromArray(preset.shore);
  water.uOptics.value.fromArray(preset.optics);
  water.uGlint.value = preset.glint;
  terrain.uFogDensity.value = preset.optics[3];
  Object.assign(post.params, preset.post);
  return true;
}
