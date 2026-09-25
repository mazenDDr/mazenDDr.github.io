// Moves the visitor's eyes around the room like a camera on a gimbal: glide
// along the floor graph at a steady speed with soft starts and stops, keep the
// horizon level, turn smoothly a little ahead of the path, settle on what the
// place is about, sit or stand, and zoom into a screen.
// One camera, driven every frame from `update(dt)`.
import * as THREE from 'three';
import { PLACES, NODES, EYE, B, shortestPath } from './places.js';

const { degToRad, radToDeg, smootherstep, clamp, lerp } = THREE.MathUtils;
const ease = (t) => smootherstep(t, 0, 1);
const CRUISE = 1.35;       // m/s once moving
const RAMP = 0.6;          // s to reach cruise speed and to come to rest
const LOOK_AHEAD = 0.9;    // m: where along the path the camera aims while moving
const TURN_RATE = 4.2;     // 1/s: spring stiffness for turning (higher = snappier)
const MAX_PAN = THREE.MathUtils.degToRad(110);   // rad/s: no faster than a camera operator pans

/** Distance fraction covered at time fraction u, for a move with soft ramps:
 *  speed rises along a half-sine, cruises, then falls the same way. */
function travelTable(duration) {
  const a = Math.min(0.45, RAMP / duration), n = 256, out = new Float32Array(n + 1);
  let acc = 0;
  for (let i = 1; i <= n; i++) {
    const u = (i - 0.5) / n;
    const v = u < a ? Math.sin((u / a) * Math.PI / 2) ** 2 : u > 1 - a ? Math.sin(((1 - u) / a) * Math.PI / 2) ** 2 : 1;
    acc += v;
    out[i] = acc;
  }
  for (let i = 0; i <= n; i++) out[i] /= acc;
  return (u) => { const f = u * n, i = Math.min(n - 1, Math.floor(f)); return out[i] + (out[i + 1] - out[i]) * (f - i); };
}

function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export class Director extends EventTarget {
  constructor(camera, anchors, setHfov) {
    super();
    this.camera = camera;
    this.anchors = anchors;
    this.setHfov = setHfov;
    this.place = null;       // key of PLACES we are at (or heading to)
    this.focus = null;       // screen name when zoomed in
    this.move = null;        // active animation
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.hfov = 70;
    this.lookOffset = new THREE.Vector2();   // smoothed pointer look, radians
    this.pointer = new THREE.Vector2();      // -1..1
    // Mouse: the view follows the pointer a little. Touch: drag to look around.
    this.drag = null;
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
      else if (this.drag) {
        const k = 2.2 / Math.min(innerWidth, innerHeight);
        this.pointer.x = THREE.MathUtils.clamp(this.drag.px - (e.clientX - this.drag.x) * k, -2.6, 2.6);
        this.pointer.y = THREE.MathUtils.clamp(this.drag.py - (e.clientY - this.drag.y) * k, -1.2, 1.2);
      }
    });
    addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && e.target.tagName === 'CANVAS') this.drag = { x: e.clientX, y: e.clientY, px: this.pointer.x, py: this.pointer.y };
    });
    addEventListener('pointerup', () => { this.drag = null; });
  }

  get busy() { return !!this.move; }

  /** Jump straight to a place (no animation). */
  snap(key) {
    const p = PLACES[key];
    this.place = key;
    this.focus = null;
    this.settle = null;
    this.pos.copy(p.eye);
    this.quat.copy(lookQuat(p.eye, p.look));
    this.hfov = p.hfov;
    this.apply();
    if (p.focus) this.zoomTo(p.focus, 0);
  }

  /** Walk (or zoom) to a place; resolves when there. */
  goTo(key) {
    const target = PLACES[key];
    if (!target || this.move) return Promise.resolve();
    if (key === this.place && this.focus === (target.focus || null)) return Promise.resolve();
    const here = PLACES[this.place];
    this.dispatchEvent(new CustomEvent('leave', { detail: { from: this.place, to: key } }));
    // Same spot, different purpose (couch -> TV, desk -> PC): just zoom in or out.
    if (here && here.node === target.node && here.eye.equals(target.eye)) {
      this.place = key;
      return target.focus ? this.zoomTo(target.focus) : this.zoomOut(target);
    }
    return this.walk(key);
  }

  walk(key) {
    const target = PLACES[key];
    const here = PLACES[this.place];
    // The path runs at standing eye height; height changes are applied separately
    // so standing up happens at the start and sitting down only at the very end.
    const flat = (v) => new THREE.Vector3(v.x, EYE.stand, v.z);
    const pts = [flat(this.pos)];
    if (this.focus) pts.push(flat(here.eye));          // back off the screen first
    for (const n of shortestPath(here ? here.node : target.node, target.node)) {
      const [x, y] = NODES[n];
      const p = B(x, y);
      p.y = EYE.stand;
      if (p.distanceTo(pts[pts.length - 1]) > 0.3) pts.push(p);
    }
    const end = flat(target.eye);
    if (end.distanceTo(pts[pts.length - 1]) < 0.3) pts.pop();
    pts.push(end);
    if (pts.length < 2) pts.unshift(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const length = curve.getLength();
    const duration = Math.max(1.2, length / CRUISE + RAMP + (target.pose !== 'stand' ? 0.35 : 0));
    this.focus = null;
    this.place = key;
    return this.run({
      duration, curve, length, travel: travelTable(duration),
      y0: this.pos.y, y1: target.eye.y,
      q0: this.quat.clone(), q1: lookQuat(target.eye, target.look),
      h0: this.hfov, h1: target.hfov,
      then: target.focus ? () => this.zoomTo(target.focus) : null,
    });
  }

  /** Pose that makes a screen fill most of the view. */
  screenPose(name) {
    const s = this.anchors.screens[name];
    const c = new THREE.Vector3().fromArray(s.center);
    const n = new THREE.Vector3().fromArray(s.normal);
    const hfov = 42;
    const aspect = this.camera.aspect;
    const vfov = 2 * Math.atan(Math.tan(degToRad(hfov) / 2) / aspect);
    const fill = 0.9;
    const d = Math.max(s.width / 2 / Math.tan(degToRad(hfov) / 2), s.height / 2 / Math.tan(vfov / 2)) / fill;
    const eye = c.clone().addScaledVector(n, d);
    return { eye, quat: lookQuat(eye, c), hfov };
  }

  zoomTo(name, duration = 1.0) {
    this.settle = null;
    const pose = this.screenPose(name);
    const curve = new THREE.LineCurve3(this.pos.clone(), pose.eye);
    this.focus = name;
    return this.run({
      duration, curve, length: 0, q0: this.quat.clone(), q1: pose.quat, h0: this.hfov, h1: pose.hfov,
      then: () => this.dispatchEvent(new CustomEvent('focus', { detail: { name } })),
    });
  }

  zoomOut(place) {
    const curve = new THREE.LineCurve3(this.pos.clone(), place.eye.clone());
    this.focus = null;
    return this.run({ duration: 0.9, curve, length: 0, q0: this.quat.clone(), q1: lookQuat(place.eye, place.look), h0: this.hfov, h1: place.hfov });
  }

  run(m) {
    if (m.duration === 0) {
      this.pos.copy(m.curve.getPoint(1));
      this.quat.copy(m.q1);
      this.hfov = m.h1;
      this.apply();
      m.then?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.move = { ...m, t: 0, resolve };
    });
  }

  update(dt) {
    const m = this.move;
    if (m) {
      m.t = Math.min(1, m.t + dt / m.duration);
      if (m.length > 0) {
        const f = m.travel(m.t), d = f * m.length, left = m.length - d;
        this.pos.copy(m.curve.getPointAt(f));
        // Level glide: rise from a seat in the first 0.8 m, sit only in the last 0.9 m.
        const rise = smootherstep(d, 0, 0.8), sit = 1 - smootherstep(left, 0, 0.9);
        this.pos.y = lerp(lerp(m.y0, EYE.stand, rise), m.y1, sit);
        // Aim a little ahead along the path, then hand over to the place's view.
        const ahead = m.curve.getPointAt(Math.min(1, f + LOOK_AHEAD / m.length));
        const aim = new THREE.Vector3(ahead.x, this.pos.y - 0.1, ahead.z);
        const walkQ = aim.distanceToSquared(this.pos) > 1e-4 ? lookQuat(this.pos, aim) : m.q1;
        const want = walkQ.clone().slerp(m.q1, 1 - smootherstep(left, 0.15, 1.6));
        const gap = this.quat.angleTo(want);
        if (gap > 1e-5) {
          const spring = gap * (1 - Math.exp(-dt * TURN_RATE * (0.6 + 0.8 * smootherstep(m.t, 0, 0.3))));
          this.quat.rotateTowards(want, Math.min(spring, MAX_PAN * dt));
        }
        if (m.t >= 1) this.settle = m.q1;      // finish the last few degrees after arriving
      } else {
        const u = ease(m.t);
        this.pos.copy(m.curve.getPoint(u));
        this.quat.copy(m.q0).slerp(m.q1, u);
      }
      this.hfov = lerp(m.h0, m.h1, ease(m.t));
      if (m.t >= 1) {
        this.move = null;
        m.then ? m.then() : null;
        this.dispatchEvent(new CustomEvent('arrive', { detail: { place: this.place, focus: this.focus } }));
        m.resolve();
      }
    } else if (this.settle) {
      this.quat.slerp(this.settle, 1 - Math.exp(-dt * 7));
      if (this.quat.angleTo(this.settle) < 0.002) { this.quat.copy(this.settle); this.settle = null; }
    }
    // Free look: a little when seated or zoomed, more when standing.
    // Holding still while a hotspot is hovered keeps it from sliding away from the cursor.
    const idle = !this.move;
    const range = this.focus ? 0.015 : PLACES[this.place]?.pose === 'stand' ? 0.24 : 0.15;
    const tx = idle ? -this.pointer.x * range : 0, ty = idle ? -this.pointer.y * range * 0.55 : 0;
    const k = this.holdLook && idle ? 0 : 1 - Math.exp(-dt * 4);
    this.lookOffset.x += (tx - this.lookOffset.x) * k;
    this.lookOffset.y += (ty - this.lookOffset.y) * k;
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    if (this.nudge) this.camera.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat), this.nudge);
    this.camera.quaternion.copy(this.quat);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.lookOffset.x);
    this.camera.rotateX(this.lookOffset.y);
    this.setHfov(this.hfov);
  }
}
