// Clickable things in the room. Each is an invisible box (measured from the
// Blender scene, cm) that sends the visitor to a place, plus a small pulsing
// marker and a hover label drawn as HTML over the canvas.
import * as THREE from 'three';
import { B, PLACES } from './places.js';
import { Doodles } from './doodles.js';

// `say` is what the hand writes when you hover; markers sit on the object itself.
const SPOTS = [
  { place: 'couch', say: 'sit on the couch', box: [[4, 216, 0], [84, 410, 77]], marker: [78, 322, 48] },
  { place: 'tv', say: 'watch my projects', box: [[290, 261, 52], [337, 315, 105]], marker: [293, 288, 84] },
  { place: 'desk', say: 'sit at my desk', box: [[57, 75, 0], [115, 133, 81]], marker: [86, 104, 70] },
  { place: 'pc', say: 'use the computer', box: [[75, 34, 74], [117, 72, 116]], marker: [96, 58, 104] },
  { place: 'bed', say: 'sit on the bed', box: [[228, 20, 0], [336, 193, 74]], marker: [270, 130, 60] },
  { place: 'memo', say: 'read the pinboard', box: [[246, 0, 98], [330, 4, 158]], marker: [288, 2, 128] },
  { place: 'certificates', say: 'my diploma', box: [[330, 30, 95], [340, 177, 198]], marker: [338, 104, 150] },
  // Things to click once you are there (onlyAt), rather than places to go.
  { action: 'cert:bsc', say: 'take a closer look', onlyAt: 'certificates', label: 'View the diploma', box: [[334, 70, 121], [340, 138, 175]], marker: [338, 118, 160] },
];
// Places reached from a screen's own seat go back to that seat, not the room.
export const PARENT = { tv: 'couch', pc: 'desk', memo: 'bed' };

export class Hotspots {
  constructor(camera, director, onAction = () => {}, root = document.body) {
    this.onAction = onAction;
    this.doodles = new Doodles();
    this.camera = camera;
    this.director = director;
    this.ray = new THREE.Raycaster();
    this.hover = null;
    this.enabled = false;
    this.layer = Object.assign(document.createElement('div'), { id: 'spots' });
    root.append(this.layer);
    this.spots = SPOTS.map((s) => {
      const [lo, hi] = s.box.map(([x, y, z]) => B(x, y, z));
      const box = new THREE.Box3().setFromPoints([lo, hi]);
      const el = document.createElement('button');
      el.className = 'spot';
      s.label ||= PLACES[s.place].label;
      el.setAttribute('aria-label', s.label);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.activate(s); });
      el.addEventListener('pointerenter', (e) => this.setHover(this.spots.find((x) => x.el === el), e));
      el.addEventListener('pointerleave', () => this.setHover(null));
      this.layer.append(el);
      const key = s.place || s.action;
      this.doodles.add(key, s.say, [...key].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
      const spot = { ...s, key, box, el, anchor: B(...s.marker) };
      // The handwritten label is clickable too.
      const label = this.doodles.items.get(key).label;
      label.addEventListener('click', (e) => { e.stopPropagation(); this.activate(spot); });
      label.addEventListener('pointerenter', (e) => this.setHover(spot, e));
      label.addEventListener('pointerleave', () => this.setHover(null));
      return spot;
    });
    this.idleSince = 0;
    this.pointer = { x: -1e4, y: -1e4 };
    addEventListener('pointermove', (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; });
    const canvas = camera.userData.canvas || document.querySelector('canvas');
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('click', (e) => this.onClick(e));
  }

  activate(s) {
    if (!this.enabled || this.director.busy) return;
    this.setHover(null);
    if (s.action) this.onAction(s.action);
    else this.director.goTo(s.place);
  }

  pick(e) {
    // Near a marker counts as that marker (forgiving on touch screens).
    for (const s of this.visibleSpots()) {
      if (!s.el.classList.contains('on')) continue;
      const m = s.el.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      if (m && Math.hypot(+m[1] - e.clientX, +m[2] - e.clientY) < 24) return s;
    }
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    let best = null, bestD = Infinity;
    for (const s of this.visibleSpots()) {
      const hit = this.ray.ray.intersectBox(s.box, new THREE.Vector3());
      if (hit) {
        const d = hit.distanceTo(this.ray.ray.origin);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return best;
  }

  visibleSpots() {
    const d = this.director;
    if (!this.enabled || d.busy || d.focus) return [];
    return this.spots.filter((s) => (s.onlyAt ? s.onlyAt === d.place : s.place !== d.place && PARENT[d.place] !== s.place));
  }

  onMove(e) {
    const s = this.pick(e);
    this.setHover(s, e);
  }

  onClick(e) {
    const s = this.pick(e);
    if (s) this.activate(s);
  }

  setHover(s) {
    this.hover = s;
    document.body.style.cursor = s ? 'pointer' : '';
    this.doodles.hover(s ? s.key : null);
  }

  /** Position the markers each frame. */
  update() {
    const vis = new Set(this.visibleSpots());
    const v = new THREE.Vector3();
    let near = Infinity;
    for (const s of this.spots) {
      v.copy(s.anchor).project(this.camera);
      const on = vis.has(s) && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      s.el.classList.toggle('on', on);
      s.el.classList.toggle('hot', this.hover === s);
      const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
      this.doodles.place(s.key, x, y, on);
      if (!on) continue;
      s.el.style.transform = `translate(${x}px, ${y}px)`;
      near = Math.min(near, Math.hypot(x - this.pointer.x, y - this.pointer.y));
    }
    // Once the camera has settled for a moment, draw the arrows in, left to right.
    const now = performance.now();
    if (!vis.size) this.idleSince = now;
    else if (now - this.idleSince > 250) {
      const fresh = this.spots.filter((s) => s.el.classList.contains('on') && !this.doodles.items.get(s.key).shown);
      if (fresh.length) {
        const pos = (s) => s.el.style.transform.match(/[-\d.]+/g).map(Number);
        const on = this.spots.filter((s) => s.el.classList.contains('on'));
        // Fan the arrows out: each tail points away from nearby markers, with a
        // gentle pull toward the middle of the screen so it stays in view.
        for (const s of fresh) {
          const [x, y] = pos(s);
          let dx = (innerWidth / 2 - x) / innerWidth * 1.6, dy = (innerHeight * 0.5 - y) / innerHeight * 1.6;
          for (const o of on) {
            if (o === s) continue;
            const [ox, oy] = pos(o), d2 = (x - ox) ** 2 + (y - oy) ** 2;
            if (d2 < 320 ** 2) { dx += (x - ox) / d2 * 140; dy += (y - oy) / d2 * 140; }
          }
          const n = Math.hypot(dx, dy) || 1;
          this.doodles.aim(s.key, [dx / n, dy / n]);
        }
        fresh.sort((a, b) => pos(a)[0] - pos(b)[0]);
        this.doodles.drawIn(fresh.map((s) => s.key));
      }
    }
    // A magnet: the view stops drifting while the cursor is close to a marker, so
    // the marker holds still under it. (Hover events alone lag when things move
    // under a still cursor.)
    this.director.holdLook = near < 48 || !!this.hover;
  }
}
