"""What a visitor feels, measured: how fast the room appears, how much it downloads,
how smooth it is, and how hard it works the device.

  first_paint_s     first pixels on screen (First Contentful Paint)
  interactive_s     the page answers (the knock button works)
  in_room_s         knock at once, then time until standing in the room
  mb_to_room        megabytes downloaded by then
  idle_frames_s     frames the browser draws per second while you just look (0 is ideal)
  flight_fps        page frame rate while flying to another place
  frame_ms          one full redraw (GPU time, synced with a pixel read)
  gpu_mb            texture memory (estimated from what is uploaded)

Network: --net fast4g (9 Mbps, 170 ms) | slow4g (1.6 Mbps, 150 ms) | none. GPU: real, or
--swiftshader (Chrome's software GPU, a stand-in for a very weak one); --cpu 6 slows the CPU
like a cheap phone. --page engine/index.html
measures the old real-time version the same way.
  /tmp/t16-pw-venv/bin/python web/tools/perf_probe.py [--net fast4g] [--swiftshader] [--dpr 2] [--size 1440x900]
"""
import argparse, functools, http.server, json, socketserver, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--net', default='none')
ap.add_argument('--swiftshader', action='store_true')
ap.add_argument('--dpr', type=float, default=1)
ap.add_argument('--size', default='1440x900')
ap.add_argument('--page', default='index.html')
ap.add_argument('--root', default=None)
ap.add_argument('--mobile', action='store_true', help='touch phone viewport')
ap.add_argument('--cpu', type=float, default=1, help='CPU slowdown (4 = a mid phone, 6 = a cheap one)')
args = ap.parse_args()
root = Path(args.root) if args.root else WEB

H = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = type('Srv', (socketserver.ThreadingTCPServer,), {'request_queue_size': 64})(('127.0.0.1', 0), functools.partial(H, directory=str(root)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/{args.page}'
NETS = {'fast4g': (9e6, 170), 'slow4g': (1.6e6, 150), 'none': None}

FPS = """(ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); })"""
BYTES = """() => performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0)"""

w, h = map(int, args.size.split('x'))
flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if args.swiftshader else []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=flags)
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=args.dpr, is_mobile=args.mobile, has_touch=args.mobile)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    if NETS[args.net]:
        bps, rtt = NETS[args.net]
        cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': rtt, 'downloadThroughput': bps / 8, 'uploadThroughput': bps / 8})
    if args.cpu > 1:
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': args.cpu})
    t0 = time.time()
    pg.goto(url, wait_until='commit')
    pg.wait_for_function('window.__room && window.__room.director', timeout=180000)
    interactive = time.time() - t0
    pg.locator('#intro .knock').click()
    pg.wait_for_function("__room.director.place === 'room' && !__room.director.busy", timeout=600000)
    in_room = time.time() - t0
    mb = pg.evaluate(BYTES) / 2**20
    fcp = pg.evaluate("performance.getEntriesByName('first-contentful-paint')[0]?.startTime / 1000")
    time.sleep(3)
    pg.mouse.move(w / 2, h / 2)
    time.sleep(2)
    # frames the browser itself draws while nobody touches anything
    events, done = [], []
    cdp.on('Tracing.dataCollected', lambda e: events.extend(e['value']))
    cdp.on('Tracing.tracingComplete', lambda e: done.append(1))
    cdp.send('Tracing.start', {'categories': 'disabled-by-default-devtools.timeline.frame', 'transferMode': 'ReportEvents'})
    time.sleep(5)
    cdp.send('Tracing.end')
    while not done:
        pg.wait_for_timeout(100)
    idle = sum(1 for e in events if e.get('name') == 'DrawFrame') / 5
    pg.evaluate("__room.director.goTo('desk')")
    flight = pg.evaluate(FPS, 2000)
    pg.wait_for_function('!__room.director.busy', timeout=60000)
    time.sleep(1)
    frame = pg.evaluate("""(() => { const r = __room, v = r.viewer;
      if (v) { const gl = v.gl, px = new Uint8Array(4), f = () => { v.render(r.tour.camera, r.tour.pano); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        f(); const t = performance.now(); for (let i = 0; i < 5; i++) f(); return (performance.now() - t) / 5; }
      const gl = r.renderer.getContext(), px = new Uint8Array(4), f = () => { r.post.render(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      f(); const t = performance.now(); for (let i = 0; i < 5; i++) f(); return (performance.now() - t) / 5; })()""")
    gpu = pg.evaluate("""(() => { const v = __room.viewer; if (!v) return null; let b = 0;
      for (const p of Object.values(v.panos)) { for (const f of Object.values(p.faces)) if (f) b += f.size * f.size * 4 * 4 / 3; if (p.strip) b += 1280 * 256 * 4; }
      return b / 1048576; })()""")
    out = {'page': args.page, 'net': args.net, 'cpu': args.cpu, 'gpu': 'swiftshader' if args.swiftshader else 'real', 'viewport': args.size, 'dpr': args.dpr,
           'first_paint_s': round(fcp, 2) if fcp else None, 'interactive_s': round(interactive, 2), 'in_room_s': round(in_room, 2),
           'mb_to_room': round(mb, 1), 'idle_frames_s': round(idle, 1), 'flight_fps': round(flight, 1), 'frame_ms': round(frame, 2),
           'gpu_mb': round(gpu) if gpu is not None else None, 'errors': errors}
    print(json.dumps(out))
    b.close()
