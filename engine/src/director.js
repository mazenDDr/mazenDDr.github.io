// Moves the visitor's view around the room like a camera drone: lift off,
// fly an almost straight line above the furniture at a steady speed, bank a
// little into turns, frame the destination early, and set down softly (a
// landing arc onto seats). Screens get a zoom; the way in through the door is
// its own flight, a "whoosh" from a narrow tunnel view to a wide reveal.
// One camera, driven every frame from `update(dt)`.
import * as THREE from 'three';
import { PLACES, NODES, B, shortestPath } from './places.js';

const { degToRad, smootherstep, clamp, lerp } = THREE.MathUtils;
const ease = (t) => smootherstep(t, 0, 1);
const CRUISE = 2.2;         // m/s: a drone, not a walk
const RAMP = 0.55;          // s to reach cruise speed and to come to rest
const ALTITUDE = 1.75;      // m: above beds, tables and the couch back; under the pendant lamp
const TURN_RATE = 4.5;      // 1/s: spring stiffness for turning
const MAX_PAN = degToRad(140);
const MAX_BANK = degToRad(7);
const SPEED_FOV = 9;        // degrees of extra width at full speed
// Things taller than the flight altitude, in plan (Blender cm): [x, y, radius].
const TALL = [[43, 178, 48]];   // the rubber tree by the couch

/** Distance fraction covered at time fraction u: a half-sine ramp up, cruise, ramp down. */
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

/** Does the straight line a -> b (three.js xz, metres) pass through a tall obstacle? */
function blocked(a, b) {
  for (const [x, y, r] of TALL) {
    const c = B(x, y), R = r / 100;
    const ab = new THREE.Vector2(b.x - a.x, b.z - a.z), ac = new THREE.Vector2(c.x - a.x, c.z - a.z);
    const t = clamp(ac.dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
    if (ac.sub(ab.multiplyScalar(t)).length() < R) return true;
  }
  return false;
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
    this.roll = 0;           // bank angle, radians
    this.fovKick = 0;
    // Free look is a damped spring (position + velocity), so it can glide to a
    // stop when a hotspot is hovered instead of halting dead.
    this.look = new THREE.Vector2();
    this.lookVel = new THREE.Vector2();
    this.pointer = new THREE.Vector2();      // -1..1
    this.drag = null;
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
      else if (this.drag) {
        const k = 2.2 / Math.min(innerWidth, innerHeight);
        this.pointer.x = clamp(this.drag.px - (e.clientX - this.drag.x) * k, -2.6, 2.6);
        this.pointer.y = clamp(this.drag.py - (e.clientY - this.drag.y) * k, -1.2, 1.2);
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

  /** Fly (or zoom) to a place; resolves when there. */
  goTo(key) {
    const target = PLACES[key];
    if (!target || this.move) return Promise.resolve();
    if (key === this.place && this.focus === (target.focus || null)) return Promise.resolve();
    const here = PLACES[this.place];
    this.dispatchEvent(new CustomEvent('leave', { detail: { from: this.place, to: key } }));
    // Same spot, different purpose (couch -> TV, desk -> PC): just zoom in or out.
    if (here && here.eye.equals(target.eye)) {
      this.place = key;
      return target.focus ? this.zoomTo(target.focus) : this.zoomOut(target);
    }
    return this.fly(key);
  }

  fly(key) {
    const target = PLACES[key];
    const here = PLACES[this.place];
    const start = this.pos.clone();
    const flat = (v) => new THREE.Vector3(v.x, ALTITUDE, v.z);
    // Straight across when nothing tall is in the way, else via the floor graph.
    let pts = [flat(start)];
    if (this.focus) pts.push(flat(here.eye));             // back off the screen first
    const from = pts[pts.length - 1], end = flat(target.eye);
    if (blocked(from, end)) {
      for (const n of shortestPath(here ? here.node : target.node, target.node).slice(1, -1)) {
        const [x, y] = NODES[n];
        pts.push(B(x, y).setY(ALTITUDE));
      }
    }
    pts.push(end);
    pts = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.2);
    if (pts.length < 2) pts.push(end.clone().add(new THREE.Vector3(0.01, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const length = curve.getLength();
    const duration = Math.max(1.1, length / CRUISE + RAMP + (target.pose !== 'stand' ? 0.3 : 0));
    this.focus = null;
    this.place = key;
    return this.run({
      kind: 'fly', duration, curve, length, travel: travelTable(duration),
      y0: start.y, y1: target.eye.y, q1: lookQuat(target.eye, target.look), look: target.look.clone(),
      h0: this.hfov, h1: target.hfov,
      then: target.focus ? () => this.zoomTo(target.focus) : null,
    });
  }

  /** The way in: through the doorway at eye height, a narrow tunnel view opening
   *  into a wide reveal of the room. */
  flyIn(key = 'room', duration = 2.6) {
    const target = PLACES[key], hinge = this.anchors.door.hinge;
    const doorway = new THREE.Vector3(hinge[0] - 0.43, 1.55, hinge[2]);
    const inside = doorway.clone().add(new THREE.Vector3(-0.35, 0.05, 0.3));   // just past the frame
    const curve = new THREE.CatmullRomCurve3([this.pos.clone(), doorway, inside, target.eye.clone()], false, 'centripetal', 0.5);
    this.place = key;
    this.focus = null;
    return this.run({
      kind: 'whoosh', duration, curve, length: curve.getLength(), travel: travelTable(duration),
      q0: this.quat.clone(), q1: lookQuat(target.eye, target.look), look: target.look.clone(),
      h0: this.hfov, h1: target.hfov,
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

  zoomTo(name, duration = 0.95) {
    this.settle = null;
    const pose = this.screenPose(name);
    const curve = new THREE.LineCurve3(this.pos.clone(), pose.eye);
    this.focus = name;
    return this.run({
      kind: 'zoom', duration, curve, q0: this.quat.clone(), q1: pose.quat, h0: this.hfov, h1: pose.hfov,
      then: () => this.dispatchEvent(new CustomEvent('focus', { detail: { name, place: this.place } })),
    });
  }

  zoomOut(place) {
    const curve = new THREE.LineCurve3(this.pos.clone(), place.eye.clone());
    this.focus = null;
    return this.run({ kind: 'zoom', duration: 0.85, curve, q0: this.quat.clone(), q1: lookQuat(place.eye, place.look), h0: this.hfov, h1: place.hfov });
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
    return new Promise((resolve) => { this.move = { ...m, t: 0, resolve, prevDir: null, prevF: 0 }; });
  }

  update(dt) {
    const m = this.move;
    let bankTarget = 0, kickTarget = 0;
    if (m) {
      m.t = Math.min(1, m.t + dt / m.duration);
      if (m.kind === 'fly' || m.kind === 'whoosh') {
        const f = m.travel(m.t), d = f * m.length, left = m.length - d;
        this.pos.copy(m.curve.getPointAt(f));
        if (m.kind === 'fly') {
          // Lift off over the first 0.9 m, land over the last 1.2 m (longer onto seats).
          const up = smootherstep(d, 0, 0.9), land = 1 - smootherstep(left, 0, 1.2);
          this.pos.y = lerp(lerp(m.y0, ALTITUDE, up), m.y1, land);
        }
        // Speed and heading, for banking and the speed widening.
        const speed = ((f - m.prevF) * m.length) / Math.max(dt, 1e-4);
        const dir = m.curve.getTangentAt(Math.min(f, 0.999)).setY(0).normalize();
        if (m.prevDir) {
          const turn = Math.atan2(m.prevDir.x * dir.z - m.prevDir.z * dir.x, m.prevDir.dot(dir)) / Math.max(dt, 1e-4);
          bankTarget = clamp(-turn * speed * 0.035, -MAX_BANK, MAX_BANK);
        }
        m.prevDir = dir; m.prevF = f;
        kickTarget = clamp(speed / CRUISE, 0, 1) * SPEED_FOV;
        // Frame the destination early: blend from the flight heading to the target.
        const heading = lookQuat(this.pos, this.pos.clone().add(dir).add(new THREE.Vector3(0, -0.18, 0)));
        const onTarget = lookQuat(this.pos, m.look);
        const want = heading.clone().slerp(onTarget, clamp(0.35 + 0.65 * smootherstep(m.t, 0.1, 0.75), 0, 1));
        if (m.t > 0.92) want.slerp(m.q1, smootherstep(m.t, 0.92, 1));
        const gap = this.quat.angleTo(want);
        if (gap > 1e-5) {
          const spring = gap * (1 - Math.exp(-dt * TURN_RATE));
          this.quat.rotateTowards(want, Math.min(spring, MAX_PAN * dt));
        }
        if (m.kind === 'whoosh') {
          // A tunnel view through the doorway, then the room opens up wide.
          const squeeze = Math.sin(Math.PI * smootherstep(m.t, 0, 0.45)) * 14;
          this.hfov = lerp(m.h0, m.h1, smootherstep(m.t, 0.3, 0.95)) - squeeze;
          kickTarget *= 0.6;
        } else {
          this.hfov = lerp(m.h0, m.h1, ease(m.t));
        }
        if (m.t >= 1) this.settle = m.q1;
      } else {
        const u = ease(m.t);
        this.pos.copy(m.curve.getPoint(u));
        this.quat.copy(m.q0).slerp(m.q1, u);
        this.hfov = lerp(m.h0, m.h1, u);
      }
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
    this.roll += (bankTarget - this.roll) * (1 - Math.exp(-dt * 5));
    this.fovKick += (kickTarget - this.fovKick) * (1 - Math.exp(-dt * 4));

    // Free look: a damped spring toward where the pointer is. Near a hotspot the
    // target becomes "where we are, plus a little of where we were going", so the
    // view glides to rest under the cursor instead of stopping instantly.
    const idle = !this.move;
    const range = this.focus ? 0.015 : PLACES[this.place]?.pose === 'stand' ? 0.24 : 0.15;
    const target = new THREE.Vector2(idle ? -this.pointer.x * range : 0, idle ? -this.pointer.y * range * 0.55 : 0);
    if (this.holdLook && idle) target.copy(this.look).addScaledVector(this.lookVel, 0.18);
    const w = 7.5;                                   // natural frequency: critically damped
    const acc = target.sub(this.look).multiplyScalar(w * w).addScaledVector(this.lookVel, -2 * w);
    this.lookVel.addScaledVector(acc, dt);
    this.look.addScaledVector(this.lookVel, dt);
    this.apply();
  }

  /** Kept for callers from before the spring: the current free-look offset. */
  get lookOffset() { return this.look; }

  apply() {
    this.camera.position.copy(this.pos);
    if (this.nudge) this.camera.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat), this.nudge);
    this.camera.quaternion.copy(this.quat);
    this.camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.look.x);
    this.camera.rotateX(this.look.y);
    if (this.roll) this.camera.rotateZ(this.roll);
    this.setHfov(this.hfov + this.fovKick);
  }
}
