"""Screenshot the room in real Chrome and report console errors and frame time.

  /tmp/t16-pw-venv/bin/python web/tools/shoot.py --query "view=hero" --out shot.png [--size 1800x1008]

Serves web/ itself on a free port, so it needs nothing else running.
"""
import argparse, functools, http.server, json, socketserver, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--query', default='view=hero')
ap.add_argument('--out', required=True)
ap.add_argument('--size', default='1800x1008')
ap.add_argument('--dpr', type=float, default=1)
ap.add_argument('--wait', type=float, default=1.5, help='seconds after ready')
ap.add_argument('--eval', default='', help='JS to run after ready (e.g. clicks)')
args = ap.parse_args()
w, h = map(int, args.size.split('x'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Quiet, directory=str(WEB))
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html?{args.query}'

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True,
                          args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=args.dpr)
    pg.on('console', lambda m: m.type in ('error', 'warning') and errors.append(f'{m.type}: {m.text}'))
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    t0 = time.time()
    pg.goto(url)
    pg.wait_for_function('window.__room && window.__room.ready', timeout=120000)
    load_s = time.time() - t0
    if args.eval:
        pg.evaluate(args.eval)
    time.sleep(args.wait)
    frame_ms = pg.evaluate('''() => new Promise(r => { let n = 0, t0 = performance.now();
        const f = () => (++n < 60 ? requestAnimationFrame(f) : r((performance.now() - t0) / 60)); requestAnimationFrame(f); })''')
    gpu = pg.evaluate('''() => { const g = document.createElement('canvas').getContext('webgl2');
        const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }''')
    pg.screenshot(path=args.out)
    b.close()
srv.shutdown()
print(json.dumps({'url': url, 'load_s': round(load_s, 2), 'frame_ms': round(frame_ms, 2), 'gpu': gpu,
                  'errors': errors[:20]}, indent=1))
