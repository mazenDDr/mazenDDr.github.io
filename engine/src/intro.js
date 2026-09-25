// The way in. The hallway shows at once; knocking is how you wait: you knock,
// the room loads while you keep knocking (each knock shakes the view), a hand
// writes what you hear, footsteps come closer as the last pieces arrive, the
// latch clicks, the door swings open and the camera whooshes in.
// Sound is synthesised with Web Audio (no audio files), through a small room reverb.
import * as THREE from 'three';

let ctx, bus, verb;
function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 0.9), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  verb.connect(tone).connect(wet).connect(bus);
  return ctx;
}
const out = (node) => { node.connect(bus); node.connect(verb); };

function noiseBuffer(seconds, shape = 4) {
  const a = audio(), len = Math.floor(a.sampleRate * seconds), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, shape);
  return buf;
}

function knock(at, strength = 1) {
  const a = audio(), t = a.currentTime + at;
  for (const [f, dur, amp] of [[118, 0.22, 0.75], [235, 0.12, 0.35], [410, 0.07, 0.2]]) {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(f * 1.06, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp * strength, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); out(g);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const n = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  n.buffer = noiseBuffer(0.06, 6);
  bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
  g.gain.value = 0.55 * strength;
  n.connect(bp).connect(g); out(g);
  n.start(t);
}

/** Footsteps behind the door, getting closer. Returns how long they take. */
function footsteps(count = 5) {
  const a = audio();
  for (let i = 0; i < count; i++) {
    const t = a.currentTime + i * 0.48 + (i % 2) * 0.04;
    const n = a.createBufferSource(), lp = a.createBiquadFilter(), g = a.createGain();
    n.buffer = noiseBuffer(0.12, 5);
    lp.type = 'lowpass'; lp.frequency.value = 260 + i * 40;
    g.gain.value = 0.12 + (i / count) * 0.5;       // approaching
    n.connect(lp).connect(g); out(g);
    n.start(t);
  }
  return count * 0.48;
}

function latch(at) {
  const a = audio(), t = a.currentTime + at;
  const n = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  n.buffer = noiseBuffer(0.05, 8);
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 3;
  g.gain.value = 0.35;
  n.connect(bp).connect(g); out(g);
  n.start(t);
  const o = a.createOscillator(), og = a.createGain();
  o.frequency.value = 2250;
  og.gain.setValueAtTime(0.08, t + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og); out(og);
  o.start(t); o.stop(t + 0.1);
}

function creak(at, dur) {
  const a = audio(), t = a.currentTime + at;
  const n = a.createBufferSource(), bp = a.createBiquadFilter(), am = a.createGain(), g = a.createGain();
  n.buffer = noiseBuffer(dur + 0.1, 0.3);
  bp.type = 'bandpass'; bp.Q.value = 14;
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.linearRampToValueAtTime(690, t + dur * 0.45);
  bp.frequency.linearRampToValueAtTime(520, t + dur);
  const lfo = a.createOscillator(), depth = a.createGain();
  lfo.type = 'sawtooth';
  lfo.frequency.setValueAtTime(38, t);
  lfo.frequency.linearRampToValueAtTime(24, t + dur);
  depth.gain.value = 0.5;
  am.gain.value = 0.5;
  lfo.connect(depth).connect(am.gain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(am).connect(g); out(g);
  n.start(t); lfo.start(t); n.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
}

/** Air rushing past as the camera flies through the doorway. */
function whoosh(dur) {
  const a = audio(), t = a.currentTime;
  const n = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  n.buffer = noiseBuffer(dur + 0.2, 0.2);
  bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(1600, t + dur * 0.4);
  bp.frequency.exponentialRampToValueAtTime(400, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(g).connect(bus);
  n.start(t); n.stop(t + dur + 0.2);
}

/** A quiet room: soft brown noise, low-passed, like a lived-in space at night. */
function roomTone() {
  const a = audio(), len = a.sampleRate * 4, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const n = a.createBufferSource(), lp = a.createBiquadFilter(), g = a.createGain();
  n.buffer = buf; n.loop = true;
  lp.type = 'lowpass'; lp.frequency.value = 420;
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.05, a.currentTime + 3);
  n.connect(lp).connect(g).connect(bus);
  n.start();
}

export function setMuted(m) { if (bus) bus.gain.setTargetAtTime(m ? 0 : 0.9, audio().currentTime, 0.1); }

/**
 * @param room     Promise resolving to { door } once the 3D room is loaded
 * @param progress () => 0..1 loading progress
 */
export function playIntro({ room, progress, openAngle, director, doodles, camera, onDone }) {
  const card = document.getElementById('intro');
  const still = document.getElementById('loading');
  const button = card.querySelector('.knock');
  const label = button.querySelector('span');
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const target = THREE.MathUtils.degToRad(openAngle);
  let started = false, door = null, loaded = false;
  room.then((r) => { door = r.door; loaded = true; });

  const doorAt = new THREE.Vector3(2.93, 1.5, -5.22);
  doodles.add('door', 'knock knock', 4242);
  doodles.aim('door', [0.75, -0.66]);
  const it = doodles.items.get('door');
  it.label.style.pointerEvents = 'all';
  let queued = false, tracking = true;
  const tick = () => {
    if (!tracking) return;
    const v = doorAt.clone().project(camera);
    doodles.place('door', (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, true);
    if (!queued) {
      queued = true;
      setTimeout(() => { if (!tracking) return; doodles.drawIn(['door']); setTimeout(() => tracking && doodles.write('door'), 900); }, 1500);
    }
    requestAnimationFrame(tick);
  };
  tick();

  /** A hand-written line near the door, re-written each time it changes. */
  const say = (text) => {
    if (it.label.textContent === text) return;
    it.label.textContent = text;
    it.sticky = false;
    doodles.hover(null);
    requestAnimationFrame(() => doodles.write('door'));
  };

  /** Each knock shakes the view: the 3D door trembles and the camera nudges;
   *  before the room is there, the still of the hallway shakes instead. */
  const shake = (times) => {
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > times[times.length - 1] + 0.6) { still.style.transform = ''; director.nudge = 0; if (door) door.rotation.y = 0; return; }
      const k = times.reduce((s, at) => s + (t > at ? Math.exp(-(t - at) * 26) * Math.sin((t - at) * 95) : 0), 0);
      director.nudge = k * 0.006;
      if (door) door.rotation.y = k * 0.003;
      still.style.transform = `translate(${k * 1.5}px, ${k * 1.1}px) scale(${1 + Math.abs(k) * 0.004})`;
      requestAnimationFrame(step);
    };
    step();
  };

  const PATTERNS = [[0, 0.34, 0.62], [0, 0.28], [0, 0.3, 0.55, 0.8], [0, 0.34, 0.62]];
  const LINES = ['knock knock', 'hello…?', '…', 'knock knock knock'];

  const openDoor = (dur) => new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      const e = t < 0.12 ? 0.03 * (t / 0.12) ** 2 : 0.03 + 0.97 * (1 - Math.pow(1 - (t - 0.12) / 0.88, 3));
      door.rotation.y = target * e;
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    step();
  });

  const start = async () => {
    if (started) return;
    started = true;
    card.classList.add('knocking');
    label.textContent = 'Knocking…';
    try { await audio().resume(); } catch { /* no audio is fine */ }
    // Keep knocking until the room is ready (at least once), reacting as it loads.
    let heard = false;
    for (let i = 0; ; i++) {
      const pattern = PATTERNS[i % PATTERNS.length];
      pattern.forEach((t, k) => knock(t, k === pattern.length - 1 ? 1.15 : 1));
      shake(pattern);
      say(loaded ? 'coming!' : progress() > 0.6 ? 'footsteps…' : LINES[i % LINES.length]);
      await wait(pattern[pattern.length - 1] + 1.1);
      if (!heard && (loaded || progress() > 0.6)) {        // someone's coming to the door
        heard = true;
        say('footsteps…');
        await wait(footsteps(4) * 0.8);
      }
      if (loaded && heard) break;
    }
    await room;
    say('coming!');
    await wait(0.5);
    tracking = false;
    doodles.hide('door');
    card.classList.add('gone');
    latch(0);
    creak(0.25, 1.4);
    const swing = openDoor(1.7);
    await wait(0.75);
    whoosh(2.6);
    const flight = director.flyIn('room', 2.6);
    roomTone();
    await Promise.all([swing, flight]);
    onDone();
  };
  button.addEventListener('click', start);
  it.label.addEventListener('click', start);
  addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !started) start(); });
  // Clicking the door itself knocks too (the canvas, or the still while loading).
  const doorBox = new THREE.Box3(new THREE.Vector3(2.47, 0, -5.30), new THREE.Vector3(3.33, 2.05, -5.16));
  const ray = new THREE.Raycaster();
  addEventListener('click', (e) => {
    if (started || e.target.closest('#intro, #mute, #back')) return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    if (ray.ray.intersectsBox(doorBox)) start();
  });

  return {
    knock: start,
    skip: async () => {
      started = true;
      tracking = false;
      card.classList.add('gone');
      doodles.hide('door');
      const r = await room;
      r.door.rotation.y = target;
      director.snap('room');
      onDone();
    },
  };
}
