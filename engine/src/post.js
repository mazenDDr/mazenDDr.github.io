// The Blender scene's own look, applied to the linear room image in the same
// order Blender uses: compositor colour balance (lift/gamma/gain), saturation,
// vignette and glow on scene-linear light, then the AgX view transform at the
// scene's exposure. Numbers come from design/blender/room_polished.blend.
//
// Built to be cheap on weak GPUs, where every full-screen pass costs a trip
// through memory. The grade runs inside the room's own shader (room.js includes
// GRADE_GLSL), so the room is drawn already graded; the glow is blurred at half
// size; and one final pass adds the glow, tone-maps, encodes sRGB and adds grain.
// Two full-screen passes instead of five, and the same picture.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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

/** Shared by every room material: set once here, read by all of them. */
export const gradeUniforms = {
  slope: { value: new THREE.Vector3() }, offset: { value: 0 }, lift: { value: new THREE.Vector3() },
  gammaInv: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3() },
  saturation: { value: 1 }, vignette: { value: 0 }, ellipse: { value: new THREE.Vector2() },
  gradeViewport: { value: new THREE.Vector2(1, 1) },
};

export const GRADE_GLSL = /* glsl */ `
  uniform vec3 slope, lift, gammaInv, gain;
  uniform float saturation, vignette, offset;
  uniform vec2 ellipse, gradeViewport;
  vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 grade(vec3 c) {
    c = c * slope + offset;
    // Blender's compositor Lift/Gamma/Gain (done on the sRGB curve, as Blender does)
    vec3 s = (toSrgb(c) - 1.0) * (2.0 - lift) + 1.0;
    c = pow(toLinear(max(s * gain, 0.0)), gammaInv);
    // Hue/Saturation/Value: scale HSV saturation, keeping value
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float k = sat > 0.0 ? min(saturation, 1.0 / sat) : 1.0;
    c = mx - (mx - c) * k;
    // Vignette: a soft ellipse, multiplied at the scene's strength
    float r = length((gl_FragCoord.xy / gradeViewport - 0.5) / ellipse);
    return c * mix(1.0, 1.0 - smoothstep(0.72, 1.28, r), vignette);
  }`;

const finalMaterial = new THREE.RawShaderMaterial({
  uniforms: {
    tScene: { value: null }, tBloom: { value: null }, toneMappingExposure: { value: 1 },
    grain: { value: 0 }, time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix, projectionMatrix;
    attribute vec3 position; attribute vec2 uv;
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tScene, tBloom;
    uniform float grain, time;
    varying vec2 vUv;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + time) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tScene, vUv);
      // Glow adds light but leaves alpha alone (alpha 0 = a hole for a live screen).
      vec3 c = AgXToneMapping(src.rgb + texture2D(tBloom, vUv).rgb);
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
      // Film grain, strongest in the mid-tones like real film, over the final image.
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += (hash(gl_FragCoord.xy) - 0.5) * grain * (1.0 - abs(l - 0.5) * 1.6);
      gl_FragColor = vec4(c, src.a);
    }`,
  depthTest: false, depthWrite: false,
});

/** UnrealBloomPass's blur chain, stopping before it blends back at full size:
 *  the final pass reads the glow straight from its half-size target. */
function glow(renderer, bloom, input) {
  const quad = bloom._fsQuad;
  bloom.highPassUniforms.tDiffuse.value = input;
  bloom.highPassUniforms.luminosityThreshold.value = bloom.threshold;
  quad.material = bloom.materialHighPassFilter;
  renderer.setRenderTarget(bloom.renderTargetBright);
  renderer.clear();
  quad.render(renderer);
  let src = bloom.renderTargetBright;
  for (let i = 0; i < bloom.nMips; i++) {
    const m = bloom.separableBlurMaterials[i];
    quad.material = m;
    m.uniforms.colorTexture.value = src.texture;
    m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
    renderer.setRenderTarget(bloom.renderTargetsHorizontal[i]);
    renderer.clear();
    quad.render(renderer);
    m.uniforms.colorTexture.value = bloom.renderTargetsHorizontal[i].texture;
    m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
    renderer.setRenderTarget(bloom.renderTargetsVertical[i]);
    renderer.clear();
    quad.render(renderer);
    src = bloom.renderTargetsVertical[i];
  }
  const cm = bloom.compositeMaterial;
  cm.uniforms.bloomStrength.value = bloom.strength;
  cm.uniforms.bloomRadius.value = bloom.radius;
  quad.material = cm;
  renderer.setRenderTarget(bloom.renderTargetsHorizontal[0]);
  renderer.clear();
  quad.render(renderer);
  return bloom.renderTargetsHorizontal[0].texture;
}

/** Render scales for moving frames on a slow GPU; a still view always gets 1. */
export const SCALES = [1, 0.75, 0.55];

export function createPost(renderer, scene, camera, look = LOOK) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const full = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const low = {};                                  // scale -> target, made only if a slow GPU needs it
  renderer.setClearColor(0x000000, 0);           // transparent where the live screens show through
  renderer.toneMapping = THREE.NoToneMapping;    // the final pass tone-maps
  const bloom = new UnrealBloomPass(size.clone(), look.glow.strength, look.glow.radius, look.glow.threshold);
  const quad = new FullScreenQuad(finalMaterial);

  const apply = (l) => {
    const u = gradeUniforms;
    u.slope.value.fromArray(l.slope); u.offset.value = l.offset || 0; u.lift.value.fromArray(l.lift); u.gain.value.fromArray(l.gain);
    u.gammaInv.value.set(1 / l.gamma[0], 1 / l.gamma[1], 1 / l.gamma[2]);
    u.saturation.value = l.saturation; u.vignette.value = l.vignette; u.ellipse.value.fromArray(l.ellipse);
    finalMaterial.uniforms.toneMappingExposure.value = 2 ** l.exposure;
    bloom.threshold = l.glow.threshold; bloom.strength = l.glow.strength; bloom.radius = l.glow.radius;
    finalMaterial.uniforms.grain.value = l.grain;
    post.look = l;
    post.onChange?.();                             // main.js redraws the (otherwise still) view
  };
  const post = {
    look, apply, bloom,
    setSize(w, h) {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      full.setSize(s.x, s.y);
      bloom.setSize(s.x, s.y);
      for (const k of Object.keys(low)) { low[k].dispose(); delete low[k]; }
    },
    /** One frame. `scale` < 1 draws the room smaller (only while moving, on a slow GPU). */
    render(t, scale = 1) {
      let target = full;
      if (scale < 1) {
        target = low[scale] ||= new THREE.WebGLRenderTarget(Math.round(full.width * scale), Math.round(full.height * scale),
          { type: THREE.HalfFloatType, samples: 2 });
      }
      gradeUniforms.gradeViewport.value.set(target.width, target.height);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);                // autoClear clears it
      finalMaterial.uniforms.tBloom.value = glow(renderer, bloom, target.texture);
      finalMaterial.uniforms.tScene.value = target.texture;
      finalMaterial.uniforms.time.value = t % 100;
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
  };
  apply(look);
  return post;
}
