// Where the visitor can go. Positions are measured in the Blender scene in cm
// (x toward the TV wall, y from the window toward the door, z up) and converted
// with B(), so they can be checked against design/blender and anchors.json.
import * as THREE from 'three';

export const B = (x, y, z = 0) => new THREE.Vector3(x / 100, z / 100, -y / 100);

export const EYE = { stand: 1.6, sit: 1.08, bed: 0.98 };

// Walkable floor graph: aisles between the furniture. Node -> [x, y] in cm.
export const NODES = {
  hall: [294, 740], door: [294, 512], entry: [236, 452], front: [168, 440],
  couchFront: [112, 318], rightNorth: [112, 205], north: [190, 200],
  aisle: [226, 318], desk: [136, 150], bedSide: [206, 112],
};
export const EDGES = [
  ['hall', 'door'], ['door', 'entry'], ['entry', 'front'], ['entry', 'aisle'],
  ['front', 'couchFront'], ['couchFront', 'rightNorth'], ['rightNorth', 'north'],
  ['aisle', 'north'], ['north', 'desk'], ['north', 'bedSide'], ['rightNorth', 'desk'],
];

// Places: a floor node to walk to, then a final eye position (standing or
// sitting) and what to look at. `focus` names a screen to zoom into afterwards.
export const PLACES = {
  hall: { node: 'hall', eye: B(294, 800, 162), look: B(294, 520, 138), hfov: 76, pose: 'stand', label: '' },
  room: { node: 'front', eye: B(190, 486, 158), look: B(170, 120, 112), hfov: 100, pose: 'stand', label: 'Stand in the room' },
  couch: { node: 'couchFront', eye: B(40, 300, 110), look: B(300, 288, 90), hfov: 82, pose: 'sit', label: 'Sit on the couch' },
  tv: { node: 'couchFront', eye: B(40, 300, 110), look: B(300, 288, 90), hfov: 82, pose: 'sit', focus: 'tv', label: 'Watch TV' },
  desk: { node: 'desk', eye: B(94, 130, 124), look: B(96, 57, 104), hfov: 80, pose: 'sit', label: 'Sit at the desk' },
  pc: { node: 'desk', eye: B(94, 130, 124), look: B(96, 57, 104), hfov: 80, pose: 'sit', focus: 'pc', label: 'Use the computer' },
  bed: { node: 'bedSide', eye: B(252, 118, 100), look: B(288, 0, 126), hfov: 84, pose: 'bed', label: 'Sit on the bed' },
  memo: { node: 'bedSide', eye: B(252, 118, 100), look: B(288, 0, 126), hfov: 84, pose: 'bed', focus: 'memo', label: 'Read the pinboard' },
  games: { node: 'couchFront', eye: B(40, 300, 110), look: B(300, 288, 90), hfov: 82, pose: 'sit', focus: 'tv', app: 'games', label: 'Play a game' },
  certificates: { node: 'bedSide', eye: B(190, 104, 152), look: B(340, 104, 146), hfov: 58, pose: 'stand', label: 'Look at the certificates' },
};

export function shortestPath(from, to) {
  const adj = {};
  for (const [a, b] of EDGES) {
    const d = Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1]);
    (adj[a] ||= []).push([b, d]);
    (adj[b] ||= []).push([a, d]);
  }
  const dist = { [from]: 0 }, prev = {}, open = new Set([from]);
  while (open.size) {
    const u = [...open].reduce((m, n) => (dist[n] < dist[m] ? n : m));
    open.delete(u);
    if (u === to) break;
    for (const [v, d] of adj[u] || []) {
      if (dist[u] + d < (dist[v] ?? Infinity)) { dist[v] = dist[u] + d; prev[v] = u; open.add(v); }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}
