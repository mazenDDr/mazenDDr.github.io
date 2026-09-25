// Loads the baked room: one mesh per bake chunk, each drawn unlit with its
// Cycles-baked atlas, so the browser shows exactly the light Blender computed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function loadRoom(renderer, onProgress = () => {}) {
  const manifest = await (await fetch('public/bake/manifest.json')).json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  let done = 0;
  const total = manifest.chunks.length + 1;
  const tick = () => onProgress(++done / total);

  const gltfP = loader.loadAsync('public/room.glb').then((g) => (tick(), g));
  const texP = manifest.chunks.map((c) =>
    texLoader.loadAsync(`public/bake/${c.file}`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // glTF UV convention
      t.anisotropy = Math.min(8, maxAniso);
      tick();
      return [c.name, t];
    }));
  const [gltf, textures] = await Promise.all([gltfP, Promise.all(texP)]);
  const maps = Object.fromEntries(textures);

  const room = gltf.scene;
  const parts = {};
  room.traverse((o) => {
    if (!o.isMesh) return;
    parts[o.name] = o;
    if (o.name === 'glass') {
      o.material = new THREE.MeshBasicMaterial({ color: 0xbfd4e6, transparent: true, opacity: 0.06, depthWrite: false });
      return;
    }
    const map = maps[o.name];
    if (!map) console.warn('no bake for', o.name);
    o.material = new THREE.MeshBasicMaterial({ map });
    o.matrixAutoUpdate = o.name === 'door';
    if (!o.matrixAutoUpdate) o.updateMatrix();
  });
  return { room, parts };
}
