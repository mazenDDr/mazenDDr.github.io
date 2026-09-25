// MazenOS: the computer on the desk. A small window manager plus a few apps,
// all reading content/portfolio.json.
const ROOT = '../../';
const data = await (await fetch(ROOT + 'content/portfolio.json')).json();
const P = data.person;
const desktop = document.getElementById('desktop');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkOk = (v) => v && !String(v).startsWith('TODO');
if (new URLSearchParams(location.search).has('room')) document.body.classList.add('in-room');

// ---------- Mac OS 9 system icons (icons/, MIT: github.com/bearz314/MacOS9-icons) ----------
const img = (name) => `<img src="icons/${name}.png" srcset="icons/${name}@2x.png 2x" alt="" draggable="false">`;
const ICONS = {
  disk: img('disk'), folder: img('folder-docs'), doc: () => img('doc-text'), text: img('doc-readme'),
  resume: img('doc-text'), term: img('window'), cert: img('folder-favorites'), mail: img('chat'),
  trash: img('trash'), web: img('web'), games: img('games'), system: img('folder-system'),
};

// ---------- window manager ----------
let z = 10, cascade = 0;
function openWin({ id, title, w = 520, h = 400, x, y, body, cls = '', status = '' }) {
  const existing = id && document.getElementById('w-' + id);
  if (existing) { focusWin(existing); return existing; }
  const el = document.createElement('section');
  el.className = 'win ' + cls;
  if (id) el.id = 'w-' + id;
  const W = desktop.clientWidth, H = desktop.clientHeight;
  w = Math.min(w, W - 30); h = Math.min(h, H - 20);
  x = x ?? (W - w) / 2 - 90 + (cascade % 5) * 24;
  y = y ?? (H - h) / 2 - 40 + (cascade % 5) * 20;
  // Keep every window fully on screen (phones are narrower than the layout).
  x = Math.max(6, Math.min(x, W - w - 6));
  y = Math.max(6, Math.min(y, H - h - 6));
  el.style.cssText = `width:${w}px;height:${h}px;left:${x}px;top:${y}px`;
  cascade++;
  el.innerHTML = `<div class="bar"><button class="close" aria-label="Close ${esc(title)}"></button><b>${esc(title)}</b>
      <button class="zoombox" aria-label="Zoom"></button><button class="shade" aria-label="Collapse"></button></div>
    <div class="body">${body}</div>${status ? `<div class="status">${status}</div>` : ''}`;
  desktop.append(el);
  zoomRects(el);
  el.querySelector('.close').addEventListener('click', () => el.remove());
  // Platinum window widgets: collapse to the title bar, and zoom to fill the screen.
  el.querySelector('.shade').addEventListener('click', () => el.classList.toggle('shaded'));
  el.querySelector('.bar').addEventListener('dblclick', () => el.classList.toggle('shaded'));
  el.querySelector('.zoombox').addEventListener('click', () => {
    if (el.dataset.zoomed) { el.style.cssText = el.dataset.zoomed; delete el.dataset.zoomed; }
    else { el.dataset.zoomed = el.style.cssText; Object.assign(el.style, { left: '6px', top: '6px', width: `${desktop.clientWidth - 120}px`, height: `${desktop.clientHeight - 12}px` }); }
    focusWin(el);
  });
  el.addEventListener('pointerdown', () => focusWin(el));
  drag(el);
  focusWin(el);
  return el;
}
// The classic Finder "zoom rectangles": outlines stepping out from the pointer to the window.
let lastClick = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointerdown', (e) => { lastClick = { x: e.clientX, y: e.clientY - 26 }; }, true);
function zoomRects(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  for (let i = 1; i <= 6; i++) {
    const k = i / 6, r = document.createElement('div');
    r.className = 'zoomrect';
    r.style.cssText = `left:${lastClick.x + (to.x - lastClick.x) * k}px;top:${lastClick.y + (to.y - lastClick.y) * k}px;width:${to.w * k}px;height:${to.h * k}px;animation-delay:${i * 22}ms`;
    desktop.append(r);
    setTimeout(() => r.remove(), 220 + i * 22);
  }
  el.style.animationDelay = '130ms';
}

function focusWin(el) {
  document.querySelectorAll('.win.active').forEach((w) => w.classList.remove('active'));
  el.classList.add('active');
  el.style.zIndex = ++z;
}
function drag(el) {
  const bar = el.querySelector('.bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.close')) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (m) => {
      el.style.left = Math.min(desktop.clientWidth - 60, Math.max(-el.offsetWidth + 80, m.clientX - sx)) + 'px';
      el.style.top = Math.min(desktop.clientHeight - 24, Math.max(0, m.clientY - sy)) + 'px';
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
  });
}
function icon(label, svg, open, extra = '') {
  const b = document.createElement('button');
  b.className = 'icon';
  b.innerHTML = `${svg}<span>${esc(label)}</span>`;
  if (extra) b.dataset.id = extra;
  b.addEventListener('click', () => { document.querySelectorAll('.icon.sel').forEach((i) => i.classList.remove('sel')); b.classList.add('sel'); });
  b.addEventListener('dblclick', open);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  // One tap is enough on touch screens and inside the 3D room.
  b.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') open(); });
  return b;
}

// ---------- apps ----------
function disk() {
  const win = openWin({ id: 'disk', title: 'Mazen HD', w: 460, h: 260, x: 60, y: 40, body: '<div class="folder"></div>',
    status: '<span>6 items</span><span>1.2 GB available</span>' });
  const f = win.querySelector('.folder');
  if (!f.children.length) f.append(
    icon('Projects', ICONS.folder, projectsFolder), icon('About Me', ICONS.text, aboutMe), icon('Resume', ICONS.resume, resume),
    icon('Certificates', ICONS.cert, certificates), icon('Terminal', ICONS.term, terminal), icon('System Folder', ICONS.system, aboutComputer));
}

function projectsFolder() {
  const win = openWin({ id: 'projects', title: 'Projects', w: 540, h: 250, x: 24, y: 20, body: '<div class="folder"></div>',
    status: `<span>${data.projects.length} items</span><span>double-click to open</span>` });
  const f = win.querySelector('.folder');
  if (!f.children.length) data.projects.forEach((p) => f.append(icon(p.title, ICONS.doc(p.color), () => project(p.id), p.id)));
}

function project(id) {
  const p = data.projects.find((x) => x.id === id);
  const names = { play: 'Open demo', guide: 'Field guide', code: 'GitHub', model: 'Model' };
  const buttons = Object.entries(p.links).map(([k, v], i) =>
    `<a class="pbtn${i === 0 ? ' default' : ''}" href="${v}" target="_blank" rel="noopener">${names[k] || k}</a>`).join('');
  openWin({ id: 'p-' + id, title: p.title + ' — README', w: 620, h: 520, body: `
    <article class="doc">
      ${p.art ? `<img class="readme-hero" src="${ROOT + 'content/' + p.art}" alt="">` : ''}
      <h1>${esc(p.title)}</h1><p class="hook">${esc(p.hook)}</p>
      <div class="stat"><b>${esc(p.stat.value)}</b>${esc(p.stat.label)}</div>
      <p>${esc(p.logline)}</p>
      <ul>${p.findings.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="tags">${p.tags.map(esc).join(' · ')} · ${p.year}</p>
      <div class="buttons">${buttons}</div>
    </article>`, status: `<span>SimpleText</span><span>${esc(p.id)}.md</span>` });
}

function aboutMe() {
  const link = (k, label) => (linkOk(P.links[k]) ? `<a href="${k === 'email' ? 'mailto:' : ''}${P.links[k]}" target="_blank" rel="noopener">${label}</a>` : '');
  openWin({ id: 'about', title: 'About Me.txt', w: 540, h: 400, x: 150, y: 300, body: `
    <article class="doc">
      <h1>${esc(P.name)}</h1><p class="hook">${esc(P.headline)}</p>
      ${P.about.map((t) => `<p>${esc(t)}</p>`).join('')}
      <p><b>How I work</b></p><ul>${P.principles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>${[link('github', 'GitHub'), link('linkedin', 'LinkedIn'), link('researchgate', 'ResearchGate'), link('huggingface', 'Hugging Face'), link('email', 'Email')].filter(Boolean).join(' · ')}</p>
    </article>`, status: '<span>SimpleText</span><span>read-only</span>' });
}

function resume() {
  openWin({ id: 'resume', title: 'Résumé', w: 640, h: 520, body: `
    <article class="doc">
      <h1>${esc(P.name)}</h1><p class="hook">${esc(P.headline)} · ${esc(P.links.email)}</p>
      ${data.experience.map((x) => `<h3 style="font:600 18px var(--ui);margin:18px 0 2px">${esc(x.role)} — ${esc(x.org)}</h3>
        <p style="margin:0 0 6px;color:#555">${esc(x.dates)}</p><ul>${x.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('')}
      <h3 style="font:600 18px var(--ui);margin:18px 0 2px">Education</h3>
      ${data.education.map((e) => `<p>${esc(e.title)}<br>${esc(e.school)} · ${new Date(e.date).getFullYear()}</p>`).join('')}
    </article>`, status: '<span>SimpleText</span><span>resume.txt</span>' });
}

function certificates() {
  openWin({ id: 'certs', title: 'Certificates', w: 620, h: 520, body: data.certificates.map((c) => `
    <figure class="cert doc" style="margin:0 0 18px">
      <img src="${ROOT + c.image}" alt="${esc(c.title)}">
      <figcaption style="margin-top:8px"><b>${esc(c.title)}</b><br>${esc(c.issuer)} · ${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</figcaption>
    </figure>`).join(''), status: `<span>${data.certificates.length} item</span><span>Scrapbook</span>` });
}

const LINK_NAMES = { github: 'GitHub', linkedin: 'LinkedIn', researchgate: 'ResearchGate', huggingface: 'Hugging Face', email: 'Email' };
function contact() {
  const rows = Object.entries(P.links).filter(([, v]) => linkOk(v)).map(([k, v]) =>
    `<p><b style="display:inline-block;width:130px">${LINK_NAMES[k] || k}</b><a href="${k === 'email' ? 'mailto:' : ''}${v}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, ''))}</a></p>`).join('');
  openWin({ id: 'contact', title: 'Contact', w: 540, h: 280, body: `<div class="doc">${rows}</div>` });
}

function trash() {
  openWin({ id: 'trash', title: 'Trash', w: 380, h: 220, body: `<div class="doc"><p>Empty.</p><p style="color:#666">Unmeasured claims go here. There were a few; they're gone.</p></div>` });
}

function aboutComputer() {
  openWin({ id: 'about-os', title: 'About This Computer', w: 420, h: 230, body: `<div class="doc">
    <h1 style="font-size:22px">MazenOS 1.0</h1>
    <p>Built-in memory: every result, with a 95% interval.<br>Largest unused block: patience for unmeasured claims.</p>
    <p style="color:#666">Runs inside a room rendered with Blender Cycles and three.js.</p></div>` });
}

// ---------- terminal ----------
function terminal() {
  const win = openWin({ id: 'term', title: 'Terminal', w: 620, h: 400, cls: 'term', body: '<div class="out"></div><label class="prompt"><span>mazen@room ~ %</span><input aria-label="Terminal input" autocomplete="off" spellcheck="false"></label>' });
  const out = win.querySelector('.out'), input = win.querySelector('input'), body = win.querySelector('.body');
  const print = (html) => { const d = document.createElement('div'); d.className = 'line'; d.innerHTML = html; out.append(d); body.scrollTop = body.scrollHeight; };
  const ids = data.projects.map((p) => p.id);
  const cmds = {
    help: () => print('commands: ls, cat &lt;project&gt;, open &lt;project&gt;, whoami, resume, skills, contact, principles, clear'),
    resume: () => { resume(); print('opened Résumé'); },
    ls: () => print(ids.map((i) => i + '/').join('   ') + '   about.txt   certificates/'),
    whoami: () => print(`${esc(P.full_name)} — ${esc(P.headline)}\n${esc(P.one_liner)}`),
    principles: () => print(P.principles.map((t, i) => `${i + 1}. ${esc(t)}`).join('\n')),
    skills: () => print(Object.entries(data.skills).map(([k, v]) => `${esc(k).padEnd(18)} ${v.map(esc).join(', ')}`).join('\n')),
    contact: () => print(Object.entries(P.links).filter(([, v]) => linkOk(v)).map(([k, v]) => `${k.padEnd(12)} <a href="${v}" target="_blank" rel="noopener">${esc(v)}</a>`).join('\n')),
    clear: () => { out.innerHTML = ''; },
    cat: (a) => {
      if (a === 'about.txt') return print(P.about.map(esc).join('\n\n'));
      const p = data.projects.find((x) => x.id === a || x.id.startsWith(a || '#'));
      if (!p) return print(`cat: ${esc(a || '')}: No such file. Try <b>ls</b>.`);
      print(`# ${esc(p.title)}\n${esc(p.hook)}\n\n  ${esc(p.stat.value)}  ${esc(p.stat.label)}\n\n${p.findings.map((f) => '- ' + esc(f)).join('\n')}`);
    },
    open: (a) => {
      const p = data.projects.find((x) => x.id === a || x.id.startsWith(a || '#'));
      if (!p) return print(`open: ${esc(a || '')}: not found`);
      project(p.id);
      print(`opened ${esc(p.id)}`);
    },
    sudo: (a) => print(/hire/.test(a || '') ? `[sudo] password for recruiter: ********\nAccess granted. Opening contact…` : 'sudo: nice try.'),
  };
  cmds.sudo = ((orig) => (a) => { orig(a); if (/hire/.test(a || '')) contact(); })(cmds.sudo);
  print(`MazenOS terminal. Type <b>help</b>. Last login: ${new Date().toDateString()}`);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const line = input.value.trim(); input.value = '';
    print(`<span style="opacity:.7">mazen@room ~ %</span> ${esc(line)}`);
    if (!line) return;
    const [c, ...rest] = line.split(/\s+/);
    (cmds[c] || (() => print(`zsh: command not found: ${esc(c)}`)))(rest.join(' '));
  });
  win.addEventListener('click', () => input.focus());
  setTimeout(() => input.focus(), 50);
}

// ---------- menus ----------
const MENUS = {
  logo: [['About This Computer', aboutComputer]],
  file: [['Open Projects', projectsFolder], ['Open Terminal', terminal], null, ['Close Window', () => document.querySelector('.win.active')?.remove()]],
  edit: [['Undo', null], ['Copy', null]],
  view: [['by Icon', null], ['by Name', null]],
  special: [['Clean Up Desktop', () => document.querySelectorAll('.win').forEach((w) => w.remove())], ['Empty Trash', trash]],
};
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; document.querySelectorAll('#menubar .open').forEach((b) => b.classList.remove('open')); }
document.querySelectorAll('#menubar [data-menu]').forEach((b) => b.addEventListener('click', (e) => {
  e.stopPropagation();
  const was = b.classList.contains('open');
  closeMenu();
  if (was) return;
  b.classList.add('open');
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.style.left = b.offsetLeft + 'px';
  menuEl.style.top = '26px';
  for (const item of MENUS[b.dataset.menu]) {
    if (!item) { menuEl.append(document.createElement('hr')); continue; }
    const mb = document.createElement('button');
    mb.textContent = item[0];
    if (!item[1]) mb.className = 'dim';
    mb.addEventListener('click', () => { closeMenu(); item[1]?.(); });
    menuEl.append(mb);
  }
  document.body.append(menuEl);
}));
addEventListener('click', closeMenu);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuEl) closeMenu();
  else parent.postMessage({ type: 'room-back' }, '*');
});

// ---------- desktop ----------
const icons = document.createElement('div');
icons.className = 'icons';
icons.append(
  icon('Mazen HD', ICONS.disk, disk),
  icon('Projects', ICONS.folder, projectsFolder),
  icon('About Me.txt', ICONS.text, aboutMe),
  icon('Resume', ICONS.resume, resume),
  icon('Certificates', ICONS.cert, certificates),
  icon('Terminal', ICONS.term, terminal),
  icon('Contact', ICONS.mail, contact),
  icon('Trash', ICONS.trash, trash),
);
desktop.append(icons);
const tick = () => { document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
tick(); setInterval(tick, 10000);
// A warm startup chord, played once the visitor has interacted (browsers require a gesture).
function chime() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), t = a.currentTime + 0.02;
    for (const f of [261.6, 329.6, 392, 523.3]) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 2.3);
    }
  } catch { /* no audio */ }
}
addEventListener('pointerdown', chime, { once: true });
setTimeout(() => { document.getElementById('boot').classList.add('done'); projectsFolder(); aboutMe(); }, 1500);
