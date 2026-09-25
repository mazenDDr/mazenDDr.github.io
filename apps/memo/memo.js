// The pinboard above the bed: how I work, skills, the diploma, a few projects
// and how to reach me. Laid out on a fixed 1300x900 stage scaled to fit.
// In the room, a screen nobody is looking at stops animating (the room says when).
addEventListener('message', (e) => { if (e.data?.type === 'room-focus') document.documentElement.classList.toggle('asleep', !e.data.on); });
// embedded in the room, start asleep: the room wakes the screen you look at
if (new URLSearchParams(location.search).has('room') && parent !== window) document.documentElement.classList.add('asleep');
const ROOT = '../../';
// (an async start instead of a top-level await: Safari before iOS 15 can't parse that)
(async () => {
  const data = await (await fetch(ROOT + 'content/portfolio.json')).json();
  const P = data.person;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ok = (v) => v && !String(v).startsWith('TODO');
  const W = 1300, H = 900;

  const board = document.getElementById('board');
  const stage = document.createElement('div');
  stage.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`;
  board.append(stage);
  const fit = () => {
    board.classList.toggle('list', innerWidth < 760);
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(${(innerWidth - W * s) / 2}px,${(innerHeight - H * s) / 2}px) scale(${s})`;
  };
  fit();
  addEventListener('resize', fit);

  const byId = Object.fromEntries(data.projects.map((p) => [p.id, p]));
  const skillColors = ['#fff27a', '#ffc2d1', '#b8f2c9', '#bfe3ff'];
  const cert = data.certificates[0];
  const items = [
    { x: 40, y: 50, r: -2.5, pin: '#2a6fdb', html: `<div class="index"><h3>HOW I WORK</h3><ol>${P.principles.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` },
    { x: 470, y: 36, r: 3, pin: '#d62828', html: `<div class="polaroid"><img src="${ROOT + cert.image}" alt="${esc(cert.title)}"><p>BSc DS &amp; AI — graduated! 🎓</p></div>` },
    { x: 830, y: 60, r: -1.5, pin: '#f4a261', html: `<div class="contact"><h3>${esc(P.name)}</h3>${esc(P.headline)}<br>
        ${ok(P.links.github) ? `<a href="${P.links.github}" target="_blank" rel="noopener">github.com/mazenDDr</a><br>` : ''}
        ${ok(P.links.linkedin) ? `<a href="${P.links.linkedin}" target="_blank" rel="noopener">LinkedIn</a><br>` : ''}
        ${ok(P.links.researchgate) ? `<a href="${P.links.researchgate}" target="_blank" rel="noopener">ResearchGate</a><br>` : ''}
        ${ok(P.links.huggingface) ? `<a href="${P.links.huggingface}" target="_blank" rel="noopener">huggingface.co/mazenDDr</a><br>` : ''}
        ${ok(P.links.email) ? `<a href="mailto:${P.links.email}">${esc(P.links.email)}</a>` : ''}</div>` },
    ...Object.entries(data.skills).map(([k, v], i) => ({
      x: 34 + i * 228, y: 430 + (i % 2) * 40, r: [-4, 2.5, -1.5, 4][i], pin: ['#2a9d8f', '#d62828', '#6d597a', '#e9c46a'][i],
      html: `<div class="sticky" style="--c:${skillColors[i]}"><h3>${esc(k)}</h3><ul>${v.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`,
    })),
    ...['crisis-triage', 'faceid-bench', 'receipt-vlm'].map((id, i) => {
      const p = byId[id];
      return { x: 985 - i * 8, y: 290 + i * 195, r: [2, -3, 1.5][i], pin: '#264653', id,
        html: `<div class="clip" style="--c:${p.color}"><div class="k">Project</div><h4>${esc(p.title)}</h4><b>${esc(p.stat.value)}</b><span>${esc(p.stat.label)}</span></div>` };
    }),
  ];

  items.forEach((it, i) => {
    const el = document.createElement('button');
    el.className = 'item';
    el.style.cssText = `left:${it.x}px;top:${it.y}px;--r:${it.r}deg;--pin:${it.pin}`;
    el.innerHTML = `<i class="pin"></i>${it.html}`;
    el.addEventListener('click', (e) => { if (!e.target.closest('a')) zoom(it); });
    el.dataset.i = i;
    stage.append(el);
  });

  // Red string from the principles card to each project clip: the method behind every result.
  requestAnimationFrame(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'string');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pinAt = (el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop });
    const from = pinAt(stage.children[0]);
    const lines = [...stage.querySelectorAll('.item')].filter((el) => items[el.dataset.i].id).map((el) => {
      const to = pinAt(el);
      const mx = (from.x + to.x) / 2, my = Math.max(from.y, to.y) + 60;
      return `<path d="M${from.x} ${from.y} Q${mx} ${my} ${to.x} ${to.y}" fill="none" stroke="#b3001b" stroke-width="2.4" opacity=".85"/>`;
    });
    svg.innerHTML = lines.join('');
    stage.append(svg);
  });

  const zoomEl = document.getElementById('zoom');
  function zoom(it) {
    zoomEl.innerHTML = `<button class="close" aria-label="Close">✕</button><div class="item" style="--r:${it.r}deg">${it.html}</div>`;
    const inner = zoomEl.querySelector('.item');
    inner.firstElementChild.classList.forEach((c) => inner.classList.add(c));
    if (it.id) {
      const p = byId[it.id];
      inner.insertAdjacentHTML('beforeend', `<p style="margin:10px 0 0;font:13px Inter;background:#fff;padding:8px 10px;max-width:270px">${esc(p.hook)}
        ${p.links.play ? `<a href="${p.links.play}" target="_blank" rel="noopener">Open demo →</a>` : `<a href="${p.links.code}" target="_blank" rel="noopener">Code →</a>`}</p>`);
    }
    zoomEl.hidden = false;
    zoomEl.querySelector('.close').focus();
  }
  zoomEl.addEventListener('click', (e) => { if (e.target === zoomEl || e.target.closest('.close')) zoomEl.hidden = true; });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!zoomEl.hidden) zoomEl.hidden = true;
    else parent.postMessage({ type: 'room-back' }, '*');
  });
})();
