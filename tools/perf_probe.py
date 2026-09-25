"""How hard the page works the GPU, on a stand-in for a weak machine.

Chrome's software GPU (SwiftShader) runs every pixel on the CPU, so its frame
rate falls with exactly the work a cheap tablet's GPU would have to do. Measures:
  idle   - frames drawn per second while you just sit and look (should be ~0)
  moving - frame rate while flying couch -> desk -> couch
  still  - frame time of one full-quality frame
    /tmp/t16-pw-venv/bin/python web/tools/perf_probe.py [--gpu] [--dpr 1]
"""
import argparse, functools, http.server, json, socketserver, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('--gpu', action='store_true', help='use the real GPU instead of SwiftShader')
ap.add_argument('--dpr', type=float, default=1)
ap.add_argument('--size', default='1280x800')
ap.add_argument('--root', default=None, help='serve another copy of the site (e.g. an older checkout)')
args = ap.parse_args()
if args.root:
    WEB = Path(args.root)

H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
H = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
H = functools.partial(H, directory=str(WEB))
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html?place=couch'

COUNT = """(() => { const r = __room.renderer; if (!r.__n) { r.__n = 0; const f = r.render.bind(r); r.render = (...a) => { r.__n++; return f(...a); }; } return r.__n; })()"""
FPS = """(ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); })"""

w, h = map(int, args.size.split('x'))
flags = [] if args.gpu else ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=flags)
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=args.dpr)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url)
    pg.wait_for_function('window.__room && window.__room.ready', timeout=300000)
    time.sleep(4)
    pg.mouse.move(w / 2, h / 2)
    time.sleep(2)
    # Frames the browser itself draws while nobody touches anything (WebGL, the live
    # screens and the page's own CSS all count), from Chrome's own trace.
    cdp = pg.context.new_cdp_session(pg)
    events = []
    cdp.on('Tracing.dataCollected', lambda e: events.extend(e['value']))
    done = []
    cdp.on('Tracing.tracingComplete', lambda e: done.append(1))
    cdp.send('Tracing.start', {'categories': 'disabled-by-default-devtools.timeline.frame', 'transferMode': 'ReportEvents'})
    n0 = pg.evaluate(COUNT); time.sleep(5); n1 = pg.evaluate(COUNT)
    cdp.send('Tracing.end')
    while not done:
        pg.wait_for_timeout(100)
    idle_frames = sum(1 for e in events if e.get('name') in ('DrawFrame',)) / 5
    idle_draws = (n1 - n0) / 5                       # renderer.render calls per second (passes included)
    idle_fps = pg.evaluate(FPS, 3000)
    pg.evaluate("__room.director.goTo('desk')")
    moving = pg.evaluate(FPS, 2500)
    pg.wait_for_function('!__room.director.busy', timeout=60000)
    pg.evaluate("__room.director.goTo('couch')")
    moving = (moving + pg.evaluate(FPS, 2500)) / 2
    pg.wait_for_function('!__room.director.busy', timeout=60000)
    time.sleep(2)
    still_ms = pg.evaluate("""(() => { const r = __room, gl = r.renderer.getContext(), px = new Uint8Array(4);
      const frame = () => { r.post.render(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      frame(); const t0 = performance.now();
      for (let i = 0; i < 5; i++) frame(); return (performance.now() - t0) / 5; })()""")
    stats = pg.evaluate("""(() => { const r = __room, info = r.renderer.info; info.autoReset = false; info.reset(); r.renderer.render(r.scene, r.camera); info.autoReset = true;
      const seen = new Set(); let bytes = 0;
      r.scene.traverse((o) => { const m = o.material; if (!m) return;
        for (const t of Object.values(m.uniforms || {}).map((u) => u.value).concat([m.map])) {
          if (!t || !t.isTexture || seen.has(t) || !t.image) continue; seen.add(t);
          const w = t.image.width || 0, h = t.image.height || 0; bytes += w * h * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1); } });
      return { calls: info.render.calls, triangles: info.render.triangles, textures: seen.size, texture_mb: Math.round(bytes / 1048576) }; })()""")
    out = {'mode': 'gpu' if args.gpu else 'swiftshader', 'viewport': args.size, 'dpr': args.dpr,
           'idle_draw_calls_per_s': round(idle_draws, 1), 'idle_browser_frames_per_s': round(idle_frames, 1), 'idle_page_fps': round(idle_fps, 1),
           'moving_fps': round(moving, 1), 'full_frame_ms': round(still_ms, 1), **stats, 'errors': errors}
    print(json.dumps(out, indent=1))
    b.close()
