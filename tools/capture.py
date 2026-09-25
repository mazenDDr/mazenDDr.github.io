"""Pre-render the visit with the room's own real-time engine, at full quality.

The site shows pictures of the room, not the room: a panorama at each place and a
short video for each move between places (src/tour/). This makes them, in
headless Chrome with the GPU, using the baked-light engine in engine/ (the same
look, with no frame-rate budget):

  panoramas  every place in tools/moves.json 'views': a cube turned to face the
             default view. Front face FRONT px (native, 4x MSAA), right/left/up/
             down SIDE px rendered at 2x and downscaled. No back face: the free
             look never gets there. Close-ups of the screens: front only. Each face
             has a margin (cropped by encode.mjs) so the glow matches across seams.
             No vignette or grain (the browser adds them over the whole view).
             Screens are holes (alpha 0) where the live pages show through.
  flights    every move in tools/moves.json, 60 fps, 1920x1080 rendered at 2x and
             streamed into a lossless master video, still-settling tail trimmed; the
             screens show stills of their apps (shot here first), dimmed and
             under the same glass as in the live view.

Output: design/export/tour/pano/<view>/<face>.png, design/export/tour/video/<a>-<b>-master.mkv
  /tmp/t16-pw-venv/bin/python web/tools/capture.py [--only panos|moves] [--views room] [--moves couch>tv]
"""
import argparse, base64, functools, http.server, json, math, socketserver, subprocess, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
OUT = WEB.parent / 'design/export/tour'
MOVES = json.loads(Path(__file__).with_name('moves.json').read_text())
FRONT, SIDE, PAD = 4096, 2048, 1 / 64
VIDEO = (1920, 1080)
SS = 2                                       # supersampling for side faces and video frames
FOCUS = {'tv', 'pc', 'memo'}
SKIP = {'games'}                              # the same close-up as the TV

ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--views', default='')
ap.add_argument('--moves', default='')
args = ap.parse_args() if __name__ == '__main__' else ap.parse_args([])


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def translate_path(self, path):          # /capture/... is read back from the output folder
        if path.startswith('/capture/'):
            return str(OUT / path.split('?')[0].removeprefix('/capture/'))
        return super().translate_path(path)

    def do_POST(self):                        # the page posts each finished image here
        path = OUT / self.path.removeprefix('/capture/')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(204)
        self.end_headers()


ENCODER = {}
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(WEB)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}/'

# In-page helpers: stop the live loop, then draw exactly what we ask for.
SETUP = """async () => {
  const THREE = await import('three');
  const r = __room;
  r.renderer.setAnimationLoop(null);
  r.post.apply({ ...r.post.look, vignette: 0, grain: 0 });
  for (const o of Object.values(r.screens.objects)) o.glass.visible = false;
  const canvas = r.renderer.domElement;
  const send = async (path) => {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    for (let i = 0; ; i++) {                     // the local server can drop a big upload under load
      try { const r = await fetch('/capture/' + path, { method: 'POST', body: blob }); if (r.ok) return; } catch (e) { if (i > 4) throw e; }
      await new Promise((res) => setTimeout(res, 200 * (i + 1)));
    }
  };
  const fit = () => { const s = r.renderer.getDrawingBufferSize(new THREE.Vector2()); r.post.setSize(s.x, s.y); };
  // flight frames: the 2x render averaged down to the video size, then into the encoder
  const small = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 });
  const g = small.getContext('2d');
  g.imageSmoothingQuality = 'high';
  // returned to Python (not posted: thousands of uploads exhaust the little server)
  const sendFrame = async () => {
    g.drawImage(canvas, 0, 0, small.width, small.height);
    return small.toDataURL('image/png').split(',')[1];     // lossless into the master
  };
  window.__cap = { THREE, r, send, sendFrame, fit };
}"""

FACE = """async ({ path, eye, quat, face, fovDeg, door }) => {
  const { THREE, r, send, fit } = __cap;
  fit();
  const cam = r.camera;
  const turn = { front: [0, 0], right: [0, -90], left: [0, 90], up: [90, 0], down: [-90, 0] }[face];
  cam.position.fromArray(eye);
  cam.quaternion.fromArray(quat);
  cam.rotateY(THREE.MathUtils.degToRad(turn[1]));
  cam.rotateX(THREE.MathUtils.degToRad(turn[0]));
  cam.aspect = 1; cam.fov = fovDeg; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  r.parts.door.rotation.y = THREE.MathUtils.degToRad(door);
  r.post.render(0, 1);
  await send(path);
}"""

# Screens in the flights: each app's still on the real glass, dimmed and under the
# glass (rim darkening, reflections), drawn over the finished frame where the room
# left a hole, so the page keeps its own colours like the live page does.
STILLS = """async ({ dim }) => {
  const { THREE, r } = __cap;
  const { GLASS_FRAG, LIGHTS } = await import('./src/tour/glass.js');
  const load = (u) => new Promise((res, rej) => new THREE.TextureLoader().load(u, (t) => { t.colorSpace = THREE.NoColorSpace; res(t); }, undefined, () => rej(new Error('missing ' + u))));
  const APPS = { tv: [1280, 975, 0.045], pc: [1024, 770, 0.035], memo: [1300, 900, 0] };
  const anchors = await (await fetch('public/anchors.json')).json();
  const scene = new THREE.Scene();
  for (const [name, o] of Object.entries(r.screens.objects)) {
    const s = anchors.screens[name], [w, h, border] = APPS[name];
    let geo = o.glass.geometry, half = new THREE.Vector2(1, 1);
    if (border) {
      const k = Math.min(s.width / w, s.height / h) * (1 - 2 * border);
      half.set((w * k) / s.width, (h * k) / s.height);            // the page's half size on the glass (-1..1)
    } else {
      geo = geo.clone();                                           // the pinboard page is its whole plane
      const uv = geo.attributes.uv.array, face = new Float32Array(uv.length);
      for (let i = 0; i < uv.length; i++) face[i] = uv[i] * 2 - 1;
      geo.setAttribute('face', new THREE.BufferAttribute(face, 2));
    }
    const m = new THREE.ShaderMaterial({
      uniforms: {
        eye: { value: new THREE.Vector3() }, lights: { value: LIGHTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)) },
        power: { value: LIGHTS.map((l) => l[3]) }, dim: { value: dim }, sheen: { value: 1 }, crt: { value: border ? 1 : 0 },
        page: { value: await load('/capture/stills/' + name + '.png') }, halfSize: { value: half },
      },
      vertexShader: `attribute vec2 face; varying vec2 vFace; varying vec3 vPos, vNormal;
        void main() { vFace = face; vPos = (modelMatrix * vec4(position, 1.0)).xyz; vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
      fragmentShader: GLASS_FRAG + `
        uniform sampler2D page; uniform vec2 halfSize;
        void main() {
          vec4 g = glass();
          vec2 uv = vFace / halfSize * 0.5 + 0.5;
          bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
          vec3 p = inside ? texture2D(page, uv).rgb : vec3(0.02);
          gl_FragColor = vec4(p * (1.0 - g.a) + g.rgb, 1.0);
        }`,
      // only where the finished frame left a hole (alpha 0): the room still covers the screen where it should
      blending: THREE.CustomBlending, blendSrc: THREE.OneMinusDstAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(o.glass.position); mesh.quaternion.copy(o.glass.quaternion);
    scene.add(mesh);
  }
  __cap.stills = scene;
}"""

FRAME = """async ({ f, aspect, door, dims }) => {
  const { THREE, r, sendFrame, fit } = __cap;
  fit();
  const cam = r.camera;
  cam.position.fromArray(f.slice(0, 3));
  cam.quaternion.fromArray(f.slice(3, 7));
  cam.aspect = aspect;
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(f[7]) / 2) / aspect));
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  r.parts.door.rotation.y = THREE.MathUtils.degToRad(door);
  r.post.render(0, 1);
  const s = __cap.stills;
  s.children.forEach((m, i) => { m.material.uniforms.dim.value = dims[i]; m.material.uniforms.eye.value.copy(cam.position); });
  const R = r.renderer, auto = R.autoClear;
  R.autoClear = false; R.setRenderTarget(null); R.render(s, cam); R.autoClear = auto;
  return await sendFrame();
}"""


def shoot_stills(b):
    """Stills of the three apps as they look in the room."""
    for name, (w, h), wait in (('tv', (1280, 975), 4), ('pc', (1024, 770), 5), ('memo', (1300, 900), 3)):
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.goto(f'{BASE}apps/{name}/?room')
        time.sleep(wait)
        (OUT / 'stills').mkdir(parents=True, exist_ok=True)
        pg.screenshot(path=str(OUT / 'stills' / f'{name}.png'))
        pg.close()


def page_at(b, w, h):
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    pg.goto(BASE + 'engine/index.html?skip')
    pg.wait_for_function('window.__room && window.__room.ready', timeout=300000)
    time.sleep(1)
    pg.evaluate(SETUP)
    return pg


def panos(b):
    fov = 2 * __import__('math').degrees(__import__('math').atan(1 + 2 * PAD))
    pages = {}
    for key, v in MOVES['views'].items():
        if key in SKIP or (args.views and key not in args.views.split(',')):
            continue
        for face in (['front'] if key in FOCUS else ['front', 'right', 'left', 'up', 'down']):
            n = FRONT if face == 'front' else SIDE * SS
            px = round(n * (1 + 2 * PAD))
            pg = pages.get(px) or pages.setdefault(px, page_at(b, px, px))
            t0 = time.time()
            pg.evaluate(FACE, {'path': f'pano/{key}/{face}.png', 'eye': v['eye'], 'quat': v['quat'], 'face': face,
                               'fovDeg': fov, 'door': 0 if key == 'hall' else 72})
            print('PANO', key, face, px, round(time.time() - t0, 1), 's', flush=True)
    for pg in pages.values():
        pg.close()


def trimmed(frames):
    """Frames up to the last one that still visibly differs from the final pose (1 mm, 0.1 degree, 0.1 degree of fov)."""
    last = frames[-1]
    n = len(frames)
    while n > 2:
        f = frames[n - 2]
        dot = min(1.0, abs(sum(f[3 + k] * last[3 + k] for k in range(4))))
        if math.dist(f[:3], last[:3]) > 0.001 or 2 * math.acos(dot) > 0.00175 or abs(f[7] - last[7]) > 0.1:
            break
        n -= 1
    return n


def encoder(out_stem):
    """ffmpeg reading frames on stdin, writing a lossless master (RGB); encode.mjs makes
    the delivery videos from it, so codec choices never need a re-render."""
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(MOVES['fps']), '-c:v', 'png', '-i', '-',
           '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', f'{out_stem}-master.mkv']
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def moves(b):
    w, h = VIDEO[0] * SS, VIDEO[1] * SS
    pg = page_at(b, w, h)
    pg.evaluate(STILLS, {'dim': 0.42})
    (OUT / 'video').mkdir(parents=True, exist_ok=True)
    order = ['tv', 'pc', 'memo']
    for key, m in MOVES['moves'].items():
        if args.moves and key not in args.moves.split(','):
            continue
        a, z = key.split('>')
        stem = OUT / 'video' / f'{a}-{z}'
        if not args.moves and Path(f'{stem}.done').exists():
            continue                               # finished on an earlier run
        frames = m['frames']
        n = trimmed(frames)
        ENCODER['proc'] = encoder(str(stem))
        t0 = time.time()
        for i, f in enumerate(frames[:n]):
            u = i / max(1, n - 1)
            # Screens: dimmed from across the room, lit up as you arrive at one (and back).
            dims = [(0.42 * (1 - max(0.0, (u - 0.8) / 0.2)) if z == s else 0.42 * min(1.0, u / 0.25) if a == s else 0.42) for s in order]
            door = m['door'][i] if 'door' in m else 72
            jpeg = pg.evaluate(FRAME, {'f': f, 'aspect': w / h, 'door': door, 'dims': dims})
            ENCODER['proc'].stdin.write(base64.b64decode(jpeg))
        ENCODER['proc'].stdin.close()
        ENCODER['proc'].wait()
        (OUT / 'video' / f'{a}-{z}.done').write_text(json.dumps({'frames': n}))
        print('MOVE', key, n, 'of', len(frames), 'frames', round(time.time() - t0, 1), 's', flush=True)
    pg.close()


if __name__ == '__main__':
  with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    if args.only in ('', 'moves') and not (OUT / 'stills' / 'memo.png').exists():
        shoot_stills(b)
    if args.only in ('', 'panos'):
        panos(b)
    if args.only in ('', 'moves'):
        moves(b)
    b.close()
