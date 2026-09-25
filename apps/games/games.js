// Mazen Arcade: the TV's easter egg, reached by clicking the game console.
// Three small games on a 640x488 pixel canvas: Pong against the CPU, Snake and
// Breakout. Keys (arrows / WASD, Enter, Esc), mouse or touch.
const cv = document.getElementById('c');
const g = cv.getContext('2d');
const W = cv.width, H = cv.height;
const FONT = "'Press Start 2P', monospace";
const NEON = { pink: '#ff3cac', cyan: '#2bd2ff', lime: '#7dff5a', gold: '#ffd23f', white: '#f4f1ff' };

// ---------- sound: square-wave blips ----------
let ac;
function blip(f = 440, dur = 0.06, type = 'square', vol = 0.06) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), v = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t);
    v.gain.setValueAtTime(vol, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* no audio */ }
}

// ---------- input ----------
const keys = new Set();
let pointer = null;
addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  scene.key?.(e.key);
});
addEventListener('keyup', (e) => keys.delete(e.key));
const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
cv.addEventListener('pointermove', (e) => { pointer = toCanvas(e); });
cv.addEventListener('pointerdown', (e) => { pointer = toCanvas(e); scene.tap?.(pointer); });
const down = (...k) => k.some((x) => keys.has(x));

function best(game, score) {
  let b = 0;
  try { b = +localStorage.getItem('arcade-' + game) || 0; if (score > b) localStorage.setItem('arcade-' + game, b = score); } catch { /* private mode */ }
  return Math.max(b, score);
}
function text(s, x, y, size = 16, color = NEON.white, align = 'center') {
  g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 12; g.fillStyle = color; g.fillText(s, x, y); g.shadowBlur = 0;
}
function glowRect(x, y, w, h, color) { g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color; g.fillRect(x, y, w, h); g.shadowBlur = 0; }
function bg() {
  g.fillStyle = '#07040f'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1a1033'; g.lineWidth = 1;          // a faint synthwave grid
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
}

// ---------- menu ----------
const GAMES = [
  { name: 'PONG', color: NEON.cyan, make: pong, blurb: 'first to 7 beats the CPU' },
  { name: 'SNAKE', color: NEON.lime, make: snake, blurb: 'eat, grow, don\'t bite yourself' },
  { name: 'BREAKOUT', color: NEON.pink, make: breakout, blurb: 'clear the wall of bricks' },
];
function menu() {
  let sel = 0, t = 0;
  return {
    key(k) {
      if (k === 'ArrowUp' || k === 'w') { sel = (sel + 2) % 3; blip(520); }
      if (k === 'ArrowDown' || k === 's') { sel = (sel + 1) % 3; blip(520); }
      if (k === 'Enter' || k === ' ') { blip(880, 0.12); go(GAMES[sel].make()); }
      if (k === 'Escape') parent.postMessage({ type: 'room-back' }, '*');
    },
    tap(p) { GAMES.forEach((gm, i) => { if (Math.abs(p.y - (220 + i * 62)) < 26) { sel = i; blip(880, 0.12); go(gm.make()); } }); },
    frame(dt) {
      t += dt; bg();
      text('MAZEN', W / 2, 70, 34, NEON.pink); text('ARCADE', W / 2, 118, 34, NEON.cyan);
      GAMES.forEach((gm, i) => {
        const on = i === sel, y = 220 + i * 62;
        if (on) glowRect(W / 2 - 170, y - 24, 340, 48, gm.color + '33');
        text((on ? '> ' : '  ') + gm.name, W / 2, y - 4, 20, on ? gm.color : '#8a7fb0');
        if (on) text(gm.blurb, W / 2, y + 16, 8, '#bfb3e6');
        text(`HI ${best(gm.name, 0)}`, W / 2 + 200, y - 4, 10, '#6c6390', 'left');
      });
      if (Math.floor(t * 2) % 2) text('PRESS ENTER', W / 2, 430, 12, NEON.gold);
      text('ESC: BACK TO MAZENFLIX', W / 2, 462, 8, '#6c6390');
    },
  };
}

// ---------- pong ----------
function pong() {
  const P = { y: H / 2, h: 70 }, C = { y: H / 2, h: 70 }, b = { x: W / 2, y: H / 2, vx: 260, vy: 120 };
  let you = 0, cpu = 0, over = 0;
  const serve = (dir) => Object.assign(b, { x: W / 2, y: H / 2, vx: 260 * dir, vy: (Math.random() - 0.5) * 260 });
  return {
    key(k) { if (k === 'Escape') go(menu()); if (over && (k === 'Enter' || k === ' ')) go(pong()); },
    tap() { if (over) go(pong()); },
    frame(dt) {
      if (!over) {
        if (pointer) P.y += (pointer.y - P.y) * Math.min(1, dt * 14);
        P.y += (down('ArrowDown', 's') - down('ArrowUp', 'w')) * 420 * dt;
        C.y += Math.sign(b.y - C.y) * Math.min(Math.abs(b.y - C.y), 300 * dt);   // a beatable CPU
        for (const p of [P, C]) p.y = Math.max(p.h / 2, Math.min(H - p.h / 2, p.y));
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < 6 || b.y > H - 6) { b.vy *= -1; b.y = Math.max(6, Math.min(H - 6, b.y)); blip(300); }
        for (const [p, x, dir] of [[P, 30, 1], [C, W - 30, -1]]) {
          if (Math.abs(b.x - x) < 10 && Math.abs(b.y - p.y) < p.h / 2 + 6 && Math.sign(b.vx) === -dir) {
            b.vx = -b.vx * 1.06; b.vy += (b.y - p.y) * 5; blip(dir > 0 ? 660 : 440);
          }
        }
        if (b.x < -10) { cpu++; blip(150, 0.25, 'sawtooth'); serve(1); }
        if (b.x > W + 10) { you++; blip(990, 0.2); serve(-1); }
        if (you === 7 || cpu === 7) { over = 1; best('PONG', you); }
      }
      bg();
      for (let y = 10; y < H; y += 24) glowRect(W / 2 - 2, y, 4, 12, '#3a2d66');
      glowRect(24, P.y - P.h / 2, 10, P.h, NEON.cyan); glowRect(W - 34, C.y - C.h / 2, 10, C.h, NEON.pink);
      glowRect(b.x - 6, b.y - 6, 12, 12, NEON.white);
      text(String(you), W / 2 - 60, 40, 28, NEON.cyan); text(String(cpu), W / 2 + 60, 40, 28, NEON.pink);
      if (over) { text(you > cpu ? 'YOU WIN!' : 'CPU WINS', W / 2, H / 2 - 20, 28, NEON.gold); text('ENTER TO PLAY AGAIN', W / 2, H / 2 + 24, 10); }
    },
  };
}

// ---------- snake ----------
function snake() {
  const S = 16, cols = W / S, rows = Math.floor((H - 40) / S);
  let body = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], dir = { x: 1, y: 0 }, next = dir, food = spot(), acc = 0, score = 0, dead = false;
  function spot() { let p; do p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }; while (body?.some((s) => s.x === p.x && s.y === p.y)); return p; }
  const turn = (x, y) => { if (x !== -dir.x || y !== -dir.y) next = { x, y }; };
  return {
    key(k) {
      if (k === 'Escape') go(menu());
      if (dead && (k === 'Enter' || k === ' ')) go(snake());
      if (k === 'ArrowUp' || k === 'w') turn(0, -1); if (k === 'ArrowDown' || k === 's') turn(0, 1);
      if (k === 'ArrowLeft' || k === 'a') turn(-1, 0); if (k === 'ArrowRight' || k === 'd') turn(1, 0);
    },
    tap(p) {
      if (dead) return go(snake());
      const h = body[0], dx = p.x / S - h.x, dy = (p.y - 40) / S - h.y;   // steer toward where you tap
      Math.abs(dx) > Math.abs(dy) ? turn(Math.sign(dx), 0) : turn(0, Math.sign(dy));
    },
    frame(dt) {
      acc += dt;
      const step = Math.max(0.055, 0.12 - score * 0.002);
      while (!dead && acc > step) {
        acc -= step; dir = next;
        const h = { x: (body[0].x + dir.x + cols) % cols, y: (body[0].y + dir.y + rows) % rows };
        if (body.some((s) => s.x === h.x && s.y === h.y)) { dead = true; best('SNAKE', score); blip(120, 0.4, 'sawtooth'); break; }
        body.unshift(h);
        if (h.x === food.x && h.y === food.y) { score++; food = spot(); blip(880); } else body.pop();
      }
      bg();
      text(`SCORE ${score}`, 20, 20, 12, NEON.lime, 'left'); text(`HI ${best('SNAKE', score)}`, W - 20, 20, 12, '#8a7fb0', 'right');
      glowRect(food.x * S + 3, 40 + food.y * S + 3, S - 6, S - 6, NEON.pink);
      body.forEach((s, i) => glowRect(s.x * S + 1, 40 + s.y * S + 1, S - 2, S - 2, i ? '#4fd14a' : NEON.lime));
      if (dead) { text('GAME OVER', W / 2, H / 2 - 10, 28, NEON.gold); text('ENTER TO TRY AGAIN', W / 2, H / 2 + 30, 10); }
    },
  };
}

// ---------- breakout ----------
function breakout() {
  const pad = { x: W / 2, w: 90 }, b = { x: W / 2, y: H - 80, vx: 180, vy: -260, stuck: true };
  const colors = [NEON.pink, '#ff7a45', NEON.gold, NEON.lime, NEON.cyan];
  let bricks = [], score = 0, lives = 3, done = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 10; c++) bricks.push({ x: 20 + c * 60, y: 70 + r * 24, w: 56, h: 18, c: colors[r] });
  return {
    key(k) { if (k === 'Escape') go(menu()); if (k === ' ' || k === 'Enter') { if (done) go(breakout()); else b.stuck = false; } },
    tap() { if (done) go(breakout()); else b.stuck = false; },
    frame(dt) {
      if (pointer) pad.x += (pointer.x - pad.x) * Math.min(1, dt * 16);
      pad.x += (down('ArrowRight', 'd') - down('ArrowLeft', 'a')) * 460 * dt;
      pad.x = Math.max(pad.w / 2, Math.min(W - pad.w / 2, pad.x));
      if (!done) {
        if (b.stuck) { b.x = pad.x; b.y = H - 44; }
        else {
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x < 6 || b.x > W - 6) { b.vx *= -1; blip(300); }
          if (b.y < 46) { b.vy = Math.abs(b.vy); blip(300); }
          if (b.y > H - 42 && b.y < H - 30 && Math.abs(b.x - pad.x) < pad.w / 2 + 6 && b.vy > 0) {
            b.vy = -Math.abs(b.vy) * 1.02; b.vx = (b.x - pad.x) * 6; blip(520);
          }
          const hit = bricks.find((k) => b.x > k.x - 5 && b.x < k.x + k.w + 5 && b.y > k.y - 5 && b.y < k.y + k.h + 5);
          if (hit) { bricks = bricks.filter((k) => k !== hit); b.vy *= -1; score += 10; blip(760 + Math.random() * 200); }
          if (b.y > H + 10) { lives--; b.stuck = true; blip(120, 0.35, 'sawtooth'); }
          if (!lives) { done = 'GAME OVER'; best('BREAKOUT', score); }
          if (!bricks.length) { done = 'YOU CLEARED IT!'; best('BREAKOUT', score); }
        }
      }
      bg();
      text(`SCORE ${score}`, 20, 22, 12, NEON.pink, 'left'); text('♥'.repeat(Math.max(0, lives)), W - 20, 22, 12, NEON.pink, 'right');
      for (const k of bricks) glowRect(k.x, k.y, k.w, k.h, k.c);
      glowRect(pad.x - pad.w / 2, H - 36, pad.w, 10, NEON.white);
      glowRect(b.x - 6, b.y - 6, 12, 12, NEON.gold);
      if (b.stuck && !done) text('SPACE TO LAUNCH', W / 2, H / 2 + 60, 10, '#bfb3e6');
      if (done) { text(done, W / 2, H / 2, 24, NEON.gold); text('ENTER TO PLAY AGAIN', W / 2, H / 2 + 36, 10); }
    },
  };
}

// ---------- loop ----------
let scene = menu(), last = performance.now();
function go(s) { scene = s; pointer = null; }
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  scene.frame(dt);
  requestAnimationFrame(loop);
}
document.fonts.ready.then(() => requestAnimationFrame(loop));
