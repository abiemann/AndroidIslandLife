import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../src/cameraConfig.js';
import { createCanopyClearance } from '../src/canopyClearance.js';
import { createGrove } from '../src/grove.js';

function view({
  aspect = 411 / 914,
  x = 0,
  z = 0,
  bearing = 0,
  distance = CAMERA.minDistance,
} = {}) {
  const camera = new PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  const target = new Vector3(x, CAMERA.targetY, z);
  camera.position.setFromSphericalCoords(distance, CAMERA.maxPolarAngle, bearing).add(target);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { camera, target };
}
function obstacle(x, y, z) {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), undefined, 1);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(x, y, z));
  return mesh;
}
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}
function lowestNear(camera) {
  camera.updateMatrixWorld();
  let lowest = camera.position.y;
  const point = new Vector3();
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      lowest = Math.min(lowest, point.set(x, y, -1).unproject(camera).y);
    }
  return lowest;
}

test('local correction clears an obstacle while preserving the orbit and horizontal pan', () => {
  const { camera, target } = view();
  const offset = camera.position.clone().sub(target);
  const before = camera.position.clone();
  const clear = createCanopyClearance(obstacle(0, 85, 150), CAMERA.targetY);
  const lift = clear(camera, target);
  assert.ok(lift > 0);
  near(lowestNear(camera), 87, 'One metre above the obstacle top');
  near(camera.position.clone().sub(target).distanceTo(offset), 0, 'Orbit vector preserved');
  near(camera.position.x, before.x, 'Eye X unchanged');
  near(camera.position.z, before.z, 'Eye Z unchanged');
  assert.deepEqual([target.x, target.z], [0, 0]);
  for (let repeat = 0; repeat < 20; repeat++)
    near(clear(camera, target), lift, 'No cumulative lift');
});

test('the current landscape near-plane width protects obstacles outside the portrait view', () => {
  const { camera, target } = view();
  const clear = createCanopyClearance(obstacle(7, 85, 150), CAMERA.targetY);
  const portraitLift = clear(camera, target);
  camera.aspect = 914 / 411;
  camera.updateProjectionMatrix();
  assert.ok(clear(camera, target) > portraitLift);
  near(lowestNear(camera), 87, 'Wide near plane clears obstacle');
});

test('approaching a canopy eases the correction continuously and restores the baseline when clear', () => {
  const clear = createCanopyClearance(obstacle(0, 85, 150), CAMERA.targetY);
  let previousLift = 0;
  for (let x = 16; x >= 0; x--) {
    const { camera, target } = view({ x });
    const lift = clear(camera, target);
    assert.ok(lift >= previousLift, 'Lift increases continuously on approach');
    previousLift = lift;
  }
  const edge = 1 + CAMERA.near * Math.tan((CAMERA.fov * Math.PI) / 360) * (411 / 914);
  const outside = view({ x: edge + 0.0001 });
  const inside = view({ x: edge - 0.0001 });
  near(
    clear(outside.camera, outside.target),
    clear(inside.camera, inside.target),
    'No jump at overlap',
  );
  outside.camera.position.x += 100;
  outside.target.x += 100;
  assert.equal(clear(outside.camera, outside.target), 0);
  assert.equal(outside.target.y, CAMERA.targetY);
});

test('panning clear and recentering remove the correction without changing orbit distance', () => {
  const { camera, target } = view();
  const clear = createCanopyClearance(obstacle(0, 85, 150), CAMERA.targetY);
  clear(camera, target);
  camera.position.x += 1000;
  target.x += 1000;
  assert.equal(clear(camera, target), 0);
  assert.equal(target.y, CAMERA.targetY);
  near(camera.position.distanceTo(target), CAMERA.minDistance, 'Pan retains zoom');
  const reset = view({ distance: 1800 });
  camera.position.copy(reset.camera.position);
  camera.quaternion.copy(reset.camera.quaternion);
  target.copy(reset.target);
  assert.equal(clear(camera, target), 0);
  assert.equal(target.y, CAMERA.targetY);
  near(camera.position.distanceTo(target), 1800, 'Reset retains overview');
});

test('actual grove crowns clear the previously intersecting close view', () => {
  const { canopies } = createGrove();
  assert.equal(canopies.count, 1040);
  const { camera, target } = view({
    aspect: 914 / 411,
    x: 150,
    z: -50,
    bearing: (280 * Math.PI) / 180,
  });
  const originalOffset = camera.position.clone().sub(target);
  const clear = createCanopyClearance(canopies, CAMERA.targetY);
  assert.ok(clear(camera, target) > 20);
  const matrix = new Matrix4();
  const point = new Vector3();
  let tallest = -Infinity;
  for (const instance of [370, 371]) {
    canopies.getMatrixAt(instance, matrix);
    for (let vertex = 0; vertex < canopies.geometry.attributes.position.count; vertex++) {
      point.fromBufferAttribute(canopies.geometry.attributes.position, vertex).applyMatrix4(matrix);
      tallest = Math.max(tallest, point.y);
    }
  }
  assert.ok(lowestNear(camera) >= tallest + 1 - 1e-8);
  near(
    camera.position.clone().sub(target).distanceTo(originalOffset),
    0,
    'Real-scene orbit preserved',
  );
});
