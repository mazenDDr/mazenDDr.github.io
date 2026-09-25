import * as THREE from 'three';
import { loadRoom } from './room.js';
import { Director } from './director.js';
import { Hotspots, PARENT } from './hotspots.js';
import { playIntro, setMuted } from './intro.js';
import { Screens } from './screens.js';
import { createPost, LOOK, SCALES } from './post.js';

const canvas = document.getElementById('room');
// alpha: the live screens show through holes in the canvas (see screens.js).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;   // the room renders linear light; post.js grades it

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 80);
camera.userData.canvas = canvas;
const params = new URLSearchParams(location.search);
const anchors = await (await fetch('public/anchors.json')).json();

// Blender keeps the horizontal field of view fixed; do the same so framing
// matches the renders on any window shape (capped on tall phones).
let hfov = 60;
function setHfov(deg) {
  hfov = deg;
  const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / camera.aspect);
  camera.fov = Math.min(THREE.MathUtils.radToDeg(v), 105);
  camera.updateProjectionMatrix();
}
let post = null, screens = null, redraw = true, door = null;
function resize() {
  redraw = true;
  renderer.setSize(innerWidth, innerHeight, false);
  post?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  setHfov(hfov);
}
resize();
addEventListener('resize', resize);

// ---- everything the hallway needs exists at once; the room streams in behind it
const director = new Director(camera, anchors, setHfov);
director.snap('hall');
const portfolio = fetch('content/portfolio.json').then((r) => r.json());
const lightbox = document.getElementById('lightbox');
async function openCertificate(id) {
  const c = (await portfolio).certificates.find((x) => x.id === id);
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
addEventListener('keydown', (e) => { if (e.key === 'Escape') goBack(); });
const mute = document.getElementById('mute');
let muted = false;
mute.addEventListener('click', () => { muted = !muted; setMuted(muted); mute.textContent = muted ? '🔇' : '🔊'; mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound'); });
const syncHud = () => {
  const p = director.place;
  back.classList.toggle('on', spots.enabled && !director.busy && p !== 'room' && p !== 'hall');
  back.textContent = director.focus ? '← Back' : '← Stand up';
};
director.addEventListener('arrive', syncHud);
director.addEventListener('leave', () => { back.classList.remove('on'); screens?.hide(); });
director.addEventListener('focus', (e) => screens?.show(e.detail.name, (e.detail.place === 'games') && 'games'));

function showHint() {
  const hint = document.getElementById('hint');
  const touch = matchMedia('(pointer: coarse)').matches;
  hint.textContent = touch ? 'Tap where an arrow points to go there · drag to look around'
    : 'Click where an arrow points to go there · hover to see what it is · Esc to stand up';
  hint.classList.add('on');
  setTimeout(() => hint.classList.remove('on'), 6500);
}

// Upright phones are asked to turn sideways (CSS shows #rotate); where the browser
// allows it (Android), a button goes full screen and turns the view itself.
const rotate = document.getElementById('rotate');
const stayPortrait = () => { document.body.classList.add('rotate-ok'); try { sessionStorage.setItem('portrait-ok', '1'); } catch {} };
try { if (sessionStorage.getItem('portrait-ok')) document.body.classList.add('rotate-ok'); } catch {}
rotate.querySelector('.stay').addEventListener('click', stayPortrait);
const turn = rotate.querySelector('.turn');
if (document.documentElement.requestFullscreen && screen.orientation?.lock) {
  turn.hidden = false;
  turn.addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch { stayPortrait(); }
  });
}

const knockBtn = document.querySelector('#intro .knock span');
knockBtn.textContent = 'Knock on the door';
let progress = 0;
// On the website (window.ROOM_LIVE, set by the page's device check) the room starts
// small and streams its full textures in; the capture tools load it all at once.
const live = !!window.ROOM_LIVE;
const bar = document.querySelector('#loading .bar i');
const uploads = [];
const roomReady = loadRoom(renderer, (p) => { progress = p; if (bar) bar.style.width = `${p * 100}%`; }, anchors.door.hinge, { lite: live }).then(({ room, parts, stream }) => {
  stream(uploads);                  // sharper pictures from now on, the landing first
  scene.add(room);
  post = createPost(renderer, scene, camera);
  post.onChange = () => { redraw = true; };
  screens = new Screens(anchors, scene, LOOK.exposure, goBack);
  door = parts.door;
  resize();
  document.getElementById('loading')?.classList.add('done');    // the 3D view takes over from the still
  document.body.classList.add('drawn');
  return { door: parts.door, parts };
});

const intro = playIntro({
  room: roomReady, progress: () => progress, openAngle: anchors.door.open_angle_deg, director, doodles: spots.doodles, camera,
  onDone: () => { spots.enabled = true; syncHud(); showHint(); },
});

// URL shortcuts for testing and deep links: ?place=desk, ?skip (no intro), ?view=hero (a Blender camera).
const deep = params.get('place') || location.hash.slice(1);
if (params.has('still')) document.body.classList.add('still');   // tools/hall_still.py: the bare hallway
roomReady.then(async ({ parts }) => {
  if (params.has('view')) {
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
  }
  window.__room = { scene, camera, parts, renderer, director, spots, screens, post, invalidate, quality: () => SCALES[level], ready: true };
});

// ---- drawing only what changed
// The room is baked, so a still view is a still picture: nothing is redrawn until
// the camera, the door or a screen's dimming changes. Sitting and reading costs
// the GPU nothing. While moving, a GPU that can't hold the frame rate draws the
// room smaller (dynamic resolution, as games do), and the moment the view stops
// it gets one full-quality frame, so what you look at is never degraded.
const drawn = new Float64Array(33);
function viewChanged() {
  camera.updateMatrixWorld();
  const now = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, door ? door.rotation.y : 0];
  let changed = false;
  for (let i = 0; i < now.length; i++) if (Math.abs(now[i] - drawn[i]) > 1e-5) changed = true;
  return changed ? now : null;
}
let level = 0, slow = 0, quick = 0, soft = false, wasMoving = false;
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const raw = timer.getDelta(), dt = Math.min(raw, 0.05);
  if (!params.has('view')) director.update(dt); else director.apply();
  spots.update();
  if (!post) return;
  // a sharper texture onto the GPU: one per frame, never mid-flight (no hitches)
  if (uploads.length && !director.busy) { uploads.shift()(); redraw = true; }
  const view = viewChanged();
  const moving = !!view || screens.update(dt);
  if (moving || redraw) {
    if (moving && wasMoving) {                      // how long the last moving frame really took
      if (raw > 1 / 42) { slow++; quick = 0; } else if (raw < 1 / 56) { quick++; slow = 0; }
      if (slow > 6 && level < SCALES.length - 1) { level++; slow = 0; }
      if (live) watchdog(raw);
      if (quick > 120 && level > 0) { level--; quick = 0; }
    }
    const scale = moving && !redraw ? SCALES[level] : 1;
    post.render(timer.getElapsed(), scale);
    screens.render(camera);
    if (view) drawn.set(view);
    soft = scale < 1;
    redraw = false;
  } else if (soft) {                               // stopped: the full-quality frame
    post.render(timer.getElapsed(), 1);
    soft = false;
  }
  wasMoving = moving;
});
const invalidate = () => { redraw = true; };
window.__room = { director, spots, camera, invalidate, ready: false };

// This machine can't draw the room smoothly even at the smallest size: take the visitor
// to the pre-rendered room instead (same place), and remember it for next time.
let slowFrames = 0, movingFrames = 0;
function watchdog(raw) {
  movingFrames++;
  if (level === SCALES.length - 1 && raw > 1 / 22) slowFrames++;
  if (movingFrames > 90 && slowFrames > movingFrames * 0.4) {
    try { localStorage.setItem('room-mode', 'tour'); } catch { /* private mode */ }
    const place = director.place && director.place !== 'hall' ? director.place : 'room';
    location.replace(`${location.pathname}?mode=tour&place=${place}`);
  }
}
