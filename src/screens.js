// The live screens: each app runs in an iframe placed exactly on its screen
// (TV, PC monitor, pinboard) with CSS3DRenderer. They only show while the
// visitor is zoomed in, when nothing can stand in front of them.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// Pixel size each app is designed for; the aspect matches the measured screen.
const APPS = {
  tv: { src: 'apps/tv/?room', px: [1280, 975] },
  pc: { src: 'apps/pc/?room', px: [1024, 770] },
  memo: { src: 'apps/memo/?room', px: [1300, 900] },
};

export class Screens {
  constructor(anchors, onBack) {
    this.renderer = new CSS3DRenderer();
    const el = this.renderer.domElement;
    el.id = 'screens';
    document.body.append(el);
    this.scene = new THREE.Scene();
    this.objects = {};
    this.active = null;
    for (const [name, app] of Object.entries(APPS)) {
      const s = anchors.screens[name];
      const [w, h] = app.px;
      const frame = document.createElement('iframe');
      frame.title = { tv: 'TV', pc: 'Computer', memo: 'Pinboard' }[name];
      frame.style.cssText = `width:${w}px;height:${h}px;border:0;background:#000`;
      frame.dataset.src = app.src;
      const wrap = document.createElement('div');
      wrap.className = 'screen-app';
      wrap.append(frame);
      const obj = new CSS3DObject(wrap);
      // Basis from the measured plane: right, up, and the normal out of the screen.
      const right = new THREE.Vector3().fromArray(s.right), up = new THREE.Vector3().fromArray(s.up);
      const n = new THREE.Vector3().fromArray(s.normal);
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
      obj.position.fromArray(s.center).addScaledVector(n, 0.002);
      // Fit inside the screen, keeping the app's aspect (CRT corners stay dark).
      obj.scale.setScalar(Math.min(s.width / w, s.height / h) * 0.97);
      this.scene.add(obj);
      this.objects[name] = { obj, wrap, frame };
    }
    // Apps ask to leave with Escape (keys inside an iframe never reach this page).
    addEventListener('message', (e) => { if (e.data?.type === 'room-back') onBack(); });
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Start loading the apps in the background so zooming in is instant. */
  preload() {
    for (const { frame } of Object.values(this.objects)) if (!frame.src) frame.src = frame.dataset.src;
  }

  /** Narrow or portrait screens can't read a 1280-px app shrunk onto a TV. */
  get flat() { return innerWidth < 760 || innerHeight > innerWidth * 1.1; }

  show(name) {
    this.preload();
    this.hide();
    const o = this.objects[name];
    if (!o) return;
    this.active = name;
    if (this.flat) {
      // Move the iframe into a full-screen sheet (moving an iframe reloads it; fine here).
      this.sheet ||= Object.assign(document.createElement('div'), { id: 'app-sheet' });
      document.body.append(this.sheet);
      this.sheet.append(o.frame);
      o.frame.classList.add('flat');
      requestAnimationFrame(() => this.sheet.classList.add('on'));
    } else {
      o.wrap.classList.add('on');
    }
    setTimeout(() => o.frame.focus(), 350);
  }

  hide() {
    for (const o of Object.values(this.objects)) {
      o.wrap.classList.remove('on');
      if (o.frame.classList.contains('flat')) { o.frame.classList.remove('flat'); o.wrap.append(o.frame); }
    }
    this.sheet?.classList.remove('on');
    this.active = null;
  }

  resize() { this.renderer.setSize(innerWidth, innerHeight); }

  render(camera) { this.renderer.render(this.scene, camera); }
}
