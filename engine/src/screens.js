// The live screens. The TV, the PC and the pinboard run all the time as real
// pages (iframes) mapped onto their surfaces with one projective CSS matrix each, *behind* the
// transparent WebGL canvas. The 3D room punches a hole where each one shows
// (alpha 0, with depth), so anything in front of a screen still covers it.
//
// On the TV and the PC the hole is the tube's real glass (its mesh comes from
// anchors.json), so the page shows exactly inside the glass outline, bezel and
// rounded corners included, like a picture *in* the tube rather than on top of
// it. Over it, the same glass is drawn again: darker towards the rim where the
// tube curves away, with the room's lights reflected in its curvature.
import * as THREE from 'three';
import { place } from '../../src/tour/homography.js';

// Pixel size each app is designed for (the aspect matches the glass), and the
// black border a CRT leaves around its picture, as a fraction of the glass.
const APPS = {
  tv: { src: 'apps/tv/?room', px: [1280, 975], crt: true, border: 0.045 },
  pc: { src: 'apps/pc/?room', px: [1024, 770], crt: true, border: 0.035 },
  memo: { src: 'apps/memo/?room', px: [1300, 900], crt: false },
};
const ALT = { games: 'apps/games/?room' };      // other apps a screen can switch to

// Lights the glass reflects (three.js coordinates): window, ceiling lamp, floor lamp.
const LIGHTS = [[1.7, 1.45, 0.05, 2.2], [1.7, 1.99, -2.57, 1.4], [3.0, 1.41, -4.06, 1.0]];

// Seen from across the room a page is dimmed into the room's light (and lit fully
// when you sit in front of it). Done here, over the page, not with a CSS filter:
// a filtered 1280-px page costs the browser a full redraw on every frame.
const DIM = 0.42;

const holeMaterial = new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
  blending: THREE.NoBlending,
  side: THREE.DoubleSide,
});

function glassMaterial(exposure, crt) {
  return new THREE.ShaderMaterial({
    defines: { CRT: crt ? 1 : 0 },
    uniforms: {
      dim: { value: DIM },
      lights: { value: LIGHTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)) },
      power: { value: LIGHTS.map((l) => l[3]) },
      gain: { value: 2 ** -exposure },           // the final pass exposes by 2^exposure
      sheen: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 face;
      varying vec2 vFace;
      varying vec3 vPos, vNormal;
      void main() {
        vFace = face;
        vPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 lights[3];
      uniform float power[3];
      uniform float gain, sheen, dim;
      varying vec2 vFace;
      varying vec3 vPos, vNormal;
      void main() {
        vec3 warm = vec3(0.030, 0.018, 0.008) * dim;    // the room's lamplight on the glass
        #if CRT == 0
          gl_FragColor = vec4(warm * gain * 0.05, dim);
          return;
        #endif
        // The tube curves away at the rim: darker there, in a rounded-rectangle falloff.
        vec2 q = abs(vFace);
        float rim = pow(pow(q.x, 8.0) + pow(q.y, 8.0), 0.125);
        float dark = max(smoothstep(0.62, 1.02, rim) * 0.78, dim);
        // Glass reflects a little head-on and more at grazing angles (Schlick).
        vec3 n = normalize(vNormal), v = normalize(cameraPosition - vPos);
        if (dot(n, v) < 0.0) n = -n;
        float f = 0.035 + 0.965 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 c = warm + vec3(0.020, 0.015, 0.011) * (0.6 + 0.4 * r.y) * f / 0.035;   // the dim room, warmer below
        for (int i = 0; i < 3; i++) {
          vec3 l = normalize(lights[i] - vPos);
          float s = max(dot(r, l), 0.0);
          c += vec3(1.0, 0.8, 0.6) * power[i] * (pow(s, 90.0) * 0.5 + pow(s, 12.0) * 0.035);
        }
        // premultiplied: the page behind keeps (1 - dark) of its light, reflections add
        gl_FragColor = vec4(c * gain * 0.05 * sheen, dark);
      }`,
    transparent: true, premultipliedAlpha: true, depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
}

/** The glass mesh, plus each vertex's place on the face (-1..1 across and up). */
function glassGeometry(g, s) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
  geo.setIndex(g.index);
  const c = new THREE.Vector3().fromArray(s.center), right = new THREE.Vector3().fromArray(s.right), up = new THREE.Vector3().fromArray(s.up);
  const p = new THREE.Vector3(), face = [];
  for (let i = 0; i < g.position.length; i += 3) {
    p.fromArray(g.position, i).sub(c);
    face.push(p.dot(right) / (s.width / 2), p.dot(up) / (s.height / 2));
  }
  geo.setAttribute('face', new THREE.Float32BufferAttribute(face, 2));
  geo.computeBoundingSphere();
  return geo;
}

export class Screens {
  constructor(anchors, scene, exposure, onBack) {
    const el = document.createElement('div');
    el.id = 'screens';
    document.body.prepend(el);                     // behind the canvas
    this.root = el;
    this.objects = {};
    this.active = null;
    for (const [name, app] of Object.entries(APPS)) {
      const s = anchors.screens[name];
      const g = app.crt && anchors.glass?.[name];
      const [w, h] = app.px;
      const frame = document.createElement('iframe');
      frame.title = { tv: 'TV', pc: 'Computer', memo: 'Pinboard' }[name];
      frame.style.cssText = `width:${w}px;height:${h}px;border:0;background:#000`;
      frame.src = app.src;
      frame.addEventListener('load', () => this.wake(this.objects[name], this.active === name));
      const wrap = document.createElement('div');
      wrap.className = 'screen-app' + (app.crt ? ' crt' : '');
      wrap.dataset.name = name;
      wrap.append(frame);
      const right = new THREE.Vector3().fromArray(s.right), up = new THREE.Vector3().fromArray(s.up);
      const n = new THREE.Vector3().fromArray(s.normal);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
      let k, hole, glass = null, pw = w, ph = h;
      if (g) {
        // The picture fills the glass less its border; the black around it runs past
        // the glass on every side so its outline never shows an edge.
        k = Math.min(s.width / w, s.height / h) * (1 - 2 * app.border);
        pw = Math.ceil(s.width * 1.06 / k); ph = Math.ceil(s.height * 1.06 / k);
        wrap.style.cssText = `width:${pw}px;height:${ph}px`;
        frame.style.margin = `${(ph - h) / 2}px ${(pw - w) / 2}px`;
        const geo = glassGeometry(g, s);
        hole = new THREE.Mesh(geo, holeMaterial);
        glass = new THREE.Mesh(geo, glassMaterial(exposure, true));
      } else {
        k = Math.min(s.width / w, s.height / h) * 0.97;   // fit inside the board, keep the app's aspect
        const geo = new THREE.PlaneGeometry(w * k, h * k);
        geo.setAttribute('face', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 2).fill(0), 2));
        hole = new THREE.Mesh(geo, holeMaterial);
        hole.quaternion.copy(q);
        hole.position.fromArray(s.center).addScaledVector(n, 0.002);
        glass = new THREE.Mesh(geo, glassMaterial(exposure, false));
        glass.quaternion.copy(q);
        glass.position.copy(hole.position);
      }
      hole.renderOrder = 1;
      glass.renderOrder = 2;
      scene.add(hole, glass);
      // the page's corners in the room (TL TR BR BL): mapped onto the screen each frame
      const c = new THREE.Vector3().fromArray(s.center);
      if (g) c.addScaledVector(n, -0.006);             // a little into the tube, under the curved front
      const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => c.clone().addScaledVector(right, (x * pw * k) / 2).addScaledVector(up, (y * ph * k) / 2).toArray());
      if (!g) wrap.style.cssText = `width:${w}px;height:${h}px`;
      el.append(wrap);
      this.objects[name] = { wrap, frame, hole, glass, corners, px: [[0, 0], [pw, 0], [pw, ph], [0, ph]], src: app.src, dim: DIM, to: DIM };
    }
    // Apps ask to leave with Escape (keys inside an iframe never reach this page).
    addEventListener('message', (e) => { if (e.data?.type === 'room-back') onBack(); });

  }

  /** Narrow or portrait screens can't read a 1280-px app shrunk onto a TV. */
  get flat() { return innerWidth < 760 || innerHeight > innerWidth * 1.1; }

  /** Tell an app whether it's being looked at, so idle ones stop animating. */
  wake(o, on) { o.frame.contentWindow?.postMessage({ type: 'room-focus', on }, '*'); }

  /** Zoom in on a screen: full brightness, pointer on, and switch app if asked. */
  show(name, app) {
    const o = this.objects[name];
    if (!o) return;
    const src = ALT[app] || APPS[name].src;
    if (o.src !== src) { o.frame.src = src; o.src = src; }
    this.active = name;
    document.body.classList.add('screen-focus');
    this.wake(o, true);
    this.changed = true;
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
      o.to = 0;
      o.glass.material.uniforms.sheen.value = 0.5;
      setTimeout(() => o.frame.focus(), 350);
    }
    this.changed = true;
  }

  /** Back to watching from the room. The games give the TV back to Mazenflix. */
  hide() {
    for (const [name, o] of Object.entries(this.objects)) {
      o.wrap.classList.remove('on');
      o.to = DIM;
      o.glass.material.uniforms.sheen.value = 1;
      if (o.src !== APPS[name].src) { o.frame.src = APPS[name].src; o.src = APPS[name].src; }
      this.wake(o, false);
    }
    this.sheet?.classList.remove('on');
    document.body.classList.remove('screen-focus');
    this.active = null;
    this.changed = true;
  }

  resize() {}

  /** Ease the dimming in and out; true while it's still changing (the room must redraw). */
  update(dt) {
    let moving = this.changed;
    this.changed = false;
    for (const o of Object.values(this.objects)) {
      if (o.dim === o.to) continue;
      o.dim = Math.abs(o.to - o.dim) < 0.004 ? o.to : o.dim + (o.to - o.dim) * Math.min(1, dt * 6);
      o.glass.material.uniforms.dim.value = o.dim;
      moving = true;
    }
    return moving;
  }

  render(camera) {
    // each page onto its screen with one flat matrix (works in Safari; hidden when out of view)
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    for (const o of Object.values(this.objects)) place(o, m, innerWidth, innerHeight);
  }
}
