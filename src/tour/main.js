// Mazen's room, as pictures: a panorama at each place and a pre-rendered flight
// between them (tools/capture.py renders both with the real-time engine in
// engine/). The browser only shows pictures and plays short videos, so it runs on
// anything, loads in moments and never makes a GPU work hard.
import { Viewer } from './viewer.js';
import { Loader, avifSupported, pickCodec } from './loader.js';
import { Tour, PARENT } from './tour.js';
import { Flight } from './flight.js';
import { Screens } from './screens.js';
import { Hotspots } from './hotspots.js';
import { playIntro, setMuted } from './intro.js';

const { manifest, anchors } = JSON.parse(document.getElementById('tour-data').textContent);
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('room');

async function start() {
  let viewer;
  try { viewer = new Viewer(canvas); } catch {
    // No WebGL at all: the screens are ordinary pages, so offer them directly.
    document.body.classList.add('no-webgl');
    document.getElementById('fallback').hidden = false;
    return;
  }

  let running = false, idle = 0, last = 0, redraw = true, drawn = false;
  /** Something may have changed: run the loop until everything is still again. */
  function wake() {
    idle = 0;
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  const [avif, codec] = await Promise.all([avifSupported(), pickCodec()]);
  const loader = new Loader(manifest, viewer, { avif, codec, onReady: wake });
  const flight = new Flight();
  const tour = new Tour(manifest, anchors, loader, flight, canvas);
  tour.drawNow = () => viewer.render(tour.camera, tour.pano);
  viewer.onRestore = () => { loader.panos = {}; loader.pano(tour.pano, 0); redraw = true; wake(); };
  const screens = new Screens(anchors, viewer, goBack);
  const lightbox = document.getElementById('lightbox');
  const spots = new Hotspots(tour.camera, tour, (action) => { if (action.startsWith('cert:')) openCertificate(action.slice(5)); });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    viewer.resize(innerWidth, innerHeight, dpr);
    tour.resize();
    redraw = true;
    wake();
  }
  resize();
  addEventListener('resize', resize);
  for (const e of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(e, wake, { passive: true });
  tour.addEventListener('change', () => { redraw = true; wake(); });

  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const upload = loader.uploads.shift();          // one picture onto the GPU per frame
    upload?.run();
    // (a picture for somewhere else goes up quietly: only this view's own redraws)
    const moved = tour.update(dt) | screens.update(dt) | (upload?.key === tour.pano) | redraw;
    if (moved) {
      viewer.render(tour.camera, tour.pano);
      screens.render(tour.camera, innerWidth, innerHeight);
      redraw = false;
      idle = 0;
      if (!drawn) { drawn = true; document.body.classList.add('drawn'); }
    } else idle++;
    spots.update();
    // Nothing moving for a while (and nothing waiting): stop until an event wakes us.
    if (idle > 45 && !tour.anim && !loader.uploads.length) { running = false; return; }
    requestAnimationFrame(loop);
  }

  // ---- the heads-up bits
  const back = document.getElementById('back');
  function goBack() {
    if (!lightbox.hidden) { lightbox.hidden = true; return; }
    if (tour.busy) return;
    const p = tour.place;
    if (PARENT[p]) tour.goTo(PARENT[p]);
    else if (p !== 'room' && p !== 'hall') tour.goTo('room');
  }
  back.addEventListener('click', goBack);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') goBack(); });
  const syncHud = () => {
    const p = tour.place;
    back.classList.toggle('on', spots.enabled && !tour.busy && p !== 'room' && p !== 'hall');
    back.textContent = tour.focus ? '← Back' : '← Stand up';
  };
  // Moving: the arrows go at once; the screens stay until the flight covers them, and
  // come back before it fades (hiding them any earlier shows black holes).
  tour.addEventListener('leave', () => { back.classList.remove('on'); screens.hide(); document.body.classList.add('moving'); });
  tour.addEventListener('covered', () => document.body.classList.add('covered'));
  tour.addEventListener('uncovered', () => { document.body.classList.remove('covered'); redraw = true; wake(); });
  tour.addEventListener('arrive', (e) => {
    const p = e.detail.place;
    document.body.classList.remove('moving', 'covered');
    syncHud();
    loader.pano(tour.view(p), 1);                 // this place, sharp
    loader.prefetch(p);                            // where you can go next
    const next = Object.values(manifest.moves).filter((m) => m.from === tour.view(p)).map((m) => m.to);
    loader.trim([tour.view(p), ...next]);
    redraw = true;
    wake();
  });
  tour.addEventListener('focus', (e) => screens.show(e.detail.name, e.detail.place === 'games' && 'games'));
  // Pointing at an arrow starts fetching that flight (before the click).
  spots.onHover = (s) => { if (s?.place && spots.enabled) for (const k of tour.route(tour.place, s.place)) loader.video(k, 1).catch(() => {}); };

  const mute = document.getElementById('mute');
  let muted = false;
  mute.addEventListener('click', () => { muted = !muted; setMuted(muted); mute.textContent = muted ? '🔇' : '🔊'; mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound'); });

  let portfolio;
  async function openCertificate(id) {
    portfolio ||= fetch('content/portfolio.json').then((r) => r.json());
    const c = (await portfolio).certificates.find((x) => x.id === id);
    lightbox.querySelector('img').src = c.image;
    lightbox.querySelector('img').alt = c.title;
    lightbox.querySelector('figcaption').innerHTML = `<b>${c.title}</b><br>${c.issuer} · ${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    lightbox.hidden = false;
    lightbox.querySelector('button').focus();
  }
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('button')) lightbox.hidden = true; });

  function showHint() {
    const hint = document.getElementById('hint');
    const touch = matchMedia('(pointer: coarse)').matches;
    hint.textContent = touch ? 'Tap where an arrow points to go there · drag to look around'
      : 'Click where an arrow points to go there · hover to see what it is · Esc to stand up';
    hint.classList.add('on');
    setTimeout(() => hint.classList.remove('on'), 6500);
  }

  // Phones held upright: ask for landscape (where Android allows, a button turns it).
  const rotate = document.getElementById('rotate');
  const stayPortrait = () => { document.body.classList.add('rotate-ok'); try { sessionStorage.setItem('portrait-ok', '1'); } catch { /* private mode */ } };
  try { if (sessionStorage.getItem('portrait-ok')) document.body.classList.add('rotate-ok'); } catch { /* private mode */ }
  rotate.querySelector('.stay').addEventListener('click', stayPortrait);
  const turn = rotate.querySelector('.turn');
  if (document.documentElement.requestFullscreen && screen.orientation?.lock) {
    turn.hidden = false;
    turn.addEventListener('click', async () => {
      try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch { stayPortrait(); }
    });
  }

  // ---- the way in
  const enterRoom = () => { spots.enabled = true; syncHud(); showHint(); wake(); };
  const deep = params.get('place');
  window.__room = { director: tour, tour, spots, loader, viewer, screens, camera: tour.camera, ready: false };
  if (deep || params.has('skip')) {
    const key = deep && manifest.views[tour.view(deep)] ? deep : 'room';
    document.getElementById('intro').classList.add('gone');
    tour.snap(key);
    await loader.pano(tour.view(key), 0);
    screens.load();
    enterRoom();
  } else {
    tour.snap('hall');
    loader.pano('hall', 0);
    const needs = [loader.videoFile('hall>room'),
      ...manifest.views.room.faces.map((f) => [manifest.views.room.files[f][1024][loader.ext], manifest.views.room.files[f][1024].kb])];
    const ready = Promise.all([loader.video('hall>room', 2), loader.pano('room', 2)]);
    ready.then(() => screens.load());
    playIntro({ ready, progress: () => loader.progress(needs), tour, doodles: spots.doodles, enter: () => tour.goTo('room'), onDone: enterRoom });
  }
  window.__room.ready = true;
  wake();
}
start();
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
