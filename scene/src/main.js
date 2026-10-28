import * as THREE from 'three';
import { IslandControls } from './IslandControls.js';
import { CAMERA } from './cameraConfig.js';
import { FrameLoop } from './FrameLoop.js';
import { OceanSim, defaultOceanParams } from '../vendor/ultra-water/src/water/OceanSim.js';
import { OceanSurface } from '../vendor/ultra-water/src/water/OceanSurface.js';
import { bakeShoreMap } from '../vendor/ultra-water/src/water/shoreMap.js';
import { bakeWaterTextures } from '../vendor/ultra-water/src/water/bakeTextures.js';
import { WaveCaustics } from '../vendor/ultra-water/src/water/Caustics.js';
import { SkySystem } from '../vendor/ultra-water/src/scene/sky.js';
import { createTerrain } from '../vendor/ultra-water/src/scene/terrain.js';
import { islandHeight } from '../vendor/ultra-water/src/scene/islandHeight.js';
import { FloaterShadow } from '../vendor/ultra-water/src/scene/floaterShadow.js';
import { PlanarReflection } from '../vendor/ultra-water/src/engine/PlanarReflection.js';
import { PostFX } from '../vendor/ultra-water/src/engine/PostFX.js';
import { createGrove } from './grove.js';
import { createCanopyClearance } from './canopyClearance.js';
import { applyWeather, skyForWeather } from './weather.js';

const status = document.getElementById('status');
let loop,
  failed = false;
function fail(error) {
  if (failed) return;
  failed = true;
  loop?.stop();
  console.error(error);
  const message =
    'The sea could not start on this device. Please update Android System WebView and try again.';
  status.textContent = message;
  status.hidden = false;
  window.IslandAndroid?.failed(message);
}
window.addEventListener('error', (event) => fail(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => fail(event.reason));

function start() {
  if (failed) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute(
    'aria-label',
    'A green tropical island surrounded by gently moving turquoise sea. Drag one finger to pan. Twist two fingers to turn the island, drag both fingers up or down to tilt, and pinch to zoom.',
  );
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
  });
  if (
    !gl ||
    !gl.getExtension('EXT_color_buffer_float') ||
    !gl.getExtension('OES_texture_float_linear')
  ) {
    throw new Error(
      'Ultra-Water requires WebGL2 and renderable, filterable floating-point textures.',
    );
  }
  const sampleCounts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  const samples = [...sampleCounts].filter((n) => n >= 2 && n <= 4).sort((a, b) => a - b)[0];
  if (!samples) throw new Error('Multisampled RGBA16F is unavailable.');

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.debug.onShaderError = () => fail(new Error('A scene shader could not compile.'));
  document.body.prepend(canvas);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    fail(new Error('WebGL context lost.'));
  });

  // Preserve shoreline depth precision on mobile depth buffers.
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  const controls = new IslandControls(camera, canvas);
  controls.enablePan = true;
  // Pan along the ground plane so moving the view cannot lower the camera
  // into terrain. Two fingers combine twist, vertical tilt and pinch zoom.
  controls.screenSpacePanning = false;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.minPolarAngle = CAMERA.minPolarAngle;
  // The closest viewing angle is 22.95° above horizontal.
  controls.maxPolarAngle = CAMERA.maxPolarAngle;
  controls.rotateSpeed = CAMERA.rotateSpeed;
  controls.zoomSpeed = CAMERA.zoomSpeed;
  controls.target.set(0, CAMERA.targetY, 0);
  const sky = new SkySystem(renderer);
  const shore = bakeShoreMap(islandHeight, 1800, 512);
  const textures = bakeWaterTextures(renderer);
  const ocean = new OceanSim(renderer, defaultOceanParams());
  const caustics = new WaveCaustics(renderer, ocean);
  const floatShadow = new FloaterShadow(1);
  floatShadow.clear(renderer);
  const surface = new OceanSurface(ocean, shore, sky, floatShadow.uniforms);
  const u = surface.uniforms;
  u.uFoamTex.value = textures.foam;

  const scene = new THREE.Scene();
  scene.environment = sky.cube;
  scene.add(sky.background);
  const grove = createGrove(1);
  const clearCanopy = createCanopyClearance(grove.canopies, CAMERA.targetY);
  const terrain = createTerrain({
    sky,
    caustics: caustics.uniforms,
    floatShadow: floatShadow.uniforms,
    water: u,
    absorption: u.uAbsorption.value,
    reflectionLayer: 1,
    rockAnchors: grove.treePositions,
  });
  scene.add(terrain.group, grove.group);
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -650,
    right: 650,
    top: 650,
    bottom: -650,
    near: 10,
    far: 5000,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  u.uShadowMatrix.value = terrain.uniforms.uSunShadowMatrix.value = sun.shadow.matrix;
  u.uShadowBias.value = 0.05 / (sun.shadow.camera.far - sun.shadow.camera.near);
  const waterScene = new THREE.Scene();
  waterScene.add(surface.mesh);
  const reflection = new PlanarReflection(1);
  reflection.scale = 0.4;
  u.uReflMatrix.value = reflection.textureMatrix;
  u.uReflection.value = reflection.target.texture;
  const post = new PostFX(renderer);
  const weatherScene = { ocean, water: u, terrain: terrain.uniforms, post };
  applyWeather('sun', weatherScene);
  const size = new THREE.Vector2();
  let hdr,
    elapsed = 0,
    requestedActive = true;
  let lighting = 'day',
    weather = 'sun',
    sunDirty = true;

  function frameDistance() {
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    return (440 / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.06;
  }
  function resetView() {
    controls.target.set(0, CAMERA.targetY, 0);
    const distance = frameDistance();
    camera.position.set(0.48, 0.66, 0.58).normalize().multiplyScalar(distance).add(controls.target);
    // Keep close-up zoom consistent in portrait and landscape.
    controls.minDistance = CAMERA.minDistance;
    controls.maxDistance = distance * 1.5;
    controls.update();
    cameraChanged();
  }
  function resize() {
    const width = window.innerWidth,
      height = window.innerHeight;
    // Limit total fill rate as well as device scale on dense phone displays.
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5, Math.sqrt(1100000 / (width * height))));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    hdr?.dispose();
    // Keep the upstream MSAA opaque→water pipeline: sampling its resolved textures is
    // safe while drawing to its separate multisample renderbuffer. samples=0 is invalid.
    hdr = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
      generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
    });
    u.uSceneColor.value = hdr.texture;
    u.uSceneDepth.value = hdr.depthTexture;
    u.uResolution.value.copy(size);
    reflection.setSize(size.x, size.y);
    post.setSize(size.x, size.y);
    resetView();
  }
  function applySun() {
    Object.assign(sky.params, skyForWeather(weather, lighting));
    sky.update();
    sun.position.copy(sky.sunDir).multiplyScalar(2000);
    sun.color
      .setRGB(sky.sunColor.x, sky.sunColor.y, sky.sunColor.z)
      .multiplyScalar(1 / Math.max(sky.sunColor.x, 1e-4));
    sun.intensity = Math.PI * Math.max(sky.sunColor.x, 1e-4);
    renderer.shadowMap.needsUpdate = true;
    sunDirty = false;
  }
  function render(dt) {
    elapsed += dt;
    if (sunDirty) applySun();
    ocean.update(dt);
    caustics.update(sky.sunDir);
    surface.update(camera, elapsed % 3600);
    reflection.render(renderer, scene, camera);
    renderer.setRenderTarget(hdr);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    u.uShadowMap.value = sun.shadow.map.depthTexture;
    hdr.resolveDepthBuffer = false;
    renderer.render(waterScene, camera);
    hdr.resolveDepthBuffer = true;
    post.render(hdr.texture, dt || 1 / 30);
  }
  function drawSoon() {
    loop.requestDraw();
  }
  function cameraChanged() {
    clearCanopy(camera, controls.target);
    camera.updateMatrixWorld();
    drawSoon();
  }
  function updateActivity() {
    loop.setActive(requestedActive && !document.hidden);
  }
  function setActive(value) {
    requestedActive = Boolean(value);
    updateActivity();
  }
  loop = new FrameLoop({
    render,
    onFps: (value) => window.IslandAndroid?.fps(value),
    onError: fail,
  });
  window.island = {
    setPaused(value) {
      loop.setPaused(value);
    },
    setFrameRateLimit(value) {
      loop.setFrameRateLimit(value);
    },
    setLighting(value) {
      if (value !== lighting && ['day', 'golden'].includes(value)) {
        lighting = value;
        if (weather === 'sun') {
          sunDirty = true;
          drawSoon();
        }
      }
    },
    setWeather(value) {
      if (value !== weather && ['sun', 'storm'].includes(value)) {
        weather = value;
        applyWeather(weather, weatherScene);
        sunDirty = true;
        drawSoon();
      }
    },
    resetView,
    setActive,
    // Compact read-only state for smoke checks; no native capabilities are exposed.
    getState: () => ({
      paused: loop.paused,
      active: loop.active,
      lighting,
      weather,
      waves: {
        windSpeed: ocean.params.windSpeed,
        waveScale: ocean.params.waveScale,
        swellScale: ocean.params.swellScale,
        swellWindSpeed: ocean.params.swellWindSpeed,
        choppiness: ocean.params.choppiness,
        timeScale: ocean.params.timeScale,
        shoreAmplitude: u.uShoreWave.value.x,
      },
      elapsed,
      fps: loop.fps,
      frameRateLimit: loop.frameRateLimit,
      width: size.x,
      height: size.y,
      target: controls.target.toArray(),
      camera: camera.position.toArray(),
      failed,
    }),
  };
  controls.addEventListener('change', cameraChanged);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', updateActivity);
  resize();
  render(1 / 30);
  if (failed) return;
  status.hidden = true;
  window.IslandAndroid?.ready();
  updateActivity();
}
// Let the loading state paint before the one-time terrain and shore baking.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      start();
    } catch (error) {
      fail(error);
    }
  }, 0),
);
