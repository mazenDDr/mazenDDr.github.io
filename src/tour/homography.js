// Putting a flat page exactly where a screen appears: the camera projects the page's
// four corners, and one projective CSS matrix maps the page onto them. No CSS 3D
// camera or preserve-3d (Safari won't draw those scenes), so it works everywhere.
// Shared by the tour (src/tour/screens.js) and the live room (engine/src/screens.js).

const css = (m) => `matrix3d(${m.map((x) => (Math.abs(x) < 1e-10 ? 0 : x)).join(',')})`;

/** The projective map taking four points to four points, as a CSS matrix3d (column-major). */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  for (let c = 0; c < 8; c++) {                     // Gaussian elimination, partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) { let v = b[r]; for (let k = r + 1; k < 8; k++) v -= A[r][k] * h[k]; h[r] = v / A[r][r]; }
  return [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1];
}

/** Place one page: o = { wrap, corners (world, TL TR BR BL), px (page corners), shown }.
 *  viewProj is column-major (camera projection x view). Hidden when a corner is behind the eye. */
export function place(o, m, w, h) {
  const dst = [];
  for (const [x, y, z] of o.corners) {
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw < 0.05) break;
    dst.push([((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) * w / 2, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) * h / 2]);
  }
  const see = dst.length === 4 && dst.some(([x, y]) => x > -w && x < 2 * w && y > -h && y < 2 * h);
  if (see !== o.shown) { o.shown = see; o.wrap.style.visibility = see ? '' : 'hidden'; }
  if (see) {
    const t = css(homography(o.px, dst));
    if (t !== o.at) { o.at = t; o.wrap.style.transform = t; }
  }
}
