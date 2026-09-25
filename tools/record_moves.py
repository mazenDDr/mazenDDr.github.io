"""Record every camera move of the visit, frame by frame, for the pre-rendered version.

Runs the site's own Director (src/director.js) with a fixed 1/FPS step, so the
rendered flights have exactly the drone motion of the live camera: lift, cruise,
banking, the speed widening, the landing. Writes tools/moves.json:

  views  - the pose at each place (eye, quaternion, horizontal fov), in three.js axes
  moves  - "from>to": per-frame [x, y, z, qx, qy, qz, qw, hfov] (+ door angle for the intro)

Which moves exist: from each place you can stand or sit, every spot whose marker can
come into view within the free-look range; "stand up" back to the room; zooming
into and out of each screen; and the way in from the landing.

  /tmp/t16-pw-venv/bin/python web/tools/record_moves.py
"""
import functools, http.server, json, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
OUT = Path(__file__).with_name('moves.json')
FPS = 60
W, H = 1600, 900            # 16:9, the frame the flights are rendered at

H_ = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H_, directory=str(WEB)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

RECORD = """async (FPS) => {
  const THREE = await import('three');
  const { PLACES } = await import('./engine/src/places.js');
  const { PARENT } = await import('./engine/src/hotspots.js');
  const r = __room, d = r.director, cam = r.camera, spots = r.spots;
  r.renderer.setAnimationLoop(null);                 // we drive the clock
  const dt = 1 / FPS;
  const reset = (key) => {
    d.move = null; d.settle = null; d.roll = 0; d.fovKick = 0; d.nudge = 0;
    d.look.set(0, 0); d.lookVel.set(0, 0); d.pointer.set(0, 0);
    d.snap(key);
  };
  const frame = () => { cam.updateMatrixWorld(); return [...cam.position.toArray(), ...cam.quaternion.toArray(), d.hfov + d.fovKick].map((v) => +v.toFixed(6)); };
  const pose = (key) => { reset(key); const f = frame(); return { eye: f.slice(0, 3), quat: f.slice(3, 7), hfov: f[7] }; };
  const settleDone = () => !d.busy && !d.settle && Math.abs(d.roll) < 2e-4 && Math.abs(d.fovKick) < 0.02;
  const record = (from, to) => {
    reset(from);
    const frames = [frame()];
    d.goTo(to);
    for (let i = 0; i < FPS * 12; i++) { d.update(dt); frames.push(frame()); if (settleDone()) break; }
    return frames;
  };
  const MOVERS = ['room', 'couch', 'desk', 'bed', 'certificates'];
  const views = {};
  for (const k of Object.keys(PLACES)) views[k] = pose(k);
  // Which spots can come on screen from a place: sweep the whole free-look range.
  const reach = (key) => {
    reset(key);
    spots.enabled = true;
    const seen = new Set();
    for (const yaw of [-0.62, -0.31, 0, 0.31, 0.62]) for (const pitch of [-0.33, 0, 0.33]) {
      d.look.set(yaw, pitch); d.apply(); cam.updateMatrixWorld();
      for (const s of spots.visibleSpots()) {
        if (!s.place) continue;
        const v = s.anchor.clone().project(cam);
        if (v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95) seen.add(s.place);
      }
    }
    return [...seen];
  };
  const edges = new Set();
  for (const k of MOVERS) {
    for (const to of reach(k)) {
      // A screen is reached through its seat: fly to the seat, then zoom.
      if (PARENT[to] && PARENT[to] !== k) { edges.add(k + '>' + PARENT[to]); edges.add(PARENT[to] + '>' + to); }
      else edges.add(k + '>' + to);
    }
    if (k !== 'room') edges.add(k + '>room');
  }
  for (const [screen, seat] of Object.entries(PARENT)) { if (screen !== 'games') { edges.add(seat + '>' + screen); edges.add(screen + '>' + seat); } }
  edges.delete('couch>games');
  const moves = {};
  for (const e of [...edges].sort()) { const [a, b] = e.split('>'); moves[e] = { frames: record(a, b) }; }
  // The way in: the door swings open (1.7 s), and 0.75 s in the camera flies through.
  reset('hall');
  const open = r.anchors?.door?.open_angle_deg ?? 72;
  const doorAt = (t) => { const u = Math.min(1, t / 1.7); return open * (u < 0.12 ? 0.03 * (u / 0.12) ** 2 : 0.03 + 0.97 * (1 - Math.pow(1 - (u - 0.12) / 0.88, 3))); };
  const frames = [], door = [];
  let flying = false;
  for (let i = 0; i < FPS * 8; i++) {
    const t = i * dt;
    if (!flying && t >= 0.75) { d.flyIn('room', 2.6); flying = true; }
    if (flying) d.update(dt);
    frames.push(frame()); door.push(+doorAt(t).toFixed(4));
    if (flying && t > 1.8 && settleDone()) break;
  }
  moves['hall>room'] = { frames, door };
  return { fps: FPS, aspect: innerWidth / innerHeight, views, moves };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': W, 'height': H})
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/engine/index.html?skip')
    pg.wait_for_function('window.__room && window.__room.ready', timeout=300000)
    pg.evaluate("window.__room.anchors = null; fetch('public/anchors.json').then(r => r.json()).then(a => { window.__room.anchors = a; })")
    pg.wait_for_function('window.__room.anchors')
    res = pg.evaluate(RECORD, FPS)
    b.close()

OUT.write_text(json.dumps(res))
secs = {k: round(len(v['frames']) / FPS, 2) for k, v in res['moves'].items()}
print(len(secs), 'moves,', round(sum(secs.values()), 1), 's in total:', secs)
