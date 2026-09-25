// Mazenflix: the TV in the room. Everything shown comes from content/portfolio.json.
const ROOT = '../../';
const data = await (await fetch(ROOT + 'content/portfolio.json')).json();
const app = document.getElementById('app');
const byId = Object.fromEntries(data.projects.map((p) => [p.id, p]));
const media = (p) => ROOT + 'content/' + p;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
if (new URLSearchParams(location.search).has('room')) document.body.classList.add('in-room');

const PEOPLE = [
  { id: 'recruiter', name: 'Recruiter', icon: '💼', color: '#e50914', greet: 'The short version: what I built and what it scored.',
    first: 'Measured, not guessed' },
  { id: 'engineer', name: 'Engineer', icon: '🛠️', color: '#2563eb', greet: 'The honest version: including where the simple baseline won.',
    first: 'When the simple baseline won' },
  { id: 'curious', name: 'Just curious', icon: '🍿', color: '#f59e0b', greet: 'Grab a seat. Start anywhere.', first: 'Language & agents' },
];
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.5"/></svg>',
};
let person = null;
try { person = PEOPLE.find((p) => p.id === sessionStorage.getItem('tv-person')) || null; } catch { /* private mode */ }

function gate() {
  app.innerHTML = `
    <section class="gate">
      <div class="wordmark">MAZENFLIX</div>
      <h1>Who's watching?</h1>
      <div class="people">${PEOPLE.map((p) => `
        <button class="person" data-id="${p.id}">
          <div class="avatar" style="background:${p.color}">${p.icon}</div><span>${p.name}</span>
        </button>`).join('')}</div>
      <small>Everything here is real work, with the numbers it scored.</small>
    </section>`;
  app.querySelectorAll('.person').forEach((b) => b.addEventListener('click', () => {
    person = PEOPLE.find((p) => p.id === b.dataset.id);
    try { sessionStorage.setItem('tv-person', person.id); } catch { /* fine */ }
    browse();
  }));
  app.querySelector('.person').focus({ preventScroll: true });
}

function rows() {
  const all = [...data.rows];
  all.sort((a, b) => (b.title === person.first) - (a.title === person.first));
  return all;
}

function card(p, i) {
  return `<button class="card" data-id="${p.id}" style="--c:${p.color}" aria-label="${esc(p.title)}: ${esc(p.hook)}">
    <div class="thumb"><img src="${media(p.art)}" alt="" loading="lazy"></div>
    <span class="n">${String(i + 1).padStart(2, '0')}</span>
    <div class="name">${esc(p.title)}</div>
    <div class="peek"><b>${esc(p.stat.value)}</b><span>${esc(p.stat.label)}</span></div>
  </button>`;
}

let featured = 0, timer = 0;
function billboard(p) {
  const bb = app.querySelector('.billboard');
  bb.style.setProperty('--c', p.color);
  bb.innerHTML = `
    <div class="art" style="background:radial-gradient(ellipse at 75% 50%, ${p.color}55, #141414 70%)"><img src="${media(p.art)}" alt=""></div>
    <div class="info">
      <div class="kicker"><b>M</b> PROJECT</div>
      <h2>${esc(p.title)}</h2>
      <p class="hook">${esc(p.hook)}</p>
      <div class="meta"><span class="match">${esc(p.stat.value)}</span><span>${esc(p.stat.label)}</span></div>
      <div class="meta"><span>${p.year}</span><span class="rating">95% CI</span><span>${p.genre.map(esc).join(' · ')}</span></div>
      <div class="actions">
        ${p.links.play ? `<a class="btn play" href="${p.links.play}" target="_blank" rel="noopener">${ICON.play} Play</a>` : `<a class="btn play" href="${p.links.code}" target="_blank" rel="noopener">${ICON.play} Code</a>`}
        <button class="btn more" data-id="${p.id}">${ICON.info} More info</button>
      </div>
    </div>`;
  bb.querySelector('.more').addEventListener('click', () => detail(p.id));
}

function browse() {
  app.innerHTML = `
    <section class="browse">
      <header class="top">
        <div class="wordmark">MAZENFLIX</div>
        <nav><button class="on" data-go="home">Home</button><button data-go="about">About Mazen</button></nav>
        <button class="who" title="Switch profile"><span>${esc(person.name)}</span><i style="background:${person.color}">${person.icon}</i></button>
      </header>
      <div class="billboard"></div>
      <div class="rows">
        ${rows().map((r) => `
          <section class="row"><h3>${esc(r.title)}</h3>
            <div class="track">${r.ids.map((id, i) => card(byId[id], i)).join('')}</div>
          </section>`).join('')}
        <section class="row"><h3>Experience</h3>
          <div class="track">${data.experience.map((x) => `
            <button class="card job" data-job="${x.id}" aria-label="${esc(x.role)}, ${esc(x.org)}">
              <div class="thumb"><div class="job-face"><small>${esc(x.dates)}</small><b>${esc(x.org)}</b><span>${esc(x.role)}</span></div></div>
              <div class="peek"><span>${esc(x.hook)}</span></div>
            </button>`).join('')}</div>
        </section>
        <section class="row" id="about-row"><h3>About Mazen</h3>
          <div class="track">
            ${data.certificates.map((c) => `
              <button class="card person-card" data-cert="${c.id}" aria-label="${esc(c.title)}">
                <div class="thumb"><img src="${ROOT + c.image}" alt=""></div>
                <div class="peek"><b>${esc(new Date(c.date).getFullYear())}</b><span>${esc(c.title)}, ${esc(c.issuer)}</span></div>
              </button>`).join('')}
            <button class="card" data-about="1" style="--c:#3b2616">
              <div class="thumb" style="display:grid;place-items:center"><div class="wordmark" style="font-size:54px;color:#f0a45a">${esc(data.person.name)}</div></div>
              <div class="peek"><b>Who?</b><span>${esc(data.person.one_liner)}</span></div>
            </button>
          </div>
        </section>
      </div>
    </section>`;
  const order = person.id === 'engineer' ? [4, 2, 0, 1, 3, 5] : [0, 1, 2, 3, 4, 5];
  const cycle = () => { billboard(data.projects[order[featured % order.length]]); featured++; };
  cycle();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.querySelector('.modal') && !app.querySelector('.billboard:hover')) cycle(); }, 9000);

  const scroller = app.querySelector('.browse');
  scroller.addEventListener('scroll', () => app.querySelector('header.top').classList.toggle('solid', scroller.scrollTop > 40));
  app.querySelectorAll('.card[data-id]').forEach((c) => c.addEventListener('click', () => detail(c.dataset.id)));
  app.querySelectorAll('.card[data-cert]').forEach((c) => c.addEventListener('click', () => certificate(c.dataset.cert)));
  app.querySelector('.card[data-about]').addEventListener('click', about);
  app.querySelectorAll('.card[data-job]').forEach((c) => c.addEventListener('click', () => job(c.dataset.job)));
  app.querySelector('.who').addEventListener('click', () => { try { sessionStorage.removeItem('tv-person'); } catch { /* fine */ } gate(); });
  app.querySelector('[data-go="about"]').addEventListener('click', () => {
    app.querySelector('#about-row').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  app.querySelector('.billboard .more').focus({ preventScroll: true });
}

function modal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) closeModal(); });
  document.body.append(m);
  m.querySelector('.close')?.focus();
  return m;
}
function closeModal() { document.querySelector('.modal')?.remove(); }

function detail(id) {
  const p = byId[id];
  const links = Object.entries(p.links).map(([k, v]) => `<a href="${v}" target="_blank" rel="noopener">${{ play: '▶ Demo', code: 'GitHub', guide: 'Field guide', model: 'Model' }[k] || k}</a>`).join('');
  modal(`
    <div class="hero" style="--c:${p.color}"><img src="${media(p.art)}" alt="">
      <button class="close" aria-label="Close">✕</button>
      <div class="title"><h2>${esc(p.title)}</h2>
        <div class="actions">${p.links.play ? `<a class="btn play" href="${p.links.play}" target="_blank" rel="noopener">${ICON.play} Play</a>` : ''}
          <a class="btn more" href="${p.links.code}" target="_blank" rel="noopener">GitHub</a></div></div>
    </div>
    <div class="body">
      <div>
        <div class="stat">${esc(p.stat.value)}</div><p>${esc(p.stat.label)}</p>
        <p style="font-size:18px;margin:0 0 16px">${esc(p.logline)}</p>
        <ul>${p.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      </div>
      <div class="side">
        <p>Tags: <span>${p.tags.map(esc).join(', ')}</span></p>
        <p>Genre: <span>${p.genre.map(esc).join(', ')}</span></p>
        <p>Year: <span>${p.year}</span></p>
        <div class="links">${links}</div>
      </div>
    </div>`);
}

function job(id) {
  const x = data.experience.find((j) => j.id === id);
  modal(`
    <div class="hero" style="aspect-ratio:16/5;background:linear-gradient(135deg,#3b2616,#141414);display:grid;align-items:end">
      <button class="close" aria-label="Close">✕</button>
      <div class="title"><h2>${esc(x.org)}</h2></div></div>
    <div class="body">
      <div><div class="stat" style="color:#fff;font-size:34px">${esc(x.role)}</div><p>${esc(x.dates)}</p>
        <p style="font-size:18px;margin:0 0 16px">${esc(x.hook)}</p>
        <ul>${x.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="side"><p>Tags: <span>${x.tags.map(esc).join(', ')}</span></p></div>
    </div>`);
}

function certificate(id) {
  const c = data.certificates.find((x) => x.id === id);
  modal(`
    <div class="hero" style="aspect-ratio:auto;background:#f5f1e8"><img src="${ROOT + c.image}" alt="${esc(c.title)}" style="height:auto;object-fit:contain">
      <button class="close" aria-label="Close">✕</button></div>
    <div class="body" style="grid-template-columns:1fr;padding-top:24px">
      <div><div class="stat" style="color:#fff">${esc(c.title)}</div><p>${esc(c.issuer)} · conferred ${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
    </div>`);
}

function about() {
  const P = data.person;
  const link = (k, label) => (P.links[k] && !P.links[k].startsWith('TODO') ? `<a href="${k === 'email' ? 'mailto:' : ''}${P.links[k]}" target="_blank" rel="noopener">${label}</a>` : '');
  modal(`
    <div class="hero" style="--c:#3b2616;aspect-ratio:16/5;display:grid;place-items:center"><div class="wordmark" style="font-size:96px;color:#f0a45a">${esc(P.name)}</div>
      <button class="close" aria-label="Close">✕</button></div>
    <div class="body">
      <div>${P.about.map((t) => `<p style="font-size:17px;margin:0 0 14px">${esc(t)}</p>`).join('')}</div>
      <div class="side"><p><span>How I work</span></p><ul>${P.principles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <div class="links">${link('github', 'GitHub')}${link('linkedin', 'LinkedIn')}${link('researchgate', 'ResearchGate')}${link('huggingface', 'Hugging Face')}${link('email', 'Email')}</div></div>
    </div>`);
}

// TV-remote keys: arrows move between cards, Enter opens, Escape closes.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.modal')) closeModal();
    else parent.postMessage({ type: 'room-back' }, '*');
    return;
  }
  const cur = document.activeElement?.closest('.card');
  if (!cur || !/^Arrow/.test(e.key)) return;
  e.preventDefault();
  const track = cur.parentElement, cards = [...track.children], i = cards.indexOf(cur);
  if (e.key === 'ArrowRight') cards[i + 1]?.focus();
  if (e.key === 'ArrowLeft') cards[i - 1]?.focus();
  const rowsEl = [...document.querySelectorAll('.track')], r = rowsEl.indexOf(track);
  const next = rowsEl[r + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)];
  if (next && next !== track) next.children[Math.min(i, next.children.length - 1)]?.focus();
  document.activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
});

person ? browse() : gate();
