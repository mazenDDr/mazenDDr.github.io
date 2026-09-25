// Draws the room: the panorama at the current place (a cube of pictures around
// the eye, turned to face the default view), and the tubes' glass over the live
// pages. Plain WebGL 1, one tiny shader per job: it runs on anything with a GPU.
// A place starts from its 256-px strip (all faces in one small image) and each
// face is swapped for a sharper one as it arrives. Draws only when asked.
import { qmat, qmul, qaxis, rot, deg } from './m.js';
import { GLASS_FRAG, GLASS_VERT, LIGHTS } from './glass.js';

const FACES = ['front', 'right', 'left', 'up', 'down'];
// Each face's turn from the view direction (the same as tools/capture.py).
const TURN = { front: [0, 0, 0, 1], right: qaxis([0, 1, 0], deg(-90)), left: qaxis([0, 1, 0], deg(90)), up: qaxis([1, 0, 0], deg(90)), down: qaxis([1, 0, 0], deg(-90)) };

const FACE_VERT = `
  attribute vec3 dir;
  attribute vec2 uv;
  uniform mat4 skyProj;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = skyProj * vec4(dir, 1.0); }`;
const FACE_FRAG = `
  precision mediump float;
  uniform sampler2D tex;
  uniform vec4 rect;               // where this face sits in its texture (the strip holds all five)
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tex, rect.xy + vUv * rect.zw); }`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export class Viewer {
  constructor(canvas) {
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no WebGL');
    this.gl = gl;
    this.canvas = canvas;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.face = program(gl, FACE_VERT, FACE_FRAG);
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0 ? 'highp' : 'mediump';
    this.glassProg = program(gl, GLASS_VERT, `precision ${hp} float;\n${GLASS_FRAG}\nvoid main() { gl_FragColor = glass(); }`);
    this.quad = gl.createBuffer();          // one unit quad, reused for every face
    this.panos = {};
    this.glass = [];
    this.pano = null;
  }

  /** A place's panorama: its turn (the view's quaternion) and faces as they load. */
  add(key, quat, faces) {
    this.panos[key] ||= { quat, faces: Object.fromEntries(faces.map((f) => [f, null])), strip: null, list: faces };
    return this.panos[key];
  }

  texture(img, mips) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !(img instanceof ImageBitmap));  // bitmaps come premultiplied
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    img.close?.();
    return t;
  }

  /** Put a decoded image on a face (or the strip); keeps the sharper one. */
  setFace(key, face, img, size) {
    const p = this.panos[key];
    if (!p) return;
    if (face === 'strip') {
      if (!p.strip) p.strip = this.texture(img, false);
      return;
    }
    const cur = p.faces[face];
    if (cur && cur.size >= size) { img.close?.(); return; }
    const tex = this.texture(img, true);
    if (cur) this.gl.deleteTexture(cur.tex);
    p.faces[face] = { tex, size };
  }

  /** Free a place's pictures (keeps memory flat on phones). */
  drop(key) {
    const p = this.panos[key];
    if (!p) return;
    for (const f of Object.values(p.faces)) if (f) this.gl.deleteTexture(f.tex);
    if (p.strip) this.gl.deleteTexture(p.strip);
    delete this.panos[key];
  }

  /** Largest face size loaded for a place (0 when only the strip, -1 when nothing). */
  level(key) {
    const p = this.panos[key];
    if (!p) return -1;
    const sizes = p.list.map((f) => p.faces[f]?.size || 0);
    return p.strip || Math.min(...sizes) > 0 ? Math.min(...sizes) : -1;
  }

  /** The screens' glass (tv, pc: the real mesh; memo: its page rectangle). */
  addGlass(geo, crt) {
    const gl = this.gl, b = (a) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); return buf; };
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.index), gl.STATIC_DRAW);
    const g = { pos: b(geo.position), nor: b(geo.normal), face: b(geo.face), idx, n: geo.index.length, crt, dim: 0.42, sheen: 1 };
    this.glass.push(g);
    return g;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  render(cam, key) {
    const gl = this.gl, p = this.panos[key];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!p) return;
    gl.disable(gl.BLEND);
    gl.useProgram(this.face);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.face, 'skyProj'), false, cam.skyProj);
    const aDir = gl.getAttribLocation(this.face, 'dir'), aUv = gl.getAttribLocation(this.face, 'uv');
    const uRect = gl.getUniformLocation(this.face, 'rect');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(aDir);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aDir, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);
    p.list.forEach((f, i) => {
      const own = p.faces[f];
      if (!own && !p.strip) return;
      // the face's corners: the unit quad at z = -1, turned to this face and then to the view
      const m = qmat(qmul(p.quat, TURN[f]));
      const c = (x, y) => rot(m, [x, y, -1]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...c(-1, 1), 0, 0, ...c(-1, -1), 0, 1, ...c(1, 1), 1, 0, ...c(1, -1), 1, 1]), gl.DYNAMIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, own ? own.tex : p.strip);
      const n = p.list.length;
      gl.uniform4f(uRect, own ? 0 : i / n, 0, own ? 1 : 1 / n, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.disableVertexAttribArray(aUv);
    this.drawGlass(cam);
  }

  /** Only where the panorama left a hole (alpha 0): rgb adds light, alpha darkens the page. */
  drawGlass(cam) {
    const gl = this.gl, pr = this.glassProg;
    gl.useProgram(pr);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    const u = (n) => gl.getUniformLocation(pr, n);
    gl.uniformMatrix4fv(u('viewProj'), false, cam.viewProj);
    gl.uniform3fv(u('eye'), cam.pos);
    gl.uniform3fv(u('lights'), LIGHTS.flatMap((l) => l.slice(0, 3)));
    gl.uniform1fv(u('power'), LIGHTS.map((l) => l[3]));
    const aPos = gl.getAttribLocation(pr, 'position'), aNor = gl.getAttribLocation(pr, 'normal'), aFace = gl.getAttribLocation(pr, 'face');
    for (const a of [aPos, aNor, aFace]) gl.enableVertexAttribArray(a);
    for (const g of this.glass) {
      gl.uniform1f(u('dim'), g.dim);
      gl.uniform1f(u('sheen'), g.sheen);
      gl.uniform1f(u('crt'), g.crt ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.nor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.face); gl.vertexAttribPointer(aFace, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
    }
    for (const a of [aNor, aFace]) gl.disableVertexAttribArray(a);
    gl.disable(gl.BLEND);
  }
}

export { FACES };
