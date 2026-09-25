"""How big does each texture need to be? Measured, the way games do it ("texture feedback").

From every spot a visitor can stand or sit (and each zoomed-in screen view), the
room is drawn in all six directions at the pixel density of a 4K screen (3840 px
across, the most the page ever renders). Instead of colour, a shader writes which
texture each pixel shows and how many texels per UV unit that pixel resolves:
exactly the mip level the GPU would pick (with 8x anisotropic filtering).
The biggest value any pixel asks for is all the resolution that texture can ever
show; anything above it only ever lands in mip levels the GPU never reads.

Writes tools/texture_needs.json {image name: needed px along its short side};
export_web.py shrinks textures to it (with a 25% margin), so the room looks the
same from everywhere you can go and costs far less GPU memory.

  /tmp/t16-pw-venv/bin/python web/tools/texture_needs.py
"""
import functools, http.server, json, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parents[1]
OUT = Path(__file__).with_name('texture_needs.json')
REF_WIDTH = 3840          # physical pixels across: a 4K screen at 2x, the renderer's cap

H = type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=str(WEB)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()

MEASURE = """async (REF) => {
  const THREE = await import('three');
  const { PLACES } = await import('./src/places.js');
  const r = __room, d = r.director;
  // one id per texture image; every mesh gets a feedback material (untextured ones still hide what's behind)
  const images = [], index = new Map(), restore = [];
  const vert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const frag = `uniform float id; varying vec2 vUv;
    void main() {
      vec2 dx = dFdx(vUv), dy = dFdy(vUv);
      float a = length(dx), b = length(dy);
      float s = max(min(a, b), max(a, b) / 8.0);          // 8x anisotropic: the minor axis, up to 8:1
      float n = clamp(log2(1.0 / max(s, 1e-7)) / 16.0, 0.0, 1.0);   // texels per UV unit, log2 / 16
      gl_FragColor = vec4(mod(id, 256.0) / 255.0, floor(id / 256.0) / 255.0, n, 1.0);
    }`;
  r.scene.traverse((o) => {
    if (!o.isMesh) return;
    const u = o.material.uniforms || {}, defs = o.material.defines || {};
    const texs = [];
    if (u.map?.value && (defs.KIND == 1 || defs.CUTOUT == 1)) texs.push(u.map.value);
    if (u.emissiveMap?.value && defs.EMISSIVE_MAP == 1) texs.push(u.emissiveMap.value);
    let id = 0;
    if (texs.length) {
      const key = texs.map((t) => t.name).join('+');
      if (!index.has(key)) { index.set(key, images.length + 1); images.push(texs.map((t) => ({ name: t.name, w: t.image.width, h: t.image.height }))); }
      id = index.get(key);
    }
    restore.push([o, o.material]);
    o.material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: { id: { value: id } }, side: THREE.DoubleSide });
  });
  // the page's own overlays (screen glass, holes) are not room textures
  const need = new Float32Array(images.length + 1);
  const views = [];
  for (const key of Object.keys(PLACES)) {
    d.snap(key);
    d.update(0);
    r.camera.updateMatrixWorld();
    views.push({ key, pos: r.camera.position.clone(), hfov: d.hfov });
  }
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const renderer = r.renderer, cam = new THREE.PerspectiveCamera(90, 1, 0.02, 60);
  const perView = [];
  for (const v of views) {
    // the same pixels per radian (at the centre) as a REF-wide screen with this place's field of view
    const S = Math.min(4096, Math.ceil(REF / Math.tan(THREE.MathUtils.degToRad(v.hfov) / 2)));
    const target = new THREE.WebGLRenderTarget(S, S);
    const px = new Uint8Array(S * S * 4);
    for (const dir of dirs) {
      cam.position.copy(v.pos);
      cam.up.set(...(Math.abs(dir[1]) ? [0, 0, 1] : [0, 1, 0]));
      cam.lookAt(v.pos.clone().add(new THREE.Vector3(...dir)));
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(r.scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, S, S, px);
      for (let i = 0; i < px.length; i += 4) {
        const id = px[i] + px[i + 1] * 256;
        if (!id || !px[i + 3]) continue;
        const n = px[i + 2];
        if (n > need[id]) need[id] = n;
      }
    }
    target.dispose();
    perView.push([v.key, S]);
  }
  renderer.setRenderTarget(null);
  for (const [o, m] of restore) o.material = m;
  const out = {};
  images.forEach((list, i) => {
    const n = need[i + 1] ? 2 ** (need[i + 1] / 255 * 16) : 0;     // texels per UV unit, at the sharpest pixel
    for (const t of list) out[t.name] = Math.max(out[t.name] || 0, Math.round(n));
  });
  const sizes = {};
  images.forEach((list) => list.forEach((t) => { sizes[t.name] = [t.w, t.h]; }));
  return { needs: out, sizes, views: perView };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': 800, 'height': 500})
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html?skip')
    pg.wait_for_function('window.__room && window.__room.ready', timeout=300000)
    res = pg.evaluate(MEASURE, REF_WIDTH)
    b.close()

needs, sizes = res['needs'], res['sizes']
mb = lambda w, h: w * h * 4 * 4 / 3 / 2**20
before = after = 0.0
for name, (w, h) in sizes.items():
    short = min(w, h)
    keep = min(1.0, needs[name] * 1.25 / short) if needs[name] else 64 / short   # never seen: a token 64 px
    before += mb(w, h)
    after += mb(w * keep, h * keep)
OUT.write_text(json.dumps({'ref_width': REF_WIDTH, 'views': res['views'], 'needs': dict(sorted(needs.items()))}, indent=1))
print(f'{len(sizes)} textures: {before:.0f} MB -> {after:.0f} MB on the GPU (with mipmaps), written to {OUT.name}')
