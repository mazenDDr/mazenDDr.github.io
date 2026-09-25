# Mazen's Room: the portfolio site

A first-person walk through Mazen's room, in the spirit of *Life is Strange*.
You knock, the door opens, and you click where to go: sit on the couch, at the
desk or on the bed, or look at the certificate wall. The TV, the computer and
the pinboard are live screens with the actual portfolio on them.

```
cd web && python3 -m http.server 8765      # then open http://localhost:8765
```

Deep links: `?place=couch|tv|desk|pc|bed|memo|certificates`, `?skip` (no knock),
`?view=hero` (the exact Blender hero camera, for render comparisons).

## What's where

| Path | What it is |
|---|---|
| `index.html`, `src/` | The room: loading, walking, hotspots, the knock intro, the live screens |
| `src/places.js` | Where you can go and what you look at there (positions in Blender cm) |
| `apps/tv/` | **Mazenflix**, the TV: profiles, billboard, rows, detail pages |
| `apps/pc/` | **MazenOS**, the computer: windows, project READMEs, terminal |
| `apps/memo/` | The pinboard: how I work, skills, the diploma, projects, contact |
| `content/portfolio.json` | **Everything the screens show.** Edit this to change the site |
| `content/github/` | The READMEs the project numbers were copied from |
| `public/room.glb`, `public/bake/` | The room model and its baked lighting (generated) |
| `public/anchors.json` | Measured screen/door/wall positions (generated) |
| `tools/` | The export pipeline and the browser checks |

## Changing the content

Edit `content/portfolio.json` and reload. Projects appear on the TV, the PC and
(the first three) the pinboard. Numbers in it come from each repo's README; when
a repo changes, update both. Fields marked `TODO` are still waiting on Mazen:
city, public email, and work experience (a LinkedIn "Save to PDF" export is the
easiest source).

A new certificate: add its image to `content/certificates/` and an entry under
`certificates`. It shows on the TV and PC straight away. To hang it on the wall
in 3D, add a `framed(...)` line in `tools/prep_web.py` and rebuild the room.

## Rebuilding the room from Blender

The room is `design/blender/room_polished.blend`. The browser shows its Cycles
lighting baked into textures, drawn unlit, so it looks like the renders and runs
at 60 fps. Four stages, all from the repo root:

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python-exit-code 1 --python web/tools/prep_web.py     # 75 s: meshes, door, hallway, diploma, chunks
$B --background --python-exit-code 1 --python web/tools/bake_web.py -- --res 4096 --samples 256   # ~40 min on an M4 Pro
$B --background --python-exit-code 1 --python web/tools/export_web.py   # the GLB
$B --background design/blender/room_polished.blend --python web/tools/anchors.py
cd web && node tools/pack.mjs                                            # meshopt + WebP + manifest
```

`bake_web.py` is resumable (finished chunks are skipped; `--force` redoes them)
and `--png-only` re-grades the saved EXRs in seconds without baking.

**Colour match.** Each bake goes through the scene's own grade (the compositor's
colour balance and saturation, then AgX at exposure −3.35), plus one measured
gain, `GAIN` in `bake_web.py`. It was set by sweeping two values and
interpolating, checked with `design/scripts/measure.py` against the Cycles hero:

| | luma | sat | R/B |
|---|---|---|---|
| Cycles `polished/hero.png` | 0.269 | 0.601 | 2.297 |
| web, no gain | 0.250 | 0.630 | 2.518 |
| web, `GAIN = 1.15,1.15,1.28` | 0.268 | 0.597 | 2.290 |

What the bake cannot show: reflections that change as you move (glossy is baked
as seen head-on) and the renders' screen-space vignette and glow.

## Checks

```sh
P=/tmp/t16-pw-venv/bin/python        # any Python with Playwright
$P web/tools/flow_test.py OUT/       # the whole visit with real clicks: knock → couch → TV → desk → PC → diploma → pinboard
$P web/tools/shoot.py --query view=hero --out hero.png
$P web/tools/app_shot.py apps/tv/ tv.png --click .person
```

`flow_test.py` fails if any step ends somewhere unexpected or the console logs
an error, and records a video of the run.
