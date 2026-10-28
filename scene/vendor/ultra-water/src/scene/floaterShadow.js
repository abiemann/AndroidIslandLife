import * as THREE from 'three';

// Sharp sun shadows of the floating props only: a depth map from an ortho sun camera
// fitted around the bodies every frame, so the big static sun map (terrain + rocks) is
// never re-rendered for them. Water, terrain, props and the underwater shafts all take
// it through floatShadow().
export const FLOAT_SHADOW_GLSL = /* glsl */`
uniform highp sampler2DShadow uFloatShadow;
uniform mat4 uFloatShadowMatrix;
uniform float uFloatShadowBias;   // depth units; 0 = no casters this frame
float floatShadow(vec3 p) {
  if (uFloatShadowBias <= 0.0) return 1.0;
  vec3 sc = (uFloatShadowMatrix * vec4(p, 1.0)).xyz;
  if (any(lessThan(sc, vec3(0.0))) || any(greaterThan(sc, vec3(1.0)))) return 1.0;
  return texture(uFloatShadow, vec3(sc.xy, sc.z - uFloatShadowBias));
}`;

const _c = new THREE.Vector3();

export class FloaterShadow {
  constructor(size = 1024) {
    const depth = new THREE.DepthTexture(size, size, THREE.FloatType);
    depth.compareFunction = THREE.LessEqualCompare;   // hardware 2x2 PCF
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, depthTexture: depth, generateMipmaps: false });
    this.camera = new THREE.OrthographicCamera();
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.uniforms = {
      uFloatShadow: { value: depth },
      uFloatShadowMatrix: { value: new THREE.Matrix4() },
      uFloatShadowBias: { value: 0 },
    };
  }

  // root: a Scene holding only the floaters; bodies: [{ pos, radius }]; sunDir: towards the sun
  update(renderer, root, bodies, sunDir) {
    const u = this.uniforms;
    // the depth texture gets its compare mode when first rendered; until then any
    // shadow sampler bound to it fails the draw
    if (!this.ready) { this.clear(renderer); this.ready = true; }
    if (!bodies.length || sunDir.y <= 0.01) { u.uFloatShadowBias.value = 0; return; }
    _c.set(0, 0, 0);
    for (const b of bodies) _c.add(b.pos);
    _c.divideScalar(bodies.length);
    let r = 1;
    for (const b of bodies) r = Math.max(r, b.pos.distanceTo(_c) + b.radius);
    // receivers lie along the light rays behind the casters, so the xy footprint is just
    // the casters'; depth runs far past them for the seabed under a low sun
    const cam = this.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 1;
    cam.far = r + 3000;
    cam.position.copy(_c).addScaledVector(sunDir, r + 20);
    cam.lookAt(_c);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    u.uFloatShadowMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    u.uFloatShadowBias.value = 0.03 / (cam.far - cam.near);

    const prev = renderer.getRenderTarget();
    root.overrideMaterial = this.material;
    renderer.setRenderTarget(this.target);
    renderer.clear(false, true, false);
    renderer.render(root, cam);
    root.overrideMaterial = null;
    renderer.setRenderTarget(prev);
  }

  clear(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear(false, true, false);
    renderer.setRenderTarget(prev);
  }
}
