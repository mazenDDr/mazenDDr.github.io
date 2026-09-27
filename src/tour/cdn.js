// Where the big files come from. The page is on GitHub Pages; its heavy, never-
// changing files (pictures, videos, the model, textures, scripts) are also served by
// jsDelivr, a free multi-CDN that mirrors this repository, pinned to the exact commit
// that holds them (window.ROOM_CDN, written by tools/build.mjs). Measured from Cairo:
// 384 KB/s from jsDelivr against 89 KB/s from GitHub Pages. The page's head
// (window.ROOM_GET) asks the CDN first and the site as well if the CDN is slow to answer
// or fails; the files the live room needs first are already on their way
// (window.ROOM_FIRST) by the time this runs.
export const CDN = (typeof window !== 'undefined' && window.ROOM_CDN) || '';

/** fetch() a site path: the early request if there is one, else from the CDN with the
 *  site as backup; plain fetch() where the page has no head script (the engine's own page). */
export function fetchAsset(path, opts) {
  const early = !opts && window.ROOM_FIRST?.[path];
  if (early) { delete window.ROOM_FIRST[path]; return early; }     // a body can be read once
  if (window.ROOM_GET && !opts) return window.ROOM_GET(path, 'low');       // (after the first files: the sharper pictures)
  return fetch(path, opts);
}
