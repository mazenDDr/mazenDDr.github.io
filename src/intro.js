// The way in: a dim hallway, a hand-drawn "knock knock", three knocks, the
// latch, the door swings open and the camera glides in.
// Sound is synthesised with Web Audio (no audio files): knuckles on a hollow
// door, a latch, a creak and a quiet room tone, all through a small room reverb.
import * as THREE from 'three';

let ctx, bus, verb;
function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(ctx.destination);
  // A short, dark room impulse: decaying noise, so every sound sits in a space.
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
  // The door panel rings at a couple of low modes; the knuckle adds a click.
  for (const [f, q, dur, amp] of [[118, 1, 0.22, 0.75], [235, 1, 0.12, 0.35], [410, 1, 0.07, 0.2]]) {
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
  // Wood rubbing: narrow-band noise, pulsed quickly, gliding in pitch.
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
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(am).connect(g); out(g);
  n.start(t); lfo.start(t); n.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
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

export function playIntro({ door, openAngle, director, doodles, camera, spill, onDone, ready = Promise.resolve() }) {
  const card = document.getElementById('intro');
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  let started = false;
  const doorAt = new THREE.Vector3(2.98, 1.5, -5.25);      // where you knock: head height, a little off-centre
  const target = THREE.MathUtils.degToRad(openAngle);

  doodles.add('door', 'knock knock', 4242);
  doodles.aim('door', [0.75, -0.66]);            // from the upper right, clear of the title card
  const it = doodles.items.get('door');
  it.label.style.pointerEvents = 'all';
  let queued = false;
  const tick = () => {
    if (started) return;
    const v = doorAt.clone().project(camera);
    doodles.place('door', (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, true);
    if (!queued && document.getElementById('loading').classList.contains('done')) {
      queued = true;
      setTimeout(() => { if (!started) { doodles.drawIn(['door']); setTimeout(() => !started && doodles.write('door'), 900); } }, 1600);
    }
    requestAnimationFrame(tick);
  };
  tick();

  const tremble = (t0) => {
    // The door trembles a little and the camera nudges with each knock.
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > 1.3 || started === 'opening') return;
      const k = [0, 0.34, 0.62].reduce((s, at) => s + (t > at ? Math.exp(-(t - at) * 28) * Math.sin((t - at) * 90) : 0), 0);
      door.rotation.y = k * 0.0025;
      director.nudge = k * 0.004;
      requestAnimationFrame(step);
    };
    step();
  };

  const openDoor = (dur) => new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      // A short hesitation as the latch lets go, then a smooth swing that settles.
      const e = t < 0.12 ? 0.03 * (t / 0.12) ** 2 : 0.03 + 0.97 * (1 - Math.pow(1 - (t - 0.12) / 0.88, 3));
      door.rotation.y = target * e;
      spill?.(e);
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    step();
  });

  const start = async () => {
    if (started) return;
    started = true;
    await ready;                                  // a knock before the room has loaded waits for it
    director.nudge = 0;
    card.classList.add('knocking');
    doodles.hide('door');
    try { await audio().resume(); } catch { /* no audio is fine */ }
    [0, 0.34, 0.62].forEach((t, i) => knock(t, i === 2 ? 1.15 : 1));
    tremble(performance.now());
    await wait(1.45);
    started = 'opening';
    latch(0);
    creak(0.25, 1.5);
    card.classList.add('gone');
    const swing = openDoor(1.9);
    await wait(0.95);                          // start gliding in while the door is still swinging
    const walk = director.goTo('room');
    roomTone();
    await Promise.all([swing, walk]);
    onDone();
  };
  card.querySelector('button').addEventListener('click', start);
  it.label.addEventListener('click', start);
  addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !started) start(); });
  // Clicking the door itself knocks too.
  const doorBox = new THREE.Box3(new THREE.Vector3(2.56, 0, -5.26), new THREE.Vector3(3.32, 2.03, -5.19));
  const ray = new THREE.Raycaster();
  addEventListener('click', (e) => {
    if (started || e.target.tagName !== 'CANVAS') return;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    if (ray.ray.intersectsBox(doorBox)) start();
  });

  return {
    knock: start,
    skip: async () => {
      started = true;
      card.classList.add('gone');
      doodles.hide('door');
      door.rotation.y = target;
      spill?.(1);
      director.snap('room');
      onDone();
    },
  };
}
