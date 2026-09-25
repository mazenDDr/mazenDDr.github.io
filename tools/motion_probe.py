"""Measure how smooth the camera moves: record it every frame during a fixed set
of walks and report bounce, speed spikes and turn rates.

  /tmp/t16-pw-venv/bin/python web/tools/motion_probe.py [--url https://mazenddr.github.io/]

Route: room -> couch -> room -> desk -> room -> certificates. The pointer stays
centred so free-look adds nothing.
"""
import argparse, functools, http.server, json, socketserver, threading, time
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--url', default='')
args = ap.parse_args()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(WEB)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = (args.url or f'http://127.0.0.1:{srv.server_address[1]}/') + 'index.html?skip'

RECORD = '''() => { window.__trace = []; const c = __room.camera;
  const f = (t) => { __trace.push([t, ...c.position.toArray(), ...c.quaternion.toArray(), __room.director.busy ? 1 : 0]);
    if (__trace.length < 100000) requestAnimationFrame(f); }; requestAnimationFrame(f); }'''

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.goto(url)
    pg.wait_for_function('window.__room && window.__room.ready', timeout=60000)
    pg.mouse.move(640, 400)
    time.sleep(1.0)
    pg.evaluate(RECORD)
    for place in ['couch', 'room', 'desk', 'room', 'certificates']:
        pg.evaluate(f"() => __room.director.goTo('{place}')")
        pg.wait_for_function('() => !__room.director.busy', timeout=20000)
        time.sleep(0.6)
    tr = np.array(pg.evaluate('() => __trace'))
    b.close()
srv.shutdown()

t = tr[:, 0] / 1000
pos, quat, busy = tr[:, 1:4], tr[:, 4:8], tr[:, 8] > 0
dt = np.diff(t)
vel = np.diff(pos, axis=0) / dt[:, None]
speed = np.linalg.norm(vel[:, [0, 2]], axis=1)
# rAF timestamps jitter against the page's own clock; judge acceleration on a 5-frame average
speed_s = np.convolve(speed, np.ones(5) / 5, mode='same')
acc = np.diff(speed_s) / dt[1:]
# angular speed between consecutive frames
dots = np.abs(np.sum(quat[1:] * quat[:-1], axis=1)).clip(0, 1)
ang = np.degrees(2 * np.arccos(dots)) / dt
ang_acc = np.diff(ang) / dt[1:]
# vertical reversals while moving: a head bob flips up/down every step, a
# gimbal glide only changes height once (sitting down or standing up)
y = pos[:, 1]
vy = np.diff(y) / dt
direction = np.sign(np.where(np.abs(vy) > 0.01, vy, 0))[busy[1:]]
direction = direction[direction != 0]
reversals = int(np.sum(direction[1:] != direction[:-1]))
print(json.dumps({
    'url': url, 'frames': int(len(t)), 'moving_s': round(float(dt[busy[1:]].sum()), 2),
    # a head bob reverses up/down every step; a gimbal glide almost never does
    'vertical_reversals_per_s': round(reversals / float(dt[busy[1:]].sum()), 2),
    'speed_max_m_s': round(float(speed.max()), 2),
    'accel_p99_m_s2': round(float(np.percentile(np.abs(acc), 99)), 2),
    'turn_rate_p99_deg_s': round(float(np.percentile(ang, 99)), 1),
    'turn_accel_p99_deg_s2': round(float(np.percentile(np.abs(ang_acc), 99)), 0),
}, indent=1))
