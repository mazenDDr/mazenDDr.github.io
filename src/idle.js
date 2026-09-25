// Idle pictures on the TV and PC seen from across the room: a Mazenflix title
// card cycling project names, and the MazenOS desktop. Drawn on small canvases
// and redrawn a few times a second; the live apps take over when zoomed in.
import * as THREE from 'three';

// Screens glow. The room is rendered in scene-linear light and exposed down by
// the grade (-3.35 stops), so a screen's picture is lifted by the same amount.
const SCREEN_TINT = new THREE.Color(0.86, 0.78, 0.68).multiplyScalar(2 ** 3.704 * 0.55);

function screenMesh(anchor, canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: SCREEN_TINT });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  const right = new THREE.Vector3().fromArray(anchor.right), up = new THREE.Vector3().fromArray(anchor.up);
  const n = new THREE.Vector3().fromArray(anchor.normal);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
  mesh.position.fromArray(anchor.center).addScaledVector(n, 0.001);
  mesh.scale.set(anchor.width * 0.94, anchor.height * 0.92, 1);
  return { mesh, tex };
}

export function idleScreens(anchors, portfolio) {
  const group = new THREE.Group();
  const titles = portfolio.projects.map((p) => p.title.toUpperCase());

  const tvC = Object.assign(document.createElement('canvas'), { width: 640, height: 488 });
  const tv = screenMesh(anchors.screens.tv, tvC);
  const pcC = Object.assign(document.createElement('canvas'), { width: 512, height: 385 });
  const pc = screenMesh(anchors.screens.pc, pcC);
  group.add(tv.mesh, pc.mesh);

  function drawTv(t) {
    const g = tvC.getContext('2d'), W = tvC.width, H = tvC.height;
    g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
    glow.addColorStop(0, '#2a0507'); glow.addColorStop(1, '#050505');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const flicker = 0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    g.globalAlpha = flicker;
    g.fillStyle = '#e50914'; g.textAlign = 'center';
    g.font = '900 96px Impact, "Arial Narrow", sans-serif';
    g.fillText('MAZENFLIX', W / 2, H * 0.47);
    const i = Math.floor(t / 3.5) % titles.length, f = (t / 3.5) % 1;
    g.globalAlpha = flicker * Math.min(1, f * 5, (1 - f) * 5);
    g.fillStyle = '#eee'; g.font = '600 30px Impact, "Arial Narrow", sans-serif';
    g.fillText(titles[i], W / 2, H * 0.62);
    g.globalAlpha = 0.55 * flicker; g.font = '20px sans-serif';
    g.fillText('▶  now showing', W / 2, H * 0.72);
    g.globalAlpha = 1;
    for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y, W, 1); }
    tv.tex.needsUpdate = true;
  }

  function drawPc(t) {
    const g = pcC.getContext('2d'), W = pcC.width, H = pcC.height;
    g.fillStyle = '#5b6e9e'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, 18); g.fillStyle = '#000'; g.fillRect(0, 18, W, 2);
    g.font = '13px monospace'; g.fillStyle = '#1d2d8a'; g.fillText('◆', 8, 14);
    g.fillStyle = '#000'; g.fillText('File  Edit  View  Special', 28, 14);
    // desktop icons
    for (let k = 0; k < 5; k++) {
      g.fillStyle = '#fff'; g.fillRect(W - 44, 34 + k * 56, 26, 30);
      g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(W - 44, 34 + k * 56, 26, 30);
    }
    // a window with a blinking cursor
    g.fillStyle = '#fff'; g.fillRect(40, 60, 330, 220); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(40, 60, 330, 220);
    g.fillStyle = '#000'; for (let y = 64; y < 78; y += 3) g.fillRect(42, y, 326, 1);
    g.fillStyle = '#fff'; g.fillRect(150, 62, 110, 16); g.fillStyle = '#000'; g.font = 'bold 12px monospace'; g.fillText('About Me.txt', 160, 74);
    g.font = '13px monospace';
    ['Mazen Khaled', 'Data science & AI', '', 'Measure before deciding.', 'Verify before claiming.'].forEach((l, k) => g.fillText(l, 56, 106 + k * 20));
    if (Math.floor(t * 2) % 2) g.fillRect(56, 106 + 5 * 20 - 11, 8, 14);
    pc.tex.needsUpdate = true;
  }

  let last = -1;
  return {
    group,
    update(t) {
      if (t - last < 0.12) return;   // ~8 fps is plenty for a flicker and a cursor
      last = t;
      drawTv(t);
      drawPc(t);
    },
  };
}
