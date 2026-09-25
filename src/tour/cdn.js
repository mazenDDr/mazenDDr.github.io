// Where the big files come from. The page is on GitHub Pages; its heavy, never-
// changing files (pictures, videos, the model, textures, scripts) are also served by
// jsDelivr, a free multi-CDN that mirrors this repository, pinned to the exact commit
// that holds them (window.ROOM_CDN, written by tools/build.mjs). Measured from Cairo:
// 384 KB/s from jsDelivr against 89 KB/s from GitHub Pages. If the CDN can't be
// reached, the same file comes from the page's own site.
export const CDN = (typeof window !== 'undefined' && window.ROOM_CDN) || '';
let cdnDown = false;

/** URL for a site path (like 'public/tour/x.avif') on the CDN, or on this site. */
export const asset = (path) => (CDN && !cdnDown ? CDN + path : path);

/** fetch() a site path from the CDN, falling back to this site. */
export async function fetchAsset(path, opts) {
  if (CDN && !cdnDown) {
    try {
      const r = await fetch(CDN + path, opts);
      if (r.ok) return r;
    } catch { /* blocked or down: use the site */ }
    cdnDown = true;
  }
  return fetch(path, opts);
}
