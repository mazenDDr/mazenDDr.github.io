"""Fit the web grade to the Cycles hero render by measurement.

Loads the room at the exact Blender hero camera, then searches the web-only
controls of the grade (white balance slope, exposure, saturation, shadow lift)
by coordinate descent, scoring each candidate with the same statistics as
design/scripts/measure.py. Prints the best LOOK values to paste into src/post.js.

  /tmp/t16-pw-venv/bin/python web/tools/calibrate_look.py
"""
import functools, http.server, io, json, socketserver, sys, threading, time
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
REF = ROOT / 'design/progress/polished/hero.png'


def stats(im):
    """luma, sat, r/b, p05, p95, contrast, dark% — as design/scripts/measure.py."""
    a = np.asarray(im.convert('RGB').resize((400, 224)), np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = a.max(2), a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    p05, p95 = np.percentile(luma, 5), np.percentile(luma, 95)
    return np.array([luma.mean(), sat.mean(), r.mean() / max(b.mean(), 1e-6), p05, p95, p95 - p05, (luma < 0.2).mean()])


NAMES = ['luma', 'sat', 'r/b', 'p05', 'p95', 'contrast', 'dark%']
target = stats(Image.open(REF))
scale = np.array([0.02, 0.03, 0.15, 0.015, 0.03, 0.03, 0.03])      # what counts as a visible difference


def score(s):
    return float(np.sum(((s - target) / scale) ** 2))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(WEB)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1800, 'height': 1008})
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html?view=hero')
    pg.wait_for_function('window.__room && window.__room.ready', timeout=120000)
    time.sleep(1.5)
    base = pg.evaluate('() => JSON.parse(JSON.stringify(__room.post.look))')

    def render(look):
        pg.evaluate('(l) => { __room.post.look.grain = 0; __room.post.apply(l); }', {**look, 'grain': 0})
        time.sleep(0.25)
        return stats(Image.open(io.BytesIO(pg.screenshot())))

    # Start from the values currently in src/post.js.
    params = {'exposure': base['exposure'], 'r': base['slope'][0], 'b': base['slope'][2],
              'saturation': base['saturation'], 'offset': base.get('offset', 0.0)}
    steps = {'exposure': 0.1, 'r': 0.03, 'b': 0.03, 'saturation': 0.04, 'offset': 0.01}

    def look_of(q):
        return {**base, 'exposure': q['exposure'], 'saturation': q['saturation'], 'offset': q['offset'],
                'slope': [q['r'], 1.0, q['b']], 'grain': 0}

    best = score(render(look_of(params)))
    print('start', round(best, 1), flush=True)
    for it in range(6):
        for k in params:
            for sgn in (+1, -1):
                moved = False
                while True:                      # keep going while it helps (a line search)
                    trial = dict(params, **{k: params[k] + sgn * steps[k]})
                    sc = score(render(look_of(trial)))
                    if sc >= best:
                        break
                    best, params, moved = sc, trial, True
                if moved:
                    break
        steps = {k: v * 0.6 for k, v in steps.items()}
        print('round', it, round(best, 2), {k: round(v, 4) for k, v in params.items()}, flush=True)
    final = render(look_of(params))
    b.close()
srv.shutdown()
print(f'{"":10}' + ''.join(f'{n:>9}' for n in NAMES))
print(f'{"cycles":10}' + ''.join(f'{v:9.3f}' for v in target))
print(f'{"web":10}' + ''.join(f'{v:9.3f}' for v in final))
print('LOOK', json.dumps({'exposure': round(params['exposure'], 3), 'slope': [round(params['r'], 3), 1.0, round(params['b'], 3)],
                          'saturation': round(params['saturation'], 3), 'offset': round(params['offset'], 5)}))
