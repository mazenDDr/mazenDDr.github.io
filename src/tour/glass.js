// The tubes' glass, drawn over each live page: darker toward the rim where the
// tube curves away, a sheen at grazing angles, and the room's lamps reflected in
// its curvature. Seen from across the room the page is dimmed into the room's
// light. Output is premultiplied in display colours: the page behind keeps (1 - a)
// of its light and rgb is light the glass adds. Shared by the viewer (over the
// live pages) and tools/capture.py (over the app stills in the flights).

// Lights the glass reflects (three.js axes, metres): window, ceiling lamp, floor lamp; power.
export const LIGHTS = [[1.7, 1.45, 0.05, 2.2], [1.7, 1.99, -2.57, 1.4], [3.0, 1.41, -4.06, 1.0]];
export const DIM = 0.42;                // a page seen from across the room

export const GLASS_FRAG = /* glsl */ `
  uniform vec3 eye;
  uniform vec3 lights[3];
  uniform float power[3];
  uniform float dim, sheen, crt;
  varying vec2 vFace;
  varying vec3 vPos, vNormal;
  vec4 glass() {
    vec3 warm = vec3(0.16, 0.10, 0.05) * dim;          // lamplight on the glass
    if (crt < 0.5) return vec4(warm, dim);
    vec2 q = abs(vFace);
    float rim = pow(pow(q.x, 8.0) + pow(q.y, 8.0), 0.125);
    float dark = max(smoothstep(0.62, 1.02, rim) * 0.78, dim);
    vec3 n = normalize(vNormal), v = normalize(eye - vPos);
    if (dot(n, v) < 0.0) n = -n;
    float f = 0.035 + 0.965 * pow(1.0 - max(dot(n, v), 0.0), 5.0);   // Schlick
    vec3 r = reflect(-v, n);
    vec3 c = warm + vec3(0.10, 0.075, 0.055) * (0.6 + 0.4 * r.y) * f / 0.035 * 0.3;
    for (int i = 0; i < 3; i++) {
      float s = max(dot(r, normalize(lights[i] - vPos)), 0.0);
      c += vec3(1.0, 0.8, 0.6) * power[i] * (pow(s, 90.0) * 0.45 + pow(s, 12.0) * 0.03);
    }
    return vec4(c * sheen, dark);
  }`;

export const GLASS_VERT = /* glsl */ `
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec2 face;
  uniform mat4 viewProj;
  varying vec2 vFace;
  varying vec3 vPos, vNormal;
  void main() { vFace = face; vPos = position; vNormal = normal; gl_Position = viewProj * vec4(position, 1.0); }`;
