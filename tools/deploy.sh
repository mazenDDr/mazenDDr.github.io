#!/bin/sh
# Publish to GitHub Pages in two steps:
#   1. every file (so jsDelivr can serve that exact commit of the repository);
#   2. the page, pointing its heavy files at jsDelivr@<that commit>.
# Then ask jsDelivr for the first files once, so the first visitor doesn't wait for it
# to fetch them from GitHub.
#   sh tools/deploy.sh "What changed"
set -e
cd "$(dirname "$0")/.."
export GIT_AUTHOR_NAME='Mazen Khaled' GIT_AUTHOR_EMAIL='khaledmazen456@gmail.com' GIT_COMMITTER_NAME='Mazen Khaled' GIT_COMMITTER_EMAIL='khaledmazen456@gmail.com'
node tools/build.mjs
git add -A
git commit -q -m "$1" || true
git push -q origin HEAD
SHA=$(git rev-parse --short=12 HEAD)
node tools/build.mjs --cdn "$SHA"
git add index.html sw.js
git commit -q -m "Serve the heavy files from jsDelivr (commit $SHA)"
git push -q origin HEAD
CDN="https://cdn.jsdelivr.net/gh/mazenDDr/mazenDDr.github.io@$SHA"
for f in $(grep -oE "public/tour/(app|live)-[0-9a-f]{8}\.js|public/tour/hall-(strip|front-1024)-[0-9a-f]{8}\.(avif|webp)" index.html | sort -u) public/room-lo.glb; do
  curl -s -o /dev/null -w "warm %{http_code} %{time_total}s $f\n" "$CDN/$f"
done
echo "published: page -> $CDN"
