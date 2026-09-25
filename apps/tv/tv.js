// Mazenflix: the TV in the room. Everything shown comes from content/portfolio.json;
// the key art is drawn per title in art.js.
import { artUrl } from './art.js';

const ROOT = '../../';
const data = await (await fetch(ROOT + 'content/portfolio.json')).json();
const app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (new URLSearchParams(location.search).has('room')) document.body.classList.add('in-room');

// Titles: projects and jobs share one shape.
const titles = [
  ...data.projects.map((p) => ({ ...p, type: 'project', year: p.year, synopsis: p.logline, episodes: p.findings,
    badge: 'PROJECT', meta: p.stat })),
  ...data.experience.map((x) => ({ id: x.id, type: 'job', title: x.org === 'Zewail City' ? 'Capstone' : x.org.split(' (')[0],
    hook: x.hook, synopsis: x.hook, episodes: x.points, tags: x.tags, genre: [x.role], year: +x.dates.slice(-4), badge: 'EXPERIENCE',
    color: { capstone: '#e50914', tanmeyah: '#0ea5e9', ta: '#16a34a' }[x.id], meta: { value: x.dates, label: x.role }, links: {} })),
];
const byId = Object.fromEntries(titles.map((t) => [t.id, t]));
const art = {};
const artOf = (t, kind) => (art[t.id + kind] ||= artUrl(t, kind, false));

const PEOPLE = [
  { id: 'recruiter', name: 'Recruiter', color: '#e50914', face: 0, first: 'Measured, not guessed', pick: ['crisis-triage', 'contract-rag', 'capstone'] },
  { id: 'engineer', name: 'Engineer', color: '#2563eb', face: 1, first: 'When the simple baseline won', pick: ['pipeline-agents', 'receipt-vlm', 'faceid-bench'] },
  { id: 'curious', name: 'Just curious', color: '#f5b400', face: 2, first: 'Language & agents', pick: ['faceid-bench', 'causal-uplift-marketing', 'crisis-triage'] },
];
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.6v.4" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
  like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2 3l-1 3h6c1.2 0 2 1 1.8 2.2l-1.4 6.5c-.2 1-1 1.3-2 1.3H7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20" stroke-linecap="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 5l-7 7 7 7" stroke-linecap="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 5l7 7-7 7" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>',
};
// Simple friendly avatar faces, in the spirit of streaming-service profiles.
const FACES = [
  '<circle cx="35" cy="42" r="5"/><circle cx="65" cy="42" r="5"/><path d="M30 64q20 16 40 0" stroke-width="6" fill="none" stroke="#fff" stroke-linecap="round"/>',
  '<rect x="28" y="36" width="14" height="10" rx="3"/><rect x="58" y="36" width="14" height="10" rx="3"/><path d="M42 41h16" stroke="#fff" stroke-width="4"/><path d="M34 66h32" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  '<circle cx="35" cy="42" r="5"/><path d="M58 42h14" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M32 62q18 14 36-2" stroke-width="6" fill="none" stroke="#fff" stroke-linecap="round"/>',
];
const avatar = (p, size = 150) => `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="background:${p.color};border-radius:6%"><g fill="#fff">${FACES[p.face]}</g></svg>`;

let person = null;
try { person = PEOPLE.find((p) => p.id === sessionStorage.getItem('tv-person')) || null; } catch { /* private mode */ }

// ---------- sound: the two-hit "ta-dum" when a profile opens ----------
function taDum() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), t = a.currentTime + 0.05;
    for (const [at, f, dur] of [[0, 62, 0.35], [0.28, 55, 1.4]]) {
      for (const h of [1, 2.01, 3.02]) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = f * h;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.5 / h, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        o.connect(g).connect(a.destination); o.start(t + at); o.stop(t + at + dur + 0.1);
      }
    }
  } catch { /* no audio */ }
}

// ---------- who's watching ----------
function gate() {
  app.innerHTML = `
    <section class="gate">
      <div class="wordmark big">MAZENFLIX</div>
      <h1>Who's watching?</h1>
      <div class="people">${PEOPLE.map((p) => `
        <button class="person" data-id="${p.id}">${avatar(p)}<span>${p.name}</span></button>`).join('')}</div>
      <p class="manage">Everything here is real work, with the numbers it scored</p>
    </section>`;
  app.querySelectorAll('.person').forEach((b) => b.addEventListener('click', () => {
    person = PEOPLE.find((p) => p.id === b.dataset.id);
    try { sessionStorage.setItem('tv-person', person.id); } catch { /* fine */ }
    taDum();
    b.classList.add('chosen');
    app.querySelector('.gate').classList.add('leaving');
    setTimeout(() => { app.innerHTML = `<div class="spinner-wrap">${avatar(person, 90)}<div class="spinner"></div></div>`; }, 450);
    setTimeout(browse, 1300);
  }));
  app.querySelector('.person').focus({ preventScroll: true });
}

// ---------- browse ----------
const card = (t, i, kind = 'wide') => `
  <button class="card ${kind}" data-id="${t.id}" aria-label="${esc(t.title)}. ${esc(t.hook)}" style="--c:${t.color}">
    <img src="${artOf(t, kind === 'poster' ? 'poster' : 'backdrop')}" alt="" loading="lazy">
    ${kind === 'poster' ? `<span class="logo poster-logo">${esc(t.title)}</span>` : `<span class="logo">${esc(t.title)}</span>`}<span class="m">M</span>
    ${kind === 'progress' ? `<span class="bar"><i style="width:${[62, 35, 81][i % 3]}%"></i></span>` : ''}
  </button>`;

function row(title, ids, kind = 'wide') {
  const items = ids.map((id) => byId[id]).filter(Boolean);
  const cardKind = kind === 'top' ? 'poster' : kind;
  return `<section class="row ${kind}"><h3>${esc(title)} <span class="explore">Explore all ›</span></h3>
    <div class="slider"><button class="nav prev" aria-label="Previous">${I.left}</button>
      <div class="track">${items.map((t, i) => (kind === 'top' ? `<div class="top-item"><span class="num">${i + 1}</span>${card(t, i, cardKind)}</div>` : card(t, i, cardKind))).join('')}</div>
      <button class="nav next" aria-label="Next">${I.right}</button></div></section>`;
}

let featured = 0, rotate = 0;
function billboard(t) {
  const bb = app.querySelector('.billboard');
  bb.innerHTML = `
    <div class="backdrop kenburns"><img src="${artOf(t, 'backdrop')}" alt=""></div>
    <div class="shade"></div>
    <div class="info">
      <div class="kicker"><b>M</b><span>${t.badge}</span></div>
      <h2 class="title-logo">${esc(t.title)}</h2>
      <div class="top10"><span class="t10">TOP<br>10</span><span>#${(featured % 6) + 1} in Projects Today</span></div>
      <p class="synopsis">${esc(t.synopsis)}</p>
      <div class="actions">
        <a class="btn play" ${t.links?.play || t.links?.code ? `href="${t.links.play || t.links.code}" target="_blank" rel="noopener"` : 'href="#"'}>${I.play}<span>Play</span></a>
        <button class="btn more" data-id="${t.id}">${I.info}<span>More Info</span></button>
      </div>
    </div>
    <div class="rating"><button class="round" aria-label="Sound">${I.mute}</button><span class="age">95% CI</span></div>`;
  bb.querySelector('.more').addEventListener('click', () => detail(t.id));
}

function browse() {
  app.innerHTML = `
    <section class="browse">
      <header class="top">
        <div class="wordmark">MAZENFLIX</div>
        <nav>
          <button class="on" data-go="top">Home</button><button data-go="projects">Projects</button>
          <button data-go="experience">Experience</button><button data-go="about">About Mazen</button>
        </nav>
        <div class="tools">
          <label class="search"><span>${I.search}</span><input placeholder="Titles, tags, genres" aria-label="Search"></label>
          <button class="icon bell" aria-label="Notifications">${I.bell}<i>2</i></button>
          <button class="who" title="Switch profile">${avatar(person, 32)}<span class="caret">${I.down}</span></button>
        </div>
      </header>
      <div class="billboard"></div>
      <div class="rows">
        ${row(`Continue exploring for ${person.name}`, person.pick, 'progress')}
        ${row('Top 10 projects today', data.projects.map((p) => p.id), 'top')}
        ${[...data.rows].sort((a, b) => (b.title === person.first) - (a.title === person.first)).map((r) => row(r.title, r.ids)).join('')}
        <div id="experience">${row('Experience', data.experience.map((x) => x.id))}</div>
        <section class="row about" id="about"><h3>About Mazen</h3>
          <div class="about-grid">
            <button class="cert" data-cert="${data.certificates[0].id}"><img src="${ROOT + data.certificates[0].image}" alt="${esc(data.certificates[0].title)}"><span>${esc(data.certificates[0].title)} · 2026</span></button>
            <div class="bio"><h4>${esc(data.person.name)}</h4><p class="role">${esc(data.person.headline)}</p>
              ${data.person.about.map((t) => `<p>${esc(t)}</p>`).join('')}
              <div class="links">${links()}</div></div>
          </div>
        </section>
      </div>
      <footer><div class="links">${links()}</div><p>© 2026 Mazenflix · a portfolio, not a streaming service</p></footer>
    </section>
    <div class="search-results" hidden></div>`;
  const order = person.id === 'engineer' ? [4, 2, 0, 1, 3, 5] : [0, 1, 2, 3, 4, 5];
  const cycle = () => { billboard(byId[data.projects[order[featured % 6]].id]); featured++; };
  cycle();
  clearInterval(rotate);
  rotate = setInterval(() => { if (!document.querySelector('.modal') && !app.querySelector('.billboard:hover')) cycle(); }, 11000);

  const scroller = app.querySelector('.browse');
  scroller.addEventListener('scroll', () => app.querySelector('header.top').classList.toggle('solid', scroller.scrollTop > 30));
  app.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('click', () => detail(c.dataset.id));
    c.addEventListener('mouseenter', () => preview(c));
  });
  app.querySelectorAll('.slider').forEach((s) => {
    const track = s.querySelector('.track');
    s.querySelector('.prev').addEventListener('click', () => track.scrollBy({ left: -track.clientWidth * 0.9, behavior: 'smooth' }));
    s.querySelector('.next').addEventListener('click', () => track.scrollBy({ left: track.clientWidth * 0.9, behavior: 'smooth' }));
  });
  app.querySelector('.cert').addEventListener('click', () => certificate(data.certificates[0].id));
  app.querySelector('.who').addEventListener('click', () => { try { sessionStorage.removeItem('tv-person'); } catch { /* fine */ } gate(); });
  app.querySelectorAll('nav [data-go]').forEach((b) => b.addEventListener('click', () => {
    app.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    const to = { projects: app.querySelectorAll('.row')[1], experience: app.querySelector('#experience'), about: app.querySelector('#about') }[b.dataset.go];
    if (!to) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else to.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  app.querySelector('.bell').addEventListener('click', (e) => toast(e.currentTarget, ['New: <b>Crisis Triage</b> is now streaming', 'Just added: <b>FaceID Bench</b>']));
  const input = app.querySelector('.search input');
  input.addEventListener('input', () => search(input.value));
  app.querySelector('.billboard .more').focus({ preventScroll: true });
}

function links() {
  const P = data.person.links;
  const names = { github: 'GitHub', linkedin: 'LinkedIn', researchgate: 'ResearchGate', huggingface: 'Hugging Face', email: 'Email' };
  return Object.entries(names).filter(([k]) => P[k]).map(([k, n]) => `<a href="${k === 'email' ? 'mailto:' : ''}${P[k]}" target="_blank" rel="noopener">${n}</a>`).join('');
}

// ---------- hover preview: the card that grows ----------
let pv = null, pvTimer = 0;
function preview(cardEl) {
  clearTimeout(pvTimer);
  if (matchMedia('(hover: none)').matches) return;
  pvTimer = setTimeout(() => {
    closePreview();
    const t = byId[cardEl.dataset.id];
    const r = cardEl.getBoundingClientRect();
    const w = Math.max(r.width * 1.45, 330), x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    pv = document.createElement('div');
    pv.className = 'preview';
    pv.style.cssText = `left:${x}px;top:${r.top + r.height / 2}px;width:${w}px;--c:${t.color}`;
    pv.innerHTML = `
      <div class="pv-art"><img src="${artOf(t, 'backdrop')}" alt=""><span class="logo">${esc(t.title)}</span></div>
      <div class="pv-body">
        <div class="pv-actions">
          <a class="round white" ${t.links?.play || t.links?.code ? `href="${t.links.play || t.links.code}" target="_blank" rel="noopener"` : ''} aria-label="Play">${I.play}</a>
          <button class="round" aria-label="Add">${I.plus}</button><button class="round" aria-label="Like">${I.like}</button>
          <button class="round more" aria-label="More info">${I.down}</button>
        </div>
        <div class="pv-meta"><span class="match">${esc(t.meta.value)}</span><span class="age">${t.type === 'job' ? 'JOB' : '95% CI'}</span><span>${t.year}</span><span class="hd">HD</span></div>
        <p class="pv-hook">${esc(t.hook)}</p>
        <div class="pv-genres">${(t.tags || []).slice(0, 3).map(esc).join('<i>•</i>')}</div>
      </div>`;
    document.body.append(pv);
    pv.querySelector('.more').addEventListener('click', () => { closePreview(); detail(t.id); });
    pv.querySelector('.pv-art').addEventListener('click', () => { closePreview(); detail(t.id); });
    pv.addEventListener('mouseleave', closePreview);
    requestAnimationFrame(() => pv && pv.classList.add('open'));
  }, 420);
  cardEl.addEventListener('mouseleave', () => clearTimeout(pvTimer), { once: true });
}
function closePreview() { if (pv) { const p = pv; pv = null; p.classList.remove('open'); setTimeout(() => p.remove(), 200); } }

// ---------- detail ----------
function modal(html, cls = '') {
  closeModal(true); closePreview();
  const m = document.createElement('div');
  m.className = 'modal ' + cls;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close round" aria-label="Close">${I.close}</button>${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) closeModal(); });
  document.body.append(m);
  requestAnimationFrame(() => m.classList.add('open'));
  m.querySelector('.close').focus();
  return m;
}
function closeModal(now) {
  const m = document.querySelector('.modal');
  if (!m) return;
  if (now) return m.remove();
  m.classList.remove('open');
  setTimeout(() => m.remove(), 220);
}

function detail(id) {
  const t = byId[id];
  const shot = t.type === 'project' && t.art ? ROOT + 'content/' + t.art : null;
  const more = titles.filter((x) => x.id !== id && x.type === t.type).slice(0, 3);
  const names = { play: 'Demo', guide: 'Field guide', code: 'GitHub', model: 'Model' };
  const m = modal(`
    <div class="hero"><img src="${artOf(t, 'backdrop')}" alt=""><div class="shade"></div>
      <div class="hero-info"><div class="kicker"><b>M</b><span>${t.badge}</span></div><h2 class="title-logo">${esc(t.title)}</h2>
        <div class="actions">${t.links?.play ? `<a class="btn play" href="${t.links.play}" target="_blank" rel="noopener">${I.play}<span>Play</span></a>` : ''}
          ${t.links?.code ? `<a class="round" href="${t.links.code}" target="_blank" rel="noopener" aria-label="Code on GitHub">${I.plus}</a>` : ''}<button class="round" aria-label="Like">${I.like}</button></div></div></div>
    <div class="body">
      <div class="main">
        <div class="pv-meta"><span class="match">${esc(t.meta.value)}</span><span>${t.year}</span><span class="age">${t.type === 'job' ? 'JOB' : '95% CI'}</span><span class="hd">HD</span></div>
        <p class="stat-label">${esc(t.meta.label)}</p>
        <p class="synopsis">${esc(t.synopsis)}</p>
      </div>
      <div class="side">
        <p><span>Tags:</span> ${(t.tags || []).map(esc).join(', ')}</p>
        <p><span>Genres:</span> ${(t.genre || []).map(esc).join(', ')}</p>
        <p><span>This ${t.type === 'job' ? 'role' : 'project'} is:</span> Measured, Reproducible</p>
      </div>
    </div>
    <section class="episodes"><h3>${t.type === 'job' ? 'What I did' : 'Findings'} <span>${t.episodes.length} episodes</span></h3>
      ${t.episodes.map((e, i) => `<div class="ep"><span class="n">${i + 1}</span>
        <div class="thumb">${shot && i === 0 ? `<img class="doc" src="${shot}" alt="">` : `<img src="${artOf(t, 'backdrop')}" alt="" style="object-position:${80 - i * 15}% 50%">`}</div>
        <div><h4>${t.type === 'job' ? 'Part' : 'Finding'} ${i + 1}</h4><p>${esc(e)}</p></div></div>`).join('')}
    </section>
    ${more.length ? `<section class="more-like"><h3>More like this</h3><div class="grid">${more.map((x) => `
      <button class="like-card" data-id="${x.id}"><div class="la"><img src="${artOf(x, 'backdrop')}" alt=""><span class="logo">${esc(x.title)}</span></div>
        <div class="lb"><div class="pv-meta"><span class="match">${esc(x.meta.value)}</span><span>${x.year}</span></div><p>${esc(x.hook)}</p></div></button>`).join('')}</div></section>` : ''}
    ${t.links && Object.keys(t.links).length ? `<section class="about-title"><h3>About <b>${esc(t.title)}</b></h3><div class="links">${Object.entries(t.links).map(([k, v]) => `<a href="${v}" target="_blank" rel="noopener">${names[k] || k}</a>`).join('')}</div></section>` : ''}`);
  m.querySelectorAll('.like-card').forEach((b) => b.addEventListener('click', () => detail(b.dataset.id)));
}

function certificate(id) {
  const c = data.certificates.find((x) => x.id === id);
  modal(`<div class="cert-view"><img src="${ROOT + c.image}" alt="${esc(c.title)}"></div>
    <div class="body"><div class="main"><h2 class="title-logo small">${esc(c.title)}</h2>
    <p class="synopsis">${esc(c.issuer)} · conferred ${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>`);
}

function search(q) {
  const box = document.querySelector('.search-results');
  q = q.trim().toLowerCase();
  if (!q) { box.hidden = true; return; }
  const hits = titles.filter((t) => [t.title, t.hook, ...(t.tags || []), ...(t.genre || [])].join(' ').toLowerCase().includes(q));
  box.hidden = false;
  box.innerHTML = `<h3>${hits.length ? `Results for “${esc(q)}”` : `No titles match “${esc(q)}”`}</h3><div class="grid">${hits.map((t, i) => card(t, i)).join('')}</div>`;
  box.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => detail(c.dataset.id)));
}

function toast(anchor, items) {
  document.querySelector('.dropdown')?.remove();
  const r = anchor.getBoundingClientRect(), d = document.createElement('div');
  d.className = 'dropdown';
  d.style.cssText = `top:${r.bottom + 10}px;right:${innerWidth - r.right}px`;
  d.innerHTML = items.map((t) => `<p>${t}</p>`).join('');
  document.body.append(d);
  setTimeout(() => addEventListener('click', () => d.remove(), { once: true }), 0);
}

// ---------- keys: a TV remote ----------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.modal')) closeModal();
    else if (pv) closePreview();
    else parent.postMessage({ type: 'room-back' }, '*');
    return;
  }
  const cur = document.activeElement?.closest('.card');
  if (!cur || !/^Arrow/.test(e.key)) return;
  e.preventDefault();
  const track = cur.closest('.track'), cards = [...track.querySelectorAll('.card')], i = cards.indexOf(cur);
  if (e.key === 'ArrowRight') cards[i + 1]?.focus();
  if (e.key === 'ArrowLeft') cards[i - 1]?.focus();
  const rows = [...document.querySelectorAll('.track')], r = rows.indexOf(track);
  const next = rows[r + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)];
  if (next && next !== track) next.querySelectorAll('.card')[Math.min(i, next.querySelectorAll('.card').length - 1)]?.focus();
  document.activeElement?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
});

person ? browse() : gate();
