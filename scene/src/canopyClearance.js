import { Box3, Matrix4, Vector3 } from 'three';

const APPROACH_DISTANCE = 12;

// The canopy is static: build its exact world-space bounds once, then use only
// bounds comparisons and reusable vectors when the camera changes.
export function createCanopyClearance(canopies, baselineY, gap = 1) {
  const bounds = [];
  const matrix = new Matrix4();
  const point = new Vector3();
  const positions = canopies.geometry.attributes.position;
  canopies.updateWorldMatrix(true, false);
  for (let instance = 0; instance < canopies.count; instance++) {
    canopies.getMatrixAt(instance, matrix);
    matrix.premultiply(canopies.matrixWorld);
    const box = new Box3();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
      box.expandByPoint(point);
    }
    bounds.push(box);
  }
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();

  return function clearCanopy(camera, target) {
    // Remove the previous correction before calculating this view's clearance.
    const eyeY = baselineY + camera.position.y - target.y;
    const halfHeight = (camera.near * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom;
    forward.set(0, 0, -camera.near).applyQuaternion(camera.quaternion);
    right.set(halfHeight * camera.aspect, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, halfHeight, 0).applyQuaternion(camera.quaternion);
    const centerX = camera.position.x + forward.x;
    const centerZ = camera.position.z + forward.z;
    const extentX = Math.abs(right.x) + Math.abs(up.x);
    const extentZ = Math.abs(right.z) + Math.abs(up.z);
    const minX = Math.min(camera.position.x, centerX - extentX);
    const maxX = Math.max(camera.position.x, centerX + extentX);
    const minZ = Math.min(camera.position.z, centerZ - extentZ);
    const maxZ = Math.max(camera.position.z, centerZ + extentZ);
    const lowestY = Math.min(eyeY, eyeY + forward.y - Math.abs(right.y) - Math.abs(up.y));
    let lift = 0;
    for (const box of bounds) {
      const requiredLift = box.max.y + gap - lowestY;
      if (requiredLift <= 0) continue;
      const dx = Math.max(box.min.x - maxX, minX - box.max.x, 0);
      const dz = Math.max(box.min.z - maxZ, minZ - box.max.z, 0);
      if (dx >= APPROACH_DISTANCE || dz >= APPROACH_DISTANCE) continue;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance >= APPROACH_DISTANCE) continue;
      // Ease up before entering a crown's footprint. At overlap the complete
      // clearance is applied; no temporal animation or extra frames are needed.
      const t = 1 - distance / APPROACH_DISTANCE;
      const weight = t * t * (3 - 2 * t);
      lift = Math.max(lift, requiredLift * weight);
    }
    // Translate eye and pivot together: tilt, orbit distance and horizontal pan
    // stay unchanged. Clear water and recentering recover the baseline height.
    camera.position.y = eyeY + lift;
    target.y = baselineY + lift;
    return lift;
  };
}
