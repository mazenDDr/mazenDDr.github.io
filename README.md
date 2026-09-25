# Mazen's Room: the portfolio site

**Live: https://mazenddr.github.io/**

A first-person visit to Mazen's room, in the spirit of *Life is Strange*.
You knock (the room downloads while you knock), the door opens, and the camera
swoops in. Click where to go and it flies there like a drone: the couch, the
desk, the bed or the certificate wall. The TV, the computer and the pinboard are
live pages on the screens, visible from anywhere in the room, with a CRT glare on
the tubes. Click the console under the TV to swap Mazenflix for the arcade.

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
| `apps/pc/` | **MazenOS**, the computer, styled on Mac OS 8/9 Platinum: windows, project READMEs, terminal |
| `apps/games/` | **Mazen Arcade** on the TV (click the console): Pong, Snake, Breakout |
| `apps/memo/` | The pinboard: how I work, skills, the diploma, projects, contact |
| `content/portfolio.json` | **Everything the screens show.** Edit this to change the site |
| `content/github/` | The READMEs the project numbers were copied from |
| `public/room.glb`, `public/bake/` | The room model and its baked lighting (generated) |
| `public/anchors.json` | Measured screen/door/wall positions (generated) |
| `tools/` | The export pipeline and the browser checks |

## Changing the content

Edit `content/portfolio.json` and reload. Projects appear on the TV, the PC and
(the first three) the pinboard. Numbers in it come from each repo's README; when
a repo changes, update both.

A new certificate: add its image to `content/certificates/` and an entry under
`certificates`. It shows on the TV and PC straight away. To hang it on the wall
in 3D, add a `framed(...)` line in `tools/prep_web.py` and rebuild the room.

## Rebuilding the room from Blender

The room is `design/blender/room_polished.blend`. As in a game engine, colour
and light are kept apart so the browser stays sharp and fast:

- every surface keeps its **own colour**: a constant, its original texture
  (books, posters, figurines…), or, for node-recipe materials, a baked colour atlas;
- **light** is baked once in Cycles into light maps (smooth, so they can be small)
  and stored log-encoded in 8-bit WebP with a measured range per chunk;
- the page multiplies the two (`src/room.js`) and then applies the scene's own
  look (`src/post.js`): Blender's lift/gamma/gain, saturation, vignette and glow,
  then AgX at the scene's exposure.

Five stages, all from the repo root:

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python-exit-code 1 --python web/tools/prep_web.py     # ~11 min: props, meshes, door, hallway, diploma, chunks
$B --background --python-exit-code 1 --python web/tools/bake_web.py -- --samples 256   # ~45 min on an M4 Pro
$B --background --python-exit-code 1 --python web/tools/export_web.py   # the GLB + material manifest
$B --background design/blender/room_polished.blend --python web/tools/anchors.py
cd web && node tools/pack.mjs                                            # meshopt + WebP + manifest
```

`prep_web.py` also adds the lived-in details from `tools/realism.py`: CC0 props
from Poly Haven (alarm clock, glasses, ukulele, basket, notepads, pencil cup, wall
clock; sources in `design/assets/realism/SOURCES.json`), dropped onto real
surfaces with a downward ray and checked for overlaps, plus modelled curtains,
a light switch, outlets and cables. `tools/books.py` shelves the books with real
covers and spines made by `tools/make_book_textures.py` (covers from Open
Library and Google Books, in `design/assets/books/`), and the door is the
downloaded *Door with Doorframe* model in `design/assets/door/`.

Third-party assets: Mac OS 9 style icons (`apps/pc/icons/`, MIT, licence file
alongside) and the Chicago-style bitmap fonts from system.css (`apps/pc/fonts/`, MIT).

`bake_web.py` is resumable (`--force` redoes chunks, `--encode-only` re-encodes the
saved EXRs in seconds). Every chunk's light-map layout is checked: an island packer
that collapses (it happened on three chunks) falls back to smart-project's own layout.

**Colour match.** `tools/calibrate_look.py` fits the web-only grade controls
(exposure, white balance, saturation, shadow lift) to the Cycles hero render:

| | luma | sat | R/B | p05 | p95 | contrast | dark% |
|---|---|---|---|---|---|---|---|
| Cycles `polished/hero.png` | 0.269 | 0.601 | 2.297 | 0.053 | 0.533 | 0.480 | 0.382 |
| web | 0.272 | 0.609 | 2.253 | 0.048 | 0.523 | 0.475 | 0.368 |

## Motion

Moving is a drone flight (`src/director.js`): the camera lifts to 1.75 m, flies
straight to the next spot (routing around the tall wardrobe), banks a little
into turns, widens its field of view with speed, and lands. Looking around is a
critically damped spring, so hovering a hotspot eases the view to a stop instead
of freezing it. Entering from the door is a whoosh from a narrow to a wide field
of view. Measured with `tools/motion_probe.py`:

| | first walk (head bob) | now (drone) |
|---|---:|---:|
| vertical reversals per second | 2.64 | 0.85 |
| top speed | – | 2.4 m/s |
| acceleration, 99th percentile | 7.1 m/s² | 6.7 m/s² |
| turn rate, 99th percentile | 532 °/s | 142 °/s |
| turn acceleration, 99th percentile | 8,261 °/s² | 1,141 °/s² |

## Checks

```sh
P=/tmp/t16-pw-venv/bin/python        # any Python with Playwright
$P web/tools/flow_test.py OUT/ [--url https://mazenddr.github.io/]   # the whole visit with real clicks: knock → couch → TV → arcade → desk → PC → diploma → pinboard
$P web/tools/shoot.py --query view=hero --out hero.png
$P web/tools/app_shot.py apps/tv/ tv.png --click .person
$P web/tools/motion_probe.py         # smoothness of the camera
$P web/tools/calibrate_look.py       # refit the grade after a rebake
$P web/tools/sharpness.py REF.png WEB.png   # detail vs a Cycles close-up
```

`flow_test.py` fails if any step ends somewhere unexpected or the console logs
an error, and records a video of the run.
