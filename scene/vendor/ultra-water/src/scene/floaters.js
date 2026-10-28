import * as THREE from 'three';
import { makeFloater } from './floaterMeshes.js';

// Rigid bodies floating on the GPU ocean. Each body is split into sub-cells (the
// descriptor's sample points); every cell gets Archimedes buoyancy for its submerged
// fraction plus drag against the local water velocity, applied at the cell, so roll,
// pitch and bobbing all come out of the same forces. Water heights come from
// WaterQuery (1-3 frames late) and water velocity from their change over time.
const RHO = 1025, G = 9.81;
const SUBSTEP = 1 / 240;
const MAX_BODIES = 28;

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _vp = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix3(), _mt = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _w = new THREE.Vector3(), _c = new THREE.Vector3(), _m4 = new THREE.Matrix4();

class Body {
  constructor(desc) {
    this.desc = desc;
    this.object = desc.object;
    this.mass = desc.density * desc.volume;
    const s = desc.size, m = this.mass;
    // solid-box inertia; good enough for every prop shape here
    this.invInertia = new THREE.Vector3(
      12 / (m * (s.y * s.y + s.z * s.z)), 12 / (m * (s.x * s.x + s.z * s.z)), 12 / (m * (s.x * s.x + s.y * s.y)));
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.radius = desc.size.length() / 2;
    this.wet = false;
    const n = desc.samples.length;
    this.cellVolume = desc.volume / n;
    this.cellMass = m / n;
    this.world = desc.samples.map(() => new THREE.Vector3());
    // per sample: water height, water velocity (x, y, z), last displacement for velocity
    this.water = new Float32Array(n * 4);
    this.lastDisp = new Float32Array(n * 3).fill(NaN);
  }

  place(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    this.water.fill(0);
    this.lastDisp.fill(NaN);
    this.updateWorld();
  }

  updateWorld() {
    for (let i = 0; i < this.world.length; i++) this.world[i].copy(this.desc.samples[i]).applyQuaternion(this.quat).add(this.pos);
  }
}

export class Floaters {
  constructor({ scene, heightAt, patchMaterial }) {
    // own (nested) scene so the floater shadow map can render just these
    this.scene = new THREE.Scene();
    scene.add(this.scene);
    this.heightAt = heightAt;
    this.patchMaterial = patchMaterial;
    this.bodies = [];
    this.layout = 0;                       // bumps whenever the sample layout changes
    this.points = new Float32Array(1024);  // xz pairs submitted to WaterQuery
    this.count = 0;
    this.params = { drag: 1.6, angularDrag: 0.8, buoyancy: 1 };
    this.time = 0;
    this.impacts = [];   // last few water entries: { x, z, t, amp, size } for ripple rings
  }

  add(kind, pos, yaw = Math.random() * Math.PI * 2) {
    if (this.bodies.length >= MAX_BODIES) {
      const old = this.bodies.shift();
      this.scene.remove(old.object);
    }
    const b = new Body(makeFloater(kind, this.patchMaterial));
    b.place(pos, yaw);
    this.scene.add(b.object);
    this.bodies.push(b);
    this.layout++;
    return b;
  }

  clear() {
    for (const b of this.bodies) this.scene.remove(b.object);
    this.bodies.length = 0;
    this.layout++;
  }

  // a small flotsam field in front of a viewpoint
  spawn(center, forward) {
    this.clear();
    const f = _f.copy(forward).setY(0).normalize(), side = new THREE.Vector3(-f.z, 0, f.x);
    const at = (ahead, across) => new THREE.Vector3().copy(center).addScaledVector(f, ahead).addScaledVector(side, across).setY(0.2);
    this.add('boat', at(22, -4), Math.atan2(f.x, f.z) + 1.2);
    this.add('buoy', at(38, 9));
    [[12, 3], [16, -9], [27, 6], [31, -1], [19, 12]].forEach(([a, c]) => this.add('crate', at(a, c)));
    [[14, -2], [24, 14], [34, -8]].forEach(([a, c]) => this.add('barrel', at(a, c)));
  }

  // sample points for this frame's water query
  collectPoints(extra) {
    let k = 0;
    for (const e of extra) { this.points[k++] = e.x; this.points[k++] = e.z; }
    for (const b of this.bodies) for (const p of b.world) { this.points[k++] = p.x; this.points[k++] = p.z; }
    this.count = k / 2;
    return this.points;
  }

  // consume a WaterQuery result (offset = number of non-body points submitted first)
  ingest(query, offset) {
    if (query.resultTag !== this.layout || query.resultTime === this.lastResultTime) return;
    const dtR = this.lastResultTime === undefined ? 0 : query.resultTime - this.lastResultTime;
    this.lastResultTime = query.resultTime;
    const r = query.result;
    let k = offset;
    for (const b of this.bodies) {
      for (let i = 0; i < b.world.length; i++, k++) {
        if (k >= query.resultCount) return;
        const h = r[k * 4], dx = r[k * 4 + 1], dz = r[k * 4 + 2];
        const w = b.water, ld = b.lastDisp;
        w[i * 4] = h;
        if (dtR > 1e-4 && !Number.isNaN(ld[i * 3])) {
          // water velocity from the change in displacement at a fixed point. At steep
          // fronts that overstates particle speed (the front sweeps past), so clamp to
          // roughly the largest orbital speeds these waves have
          const c = (v, m) => Math.max(-m, Math.min(m, v));
          w[i * 4 + 1] = c((dx - ld[i * 3]) / dtR, 3);
          w[i * 4 + 2] = c((h - ld[i * 3 + 1]) / dtR, 0.8);
          w[i * 4 + 3] = c((dz - ld[i * 3 + 2]) / dtR, 3);
        }
        ld[i * 3] = dx; ld[i * 3 + 1] = h; ld[i * 3 + 2] = dz;
      }
    }
  }

  step(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / steps;
    for (let s = 0; s < steps; s++) for (const b of this.bodies) this.integrate(b, h);
    for (const b of this.bodies) {
      b.object.position.copy(b.pos);
      b.object.quaternion.copy(b.quat);
    }
  }

  integrate(b, h) {
    const P = this.params;
    const force = _f.set(0, -b.mass * G, 0), torque = _t.set(0, 0, 0);
    const cell = b.desc.cellHeight;
    let wet = false;
    b.updateWorld();
    for (let i = 0; i < b.world.length; i++) {
      const p = b.world[i], w = b.water;
      _r.subVectors(p, b.pos);
      _vp.copy(b.angVel).cross(_r).add(b.vel);                 // velocity of this cell
      const sub = THREE.MathUtils.clamp((w[i * 4] - p.y) / cell + 0.5, 0, 1);
      if (sub > 0) {
        wet = true;
        _v.set(0, RHO * G * b.cellVolume * sub * P.buoyancy, 0);
        // drag against the moving water (gives orbital bobbing and surf push)
        const k = P.drag * b.cellMass * sub;
        _v.x -= (_vp.x - w[i * 4 + 1]) * k;
        _v.y -= (_vp.y - w[i * 4 + 2]) * k * 1.5;
        _v.z -= (_vp.z - w[i * 4 + 3]) * k;
        force.add(_v);
        torque.add(_c.copy(_r).cross(_v));
      }
      // beach / seabed contact: stiff spring + friction
      const ground = this.heightAt(p.x, p.z);
      const pen = ground - p.y;
      if (pen > 0) {
        const kN = b.cellMass * 900;
        _v.set(-_vp.x * b.cellMass * 6, pen * kN - _vp.y * b.cellMass * 40, -_vp.z * b.cellMass * 6);
        force.add(_v);
        torque.add(_c.copy(_r).cross(_v));
      }
    }
    // hitting the water fast: ripple rings (and a splash) sized by the body and speed
    if (wet && !b.wet && b.vel.y < -1.5) {
      const s = b.desc.size;
      this.impacts.push({ x: b.pos.x, z: b.pos.z, t: this.time, amp: Math.min(0.35, 0.03 * -b.vel.y * Math.min(s.x, s.z)), size: Math.max(s.x, s.z) * 0.5 });
      if (this.impacts.length > 8) this.impacts.shift();
    }
    b.wet = wet;
    b.vel.addScaledVector(force, h / b.mass);
    b.pos.addScaledVector(b.vel, h);

    // world inverse inertia = R diag(I^-1) R^T
    _m.setFromMatrix4(_m4.makeRotationFromQuaternion(b.quat));
    _mt.copy(_m).transpose();
    _w.copy(torque).applyMatrix3(_mt).multiply(b.invInertia).applyMatrix3(_m);
    b.angVel.addScaledVector(_w, h);
    b.angVel.multiplyScalar(Math.exp(-P.angularDrag * h));
    const a = b.angVel.length();
    if (a > 1e-6) {
      _q.setFromAxisAngle(_v.copy(b.angVel).divideScalar(a), a * h);
      b.quat.premultiply(_q).normalize();
    }
  }
}
