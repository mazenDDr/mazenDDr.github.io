"""Stills of the three screen pages (TV, computer, pinboard) as the room shows them from
across the room: the live room draws these on Android phones instead of the live pages
until you zoom in on a screen (engine/src/screens.js). Rerun after changing
content/portfolio.json or an app; tools/build.mjs warns when they are older.

  /tmp/t16-pw-venv/bin/python web/tools/screen_stills.py
Writes public/screens/<name>-<hash>.webp and public/screens/stills.json. Each still is
1024 x 1024 whatever the page's shape (the shaders stretch it back): a power of two, so
even the tour's WebGL 1 can make it smooth to shrink (mipmaps), and plenty for a screen
seen from across the room (zoomed in, the live page shows).
"""
import functools, hashlib, http.server, io, json, socketserver, threading, time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / 'public/screens'
H = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = type('Srv', (socketserver.ThreadingTCPServer,), {'request_queue_size': 64})(('127.0.0.1', 0), functools.partial(H, directory=str(WEB)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

OUT.mkdir(parents=True, exist_ok=True)
stills = {}
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--enable-gpu'])
    pg = b.new_page(viewport={'width': 1800, 'height': 1400})
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html?mode=live&place=room&skip')
    pg.wait_for_function('window.__room && window.__room.ready', timeout=120000)
    for name in ('tv', 'pc', 'memo'):
        # the page as it is in the room (asleep: nobody is looking at it), laid flat at its own size
        box = pg.evaluate("""(name) => { const o = __room.screens.objects[name]; __room.director.update = () => {}; __room.screens.render = () => {};
          for (const e of document.querySelectorAll('#screens .screen-app')) e.style.visibility = 'hidden';
          document.getElementById('room').style.visibility = 'hidden';
          const s = document.getElementById('screens'); s.style.zIndex = 50;
          o.wrap.style.transform = 'none'; o.wrap.style.visibility = 'visible'; o.at = null;
          o.frame.style.margin = '0'; o.wrap.style.width = o.frame.style.width; o.wrap.style.height = o.frame.style.height;
          const r = o.frame.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }""", name)
        frame = next(f for f in pg.frames if f.url.split('?')[0].endswith(f'apps/{name}/'))
        frame.wait_for_load_state('load')
        frame.evaluate('document.fonts.ready')
        time.sleep(3)                                  # images decoded, entrance animations done
        png = pg.locator(f'iframe[title="{ {"tv": "TV", "pc": "Computer", "memo": "Pinboard"}[name] }"]').screenshot()
        img = Image.open(io.BytesIO(png)).convert('RGB')
        page = list(img.size)
        img = img.resize((1024, 1024), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, 'WEBP', quality=86, method=6)
        data = buf.getvalue()
        for old in OUT.glob(f'{name}-*.webp'):
            old.unlink()
        file = f'{name}-{hashlib.sha1(data).hexdigest()[:8]}.webp'
        (OUT / file).write_bytes(data)
        stills[name] = {'file': file, 'page': page}
        print(name, file, img.size, f'{len(data) // 1024} KB', 'box', [round(v) for v in box])
    b.close()
(OUT / 'stills.json').write_text(json.dumps(stills, indent=1))
