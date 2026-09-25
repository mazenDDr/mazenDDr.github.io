// The Blender scene's own look, applied to the linear room image in the same
// order Blender uses: compositor colour balance (lift/gamma/gain), saturation,
// vignette and glow on scene-linear light, then the AgX view transform at the
// scene's exposure. Numbers come from design/blender/room_polished.blend.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const LOOK = {
  // The scene's own exposure is -3.35; the web-only controls below (exposure, slope,
  // offset, saturation) were fitted by tools/calibrate_look.py so the hero view matches
  // the Cycles render on luma, saturation, warmth, p05/p95, contrast and dark area.
  exposure: -3.704,                     // view transform, stops
  slope: [0.802, 1.0, 0.923],           // white balance
  offset: 0.07343,                      // shadow lift (linear): the bake has no glossy bounce light
  lift: [1.07, 1.06, 1.05], gamma: [1, 1, 1], gain: [1.30, 1.0, 0.88],
  saturation: 0.982,
  vignette: 0.34, ellipse: [0.45, 0.51], // multiply by a blurred ellipse, 90% x 102% of the frame
  glow: { threshold: 5.0, strength: 0.14, radius: 0.3 },     // Blender: fog glow, threshold 5, strength 0.12
  grain: 0.035,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    slope: { value: new THREE.Vector3() }, offset: { value: 0 }, lift: { value: new THREE.Vector3() },
    gammaInv: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3() },
    saturation: { value: 1 }, vignette: { value: 0 }, ellipse: { value: new THREE.Vector2() }, aspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 slope, lift, gammaInv, gain;
    uniform float saturation, vignette, aspect, offset;
    uniform vec2 ellipse;
    varying vec2 vUv;
    vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb * slope + offset * src.a;     // (alpha 0 = a hole for a live screen)
      // Blender's compositor Lift/Gamma/Gain (done on the sRGB curve, as Blender does)
      vec3 s = (toSrgb(c) - 1.0) * (2.0 - lift) + 1.0;
      c = pow(toLinear(max(s * gain, 0.0)), gammaInv);
      // Hue/Saturation/Value: scale HSV saturation, keeping value
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
      float k = sat > 0.0 ? min(saturation, 1.0 / sat) : 1.0;
      c = mx - (mx - c) * k;
      // Vignette: a soft ellipse, multiplied at the scene's strength
      float r = length((vUv - 0.5) / ellipse);
      float mask = 1.0 - smoothstep(0.72, 1.28, r);
      c *= mix(1.0, mask, vignette);
      gl_FragColor = vec4(c, src.a);
    }`,
};

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float amount, time; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Film grain, strongest in the mid-tones like real film, over the final image.
      float g = hash(gl_FragCoord.xy) - 0.5;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += g * amount * (1.0 - abs(l - 0.5) * 1.6);
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera, look = LOOK) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  renderer.setClearColor(0x000000, 0);           // transparent where the live screens show through
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), look.glow.strength, look.glow.radius, look.glow.threshold);
  // Glow adds light but must not fill the screen holes: leave alpha untouched.
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendEquation = THREE.AddEquation;
  bloom.blendMaterial.blendSrc = THREE.OneFactor; bloom.blendMaterial.blendDst = THREE.OneFactor;
  bloom.blendMaterial.blendSrcAlpha = THREE.ZeroFactor; bloom.blendMaterial.blendDstAlpha = THREE.OneFactor;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());          // AgX + exposure + sRGB, from renderer settings
  const grain = new ShaderPass(GrainShader);
  composer.addPass(grain);

  renderer.toneMapping = THREE.AgXToneMapping;
  const apply = (l) => {
    const u = grade.uniforms;
    u.slope.value.fromArray(l.slope); u.offset.value = l.offset || 0; u.lift.value.fromArray(l.lift); u.gain.value.fromArray(l.gain);
    u.gammaInv.value.set(1 / l.gamma[0], 1 / l.gamma[1], 1 / l.gamma[2]);
    u.saturation.value = l.saturation; u.vignette.value = l.vignette; u.ellipse.value.fromArray(l.ellipse);
    renderer.toneMappingExposure = 2 ** l.exposure;
    bloom.threshold = l.glow.threshold; bloom.strength = l.glow.strength; bloom.radius = l.glow.radius;
    grain.uniforms.amount.value = l.grain;
  };
  apply(look);
  return {
    composer, look, apply,
    setSize(w, h) { composer.setSize(w, h); },
    render(t) { grain.uniforms.time.value = t % 100; composer.render(); },
  };
}
