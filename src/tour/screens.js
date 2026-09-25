// The live screens: the TV, the PC and the pinboard are real pages (iframes),
// shown behind the transparent canvas. Each page is mapped onto where its screen
// appears with one projective matrix (the four corners, projected by the camera):
// no CSS 3D camera, which Safari won't draw, just a flat transform every browser does. The panorama has a hole
// exactly where each screen shows (rendered in), so they appear inside the tube
// and anything in front still covers them. The viewer draws the glass on top.
// Pages load only once the room is entered, and sleep when not looked at.
import { DIM } from './glass.js';
import { place } from './homography.js';

// Pixel size each app is designed for (the aspect matches the glass), and the black
// border a CRT leaves around its picture, as a fraction of the glass.
const APPS = {
  tv: { src: 'apps/tv/?room', px: [1280, 975], crt: true, border: 0.045, title: 'TV' },
  pc: { src: 'apps/pc/?room', px: [1024, 770], crt: true, border: 0.035, title: 'Computer' },
  memo: { src: 'apps/memo/?room', px: [1300, 900], crt: false, title: 'Pinboard' },
};
const ALT = { games: 'apps/games/?room' };      // other apps a screen can switch to

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];


/** The glass as buffers, with each vertex's place on the face (-1..1). */
function glassGeometry(g, s) {
  const face = [];
  for (let i = 0; i < g.position.length; i += 3) {
    const p = add(g.position.slice(i, i + 3), s.center, -1);
    face.push(dot(p, s.right) / (s.width / 2), dot(p, s.up) / (s.height / 2));
  }
  return { position: g.position, normal: g.normal, index: g.index, face };
}

/** The pinboard page: a rectangle on the board, with face coordinates. */
function planeGeometry(c, r, u, n, w, h) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const position = corners.flatMap(([x, y]) => add(add(c, r, (x * w) / 2), u, (y * h) / 2));
  return { position, normal: corners.flatMap(() => n), face: corners.flat(), index: [0, 1, 2, 0, 2, 3] };
}

export class Screens {
  constructor(anchors, viewer, onBack) {
    this.root = document.createElement('div');
    this.root.id = 'screens';
    document.body.prepend(this.root);             // behind the canvas
    this.objects = {};
    this.active = null;
    for (const [name, app] of Object.entries(APPS)) {
      const s = anchors.screens[name], g = app.crt && anchors.glass?.[name];
      const [w, h] = app.px;
      const frame = document.createElement('iframe');
      frame.title = app.title;
      frame.style.cssText = `width:${w}px;height:${h}px;border:0;background:#000`;
      const wrap = document.createElement('div');
      wrap.className = 'screen-app' + (app.crt ? ' crt' : '');
      wrap.dataset.name = name;
      wrap.append(frame);
      let k, pw = w, ph = h, centre = s.center, glass;
      if (g) {
        // The picture fills the glass less its border; the black around it runs past
        // the glass on every side, so its outline never shows an edge.
        k = Math.min(s.width / w, s.height / h) * (1 - 2 * app.border);
        pw = Math.ceil((s.width * 1.06) / k); ph = Math.ceil((s.height * 1.06) / k);
        frame.style.margin = `${(ph - h) / 2}px ${(pw - w) / 2}px`;
        centre = add(s.center, s.normal, -0.006);   // a little into the tube, under the curved front
        glass = viewer.addGlass(glassGeometry(g, s), true);
      } else {
        k = Math.min(s.width / w, s.height / h) * 0.97;
        centre = add(s.center, s.normal, 0.002);
        glass = viewer.addGlass(planeGeometry(centre, s.right, s.up, s.normal, w * k, h * k), false);
      }
      wrap.style.width = pw + 'px';
      wrap.style.height = ph + 'px';
      // the page's corners in the room (top-left, top-right, bottom-right, bottom-left)
      const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => add(add(centre, s.right, (x * pw * k) / 2), s.up, (y * ph * k) / 2));
      this.root.append(wrap);
      this.objects[name] = { app, wrap, frame, glass, corners, px: [[0, 0], [pw, 0], [pw, ph], [0, ph]], src: app.src, dim: DIM, to: DIM };
    }
    addEventListener('message', (e) => { if (e.data?.type === 'room-back') onBack(); });
  }

  /** Start the pages (once the room is entered: nothing loads before it's needed). */
  load() {
    for (const [name, o] of Object.entries(this.objects)) {
      if (o.frame.src) continue;
      o.frame.addEventListener('load', () => this.wake(o, this.active === name));
      o.frame.src = o.src;
    }
  }

  get flat() { return innerWidth < 760 || innerHeight > innerWidth * 1.1; }

  wake(o, on) { o.frame.contentWindow?.postMessage({ type: 'room-focus', on }, '*'); }

  show(name, app) {
    const o = this.objects[name];
    if (!o) return;
    const src = ALT[app] || o.app.src;
    const swapped = o.src !== src;
    if (swapped) { o.frame.src = src; o.src = src; }
    this.active = name;
    document.body.classList.add('screen-focus');
    this.wake(o, true);
    if (this.flat) {
      this.sheet ||= Object.assign(document.createElement('div'), { id: 'app-sheet' });
      document.body.append(this.sheet);
      this.sheet.innerHTML = '';
      const f = Object.assign(document.createElement('iframe'), { src, className: 'flat', title: o.frame.title });
      f.addEventListener('load', () => f.contentWindow?.postMessage({ type: 'room-focus', on: true }, '*'));
      this.sheet.append(f);
      requestAnimationFrame(() => this.sheet.classList.add('on'));
      setTimeout(() => f.focus(), 350);
    } else {
      o.wrap.classList.add('on');
      o.to = 0;
      o.glass.sheen = 0.5;
      // keys go to the page only once it can answer them (Escape still works meanwhile)
      if (swapped) o.frame.addEventListener('load', () => this.active === name && o.frame.focus(), { once: true });
      else setTimeout(() => o.frame.focus(), 350);
    }
  }

  hide() {
    for (const o of Object.values(this.objects)) {
      o.wrap.classList.remove('on');
      o.to = DIM;
      o.glass.sheen = 1;
      if (o.src !== o.app.src) { o.frame.src = o.app.src; o.src = o.app.src; }
      this.wake(o, false);
    }
    this.sheet?.classList.remove('on');
    document.body.classList.remove('screen-focus');
    this.active = null;
  }

  /** Ease the dimming; true while it still changes (the view must redraw). */
  update(dt) {
    let moving = false;
    for (const o of Object.values(this.objects)) {
      if (o.dim === o.to) continue;
      o.dim = Math.abs(o.to - o.dim) < 0.004 ? o.to : o.dim + (o.to - o.dim) * Math.min(1, dt * 6);
      o.glass.dim = o.dim;
      moving = true;
    }
    return moving;
  }

  /** Map each page onto its screen as the camera sees it. */
  render(cam, w, h) {
    for (const o of Object.values(this.objects)) place(o, cam.viewProj, w, h);
  }

  set visible(on) { this.root.style.visibility = on ? '' : 'hidden'; }
}
