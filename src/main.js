import * as THREE from 'three';
import { loadRoom } from './room.js';
import { Director } from './director.js';
import { Hotspots, PARENT } from './hotspots.js';
import { playIntro, setMuted } from './intro.js';
import { Screens } from './screens.js';
import { idleScreens } from './idle.js';
import { createPost, LOOK } from './post.js';

const canvas = document.getElementById('room');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;   // the room renders linear light; post.js grades it

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0806);
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 80);
camera.userData.canvas = canvas;

// The title card and knock button show at once over a still of the hallway; a knock
// during loading is remembered and plays as soon as the room is ready.
const knockBtn = document.querySelector('#intro .knock');
let earlyKnock = false;
const knockLabel = knockBtn.querySelector('span');
knockLabel.textContent = 'Loading the room…';
document.getElementById('intro').classList.add('waiting');
const onEarly = () => { earlyKnock = true; knockLabel.textContent = 'Knocking…'; };
knockBtn.addEventListener('click', onEarly);

const anchors = await (await fetch('public/anchors.json')).json();

// Blender keeps the horizontal field of view fixed; do the same so framing
// matches the renders on any window shape (capped on tall phones).
let hfov = 60;
function setHfov(deg) {
  hfov = deg;
  const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / camera.aspect);
  camera.fov = Math.min(THREE.MathUtils.radToDeg(v), 100);
  camera.updateProjectionMatrix();
}
let post = null;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  setHfov(hfov);
}
resize();
addEventListener('resize', resize);

const bar = document.querySelector('#loading .bar i');
const { room, parts } = await loadRoom(renderer, (p) => (bar.style.width = `${p * 100}%`));
scene.add(room);

post = createPost(renderer, scene, camera);
resize();
const director = new Director(camera, anchors, setHfov);
const portfolio = await (await fetch('content/portfolio.json')).json();
const idle = idleScreens(anchors, portfolio);
scene.add(idle.group);
const lightbox = document.getElementById('lightbox');
function openCertificate(id) {
  const c = portfolio.certificates.find((x) => x.id === id);
  lightbox.querySelector('img').src = c.image;
  lightbox.querySelector('img').alt = c.title;
  lightbox.querySelector('figcaption').innerHTML = `<b>${c.title}</b><br>${c.issuer} · ${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  lightbox.hidden = false;
  lightbox.querySelector('button').focus();
}
lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('button')) lightbox.hidden = true; });
const spots = new Hotspots(camera, director, (action) => {
  if (action.startsWith('cert:')) openCertificate(action.slice(5));
});
const back = document.getElementById('back');

function goBack() {
  if (!lightbox.hidden) { lightbox.hidden = true; return; }
  if (director.busy) return;
  const p = director.place;
  if (PARENT[p]) director.goTo(PARENT[p]);
  else if (p !== 'room' && p !== 'hall') director.goTo('room');
}
back.addEventListener('click', goBack);
const mute = document.getElementById('mute');
let muted = false;
mute.addEventListener('click', () => { muted = !muted; setMuted(muted); mute.textContent = muted ? '🔇' : '🔊'; mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound'); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') goBack(); });
const syncHud = () => {
  const p = director.place;
  back.classList.toggle('on', spots.enabled && !director.busy && p !== 'room' && p !== 'hall');
  back.textContent = director.focus ? '← Back' : '← Stand up';
};
director.addEventListener('arrive', syncHud);
director.addEventListener('leave', () => { back.classList.remove('on'); screens.hide(); });
const screens = new Screens(anchors, goBack);
director.addEventListener('focus', (e) => screens.show(e.detail.name));

// URL shortcuts for testing and deep links: ?place=desk, ?skip (no intro).
const params = new URLSearchParams(location.search);
const deep = params.get('place') || location.hash.slice(1);
// Warm light spilling from the room onto the hallway floor as the door opens.
const spillTex = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 256 }), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,190,120,0.9)'); grad.addColorStop(0.5, 'rgba(255,170,100,0.35)'); grad.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = grad; g.beginPath(); g.moveTo(30, 0); g.lineTo(98, 0); g.lineTo(128, 256); g.lineTo(0, 256); g.fill();
  return new THREE.CanvasTexture(c);
})();
const spillMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.7),
  new THREE.MeshBasicMaterial({ map: spillTex, color: new THREE.Color(1, 1, 1).multiplyScalar(2 ** -LOOK.exposure), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
spillMesh.rotation.x = -Math.PI / 2;
spillMesh.position.set(2.94, 0.004, -5.26 - 0.85);
spillMesh.rotation.z = Math.PI;
scene.add(spillMesh);

const intro = playIntro({ door: parts.door, openAngle: anchors.door.open_angle_deg, director, doodles: spots.doodles, camera,
  spill: (e) => { spillMesh.material.opacity = 0.32 * e; },
  onDone: () => { spots.enabled = true; syncHud(); showHint(); setTimeout(() => screens.preload(), 1500); } });

// One short hint on the way in; touch screens get touch words.
function showHint() {
  const hint = document.getElementById('hint');
  const touch = matchMedia('(pointer: coarse)').matches;
  hint.textContent = touch ? 'Tap where an arrow points to go there · drag to look around'
    : 'Click where an arrow points to go there · hover to see what it is · Esc to stand up';
  hint.classList.add('on');
  setTimeout(() => hint.classList.remove('on'), 6500);
}
if (params.has('view')) {                      // exact Blender camera, for render comparisons
  const c = anchors.cameras[params.get('view')] || anchors.review[params.get('view')];
  director.pos.fromArray(c.position);
  director.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(director.pos, new THREE.Vector3().fromArray(c.target), new THREE.Vector3(0, 1, 0)));
  director.hfov = c.hfov_deg;
  director.place = 'room';
  director.pointer.set(0, 0);
  parts.door.rotation.y = THREE.MathUtils.degToRad(anchors.door.open_angle_deg);
  document.getElementById('intro').classList.add('gone');
} else if (deep || params.has('skip')) {
  await intro.skip();
  if (deep && deep !== 'room') director.snap(deep);
  syncHud();
} else {
  director.snap('hall');
  knockBtn.removeEventListener('click', onEarly);
  document.getElementById('intro').classList.remove('waiting');
  knockLabel.textContent = 'Knock on the door';
  if (earlyKnock) setTimeout(() => intro.knock(), 400);
  if (params.has('still')) {           // tools/hall_still.py: the bare hallway, no UI
    document.body.classList.add('still');
  }
}

document.getElementById('loading').classList.add('done');
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  if (!params.has('view')) director.update(dt); else director.apply();
  spots.update();
  idle.update(timer.getElapsed());
  post.render(timer.getElapsed());
  screens.render(camera);
});
window.__room = { scene, camera, parts, renderer, director, spots, screens, post, ready: true };
