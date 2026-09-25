// Moves the visitor's eyes around the room: walk along the floor graph with a
// light head bob, turn toward what the place is about, sit or stand, and zoom
// into a screen. One camera, driven every frame from `update(dt)`.
import * as THREE from 'three';
import { PLACES, NODES, EYE, B, shortestPath } from './places.js';

const { degToRad, radToDeg, smootherstep, clamp, lerp } = THREE.MathUtils;
const ease = (t) => smootherstep(t, 0, 1);
const WALK_SPEED = 1.15;   // m/s, an unhurried indoor walk
const STRIDE = 0.72;       // m per step, for the head bob

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
    const pts = [this.pos.clone()];
    if (this.focus) pts.push(here.eye.clone());          // back off the screen first
    const nodes = shortestPath(here ? here.node : target.node, target.node);
    for (const n of nodes) {
      const [x, y] = NODES[n];
      const p = B(x, y);
      p.y = EYE.stand;
      if (p.distanceTo(pts[pts.length - 1]) > 0.25) pts.push(p);
    }
    pts.push(target.eye.clone());
    // Standing up from a seat: rise before walking away.
    if (here && here.pose !== 'stand' && pts.length > 2) pts.splice(1, 0, pts[0].clone().setY(EYE.stand));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = curve.getLength();
    this.focus = null;
    this.place = key;
    return this.run({
      duration: Math.max(1.4, length / WALK_SPEED + (target.pose !== 'stand' ? 0.6 : 0)),
      curve, length,
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

  zoomTo(name, duration = 1.1) {
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
      const u = ease(m.t);
      this.pos.copy(m.curve.getPointAt(u));
      if (m.length > 0) {
        // Face along the path while walking, then settle on the place's view.
        const tangent = m.curve.getTangentAt(Math.min(u, 0.999)).setY(0).normalize();
        const walkQ = lookQuat(this.pos, this.pos.clone().add(tangent).add(new THREE.Vector3(0, -0.12, 0)));
        const inW = smootherstep(m.t, 0, 0.22), outW = smootherstep(m.t, 0.55, 1);
        this.quat.copy(m.q0).slerp(walkQ, inW).slerp(m.q1, outW);
        // Head bob: steps are strongest mid-walk and fade at both ends.
        const walking = Math.sin(Math.PI * m.t);
        const s = (u * m.length) / STRIDE * Math.PI;
        this.pos.y += Math.abs(Math.sin(s)) * 0.022 * walking - 0.011 * walking;
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
        this.pos.addScaledVector(side, Math.sin(s) * 0.008 * walking);
      } else {
        this.quat.copy(m.q0).slerp(m.q1, u);
      }
      this.hfov = lerp(m.h0, m.h1, u);
      if (m.t >= 1) {
        this.move = null;
        m.then ? m.then() : null;
        this.dispatchEvent(new CustomEvent('arrive', { detail: { place: this.place, focus: this.focus } }));
        m.resolve();
      }
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
    this.camera.quaternion.copy(this.quat);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.lookOffset.x);
    this.camera.rotateX(this.lookOffset.y);
    this.setHfov(this.hfov);
  }
}
