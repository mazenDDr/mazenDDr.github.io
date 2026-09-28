"""The room in Chrome for Android, on the Android emulator: real touch input, Chrome's own
frame timeline, and a recording of the phone's screen. For what only Android's Chrome
does (how it composites the screens' pages, how it paces frames).

  /tmp/t16-pw-venv/bin/python web/tools/android_probe.py [--query 'mode=live'] [--out DIR] [--keep]

Needs the Android SDK (brew install --cask android-commandlinetools; sdkmanager
"platform-tools" "emulator" "system-images;android-34;google_apis;arm64-v8a") and a current
Chromium in the emulator (the image's Chrome 113 crashes there): adb install ChromePublic.apk
from https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Android_Arm64/
(it draws in software, SwiftShader: with the Mac's GPU, Chromium's WebGL crashes the emulator's
graphics; so frame rates here are a slow phone's, but what Chrome composites and how much tile
memory it needs are Android's own). The live room needs &stay on such a slow GPU. Creates an
emulator shaped like a Galaxy S21 (1080 x 2400 at 420 dpi) the first time, serves web/
to it (adb reverse), opens the page held sideways, and reports:
  in_room_s        from opening the page to standing in the room (knock at once)
  look_fps         frames Chrome drew per second while a finger drags the view around
  look_dropped     frames Chrome dropped meanwhile (its own count)
  tile_warnings    times Chrome said "tile memory limits exceeded, some content may not draw"
                   (what made the screens and arrows flicker on Galaxy phones)
  screen_blinks    recorded frames where a screen (TV, computer, pinboard) suddenly
                   loses most of its light and gets it back (a blink), while looking around
"""
import argparse, functools, http.server, json, os, socketserver, subprocess, sys, threading, time
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_HOME', '/opt/homebrew/share/android-commandlinetools'))
ADB, EMU = str(SDK / 'platform-tools/adb'), str(SDK / 'emulator/emulator')
AVD = 'room_s21'
APP = 'org.chromium.chrome'                     # Chromium (ChromePublic.apk)
ap = argparse.ArgumentParser()
ap.add_argument('--query', default='mode=live')
ap.add_argument('--out', default='/tmp/android_probe')
ap.add_argument('--port', type=int, default=8765)
ap.add_argument('--url', default='', help='a deployed site instead of web/ (e.g. https://mazenddr.github.io/)')
ap.add_argument('--gpu', default='swiftshader_indirect', help="emulator GPU: swiftshader_indirect (software; the Mac GPU's host mode crashes Chromium's WebGL)")
ap.add_argument('--keep', action='store_true', help='leave the emulator running')
args = ap.parse_args()
out = Path(args.out); out.mkdir(parents=True, exist_ok=True)


def adb(*a, check=True, text=True):
    r = subprocess.run([ADB, *a], capture_output=True, text=text)
    if check and r.returncode:
        raise RuntimeError(f'adb {a}: {r.stderr}')
    return r.stdout


def boot():
    if AVD not in subprocess.run([EMU, '-list-avds'], capture_output=True, text=True).stdout:
        avdm = str(SDK / 'cmdline-tools/latest/bin/avdmanager')
        subprocess.run([avdm, 'create', 'avd', '-n', AVD, '-k', 'system-images;android-34;google_apis;arm64-v8a', '-d', 'pixel_6'],
                       input='no\n', text=True, check=True, capture_output=True)
        cfg = Path.home() / f'.android/avd/{AVD}.avd/config.ini'
        lines = [l for l in cfg.read_text().splitlines() if not l.startswith(('hw.lcd.', 'hw.ramSize', 'hw.gpu.', 'hw.keyboard'))]
        lines += ['hw.lcd.width=1080', 'hw.lcd.height=2400', 'hw.lcd.density=420', 'hw.ramSize=6144',
                  'hw.gpu.enabled=yes', f'hw.gpu.mode={args.gpu}', 'hw.keyboard=yes']
        cfg.write_text('\n'.join(lines) + '\n')
    if 'emulator-' not in adb('devices'):
        subprocess.Popen([EMU, '-avd', AVD, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', args.gpu, '-feature', 'GLESDynamicVersion'],
                         stdout=open(out / 'emulator.log', 'w'), stderr=subprocess.STDOUT)
    adb('wait-for-device')
    while adb('shell', 'getprop', 'sys.boot_completed', check=False).strip() != '1':
        time.sleep(2)
    adb('root', check=False)
    time.sleep(2)
    adb('wait-for-device')
    # Chrome without its first-run screens, with remote debugging; the phone held sideways
    adb('shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run --disable-features=Translate,SkiaGraphite" > /data/local/tmp/chrome-command-line')
    adb('shell', 'chmod', '644', '/data/local/tmp/chrome-command-line')
    adb('shell', 'am', 'set-debug-app', '--persistent', APP, check=False)
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    adb('shell', 'svc', 'power', 'stayon', 'true', check=False)


def serve():
    H = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
    try:
        srv = type('Srv', (socketserver.ThreadingTCPServer,), {'request_queue_size': 64, 'allow_reuse_address': True})(('127.0.0.1', args.port), functools.partial(H, directory=str(WEB)))
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    except OSError:
        pass                                            # a server is already there (python3 -m http.server)
    adb('reverse', f'tcp:{args.port}', f'tcp:{args.port}')


def blinks(video):
    """Blinks in the recording: pixels that change a lot in one frame and change back in
    the next while the frames either side agree (moving the camera doesn't do that; a page
    or an arrow flashing does). Counted per frame on a small grey copy of the video."""
    import numpy as np
    w, h = 480, 216
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'scale={w}:{h},format=gray', '-f', 'rawvideo', '-'],
                         capture_output=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.int16)
    if len(f) < 3:
        return {'frames_recorded': len(f)}
    a, m, c = f[:-2], f[1:-1], f[2:]
    spike = (np.abs(m - a) > 40) & (np.abs(m - c) > 40) & (np.abs(a - c) < 15)
    per = spike.reshape(len(m), -1).sum(axis=1)
    return {'frames_recorded': int(len(f)), 'blink_frames': int((per > 30).sum()), 'blink_pixels': int(per.sum())}


boot()
if not args.url:
    serve()
base = args.url or f'http://localhost:{args.port}/'
url = f'{base}?{args.query}' if args.query else base
adb('shell', 'pm', 'clear', APP)                        # a first visit: no old tabs, no cache
adb('shell', 'pm', 'grant', APP, 'android.permission.POST_NOTIFICATIONS', check=False)   # (else a dialog covers the page)
adb('shell', 'wm', 'user-rotation', 'lock', '1', check=False)                         # held sideways
adb('logcat', '-c')
adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote')
adb('shell', 'am', 'start', '-n', f'{APP}/com.google.android.apps.chrome.Main', '-a', 'android.intent.action.VIEW', '-d', 'about:blank')

from playwright.sync_api import sync_playwright   # noqa: E402
res = {'url': url}
with sync_playwright() as p:
    for _ in range(60):
        try:
            b = p.chromium.connect_over_cdp('http://localhost:9222')
            break
        except Exception:
            time.sleep(1)
    pg = None
    for _ in range(60):
        pg = next((q for c in b.contexts for q in c.pages), None)
        if pg:
            break
        time.sleep(1)
    # held sideways (Chromium's first start turns it back upright): until Android says so
    for _ in range(20):
        adb('shell', 'wm', 'user-rotation', 'lock', '1', check=False)
        if 'ROTATION_90' in adb('shell', 'dumpsys', 'window', 'displays', check=False):
            break
        time.sleep(0.5)
    # (the address goes through DevTools: through an Android intent the query is lost)
    t0 = time.time()
    pg.goto(url, wait_until='commit')
    navs = []
    pg.on('framenavigated', lambda f: f == pg.main_frame and navs.append((round(time.time() - t0, 1), f.url)))
    pg.on('console', lambda m: m.type == 'error' and navs.append(('console', m.text[:160])))
    pg.wait_for_function('window.__room && window.__room.director', timeout=180000)
    res['page'] = pg.evaluate("({ mode: window.ROOM_MODE, tier: window.ROOM_TIER, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, gpu: (() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; })() })")
    W, H = 2400, 1080                                   # the screen, sideways (device pixels)
    if 'skip' not in args.query and 'place=' not in args.query:
        pg.evaluate("document.querySelector('#intro .knock').click()")
        try:
            pg.wait_for_function("window.__room && __room.director.place === 'room' && !__room.director.busy", timeout=300000)
        finally:
            print('navigations', navs, file=sys.stderr)
    else:
        pg.wait_for_function('window.__room && window.__room.ready', timeout=300000)
    res['in_room_s'] = round(time.time() - t0, 1)
    time.sleep(8)                                       # sharper textures in, arrows drawn

    # a finger dragging the view around while Chrome records its frames and the screen is recorded
    cdp = pg.context.new_cdp_session(pg)
    events, done = [], []
    cdp.on('Tracing.dataCollected', lambda e: events.extend(e['value']))
    cdp.on('Tracing.tracingComplete', lambda e: done.append(1))
    subprocess.run([ADB, 'shell', 'rm', '-f', '/sdcard/look.mp4'])
    rec = subprocess.Popen([ADB, 'shell', 'screenrecord', '--time-limit', '8', '--bit-rate', '20000000', '/sdcard/look.mp4'])
    time.sleep(0.8)
    cdp.send('Tracing.start', {'categories': 'disabled-by-default-devtools.timeline.frame,devtools.timeline', 'transferMode': 'ReportEvents'})
    t1 = time.time()
    y = H // 2
    for i in range(6):                                  # slow drags left and right, like looking around
        x0, x1 = (W // 2 - 500, W // 2 + 500) if i % 2 == 0 else (W // 2 + 500, W // 2 - 500)
        subprocess.run([ADB, 'shell', 'input', 'swipe', str(x0), str(y), str(x1), str(y + (60 if i % 3 else -60)), '900'])
    look_s = time.time() - t1
    cdp.send('Tracing.end')
    while not done:
        pg.wait_for_timeout(100)
    rec.wait()
    names = [e.get('name') for e in events]
    res['look_s'] = round(look_s, 1)
    res['look_fps'] = round(names.count('DrawFrame') / look_s, 1)
    res['look_dropped'] = names.count('DroppedFrame') + sum(1 for e in events if e.get('name') == 'PipelineReporter' and e.get('args', {}).get('chrome_frame_reporter', {}).get('state') == 'STATE_DROPPED')
    # where the three screens are on the phone's screen now (device pixels)
    res['screens'] = pg.evaluate("""(() => { const r = __room, out = {}, d = devicePixelRatio;
      const v = new r.camera.position.constructor();
      for (const [k, o] of Object.entries(r.screens.objects)) {
        const pts = o.corners.map((c) => { v.fromArray(c).project(r.camera); return [(v.x + 1) / 2 * innerWidth * d, (1 - v.y) / 2 * innerHeight * d]; });
        out[k] = pts; }
      return out; })()""")
    b.close()
subprocess.run([ADB, 'pull', '/sdcard/look.mp4', str(out / 'look.mp4')], capture_output=True)
res['video'] = str(out / 'look.mp4')
log = adb('logcat', '-d', check=False)
res['tile_warnings'] = log.count('tile memory limits exceeded')
res['gpu_restarts'] = log.count('GPU process exited unexpectedly')
res.update(blinks(out / 'look.mp4'))
json.dump(res, open(out / 'result.json', 'w'), indent=1)
print(json.dumps(res))
if not args.keep:
    subprocess.run([ADB, 'emu', 'kill'], capture_output=True)
