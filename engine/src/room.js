// Loads the baked room. Colour and light are separate, as in a game engine:
// each surface's own colour (a constant, its original texture, or a baked colour
// atlas) is multiplied by a light map baked in Cycles, and emission is added.
// Output is linear light; post.js grades it exactly like the Blender scene.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { gradeUniforms, GRADE_GLSL } from './post.js';

const KIND = { constant: 0, image: 1, recipe: 2, special: 3, cutout: 3 };
const SCREEN_GLASS = new Set(['image|crt_art', 'image|pc_art']);

const vertexShader = /* glsl */ `
  attribute vec2 uv1;
  varying vec2 vUv;
  varying vec2 vUv1;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    vUv1 = uv1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

// Each kind of surface gets its own compiled variant (KIND, CUTOUT, EMISSIVE_MAP),
// so a pixel only fetches the textures it uses: on a weak GPU every fetch counts.
const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform sampler2D map;          // the object's own texture (sRGB, decoded by the GPU)
  uniform sampler2D atlas;        // the chunk's baked colour atlas (sRGB)
  uniform sampler2D lightMap;     // log2-encoded linear light
  uniform vec2 lightRange;        // log2 range the light map was encoded with
  uniform vec3 emissive;
  uniform sampler2D emissiveMap;
  varying vec2 vUv;
  varying vec2 vUv1;
  ${GRADE_GLSL}
  void main() {
    #if KIND == 1 || CUTOUT
      vec4 tex = texture2D(map, vUv);
    #endif
    #if CUTOUT
      if (tex.a < 0.5) discard;
    #endif
    // Half a step of noise before decoding hides the 8-bit steps in smooth light.
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    vec3 enc = texture2D(lightMap, vUv1).rgb + n / 255.0;
    vec3 light = exp2(mix(vec3(lightRange.x), vec3(lightRange.y), enc));
    #if KIND == 3
      vec3 c = light;             // the bake already holds colour and light
    #elif KIND == 1
      vec3 c = tex.rgb * color * light;
    #elif KIND == 2
      vec3 c = texture2D(atlas, vUv1).rgb * light;
    #else
      vec3 c = color * light;
    #endif
    #if EMISSIVE_MAP
      c += emissive * texture2D(emissiveMap, vUv).rgb;
    #else
      c += emissive;
    #endif
    // Drawn already graded (post.js): saves a full-screen pass.
    gl_FragColor = vec4(grade(c), 1.0);
  }`;

export function roomMaterial({ kind, color, map, atlas, lightMap, range, emissive, emissiveMap, cutout }) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    defines: { KIND: kind, CUTOUT: cutout ? 1 : 0, EMISSIVE_MAP: emissiveMap ? 1 : 0 },
    uniforms: {
      ...gradeUniforms,
      color: { value: new THREE.Color(...(color || [1, 1, 1])) },
      map: { value: map || null }, atlas: { value: atlas || null },
      lightMap: { value: lightMap }, lightRange: { value: new THREE.Vector2(...range) },
      emissive: { value: new THREE.Color(...(emissive || [0, 0, 0])) },
      emissiveMap: { value: emissiveMap || null },
    },
    // Many downloaded models are single shells (lamp shades) or built inside out
    // (the teapot lid); Cycles shows both sides, so the browser must too.
    side: THREE.DoubleSide,
  });
}

/**
 * @param lite  the website: start from the small model and quarter-size light maps
 *              (about 9 MB) and stream the full ones in afterwards with stream();
 *              the capture tools load everything full-size at once.
 */
export async function loadRoom(renderer, onProgress = () => {}, hinge = null, { lite = false } = {}) {
  const manifest = await (await fetch('public/bake/manifest.json')).json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // The model is most of the download, so its bytes drive most of the bar.
  let done = 0, glb = 0;
  const lightFile = (c) => (lite && c.lo) || c.file, albedoFile = (c) => (lite && c.albedoLo) || c.albedo;
  const files = manifest.chunks.flatMap((c) => [lightFile(c), albedoFile(c)].filter(Boolean));
  const report = () => onProgress(0.8 * glb + 0.2 * done / files.length);
  const tick = () => { done++; report(); };
  const load = (file, srgb) => texLoader.loadAsync(`public/bake/${file}`).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;                 // glTF UV convention
    t.anisotropy = aniso;
    tick();
    return t;
  });
  const gltfP = loader.loadAsync(lite ? 'public/room-lo.glb' : 'public/room.glb', (e) => { if (e.total) { glb = e.loaded / e.total; report(); } })
    .then((g) => { glb = 1; report(); return g; });
  const chunkP = Promise.all(manifest.chunks.map(async (c) => [c.name, {
    ...c, light: await load(lightFile(c), false), atlasTex: c.albedo ? await load(albedoFile(c), true) : null,
  }]));
  const [gltf, chunkList] = await Promise.all([gltfP, chunkP]);
  const chunks = Object.fromEntries(chunkList);

  const room = gltf.scene;
  const parts = {};
  room.traverse((o) => {
    if (!o.isMesh) return;
    // A chunk with several materials loads as a group of meshes: its node is the
    // ancestor directly under the room.
    let node = o;
    while (node.parent && node.parent !== room) node = node.parent;
    const chunkName = node.name;
    parts[chunkName] = node;
    const src = o.material;
    const entry = manifest.materials[src.name] || { kind: 'constant' };
    // The tubes' baked glass: the live page shows there instead (screens.js draws the
    // glass from the original mesh). Drawing both makes them fight for the same depth.
    if (SCREEN_GLASS.has(src.name)) { o.visible = false; return; }
    if (entry.kind === 'glass') {
      o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.8), transparent: true, opacity: 0.05, depthWrite: false });
      return;
    }
    const c = chunks[chunkName];
    if (!c) { console.warn('no light map for', chunkName, o.name); return; }
    if (src.map) { src.map.anisotropy = aniso; src.map.colorSpace = THREE.SRGBColorSpace; }
    if (src.emissiveMap) src.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    o.material = roomMaterial({
      kind: KIND[entry.kind] ?? 0, color: entry.color, map: src.map, atlas: c.atlasTex,
      lightMap: c.light, range: c.range, emissive: entry.emissive, emissiveMap: entry.emissiveMap ? src.emissiveMap : null,
      cutout: entry.kind === 'cutout' && !!src.map,
    });
    src.dispose();
  });
  // Packing re-centres each node on its bounds (meshopt quantization), so the door
  // would spin about its middle. Hang it on a pivot at the measured hinge instead.
  if (parts.door && hinge) {
    const pivot = new THREE.Group();
    pivot.name = 'door';
    pivot.position.fromArray(hinge);
    room.add(pivot);
    room.updateMatrixWorld(true);
    pivot.attach(parts.door);
    parts.door = pivot;
  }
  // Only the door moves; freeze everything else's matrices.
  room.traverse((o) => { if (o !== room && !isDoor(o)) { o.updateMatrix(); o.matrixAutoUpdate = false; } });

  // Every texture in use and the uniforms holding it, so a sharper copy can replace it.
  const holders = new Map();
  room.traverse((o) => {
    for (const u of Object.values(o.material?.uniforms || {})) {
      if (u.value?.isTexture) (holders.get(u.value) || holders.set(u.value, []).get(u.value)).push(u);
    }
  });

  /** The full-size light maps, colour atlases and textures, fetched a few at a time
   *  (light first: the whole look rests on it). Each arrives as a job for `queue`,
   *  which the page runs one per frame when the camera is still. */
  function stream(queue) {
    if (!lite) return;
    const byName = new Map();
    for (const t of holders.keys()) if (t.name) byName.set(t.name, t);
    // what you see first (the landing and the door, while knocking) goes first
    const FIRST = ['hall', 'door'];
    const firstTex = new Set();
    for (const k of FIRST) parts[k]?.traverse((o) => { for (const u of Object.values(o.material?.uniforms || {})) if (u.value?.isTexture && u.value.name) firstTex.add(u.value.name); });
    const jobs = [];
    const chunkOrder = [...manifest.chunks].sort((a, b) => FIRST.includes(b.name) - FIRST.includes(a.name));
    for (const c of chunkOrder) {
      const ch = chunks[c.name];
      if (c.lo) jobs.push([`public/bake/${c.file}`, ch.light]);
      if (c.albedoLo && ch.atlasTex) jobs.push([`public/bake/${c.albedo}`, ch.atlasTex]);
    }
    const texs = Object.entries(manifest.textures || {}).filter(([n, t]) => byName.has(n) && Math.max(...t.size) > 256)
      .sort((a, b) => b[1].size[0] * b[1].size[1] - a[1].size[0] * a[1].size[1]);
    texs.sort((a, b) => firstTex.has(b[0]) - firstTex.has(a[0]));
    const [lightFirst, lightRest] = [jobs.filter((j) => FIRST.some((k) => j[0].includes(`/${k}.`))), jobs.filter((j) => !FIRST.some((k) => j[0].includes(`/${k}.`)))];
    jobs.length = 0;
    jobs.push(...lightFirst, ...texs.filter(([n]) => firstTex.has(n)).map(([n, t]) => [`public/tex/${t.file}`, byName.get(n)]), ...lightRest,
      ...texs.filter(([n]) => !firstTex.has(n)).map(([n, t]) => [`public/tex/${t.file}`, byName.get(n)]));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const [url, old] = jobs[next++];
        try {
          const blob = await (await fetch(url)).blob();
          const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          queue.push(() => swap(old, img));
        } catch { /* keep the small one */ }
      }
    };
    for (let i = 0; i < 4; i++) worker();
  }

  /** A new texture object for the sharper picture (a texture can't change size in place). */
  function swap(old, img) {
    const t = old.clone();
    t.source = new THREE.Source(img);
    t.needsUpdate = true;
    for (const u of holders.get(old) || []) u.value = t;
    holders.set(t, holders.get(old) || []);
    holders.delete(old);
    old.dispose();
  }

  return { room, parts, stream };

  function isDoor(o) { for (; o; o = o.parent) if (o === parts.door) return true; return false; }
}
