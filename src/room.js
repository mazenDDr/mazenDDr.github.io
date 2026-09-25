// Loads the baked room. Colour and light are separate, as in a game engine:
// each surface's own colour (a constant, its original texture, or a baked colour
// atlas) is multiplied by a light map baked in Cycles, and emission is added.
// Output is linear light; post.js grades it exactly like the Blender scene.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const KIND = { constant: 0, image: 1, recipe: 2, special: 3, cutout: 3 };

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

const fragmentShader = /* glsl */ `
  uniform int kind;               // 0 colour, 1 texture, 2 colour atlas, 3 baked result
  uniform vec3 color;
  uniform sampler2D map;          // the object's own texture (sRGB, decoded by the GPU)
  uniform sampler2D atlas;        // the chunk's baked colour atlas (sRGB)
  uniform sampler2D lightMap;     // log2-encoded linear light
  uniform vec2 lightRange;        // log2 range the light map was encoded with
  uniform vec3 emissive;
  uniform sampler2D emissiveMap;
  uniform bool useEmissiveMap;
  uniform bool cutout;
  varying vec2 vUv;
  varying vec2 vUv1;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 tex = texture2D(map, vUv);
    if (cutout && tex.a < 0.5) discard;
    // Half a step of noise before decoding hides the 8-bit steps in smooth light.
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    vec3 enc = texture2D(lightMap, vUv1).rgb + n / 255.0;
    vec3 light = exp2(mix(vec3(lightRange.x), vec3(lightRange.y), enc));
    vec3 albedo = kind == 1 ? tex.rgb * color : kind == 2 ? texture2D(atlas, vUv1).rgb : color;
    vec3 c = kind == 3 ? light : albedo * light;
    c += emissive * (useEmissiveMap ? texture2D(emissiveMap, vUv).rgb : vec3(1.0));
    gl_FragColor = vec4(c, 1.0);
  }`;

export function roomMaterial({ kind, color, map, atlas, lightMap, range, emissive, emissiveMap, cutout }) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      kind: { value: kind }, color: { value: new THREE.Color(...(color || [1, 1, 1])) },
      map: { value: map || null }, atlas: { value: atlas || null },
      lightMap: { value: lightMap }, lightRange: { value: new THREE.Vector2(...range) },
      emissive: { value: new THREE.Color(...(emissive || [0, 0, 0])) },
      emissiveMap: { value: emissiveMap || null }, useEmissiveMap: { value: !!emissiveMap },
      cutout: { value: !!cutout },
    },
  });
}

export async function loadRoom(renderer, onProgress = () => {}) {
  const manifest = await (await fetch('public/bake/manifest.json')).json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // The model is most of the download, so its bytes drive most of the bar.
  let done = 0, glb = 0;
  const files = manifest.chunks.flatMap((c) => [c.file, c.albedo].filter(Boolean));
  const report = () => onProgress(0.8 * glb + 0.2 * done / files.length);
  const tick = () => { done++; report(); };
  const load = (file, srgb) => texLoader.loadAsync(`public/bake/${file}`).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;                 // glTF UV convention
    t.anisotropy = aniso;
    tick();
    return t;
  });
  const gltfP = loader.loadAsync('public/room.glb', (e) => { if (e.total) { glb = e.loaded / e.total; report(); } })
    .then((g) => { glb = 1; report(); return g; });
  const chunkP = Promise.all(manifest.chunks.map(async (c) => [c.name, {
    ...c, light: await load(c.file, false), atlasTex: c.albedo ? await load(c.albedo, true) : null,
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
  // Only the door moves; freeze everything else's matrices.
  room.traverse((o) => { if (o !== room && o !== parts.door && !parts.door?.children.includes(o)) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
  return { room, parts };
}
