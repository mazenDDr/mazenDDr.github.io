#!/bin/sh
# Publish. The site lives on Cloudflare Pages (free: no bandwidth limit, servers near every
# visitor); GitHub keeps the files and its Pages address sends visitors to Cloudflare (the
# page's first script). jsDelivr is no longer used: it served this repository only in part
# (over its 50 MB limit).
#   sh tools/deploy.sh "What changed"          (once before: npx wrangler login)
set -e
cd "$(dirname "$0")/.."
export GIT_AUTHOR_NAME='Mazen Khaled' GIT_AUTHOR_EMAIL='khaledmazen456@gmail.com' GIT_COMMITTER_NAME='Mazen Khaled' GIT_COMMITTER_EMAIL='khaledmazen456@gmail.com'
# the site's Cloudflare address (its Pages project "mazenddr", made once with --force)
HOME_URL=$(cat tools/cloudflare-url.txt)
node tools/build.mjs --home "$HOME_URL"
git add -A
git commit -q -m "$1" || true
git push -q origin HEAD
OUT=$(mktemp -d) NEUTRAL=$(mktemp -d)
git archive HEAD | tar -x -C "$OUT"
rm -rf "$OUT/node_modules" "$OUT/package.json" "$OUT/package-lock.json" "$OUT/tools" "$OUT/build"   # the site only
# (run from an empty folder: in a project folder wrangler "sets it up" for Workers on its own)
(cd "$NEUTRAL" && npx --yes wrangler pages deploy "$OUT" --project-name mazenddr --branch main --commit-dirty=true)
rm -rf "$OUT" "$NEUTRAL"
for f in index.html $(grep -oE "public/tour/(app|live)-[0-9a-f]{8}\.js|public/(anchors\.json|room-lo\.glb|bake/[a-z0-9_-]+\.(json|webp))" index.html | sort -u); do
  curl -s -o /dev/null -w "warm %{http_code} %{time_total}s $f\n" "$HOME_URL$f"
done
echo "published: $HOME_URL (and https://mazenddr.github.io/ forwards there)"
