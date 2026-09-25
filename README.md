# Mazen's Room: the portfolio site

**Live: https://mazenddr.github.io/**

A first-person visit to Mazen's room, in the spirit of *Life is Strange*.
You stand on a landing with paintings on the wall and knock (the room downloads
while you knock); the door opens and the camera swoops in. Click where to go and
it flies there like a drone: the couch, the desk, the bed or the certificate wall.
The TV, the computer and the pinboard are live pages, shown inside the tubes'
curved glass. Click the console under the TV to swap Mazenflix for the arcade.

```
cd web && python3 -m http.server 8765      # then open http://localhost:8765
```

Deep links: `?place=couch|tv|desk|pc|bed|memo|certificates`, `?skip` (no knock).

## How it works: pictures, not a 3D engine in your browser

A visitor never walks freely: they stand at a few places, look around a little,
and fly between them. So the room is **rendered in advance**, the way Matterport
tours, Street View and Apple's product pages work:

- **a panorama at every place**: a cube of pictures around the eye, turned to face
  the default view (no back face: you never look there), at 1024/2048 px per face
  and a 4096-px front for large high-DPI screens;
- **a short video for every flight** between places (the same drone moves as the
  real-time version, 60 fps), in AV1 for devices that decode it in hardware and
  H.264 for everything else, at 1080p and 720p;
- the **live pages** show through holes left in the pictures where the screens are,
  each mapped onto its screen with one projective CSS matrix; the tube's glass
  (rim darkening, reflections, dimming from across the room) is drawn over them.

The browser only shows pictures and plays videos (`src/tour/`: ~42 KB of script,
plain WebGL 1, no libraries), so it runs on anything and never works a GPU hard.
The pictures and videos are made by the real-time engine in `engine/` (the baked
Cycles lighting of `design/blender/`), at full quality with no frame budget.

## What's where

| Path | What it is |
|---|---|
| `index.html` (built), `src/tour/` | The site: panoramas, flights, hotspots, the knock intro, the live screens |
| `engine/` | The real-time room (three.js, baked light): renders the tour's pictures and videos |
| `engine/src/places.js` | Where you can go and what you look at there (positions in Blender cm) |
| `public/tour/` | The panoramas, flights and script, named by content hash (generated) |
| `apps/tv/` | **Mazenflix**, the TV: profiles, billboard, rows, detail pages |
| `apps/pc/` | **MazenOS**, the computer, styled on Mac OS 8/9 Platinum: windows, project READMEs, terminal |
| `apps/games/` | **Mazen Arcade** on the TV (click the console): Pong, Snake, Breakout |
| `apps/memo/` | The pinboard: how I work, skills, the diploma, projects, contact |
| `content/portfolio.json` | **Everything the screens show.** Edit this to change the site |
| `content/github/` | The READMEs the project numbers were copied from |
| `public/room.glb`, `public/bake/` | The room model and its baked lighting, for the engine (generated) |
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

The engine's room in five stages, all from the repo root (a new prep always gets a
fresh bake; `bake_web.py` only resumes a bake of the current prep):

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python-exit-code 1 --python web/tools/prep_web.py     # ~11 min: props, meshes, door, hallway, diploma, chunks
$B --background --python-exit-code 1 --python web/tools/bake_web.py -- --samples 256   # ~45 min on an M4 Pro
$B --background --python-exit-code 1 --python web/tools/export_web.py   # the GLB + material manifest (texture sizes from tools/texture_needs.json)
$B --background design/blender/room_polished.blend --python web/tools/anchors.py
cd web && node tools/pack.mjs                                            # meshopt + WebP + manifest
```

Then the tour, from `web/` (about 10 minutes):

```sh
P=/tmp/t16-pw-venv/bin/python
$P tools/record_moves.py    # every flight, frame by frame, from the engine's own camera code -> tools/moves.json
$P tools/capture.py         # panoramas (PNG) and flights (lossless master videos), rendered by the engine
node tools/encode.mjs       # AVIF/WebP faces and AV1/H.264 videos, named by hash -> public/tour/
node tools/build.mjs        # bundle + minify, inline CSS and data, preload tags -> index.html, sw.js
```

`prep_web.py` also adds the lived-in details from `tools/realism.py`: CC0 props
from Poly Haven (alarm clock, glasses, ukulele, basket, notepads, pencil cup, wall
clock; sources in `design/assets/realism/SOURCES.json`), dropped onto real
surfaces with a downward ray and checked for overlaps, plus modelled curtains,
a light switch, outlets and cables. `tools/books.py` shelves the books with real
covers and spines made by `tools/make_book_textures.py` (covers from Open
Library and Google Books, in `design/assets/books/`), and the door is the
downloaded *Door with Doorframe* model in `design/assets/door/`.

The landing outside the door is built in `prep_web.py` too: one long wall in the
room's own plaster with six public-domain paintings under brass picture lights
(`design/assets/paintings/SOURCES.md`), a bench and two plants from Poly Haven
(`realism.add_landing()`), all in their own `hall` light-map chunk.

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

Moving is a drone flight (`engine/src/director.js`, recorded frame by frame for the tour): the camera lifts to 1.75 m, flies
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

## Speed on any machine

Measured with `tools/perf_probe.py`: the page is opened, the visitor knocks at once,
enters the room and flies to the desk. "Old" is the previous real-time version (now
`engine/index.html`), measured the same way.

**Laptop** (M4 Pro, 1440x900 at 2x, fast 4G 9 Mbps):

| | old | now |
|---|---:|---:|
| first picture | 0.62 s | **0.33 s** |
| the page answers (knock works) | 3.48 s | **0.49 s** |
| standing in the room (after about 8 s of knocking, footsteps and the door) | 38.2 s | **10.8 s** |
| downloaded by then | 33.6 MB | **2.1 MB** |
| GPU time per frame | 11.2 ms | **1.5 ms** |

**Phone** (844x390 at 3x, CPU 4x slower, fast 4G): the page answers in 0.54 s (old
3.51 s), in the room at 10.9 s (old 40.4 s), 2.0 MB (old 33.6 MB), 60 fps flights.

**A weak machine** (software GPU, CPU 6x slower, slow 4G 1.6 Mbps, 1280x720):

| | old | now |
|---|---:|---:|
| the page answers | 14.1 s | **2.0 s** |
| standing in the room | 215 s | **17.3 s** |
| downloaded by then | 33.6 MB | **1.0 MB** |
| frame rate while flying | 5.5 fps | **59.4 fps** |
| time per frame | 256 ms | **3.6 ms** |

What makes it fast:

- **Nothing heavy to run**: pictures and hardware-decoded video; the whole GPU
  job is drawing five textured squares, and only when the view changes (a still
  view draws nothing; the loop stops until the pointer moves).
- **Only what this screen needs, in the order it's needed**: a 256-px strip of
  the place first (a few KB), then sharper faces, sized to the screen; AVIF where
  supported (WebP otherwise); AV1 only where the hardware decodes it
  (`navigator.mediaCapabilities`: `powerEfficient`); 720p video and no
  prefetching on Save-Data or 2G/3G.
- **The wait is hidden**: loading starts before the first knock; the knocking
  lasts until the room is ready.
- **The next move is already there**: after arriving, the flights you can take
  from here are fetched in the background; pointing at an arrow fetches its
  flight first. Flights are played from memory, so they never stall.
- **One round trip to start**: CSS and the tour's data are inlined in the page,
  fonts are self-hosted, the first pictures and the script are preloaded.
- **Cached forever**: every file is named by its content hash; a service worker
  keeps them, so a second visit loads from disk.
- **Video quality by measurement**: VMAF (Netflix's perceptual metric) against
  the lossless master on the way-in flight: H.264 CRF 20 scores 96.0 at 2.5 MB,
  AV1 CRF 36 scores 96.1 at 1.15 MB (visually identical is about 95).
- **Screens that sleep**: the pages pause their endless animations and swap their
  animated key art for stills when you're not looking at them.
- **Works everywhere**: WebGL 1, ES2019 script, no CSS 3D context (Safari won't
  draw three.js-style CSS3D scenes: the pages are mapped with one flat matrix each);
  without WebGL at all the page offers the screens as plain pages.

## Checks

```sh
P=/tmp/t16-pw-venv/bin/python        # any Python with Playwright
$P web/tools/flow_test.py OUT/ [--url https://mazenddr.github.io/]   # the whole visit with real clicks: knock → couch → TV → arcade → desk → PC → diploma → pinboard
$P web/tools/shoot.py --query view=hero --out hero.png      # the engine, at the Blender hero camera
$P web/tools/app_shot.py apps/tv/ tv.png --click .person
$P web/tools/motion_probe.py         # smoothness of the camera
$P web/tools/perf_probe.py [--net fast4g|slow4g] [--cpu 6] [--swiftshader] [--mobile] [--page engine/index.html]
$P web/tools/texture_needs.py        # the engine: how big each texture needs to be (before export_web.py)
$P web/tools/calibrate_look.py       # refit the grade after a rebake
$P web/tools/sharpness.py REF.png WEB.png   # detail vs a Cycles close-up
```

`flow_test.py` fails if any step ends somewhere unexpected or the console logs
an error, and records a video of the run.
