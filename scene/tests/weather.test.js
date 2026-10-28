import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, Vector3, Vector4 } from 'three';
import { applyWeather, skyForWeather } from '../src/weather.js';
import { defaultOceanParams } from '../vendor/ultra-water/src/water/OceanSim.js';

function scene() {
  return {
    ocean: { params: defaultOceanParams(), dirty: false, time: 42.5, parity: 1 },
    water: {
      uAbsorption: { value: new Vector3() },
      uScatterColor: { value: new Color() },
      uFoamTint: { value: new Color() },
      uFoam: { value: new Vector4() },
      uShoreWave: { value: new Vector4() },
      uOptics: { value: new Vector4() },
      uGlint: { value: 0 },
    },
    terrain: { uFogDensity: { value: 0 } },
    post: { params: { droplets: 0 } },
  };
}

test('storm increases waves and overcast contrast without resetting simulation or replacing uniforms', () => {
  const value = scene();
  applyWeather('sun', value);
  const calm = structuredClone(value.ocean.params);
  const calmShore = value.water.uShoreWave.value.x;
  const calmExposure = value.post.params.keyValue;
  const uniforms = Object.values(value.water).map((uniform) => uniform.value);
  value.ocean.dirty = false;
  assert.equal(applyWeather('storm', value), true);
  for (const parameter of ['windSpeed', 'waveScale', 'swellScale', 'swellWindSpeed']) {
    assert.ok(value.ocean.params[parameter] > calm[parameter], `${parameter} rises in a storm`);
  }
  assert.ok(value.water.uShoreWave.value.x > calmShore);
  assert.ok(value.post.params.keyValue < calmExposure);
  assert.equal(value.ocean.dirty, true);
  assert.equal(value.ocean.time, 42.5);
  assert.equal(value.ocean.parity, 1);
  assert.equal(value.post.params.droplets, 0);
  Object.values(value.water).forEach((uniform, index) => {
    if (typeof uniform.value === 'object') assert.equal(uniform.value, uniforms[index]);
  });
});

test('returning to Sun restores all wave, water, fog and exposure settings', () => {
  const value = scene();
  applyWeather('sun', value);
  const calm = JSON.stringify(value);
  applyWeather('storm', value);
  applyWeather('sun', value);
  assert.equal(JSON.stringify(value), calm);
  value.ocean.dirty = false;
  const unchanged = JSON.stringify(value);
  assert.equal(applyWeather('rainbow', value), false);
  assert.equal(JSON.stringify(value), unchanged);
});

test('storm overrides both lighting choices while Sun restores the selected sky', () => {
  assert.equal(skyForWeather('storm', 'day'), skyForWeather('storm', 'golden'));
  assert.notEqual(skyForWeather('sun', 'day'), skyForWeather('sun', 'golden'));
  assert.ok(skyForWeather('sun', 'golden').elevation < skyForWeather('sun', 'day').elevation);
  assert.ok(
    skyForWeather('storm', 'day').cloudCoverage > skyForWeather('sun', 'day').cloudCoverage,
  );
  assert.ok(skyForWeather('storm', 'day').sunIntensity < skyForWeather('sun', 'day').sunIntensity);
});
