"""Walk through the whole visit in real Chrome with real mouse clicks and keys,
saving a frame at each step and a short video of the run.

  /tmp/t16-pw-venv/bin/python web/tools/flow_test.py OUT_DIR [--size 1440x900]

Checks, per step: the place the director reports, whether it is still moving,
and console errors. Exits non-zero if a step ends somewhere unexpected.
"""
import argparse, functools, http.server, json, socketserver, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--size', default='1440x900')
ap.add_argument('--url', default='', help='test a deployed site instead of a local server')
args = ap.parse_args()
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
W, H = map(int, args.size.split('x'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = type('Srv', (socketserver.ThreadingTCPServer,), {'request_queue_size': 64})(('127.0.0.1', 0), functools.partial(Quiet, directory=str(WEB)))


threading.Thread(target=srv.serve_forever, daemon=True).start()
url = args.url or f'http://127.0.0.1:{srv.server_address[1]}/index.html'
errors, results = [], []

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': W, 'height': H}, record_video_dir=str(out), record_video_size={'width': 960, 'height': 600})
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.goto(url)
    pg.wait_for_function('window.__room && window.__room.director', timeout=60000)

    pg.evaluate('''() => { window.__log = []; for (const t of ['pointerdown', 'click'])
        addEventListener(t, (e) => { const m = document.querySelector('.spot.on.hot') || null;
          __log.push(t + ':' + (e.target.id || e.target.className || e.target.tagName) + '@' + e.clientX.toFixed(0) + ',' + e.clientY.toFixed(0)
            + ' marks=' + [...document.querySelectorAll('.spot.on')].map(el => el.style.transform.replace(/translate\(|px|\)/g, '')).join('|')
            + ' hold=' + __room.director.holdLook); }, true); }''')
    state = lambda: pg.evaluate('() => ({ place: __room.director.place, focus: __room.director.focus, busy: __room.director.busy })')
    settle = lambda limit=12: pg.wait_for_function('() => !__room.director.busy', timeout=limit * 1000)

    def until(place, focus='null'):
        # Wait for the director to reach a place (and focus), then to stop moving.
        pg.wait_for_function(f"() => __room.director.place === '{place}' && String(__room.director.focus) === '{focus}' && !__room.director.busy", timeout=15000)

    def shot(name, expect=None):
        s = state()
        s['cam'] = pg.evaluate('() => { const c = __room.camera, r = c.ray(0, 0); return [...c.pos, ...r.d].map(v => +v.toFixed(2)); }')
        print('STEP', name, json.dumps(s), flush=True)
        pg.screenshot(path=str(out / f'{len(results):02d}_{name}.png'))
        ok = expect is None or all(s.get(k) == v for k, v in expect.items())
        results.append({'step': name, **s, 'ok': ok})

    def click_spot(place):
        # Aim at the object's marker like a visitor: the view drifts a little with
        # the pointer, so follow the marker until it is hovered, then click.
        where = f'''() => {{ const s = __room.spots.spots.find(s => (s.place || s.action) === '{place}');
            const p = __room.camera.project(s.anchor), v = {{ x: p[0], y: p[1] }};
            return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, __room.spots.hover === s]; }}'''
        for _ in range(8):
            x, y, hovered = pg.evaluate(where)
            if hovered:
                break
            pg.mouse.move(x, y, steps=4)
            time.sleep(0.35)
        x, y, _ = pg.evaluate(where)
        pg.mouse.click(x, y)
        # Input is handled on the page's next frame; wait until the click has taken effect.
        if not place.startswith('cert:'):
            try:
                pg.wait_for_function(f"() => __room.director.busy || __room.director.place === '{place}'", timeout=3000)
            except Exception:
                print('CLICK LOST', place, x, y, pg.evaluate(f'''() => ({{ log: __log.slice(-4), hover: __room.spots.hover && (__room.spots.hover.place || __room.spots.hover.action),
                    el: document.elementsFromPoint({x}, {y}).map(e => (e.id || e.className || e.tagName) + ':' + getComputedStyle(e).zIndex + ':' + getComputedStyle(e).pointerEvents).join(' > '),
                    busy: __room.director.busy, enabled: __room.spots.enabled, place: __room.director.place, mk: __room.spots.spots.find(s => s.place === 'tv').el.className + ' ' + __room.spots.spots.find(s => s.place === 'tv').el.style.transform, vis: __room.spots.visibleSpots().map(s => s.place) }})'''))
                raise

    time.sleep(0.8)
    shot('hall', {'place': 'hall'})
    pg.locator('#intro .knock').click()
    time.sleep(1.0); shot('knocking')
    time.sleep(1.6); shot('door_opening')
    pg.wait_for_function('() => __room.ready && __room.spots.enabled', timeout=120000); time.sleep(0.3)
    shot('in_room', {'place': 'room', 'busy': False})

    click_spot('couch'); time.sleep(1.6); shot('walking_to_couch')
    settle(); time.sleep(0.4); shot('couch', {'place': 'couch', 'busy': False})

    click_spot('tv'); settle(); time.sleep(2.5); shot('tv', {'place': 'tv', 'focus': 'tv'})
    frame = pg.frame_locator('iframe[title="TV"]')
    if frame.locator('.person').first.is_visible():        # the room TV opens on the billboard
        frame.locator('.person').first.click(); time.sleep(1.5)
    shot('tv_browse')
    frame.locator('.card[data-id="faceid-bench"]').first.click(); time.sleep(1.0); shot('tv_detail')
    pg.keyboard.press('Escape'); time.sleep(0.4)          # closes the modal inside the TV
    pg.keyboard.press('Escape'); until('couch'); time.sleep(0.4); shot('back_to_couch', {'place': 'couch', 'focus': None})

    click_spot('games'); until('games', 'tv'); time.sleep(2.0)
    src = pg.evaluate("() => document.querySelector('iframe[title=TV]').src")
    shot('games', {'place': 'games', 'focus': 'tv'})
    results[-1]['ok'] = results[-1]['ok'] and 'apps/games' in src
    pg.keyboard.press('Escape'); until('couch'); time.sleep(0.4)

    pg.keyboard.press('Escape'); until('room'); time.sleep(0.3); shot('stood_up_from_couch', {'place': 'room'})
    click_spot('desk'); time.sleep(1.2); shot('walking_to_desk')
    settle(); time.sleep(0.4); shot('desk', {'place': 'desk'})
    click_spot('pc'); settle(); time.sleep(3.0); shot('pc', {'focus': 'pc'})
    pg.get_by_role('button', name='← Back').click(); until('desk'); time.sleep(0.3)

    pg.keyboard.press('Escape'); until('room')
    click_spot('certificates'); settle(); time.sleep(0.4); shot('certificates', {'place': 'certificates'})
    click_spot('cert:bsc'); time.sleep(0.8); shot('diploma_lightbox')
    pg.keyboard.press('Escape'); time.sleep(0.3)
    pg.keyboard.press('Escape'); until('room')
    click_spot('memo'); settle(); time.sleep(2.5); shot('memo', {'focus': 'memo'})
    pg.keyboard.press('Escape'); until('bed'); pg.keyboard.press('Escape'); until('room'); time.sleep(0.3)
    shot('stood_up', {'place': 'room'})
    fps = pg.evaluate('''() => new Promise(r => { let n = 0, t0 = performance.now();
        const f = () => (++n < 120 ? requestAnimationFrame(f) : r(1000 / ((performance.now() - t0) / 120))); requestAnimationFrame(f); })''')
    ctx.close(); b.close()
srv.shutdown()
print(json.dumps({'steps': results, 'errors': errors, 'fps': round(fps, 1)}, indent=1))
sys.exit(0 if all(r['ok'] for r in results) and not errors else 1)
