import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector2, TOUCH } from 'three';
import { IslandControls } from '../src/IslandControls.js';
import { CAMERA } from '../src/cameraConfig.js';

const radians = (degrees) => (degrees * Math.PI) / 180;
const height = 914;
const center = { x: 205, y: 457 };

function near(actual, expected, label, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function createControls({ polar = 48, distance = 1000 } = {}) {
  const camera = new PerspectiveCamera(CAMERA.fov, 411 / height, CAMERA.near, CAMERA.far);
  camera.position.setFromSphericalCoords(distance, radians(polar), 0);
  camera.position.y += CAMERA.targetY;
  const controls = new IslandControls(camera);
  // No DOM listeners are needed: exercise the same tracked-pointer hooks that
  // OrbitControls dispatches, followed by its normal per-event update.
  controls.domElement = { clientHeight: height };
  controls.target.set(0, CAMERA.targetY, 0);
  controls.minPolarAngle = CAMERA.minPolarAngle;
  controls.maxPolarAngle = CAMERA.maxPolarAngle;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = 4000;
  controls.rotateSpeed = CAMERA.rotateSpeed;
  controls.zoomSpeed = CAMERA.zoomSpeed;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.update();
  return controls;
}

function pair({ angle = 0, separation = 200, x = center.x, y = center.y } = {}) {
  const dx = (Math.cos(radians(angle)) * separation) / 2;
  const dy = (Math.sin(radians(angle)) * separation) / 2;
  return [new Vector2(x - dx, y - dy), new Vector2(x + dx, y + dy)];
}

function eventFor(controls, index, position) {
  return { pointerId: controls._pointers[index], pageX: position.x, pageY: position.y };
}

function startGesture(controls, options) {
  // Deliberately not sorted: bearing must follow consistent pointer identity,
  // independent of which finger delivers the current event.
  controls._pointers = [42, 7];
  controls._pointerPositions = {};
  const positions = pair(options);
  for (let i = 0; i < 2; i++) controls._trackPointer(eventFor(controls, i, positions[i]));
  controls._handleTouchStartDollyRotate(eventFor(controls, 1, positions[1]));
}

function movePair(controls, options, order = [0, 1]) {
  const positions = pair(options);
  for (const index of order) {
    const event = eventFor(controls, index, positions[index]);
    controls._trackPointer(event);
    controls._handleTouchMoveDollyRotate(event);
    controls.update();
  }
}

for (const degrees of [45, -45]) {
  test(`${degrees > 0 ? 'clockwise' : 'counterclockwise'} twist rotates the island with the fingers`, () => {
    const controls = createControls();
    startGesture(controls);
    for (let step = 1; step <= 15; step++) movePair(controls, { angle: (degrees * step) / 15 });
    // Positive camera azimuth makes world landmarks turn clockwise on screen.
    near(controls.getAzimuthalAngle(), radians(degrees), 'bearing');
    near(controls.getPolarAngle(), radians(48), 'tilt');
    near(controls.getDistance(), 1000, 'distance');
    assert.deepEqual(controls.target.toArray(), [0, CAMERA.targetY, 0]);
  });
}

for (const [start, end, delta] of [
  [179, 181, 2],
  [-179, -181, -2],
]) {
  test(`twist crosses ${start} degrees without a full-turn jump`, () => {
    const controls = createControls();
    startGesture(controls, { angle: start });
    movePair(controls, { angle: end }, [1, 0]);
    near(controls.getAzimuthalAngle(), radians(delta), 'wrapped bearing');
    near(controls.getPolarAngle(), radians(48), 'tilt');
    near(controls.getDistance(), 1000, 'distance');
  });
}

for (const polar of [CAMERA.minPolarAngle, CAMERA.maxPolarAngle].map(
  (angle) => (angle * 180) / Math.PI,
)) {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    test(`pure twist preserves tilt ${polar} and minimum distance with pointer order ${order}`, () => {
      const controls = createControls({ polar, distance: CAMERA.minDistance });
      startGesture(controls);
      for (let angle = 3; angle <= 90; angle += 3) {
        movePair(controls, { angle }, order);
        near(controls.getPolarAngle(), radians(polar), 'tilt after both finger events');
        near(
          controls.getDistance(),
          CAMERA.minDistance,
          'minimum distance after both finger events',
        );
      }
      near(controls.getAzimuthalAngle(), Math.PI / 2, 'bearing');
    });
  }
}

test('pinch respects the configured close limit and can zoom back out', () => {
  const controls = createControls({ distance: CAMERA.minDistance * 1.3 });
  startGesture(controls);
  for (let separation = 220; separation <= 400; separation += 20) {
    movePair(controls, { separation });
    assert.ok(controls.getDistance() >= CAMERA.minDistance - 1e-8);
  }
  near(controls.getDistance(), CAMERA.minDistance, 'clamped distance');
  movePair(controls, { separation: 200 }, [1, 0]);
  near(controls.getDistance(), CAMERA.minDistance * 2 ** CAMERA.zoomSpeed, 'zoomed-out distance');
  near(controls.getAzimuthalAngle(), 0, 'bearing');
  near(controls.getPolarAngle(), radians(48), 'tilt');
});

test('combined twist, vertical drag, and pinch preserve independent gesture effects', () => {
  const controls = createControls();
  startGesture(controls);
  for (let step = 1; step <= 15; step++) {
    const fraction = step / 15;
    movePair(
      controls,
      {
        angle: 30 * fraction,
        separation: 200 + 100 * fraction,
        y: center.y + 30 * fraction,
      },
      step % 2 ? [0, 1] : [1, 0],
    );
  }
  near(controls.getAzimuthalAngle(), radians(30), 'bearing');
  near(
    controls.getPolarAngle(),
    radians(48) - ((2 * Math.PI * 30) / height) * CAMERA.rotateSpeed,
    'tilt',
  );
  near(controls.getDistance(), 1000 / 1.5 ** CAMERA.zoomSpeed, 'pinch distance');
  assert.deepEqual(controls.target.toArray(), [0, CAMERA.targetY, 0]);
});

test('vertical drag returns to its starting tilt after reaching either tilt limit', () => {
  const controls = createControls();
  const travel =
    (Math.max(radians(48) - CAMERA.minPolarAngle, CAMERA.maxPolarAngle - radians(48)) * height) /
      (2 * Math.PI * CAMERA.rotateSpeed) +
    20;
  startGesture(controls);
  movePair(controls, { y: center.y + travel });
  near(controls.getPolarAngle(), CAMERA.minPolarAngle, 'upper limit');
  movePair(controls, { y: center.y });
  near(controls.getPolarAngle(), radians(48), 'restored tilt');
  movePair(controls, { y: center.y - travel }, [1, 0]);
  near(controls.getPolarAngle(), CAMERA.maxPolarAngle, 'lower limit');
  movePair(controls, { y: center.y }, [1, 0]);
  near(controls.getPolarAngle(), radians(48), 'restored tilt');
  near(controls.getAzimuthalAngle(), 0, 'bearing');
});

test('closest low-angle view can pan at water level without raising the camera', () => {
  const polar = (CAMERA.maxPolarAngle * 180) / Math.PI;
  const controls = createControls({ polar, distance: CAMERA.minDistance * 1.3 });
  startGesture(controls);
  movePair(controls, { separation: 400 });
  near(controls.getDistance(), 5, 'Water inspection distance');
  near(controls.target.y, 0, 'Focus remains at sea level');
  assert.ok(controls.object.position.y > 0 && controls.object.position.y < 0.1);

  const eyeHeight = controls.object.position.y;
  controls.object.updateMatrixWorld();
  controls._pointers = [1];
  controls._pointerPositions = {};
  const pointer = (x, y) => ({ pointerId: 1, pageX: x, pageY: y });
  controls._trackPointer(pointer(center.x, center.y));
  controls._handleTouchStartPan(pointer(center.x, center.y));
  controls._trackPointer(pointer(center.x + 80, center.y + 40));
  controls._handleTouchMovePan(pointer(center.x + 80, center.y + 40));
  controls.update();
  assert.ok(Math.hypot(controls.target.x, controls.target.z) > 0.1, 'Close pan moves the focus');
  near(controls.target.y, 0, 'Panning does not lift the focus');
  near(controls.object.position.y, eyeHeight, 'Panning does not lift the camera');
  near(controls.getDistance(), 5, 'Panning preserves close zoom');
  near(controls.getPolarAngle(), CAMERA.maxPolarAngle, 'Panning preserves water-level tilt');
});

for (const cancelled of [false, true]) {
  test(`two-finger gestures resume after a third finger ${cancelled ? 'is cancelled' : 'lifts'}`, () => {
    const controls = createControls();
    controls.domElement = {
      clientHeight: height,
      style: {},
      setPointerCapture() {},
      releasePointerCapture() {},
      ownerDocument: { addEventListener() {}, removeEventListener() {} },
    };
    controls.touches.ONE = TOUCH.PAN;
    controls.touches.TWO = TOUCH.DOLLY_ROTATE;
    const pointer = (id, x, y) => ({ pointerId: id, pointerType: 'touch', pageX: x, pageY: y });
    controls._onPointerDown(pointer(1, 100, 400));
    controls._onPointerDown(pointer(2, 300, 400));
    controls._onPointerDown(pointer(3, 200, 600));
    // OrbitControls binds pointercancel and pointerup to this same dispatcher.
    controls._onPointerUp({
      ...pointer(3, 200, 600),
      type: cancelled ? 'pointercancel' : 'pointerup',
    });
    controls._onPointerMove(pointer(1, 100, 350));
    controls._onPointerMove(pointer(2, 300, 450));
    near(controls.getAzimuthalAngle(), Math.atan2(100, 200), 'resumed bearing');
    near(controls.getPolarAngle(), radians(48), 'tilt');
  });
}
