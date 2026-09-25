"""Screenshot one of the screen apps (or any page under web/) in real Chrome.

  /tmp/t16-pw-venv/bin/python web/tools/app_shot.py apps/tv/ out.png [--size 1280x960]
      [--click ".person"] [--click ".card"] [--wait 1]

Each --click runs in order (CSS selector, first match), with a short pause after.
Prints console errors, horizontal overflow and the number of broken images.
"""
import argparse, functools, http.server, json, socketserver, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('path')
ap.add_argument('out')
ap.add_argument('--size', default='1280x960')
ap.add_argument('--click', action='append', default=[])
ap.add_argument('--key', action='append', default=[])
ap.add_argument('--wait', type=float, default=1.0)
ap.add_argument('--clear', action='store_true', help='clear session storage first')
args = ap.parse_args()
w, h = map(int, args.size.split('x'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(WEB)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/{args.path}'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': w, 'height': h})
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.goto(url)
    pg.wait_for_load_state('networkidle')
    time.sleep(args.wait)
    for sel in args.click:
        pg.locator(sel).first.click()
        time.sleep(0.9)
    for k in args.key:
        pg.keyboard.press(k)
        time.sleep(0.5)
    time.sleep(args.wait)
    info = pg.evaluate('''() => ({
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src),
    })''')
    pg.screenshot(path=args.out)
    b.close()
srv.shutdown()
print(json.dumps({'url': url, 'errors': errors, **info}, indent=1))
