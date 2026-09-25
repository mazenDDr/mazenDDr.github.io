// Key art for Mazenflix: cinematic backdrops (16:9) and posters (2:3) drawn as
// SVG from each project's own theme, so every title looks like it belongs on a
// streaming service. Each motif shows what the project actually does.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rng(seed) {
  let s = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Motifs in a 1600x900 frame, drawn on the right so the title can sit left.
const MOTIF = {
  'crisis-triage': (c, r) => {
    // A radar sweep over incoming messages: sure ones sent, unsure ones held for a person.
    let s = `<g transform="translate(1120 450)" opacity=".9">`;
    for (let i = 1; i <= 5; i++) s += `<circle r="${i * 80}" fill="none" stroke="${c}" stroke-opacity="${0.42 - i * 0.06}" stroke-width="2"/>`;
    s += `<path d="M0 0 L400 0 A400 400 0 0 0 346 -200 Z" fill="url(#sweep)"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="7s" repeatCount="indefinite"/></path>`;
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = 60 + r() * 330, sure = r() > 0.4;
      s += `<circle cx="${(Math.cos(a) * d).toFixed(0)}" cy="${(Math.sin(a) * d).toFixed(0)}" r="${sure ? 5 : 7}" fill="${sure ? '#fff' : c}" opacity="${sure ? 0.85 : 1}"/>`;
    }
    return s + `</g><g font-family="'Bebas Neue',Impact" font-size="54" letter-spacing="3"><text x="1330" y="210" fill="#fff" opacity=".85" transform="rotate(-8 1330 210)">SENT</text><text x="820" y="760" fill="${c}" transform="rotate(6 820 760)">FOR A PERSON</text></g>`;
  },
  'faceid-bench': (c, r) => {
    // Face landmarks joined into a mesh, with a scan line passing over.
    const pts = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r());
      pts.push([1150 + Math.cos(a) * rr * 230, 450 + Math.sin(a) * rr * 300]);
    }
    let s = '<g opacity=".95">';
    for (let i = 0; i < pts.length; i++) {
      const near = pts.map((p, j) => [j, Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])]).sort((a, b) => a[1] - b[1]).slice(1, 4);
      for (const [j] of near) s += `<line x1="${pts[i][0].toFixed(0)}" y1="${pts[i][1].toFixed(0)}" x2="${pts[j][0].toFixed(0)}" y2="${pts[j][1].toFixed(0)}" stroke="${c}" stroke-opacity=".35" stroke-width="1.5"/>`;
    }
    for (const [x, y] of pts) s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="3.5" fill="#fff" opacity=".9"/>`;
    s += `<ellipse cx="1150" cy="450" rx="250" ry="320" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-dasharray="4 10"/>`;
    s += `<rect x="880" y="120" width="540" height="6" fill="${c}" opacity=".9" filter="url(#glow)"><animate attributeName="y" values="130;770;130" dur="5s" repeatCount="indefinite"/></rect>`;
    return s + '</g>';
  },
  'contract-rag': (c, r) => {
    // A stack of contract pages, one clause lit up and cited.
    let s = '';
    for (let k = 2; k >= 0; k--) {
      const x = 900 + k * 38, y = 110 + k * 30;
      s += `<g transform="rotate(${(k - 1) * 4} ${x + 230} ${y + 330})"><rect x="${x}" y="${y}" width="460" height="640" rx="6" fill="#f3efe6" opacity="${0.25 + (2 - k) * 0.3}"/>`;
      if (k === 0) {
        for (let i = 0; i < 17; i++) {
          const w = 280 + r() * 110, yy = y + 70 + i * 32, hi = i >= 7 && i <= 9;
          if (hi) s += `<rect x="${x + 34}" y="${yy - 16}" width="${w + 20}" height="26" fill="${c}" opacity=".55"/>`;
          s += `<rect x="${x + 44}" y="${yy - 7}" width="${w}" height="8" rx="4" fill="#3a3a3a" opacity="${hi ? 0.9 : 0.35}"/>`;
        }
        s += `<text x="${x + 380}" y="${y + 330}" font-family="'Bebas Neue',Impact" font-size="64" fill="${c}">[5]</text>`;
      }
      s += '</g>';
    }
    return s;
  },
  'receipt-vlm': (c, r) => {
    // A till receipt turning into JSON.
    let s = `<g transform="rotate(-6 1020 450)"><path d="M880 90 h260 v700 l-20 18 -20 -18 -20 18 -20 -18 -20 18 -20 -18 -20 18 -20 -18 -20 18 -20 -18 -20 18 -20 -18 -20 18 -20 -18 z" fill="#f4f1ea" opacity=".92"/>`;
    for (let i = 0; i < 16; i++) s += `<rect x="905" y="${140 + i * 38}" width="${90 + r() * 80}" height="9" rx="4" fill="#333" opacity=".55"/><rect x="${1080 - r() * 20}" y="${140 + i * 38}" width="36" height="9" rx="4" fill="#333" opacity=".55"/>`;
    s += '</g><g font-family="ui-monospace,Menlo,monospace" font-size="30" fill="#fff">';
    const lines = ['{', '  "items": [', '    {"name": …, "count": 2},', '    {"price": 4.50}', '  ],', '  "total": 13.90', '}'];
    lines.forEach((l, i) => { s += `<text x="1190" y="${300 + i * 46}" opacity="${0.55 + 0.45 * (i % 2)}" fill="${i === 5 ? c : '#fff'}">${esc(l)}</text>`; });
    return s + '</g>';
  },
  'pipeline-agents': (c) => {
    // Four agents passing work around, and one agent alone doing better.
    const nodes = [[930, 260, 'PLANNER'], [1230, 260, 'EXECUTOR'], [1230, 560, 'CRITIC'], [930, 560, 'REVISER']];
    let s = '<g font-family="\'Bebas Neue\',Impact" font-size="30" letter-spacing="2" text-anchor="middle">';
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = nodes[i], [x2, y2] = nodes[(i + 1) % 4];
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-dasharray="10 12"><animate attributeName="stroke-dashoffset" from="0" to="-44" dur="1.2s" repeatCount="indefinite"/></line>`;
    }
    for (const [x, y, t] of nodes) s += `<circle cx="${x}" cy="${y}" r="62" fill="#1c1c1c" stroke="#fff" stroke-opacity=".45" stroke-width="3"/><text x="${x}" y="${y + 11}" fill="#ddd">${t}</text>`;
    s += `<circle cx="1450" cy="410" r="92" fill="${c}" filter="url(#glow)"/><text x="1450" y="400" fill="#fff" font-size="40">ONE</text><text x="1450" y="440" fill="#fff" font-size="40">AGENT</text>`;
    return s + '</g>';
  },
  'causal-uplift-marketing': (c, r) => {
    // Two target lists that barely overlap: likely buyers vs people the email changes.
    let s = `<circle cx="1030" cy="450" r="270" fill="#fff" fill-opacity=".06" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>`;
    s += `<circle cx="1330" cy="450" r="270" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="3"/>`;
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 250, left = i < 45;
      s += `<circle cx="${((left ? 1030 : 1330) + Math.cos(a) * d).toFixed(0)}" cy="${(450 + Math.sin(a) * d).toFixed(0)}" r="4" fill="${left ? '#fff' : c}" opacity=".8"/>`;
    }
    return s + `<text x="1180" y="465" text-anchor="middle" font-family="'Bebas Neue',Impact" font-size="52" fill="#fff">76</text>`;
  },
  capstone: (c, r) => {
    // A call's waveform turning into a scored report.
    let s = '<g>';
    for (let i = 0; i < 110; i++) {
      const h = (Math.sin(i * 0.23) * 0.5 + 0.5) * (40 + r() * 180);
      s += `<rect x="${860 + i * 6.2}" y="${450 - h / 2}" width="3.6" height="${h}" rx="1.8" fill="${i > 70 ? c : '#fff'}" opacity="${i > 70 ? 0.95 : 0.6}"/>`;
    }
    return s + `</g><text x="1500" y="250" text-anchor="end" font-family="'Bebas Neue',Impact" font-size="120" fill="${c}" opacity=".95">100%</text><text x="1500" y="300" text-anchor="end" font-family="Inter,sans-serif" font-size="26" fill="#fff" opacity=".7">OF CALLS SCORED</text>`;
  },
  tanmeyah: (c, r) => {
    // A transaction network with one flagged path.
    const pts = Array.from({ length: 28 }, () => [880 + r() * 620, 130 + r() * 640]);
    let s = '';
    for (let i = 0; i < pts.length; i++) {
      const j = (i * 7 + 3) % pts.length, k = (i * 11 + 5) % pts.length;
      for (const q of [j, k]) s += `<line x1="${pts[i][0].toFixed(0)}" y1="${pts[i][1].toFixed(0)}" x2="${pts[q][0].toFixed(0)}" y2="${pts[q][1].toFixed(0)}" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>`;
    }
    const path = [3, 10, 17, 24];
    for (let i = 0; i < path.length - 1; i++) s += `<line x1="${pts[path[i]][0].toFixed(0)}" y1="${pts[path[i]][1].toFixed(0)}" x2="${pts[path[i + 1]][0].toFixed(0)}" y2="${pts[path[i + 1]][1].toFixed(0)}" stroke="${c}" stroke-width="5" filter="url(#glow)"/>`;
    pts.forEach(([x, y], i) => { s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${path.includes(i) ? 11 : 6}" fill="${path.includes(i) ? c : '#fff'}" opacity=".9"/>`; });
    return s;
  },
  ta: (c) => {
    // A chalkboard: the three topics taught.
    return `<rect x="860" y="130" width="660" height="560" rx="10" fill="#1f2b24" stroke="#6b4e2e" stroke-width="16"/>
      <g font-family="Caveat,'Bradley Hand',cursive" font-size="58" fill="#f1efe6" opacity=".9">
        <text x="910" y="250">y = wx + b</text><text x="910" y="380">σ(Wx + b)</text><text x="910" y="510">"the cat sat" → [0.2, …]</text></g>
      <text x="1480" y="650" text-anchor="end" font-family="'Bebas Neue',Impact" font-size="60" fill="${c}">50+ STUDENTS</text>`;
  },
};

/** SVG markup for a title's key art. kind: 'backdrop' (16:9) or 'poster' (2:3). */
export function keyArt(item, kind = 'backdrop', withTitle = true) {
  const c = item.color || '#e50914';
  const r = rng(item.id);
  const motif = (MOTIF[item.id] || MOTIF.capstone)(c, r);
  const W = 1600, H = 900;
  const defs = `<defs>
    <radialGradient id="bg" cx="72%" cy="50%" r="80%"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset=".55" stop-color="${c}" stop-opacity=".12"/><stop offset="1" stop-color="#050505" stop-opacity="0"/></radialGradient>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#0b0b0b"/><stop offset=".45" stop-color="#0b0b0b" stop-opacity=".75"/><stop offset=".75" stop-color="#0b0b0b" stop-opacity="0"/></linearGradient>
    <linearGradient id="fadeB" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="#0b0b0b" stop-opacity="0"/><stop offset="1" stop-color="#0b0b0b" stop-opacity=".9"/></linearGradient>
    <radialGradient id="sweep" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="400"><stop offset="0" stop-color="${c}" stop-opacity=".5"/><stop offset=".7" stop-color="${c}" stop-opacity=".12"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0"/></filter>
  </defs>`;
  const title = withTitle ? titleBlock(item, kind) : '';
  if (kind === 'poster') {
    // Poster: the motif centred higher, the title at the bottom.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice">${defs}
      <rect width="600" height="900" fill="#0b0b0b"/><rect width="600" height="900" fill="url(#bg)" transform="translate(-450 -40)"/>
      <g transform="translate(-652 20) scale(.8)">${motif}</g>
      <rect width="600" height="900" fill="url(#fadeB)"/><rect width="600" height="900" filter="url(#grain)"/>${title}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${defs}
    <rect width="${W}" height="${H}" fill="#0b0b0b"/><rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${motif}<rect width="${W}" height="${H}" fill="url(#fadeL)"/><rect width="${W}" height="${H}" fill="url(#fadeB)"/>
    <rect width="${W}" height="${H}" filter="url(#grain)"/>${title}</svg>`;
}

function titleBlock(item, kind) {
  const words = item.title.toUpperCase();
  if (kind === 'poster') {
    const size = words.length > 12 ? 92 : 118;
    return `<g font-family="'Bebas Neue',Impact"><text x="300" y="770" text-anchor="middle" font-size="${size}" fill="#fff" letter-spacing="2" style="paint-order:stroke" stroke="#000" stroke-opacity=".35" stroke-width="6">${esc(words)}</text>
      <text x="300" y="820" text-anchor="middle" font-family="Inter,sans-serif" font-size="22" letter-spacing="6" fill="#ddd">${esc((item.genre || item.tags || []).slice(0, 2).join(' · ').toUpperCase())}</text>
      <text x="36" y="70" font-size="56" fill="#e50914">M</text></g>`;
  }
  return `<g font-family="'Bebas Neue',Impact"><text x="80" y="820" font-size="96" fill="#fff" letter-spacing="2">${esc(words)}</text>
    <text x="80" y="110" font-size="60" fill="#e50914">M</text></g>`;
}

export const artUrl = (item, kind, withTitle) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(keyArt(item, kind, withTitle));
