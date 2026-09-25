// The way in: stand in the hallway, knock, the door opens, walk in.
// Sounds are synthesised with Web Audio, so there are no audio files to load.
import * as THREE from 'three';

let ctx;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function knock(at, strength = 1) {
  const a = audio(), t = a.currentTime + at;
  // Knuckle on wood: a low body thump plus a short filtered click.
  const body = a.createOscillator(), bg = a.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(150, t);
  body.frequency.exponentialRampToValueAtTime(70, t + 0.09);
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.004);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  body.connect(bg).connect(a.destination);
  body.start(t); body.stop(t + 0.2);
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const n = a.createBufferSource(), f = a.createBiquadFilter(), ng = a.createGain();
  n.buffer = buf; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4; ng.gain.value = 0.55 * strength;
  n.connect(f).connect(ng).connect(a.destination);
  n.start(t);
}

function creak(at, dur) {
  const a = audio(), t = a.currentTime + at;
  const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(95, t);
  o.frequency.linearRampToValueAtTime(140, t + dur * 0.4);
  o.frequency.linearRampToValueAtTime(110, t + dur);
  f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 8;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export function playIntro({ door, openAngle, director, onDone }) {
  const el = document.getElementById('intro');
  const btn = el.querySelector('button');
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  let started = false;

  const openDoor = (dur) => new Promise((resolve) => {
    const t0 = performance.now(), target = THREE.MathUtils.degToRad(openAngle);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      // Swing with a slight overshoot, like a door pushed from the inside.
      const e = 1 - Math.pow(1 - t, 3);
      door.rotation.y = target * (e + Math.sin(t * Math.PI) * 0.04);
      t < 1 ? requestAnimationFrame(step) : resolve();
    };
    step();
  });

  const start = async () => {
    if (started) return;
    started = true;
    el.classList.add('knocking');
    try { await audio().resume(); } catch { /* no audio is fine */ }
    [0, 0.34, 0.62].forEach((t, i) => knock(t, i === 2 ? 1.15 : 1));
    await wait(1.6);
    el.classList.add('gone');
    creak(0, 1.6);
    await openDoor(1.9);
    await director.goTo('room');
    onDone();
  };
  btn.addEventListener('click', start);
  addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !started) start(); });

  return { skip: async () => { started = true; el.classList.add('gone'); door.rotation.y = THREE.MathUtils.degToRad(openAngle); director.snap('room'); onDone(); } };
}
