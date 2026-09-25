"""Capture the hallway exactly as the 3D view frames it, for the instant first
paint while the room loads: public/hall.webp (landscape) and hall-portrait.webp.

  /tmp/t16-pw-venv/bin/python web/tools/hall_still.py
"""
import functools, http.server, io, socketserver, threading, time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(WEB)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
    for name, size in (('hall', (1920, 1080)), ('hall-portrait', (900, 1600))):
        pg = b.new_page(viewport={'width': size[0], 'height': size[1]})
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/engine/index.html?still')
        pg.wait_for_function('window.__room && window.__room.ready', timeout=120000)
        pg.evaluate('() => { __room.post.look.grain = 0; __room.post.apply(__room.post.look); }')
        time.sleep(1.5)
        im = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
        im.save(WEB / 'public' / f'{name}.webp', quality=80, method=6)
        print(name, im.size, round((WEB / 'public' / f'{name}.webp').stat().st_size / 1024), 'KB')
        pg.close()
    b.close()
srv.shutdown()
