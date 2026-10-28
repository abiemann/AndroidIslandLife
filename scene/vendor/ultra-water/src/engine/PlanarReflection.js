import * as THREE from 'three';

// Mirror camera about the y=0 plane with an oblique near plane (Lengyel), rendering
// into a half-res target cleared to alpha 0 so the water falls back to the sky cube
// wherever nothing was drawn. Same math as three's Reflector, minus the mesh.
const normal = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const target = new THREE.Vector3();
const rot = new THREE.Matrix4();
const plane = new THREE.Plane();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();

export class PlanarReflection {
  constructor(layer = 1) {
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(layer);
    this.textureMatrix = new THREE.Matrix4();
    // mipmapped: the water blurs it by its roughness
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.scale = 0.5;
  }

  setSize(w, h) { this.target.setSize(Math.max(1, Math.floor(w * this.scale)), Math.max(1, Math.floor(h * this.scale))); }

  render(renderer, scene, camera) {
    const rc = this.camera;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.set(lookAt.x, -lookAt.y, lookAt.z);
    rc.position.set(camPos.x, -camPos.y, camPos.z);
    rc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    rc.lookAt(target);
    rc.far = camera.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

    plane.setFromNormalAndCoplanarPoint(normal, target.set(0, 0, 0)).applyMatrix4(rc.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = rc.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, rc);
  }
}
