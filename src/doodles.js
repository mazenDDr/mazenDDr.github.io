// Hand-drawn arrows and handwritten labels over the room, in the spirit of the
// doodles in Life is Strange. Each arrow starts a little way off, curls into a
// loop and heads for its object, drawn stroke by stroke; hovering writes a label.
const NS = 'http://www.w3.org/2000/svg';

// A tiny seeded random, so each arrow keeps the same wobble every time it is drawn.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Arrow body and head in local coordinates, the target at (0, 0). */
function arrowShape(seed, dir, k = 1) {
  const r = rng(seed);
  const len = (150 + r() * 40) * k;                // tail distance from the target
  const [dx, dy] = dir;
  const nx = -dy, ny = dx;                         // normal, for the loop's side
  const side = r() < 0.5 ? 1 : -1;
  const at = (t, off) => [dx * len * t + nx * off * side, dy * len * t + ny * off * side];
  // tail -> bulge -> loop around a point ~55% of the way -> in to the target
  // One generous loop partway along, like a pen looping once before pointing.
  const loopC = at(0.5, 20 * k), rad = (22 + r() * 8) * k;
  const pts = [at(1, 0), at(0.78, 22)];
  for (let k = 0; k <= 14; k++) {
    const a = Math.atan2(-dy, -dx) + side * (Math.PI * 0.45 + (k / 14) * Math.PI * 2.0);
    pts.push([loopC[0] + Math.cos(a) * rad, loopC[1] + Math.sin(a) * rad]);
  }
  pts.push(at(0.26, 4), at(0.1, 0));
  const wob = () => (r() - 0.5) * 1.6;
  const p = pts.map(([x, y]) => [x + wob(), y + wob()]);
  // Catmull-Rom through the points -> cubic Béziers, for one smooth pen stroke.
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.map((v) => v.toFixed(1))} ${c2.map((v) => v.toFixed(1))} ${p2.map((v) => v.toFixed(1))}`;
  }
  // Arrowhead: two short strokes back from the tip.
  const tip = p[p.length - 1], back = p[p.length - 2];
  const a = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
  const h = 14 + r() * 3, spread = 0.48 + r() * 0.12;
  const w1 = [tip[0] - Math.cos(a - spread) * h, tip[1] - Math.sin(a - spread) * h];
  const w2 = [tip[0] - Math.cos(a + spread) * (h - 1.5), tip[1] - Math.sin(a + spread) * (h - 1.5)];
  const head = `M${w1.map((v) => v.toFixed(1))} L${tip.map((v) => v.toFixed(1))} L${w2.map((v) => v.toFixed(1))}`;
  return { d, head, tail: p[0] };
}

export class Doodles {
  constructor() {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.id = 'doodles';
    this.svg.setAttribute('aria-hidden', 'true');
    document.body.append(this.svg);
    this.items = new Map();
  }

  /** One doodle per hotspot: arrow + label. `text` is what gets written on hover. */
  add(key, text, seed) {
    const g = document.createElementNS(NS, 'g');
    g.classList.add('doodle');
    const body = document.createElementNS(NS, 'path');
    const head = document.createElementNS(NS, 'path');
    body.classList.add('pen', 'body');
    head.classList.add('pen', 'head');
    const label = document.createElementNS(NS, 'text');
    label.classList.add('hand');
    label.textContent = text;
    const under = document.createElementNS(NS, 'path');
    under.classList.add('pen', 'under');
    g.append(body, head, under, label);
    this.svg.append(g);
    this.items.set(key, { g, body, head, label, under, seed, dir: null, shown: false });
  }

  /** Fix a doodle's tail direction (unit vector, screen space) before it is drawn. */
  aim(key, dir) {
    const it = this.items.get(key);
    if (it && !it.shown) { it.want = dir; it.dir = null; }
  }

  /** Place a doodle at a screen point, aiming its tail toward open space. */
  place(key, x, y, visible) {
    const it = this.items.get(key);
    if (!it) return;
    if (!visible) {
      if (it.shown) this.hide(key);
      return;
    }
    if (!it.dir || !it.shown) {       // keep re-aiming until the arrow is drawn
      if (it.want) it.dir = it.want;
      else {
        // Tail toward the middle of the screen, turned a little, so arrows fan in.
        const cx = innerWidth / 2 - x, cy = innerHeight * 0.55 - y;
        const n = Math.hypot(cx, cy) || 1, turn = (rng(it.seed)() - 0.5) * 0.9;
        const ux = cx / n, uy = cy / n;
        it.dir = [ux * Math.cos(turn) - uy * Math.sin(turn), ux * Math.sin(turn) + uy * Math.cos(turn)];
      }
      const k = Math.min(1, Math.max(0.6, innerWidth / 1100));   // smaller arrows on small screens
      let s = arrowShape(it.seed, it.dir, k);
      // Keep the tail and its label on screen: mirror the arrow if it would leave.
      const room = 16, labelW = 170;
      const tx = x + s.tail[0], ty = y + s.tail[1];
      if (tx - labelW < room && it.dir[0] < 0 || tx + labelW > innerWidth - room && it.dir[0] > 0) it.dir = [-it.dir[0], it.dir[1]];
      if (ty < 60 && it.dir[1] < 0 || ty > innerHeight - 60 && it.dir[1] > 0) it.dir = [it.dir[0], -it.dir[1]];
      s = arrowShape(it.seed, it.dir, k);
      it.body.setAttribute('d', s.d);
      it.head.setAttribute('d', s.head);
      // Label beside the tail, written toward the middle of the screen.
      const right = x + s.tail[0] < innerWidth / 2;
      it.label.setAttribute('x', (s.tail[0] + (right ? 8 : -8)).toFixed(1));
      it.label.setAttribute('y', (s.tail[1] + (it.dir[1] >= 0 ? 22 : -10)).toFixed(1));
      it.label.setAttribute('text-anchor', right ? 'start' : 'end');
      it.tail = s.tail;
    }
    const t = `translate(${x.toFixed(1)},${y.toFixed(1)})`;
    if (t !== it.at) { it.at = t; it.g.setAttribute('transform', t); }   // a still view writes nothing
  }

  /** Draw the arrows in, one after another. */
  drawIn(keys) {
    keys.forEach((key, i) => {
      const it = this.items.get(key);
      if (!it || it.shown) return;
      it.shown = true;
      for (const [el, delay, dur] of [[it.body, i * 0.14, 0.75], [it.head, i * 0.14 + 0.7, 0.18]]) {
        const L = el.getTotalLength();
        el.style.transition = 'none';
        el.style.strokeDasharray = `${L} ${L}`;
        el.style.strokeDashoffset = L;
        el.getBoundingClientRect();
        el.style.transition = `stroke-dashoffset ${dur}s cubic-bezier(.45,.05,.35,1) ${delay}s`;
        el.style.strokeDashoffset = 0;
      }
      it.g.classList.add('on');
    });
  }

  hide(key) {
    const it = this.items.get(key);
    if (!it) return;
    it.shown = false;
    it.sticky = false;
    it.dir = null;                 // re-aim next time, the view may have changed
    it.g.classList.remove('on', 'hot');
  }

  hideAll() { for (const key of this.items.keys()) this.hide(key); }

  /** Write a label and keep it (hovering elsewhere won't clear it). */
  write(key) {
    const it = this.items.get(key);
    if (!it) return;
    it.sticky = false;
    this.hover(key);
    it.sticky = true;
  }

  /** Hover: thicken the arrow and write the label. */
  hover(key) {
    for (const [k, it] of this.items) {
      if (it.sticky) continue;
      const on = k === key && it.shown;
      if (on === it.g.classList.contains('hot')) continue;
      it.g.classList.toggle('hot', on);
      if (!on) {                        // erase the underline with the label
        it.under.style.transition = 'none';
        it.under.style.strokeDashoffset = Math.max(1, it.under.getTotalLength());
      }
      if (on) {
        const bb = it.label.getBBox();
        const y = bb.y + bb.height + 3, x0 = bb.x, x1 = bb.x + bb.width;
        it.under.setAttribute('d', `M${x0},${y} C${x0 + (x1 - x0) * 0.3},${y + 3} ${x0 + (x1 - x0) * 0.7},${y - 2} ${x1 + 6},${y + 1}`);
        const L = Math.max(1, it.under.getTotalLength());
        it.under.style.transition = 'none';
        it.under.style.strokeDasharray = `${L} ${L}`;
        it.under.style.strokeDashoffset = L;
        it.under.getBoundingClientRect();
        it.under.style.transition = 'stroke-dashoffset .35s ease .45s';
        it.under.style.strokeDashoffset = 0;
      }
    }
  }
}
