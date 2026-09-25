// The live screens. The TV, the PC and the pinboard run all the time as real
// pages (iframes) placed on their surfaces with CSS3DRenderer, *behind* the
// transparent WebGL canvas. The 3D room punches a screen-shaped hole where each
// one is (alpha 0, with depth), so the page shows through and anything in front
// of a screen still covers it. On top, the tubes get a CRT glare. From across
// the room the pages are dimmed to sit in the room's light; zoomed in, they are
// full brightness and take the pointer.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// Pixel size each app is designed for; the aspect matches the measured screen.
const APPS = {
  tv: { src: 'apps/tv/?room', px: [1280, 975], crt: true },
  pc: { src: 'apps/pc/?room', px: [1024, 770], crt: true },
  memo: { src: 'apps/memo/?room', px: [1300, 900], crt: false },
};
const ALT = { games: 'apps/games/?room' };      // other apps a screen can switch to

const holeMaterial = new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  blending: THREE.NoBlending,
});

/** A CRT tube's glass: a soft curved highlight, a window reflection, a sheen
 *  along the top and darker corners, as a texture with alpha. */
function glareTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 390 }), g = c.getContext('2d');
  const W = c.width, H = c.height;
  let grd = g.createRadialGradient(W * 0.28, H * 0.22, 10, W * 0.28, H * 0.22, W * 0.55);
  grd.addColorStop(0, 'rgba(255,255,255,0.34)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W * 0.2, H * 0.14); g.rotate(-0.28);
  grd = g.createLinearGradient(0, 0, 0, 40);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.20)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath(); g.ellipse(80, 20, 150, 22, 0, 0, Math.PI * 2); g.fill(); g.restore();
  grd = g.createLinearGradient(0, 0, 0, H * 0.12);
  grd.addColorStop(0, 'rgba(255,255,255,0.16)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H * 0.12);
  grd = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, W * 0.62);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Screens {
  constructor(anchors, scene, exposure, onBack) {
    this.renderer = new CSS3DRenderer();
    const el = this.renderer.domElement;
    el.id = 'screens';
    document.body.prepend(el);                     // behind the canvas
    this.scene = new THREE.Scene();
    this.objects = {};
    this.active = null;
    const glare = glareTexture();
    for (const [name, app] of Object.entries(APPS)) {
      const s = anchors.screens[name];
      const [w, h] = app.px;
      const frame = document.createElement('iframe');
      frame.title = { tv: 'TV', pc: 'Computer', memo: 'Pinboard' }[name];
      frame.style.cssText = `width:${w}px;height:${h}px;border:0;background:#000`;
      frame.src = app.src;
      const wrap = document.createElement('div');
      wrap.className = 'screen-app';
      wrap.dataset.name = name;
      wrap.append(frame);
      const obj = new CSS3DObject(wrap);
      const right = new THREE.Vector3().fromArray(s.right), up = new THREE.Vector3().fromArray(s.up);
      const n = new THREE.Vector3().fromArray(s.normal);
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
      obj.position.fromArray(s.center).addScaledVector(n, 0.002);
      const k = Math.min(s.width / w, s.height / h) * 0.97;   // fit inside the screen, keep the app's aspect
      obj.scale.setScalar(k);
      this.scene.add(obj);
      // The hole in the room where the page shows, exactly the page's size.
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k), holeMaterial);
      hole.quaternion.copy(obj.quaternion);
      hole.position.copy(obj.position);
      hole.renderOrder = 1;
      scene.add(hole);
      let glass = null;
      if (app.crt) {
        glass = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k), new THREE.MeshBasicMaterial({
          map: glare, transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1).multiplyScalar(2 ** -exposure * 0.5),
        }));
        glass.quaternion.copy(obj.quaternion);
        glass.position.copy(obj.position).addScaledVector(n, 0.001);
        glass.renderOrder = 2;
        scene.add(glass);
      }
      this.objects[name] = { obj, wrap, frame, hole, glass, src: app.src };
    }
    // Apps ask to leave with Escape (keys inside an iframe never reach this page).
    addEventListener('message', (e) => { if (e.data?.type === 'room-back') onBack(); });
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Narrow or portrait screens can't read a 1280-px app shrunk onto a TV. */
  get flat() { return innerWidth < 760 || innerHeight > innerWidth * 1.1; }

  /** Zoom in on a screen: full brightness, pointer on, and switch app if asked. */
  show(name, app) {
    const o = this.objects[name];
    if (!o) return;
    const src = ALT[app] || APPS[name].src;
    if (o.src !== src) { o.frame.src = src; o.src = src; }
    this.active = name;
    document.body.classList.add('screen-focus');
    if (this.flat) {
      this.sheet ||= Object.assign(document.createElement('div'), { id: 'app-sheet' });
      document.body.append(this.sheet);
      this.sheet.innerHTML = '';
      const f = document.createElement('iframe');
      f.src = src;
      f.className = 'flat';
      f.title = o.frame.title;
      this.sheet.append(f);
      requestAnimationFrame(() => this.sheet.classList.add('on'));
      setTimeout(() => f.focus(), 350);
    } else {
      o.wrap.classList.add('on');
      if (o.glass) o.glass.material.opacity = 0.55;
      setTimeout(() => o.frame.focus(), 350);
    }
  }

  /** Back to watching from the room. The games give the TV back to Mazenflix. */
  hide() {
    for (const [name, o] of Object.entries(this.objects)) {
      o.wrap.classList.remove('on');
      if (o.glass) o.glass.material.opacity = 1;
      if (o.src !== APPS[name].src) { o.frame.src = APPS[name].src; o.src = APPS[name].src; }
    }
    this.sheet?.classList.remove('on');
    document.body.classList.remove('screen-focus');
    this.active = null;
  }

  preload() {}

  resize() { this.renderer.setSize(innerWidth, innerHeight); }

  render(camera) { this.renderer.render(this.scene, camera); }
}
