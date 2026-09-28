import * as THREE from 'three';
import { loadRoom } from './room.js';
import { Director } from './director.js';
import { Hotspots, PARENT } from './hotspots.js';
import { playIntro, setMuted } from './intro.js';
import { Screens } from './screens.js';
import { createPost, LOOK, SCALES } from './post.js';
import { PLACES } from './places.js';
import { fetchAsset } from '../../src/tour/cdn.js';

const canvas = document.getElementById('room');
// alpha: the live screens show through holes in the canvas (see screens.js).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;   // the room renders linear light; post.js grades it

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 80);
camera.userData.canvas = canvas;
const params = new URLSearchParams(location.search);
const anchors = await (await fetchAsset('public/anchors.json')).json();

// Blender keeps the horizontal field of view fixed; do the same so framing
// matches the renders on any window shape (capped on tall phones).
let hfov = 60;
function setHfov(deg) {
  hfov = deg;
  const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / camera.aspect);
  camera.fov = Math.min(THREE.MathUtils.radToDeg(v), 105);
  camera.updateProjectionMatrix();
}
let post = null, screens = null, redraw = true, door = null, bench = null, warmed = false;
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
// iPhone Safari can't make a page full screen; opened from the Home Screen, the room fills it
const homeTip = rotate.querySelector('.home');
if (homeTip) homeTip.hidden = !(/iPhone|iPod/.test(navigator.userAgent) && !navigator.standalone);
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
// small and streams sharper textures in; the capture tools load it all at once.
const live = !!window.ROOM_LIVE;
const bar = document.querySelector('#loading .bar i');
const uploads = [];
// Loading shown under the knock: the first model (a third of the way), then every sharper
// picture. The door opens only when the whole room is there at full quality.
let first = 0, streaming = null;
const loadBar = document.querySelector('#intro .load');
function showProgress() {
  progress = 0.35 * first + 0.65 * (streaming ? streaming.progress() : 0);
  if (bar) bar.style.width = `${progress * 100}%`;
  if (loadBar) {
    loadBar.querySelector('i').style.width = `${progress * 100}%`;
    loadBar.querySelector('.pct').textContent = `${Math.floor(progress * 100)}%`;
  }
}
const roomReady = loadRoom(renderer, (p) => { first = p; showProgress(); }, anchors.door.hinge,
  { lite: live, tier: window.ROOM_TIER }).then(async ({ room, parts, stream }) => {
  performance.mark('room-loaded');
  streaming = stream(uploads);      // every sharper picture, the landing first
  const ticker = setInterval(showProgress, 200);
  scene.add(room);
  post = createPost(renderer, scene, camera);
  post.onChange = () => { redraw = true; };
  // Phones and tablets: stills on the screens, apps full screen (screens.js); ?pictures / ?pictures=0 force it on / off
  screens = new Screens(anchors, scene, LOOK.exposure, goBack, { pictures: params.has('pictures') ? params.get('pictures') !== '0' : /Android/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches });
  post.after = () => screens.drawUnder(renderer, camera);
  door = parts.door;
  resize();
  if (live) await warmUp();
  // Full quality before the door opens: every sharper picture downloaded and put on the GPU
  // now, a few per frame while the visitor knocks, and the screens' stills in place.
  await streaming.done;
  while (uploads.length) {
    for (let i = 0; i < 3 && uploads.length; i++) { const t = uploads.shift()(); if (t) renderer.initTexture(t); }
    redraw = true;
    await new Promise((r) => requestAnimationFrame(r));
  }
  await screens.picturesReady;
  clearInterval(ticker);
  first = 1; showProgress();
  loadBar?.classList.add('ready');
  warmed = true;                    // (nothing is left to stream now)
  performance.mark('room-ready');
  document.getElementById('loading')?.classList.add('done');    // the 3D view takes over from the still
  document.body.classList.add('drawn');
  return { door: parts.door, parts };
});

// ---- ready before the door opens (the visitor is still knocking): every shader compiled,
// every texture on the GPU, and the room itself drawn off screen and timed, so the way in
// runs at the size this GPU can hold from its very first frame, with no hitch. A GPU that
// can't draw the room at 20 frames a second even at the smallest size goes to the pictures.
async function warmUp() {
  const p = PLACES.room;
  const pose = () => { camera.position.copy(p.eye); camera.lookAt(p.look); setHfov(p.hfov); camera.updateMatrixWorld(); };
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));   // a step per frame: the knocking stays smooth
  pose();
  // compiled for where the room is really drawn (post's target: no tone mapping, linear), in parallel where the GPU allows
  renderer.setRenderTarget(post.target);
  const compiled = renderer.compileAsync(scene, camera).catch(() => { /* compiled on first draw instead */ });
  renderer.setRenderTarget(null);
  await compiled;
  const textures = new Set();
  scene.traverse((o) => { for (const u of Object.values(o.material?.uniforms || {})) if (u.value?.isTexture) textures.add(u.value); });
  let batch = 0;
  for (const t of textures) { renderer.initTexture(t); if (++batch % 24 === 0) await frame(); }
  // each timing in a frame of its own; the loop puts the camera back in between
  const ms = async (scale) => { const t = []; for (let i = 0; i < 4; i++) { await frame(); pose(); t.push(post.time(scale)); director.apply(); } return t.slice(1).sort((a, b) => a - b)[1]; };
  const times = [];
  let fits = 0;
  for (; fits < SCALES.length; fits++) {
    times.push(Math.round(await ms(SCALES[fits]) * 10) / 10);
    if (times[fits] < 22) break;
  }
  bench = times;
  level = Math.min(fits, SCALES.length - 1);
  if (fits === SCALES.length && times[times.length - 1] > 50) return toPictures();
}

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
  window.__room = { scene, camera, parts, renderer, director, spots, screens, post, invalidate, quality: () => SCALES[level], bench, ready: true };
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
// A smaller size is tried, not assumed: if frames come no faster at it, it isn't the GPU
// holding them back (a browser saving battery caps pages at 30 frames a second), so the
// sharper size comes back, and frames that slow don't lower it again.
let pace = 1 / 60, trial = null, capped = 0;
let lastMove = 0, lastUpload = 0;
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const raw = timer.getDelta(), dt = Math.min(raw, 0.05);
  if (!params.has('view')) director.update(dt); else director.apply();
  spots.update();
  if (!post) return;
  // A sharper texture onto the GPU: one per frame, never while the view moves (a 4096-px
  // one can take a GPU 100 ms: a jolt mid-move, unseen while still); at most one a second
  // for someone who never stops looking around.
  const now = timer.getElapsed();
  if (uploads.length && !director.busy && warmed && (now - lastMove > 0.2 || now - lastUpload > 1)) {
    uploads.shift()();
    redraw = true;
    lastUpload = now;
  }
  const view = viewChanged();
  if (view) lastMove = now;
  const moving = !!view || screens.update(dt);
  if (moving || redraw) {
    if (moving && wasMoving) {                      // how long the last moving frame really took
      pace += (raw - pace) * 0.1;
      if (trial) {
        trial.sum += raw;
        if (++trial.n >= 12) {
          if (trial.sum / trial.n > trial.before * 0.85) { level = trial.from; capped = trial.before * 1.2; }   // no faster: keep it sharp
          trial = null;
        }
      } else {
        if (raw > 1 / 42 && raw > capped) { slow++; quick = 0; } else if (raw < 1 / 56) { quick++; slow = 0; }
        if (slow > 6 && level < SCALES.length - 1) { trial = { from: level, before: pace, n: 0, sum: 0 }; level++; slow = 0; }
        if (quick > 120 && level > 0) { level--; quick = 0; }
      }
      if (live) watchdog(raw);
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
  if ((level === SCALES.length - 1 || capped) && raw > 1 / 22) slowFrames++;   // (capped: a smaller size didn't help)
  if (movingFrames > 90 && slowFrames > movingFrames * 0.4) toPictures();
}
let leaving = false;
function toPictures() {
  if (params.has('stay')) return Promise.resolve();   // ?stay: keep the live room even on a GPU this slow (tests)
  if (leaving) return new Promise(() => {});
  leaving = true;
  try { localStorage.setItem('room-mode', `tour:${Date.now()}`); } catch { /* private mode */ }
  const place = director.place && director.place !== 'hall' ? director.place : 'room';
  const knocked = document.getElementById('intro')?.classList.contains('knocking') ? '&knocked' : '';
  location.replace(`${location.pathname}?mode=tour${director.place === 'hall' ? knocked : `&place=${place}`}`);
  return new Promise(() => {});                    // the door never opens here
}

// A phone can take the GPU's memory back (a background tab, a low-memory moment); the
// page's copies of the textures are gone by then (room.js frees them), so start again
// where the visitor was.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const place = director.place && director.place !== 'hall' ? `?place=${director.place}` : '';
  addEventListener('webglcontextrestored', () => location.replace(location.pathname + place), { once: true });
  if (document.visibilityState === 'visible') setTimeout(() => location.replace(location.pathname + place), 1500);
});
