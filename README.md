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

## How it works: two rooms, one for each kind of device

A tiny check in the page's head (`src/tour/index.html`) picks, before anything big
downloads:

- **live**: the real-time 3D room in `engine/` (three.js, Cycles-baked light), sharp
  at any resolution, flying freely. Every device whose graphics can hold it gets it,
  phones and tablets included, in one of two sizes:
  - *full* (computers): every texture at full size once you're in (1.2 GB of
    graphics memory when all is in);
  - *compact* (phones, tablets, basic Intel graphics, 4 GB of memory or less):
    textures of at most 512 px and half-size light maps (280 MB).

  Both start from the same small model (textures at most 256 px, quarter-size light
  maps: 6.9 MB over the wire, all asked for by the page's head at once) and stream the
  sharper pictures in while you knock, the landing first. Before the door opens the
  room is warmed up behind it: shaders compiled, textures on the GPU, and one frame of
  the room timed off screen, so the way in starts at the render size this GPU holds.
- **tour**: the same room as pictures, rendered in advance by the engine: a panorama
  at every place and a short video for every flight (AV1 where the hardware decodes
  it, else H.264; 720p on phones and slow lines), shown by ~44 KB of plain WebGL 1
  (`src/tour/`). For slow lines (Save-Data, 2G/3G, under 5 Mbps), old or low-end GPUs
  (software, Mali-G5x and older, Adreno 5xx and older, PowerVR, Intel HD before 2015)
  and browsers without WebGL 2. Flights you can take are fetched as soon as you
  arrive; if one isn't ready, the view dissolves there at once.

The live room hands over to the tour, at the same place and still knocking, when:
the line turns out slow (the head counts the bytes of the first files: if after 2.5 s
the rest would take over 10 s more, the tour is a fifth of the download); the GPU can't
draw the room at 20 frames a second even at the smallest size (timed before the door
opens, and watched while flying); or the browser killed the page last time (a phone out
of memory: the head notices the page died without leaving). The last two are remembered.

Files come from jsDelivr pinned to a commit; if the CDN hasn't answered in 1.5 s (a
cold CDN cache once took 13 s) or fails, the same file is asked of GitHub Pages too
and the first answer wins (`ROOM_GET` in the page's head).

On a phone (touch, and a small screen either way up) the hand-drawn arrows are drawn
at phone size, with one light shadow, and fewer at a time: the seats (couch, desk, bed,
diploma) from the room, and the TV, the computer and the pinboard from their own seat.
An arrow at the edge of the view stays until its object is well out of it, so looking
around with a finger doesn't make arrows blink. Computers and tablets keep the full-size
arrows and every one of them.

On Android, Chrome re-draws each screen's page at every new size while the camera moves
(the pages are mapped onto the screens behind the canvas), and the screens lagged and
flickered from across the room (Galaxy S21, S23 Ultra). There, each screen shows a still
of its page instead (`tools/screen_stills.py`, 1024 x 1024, in `public/screens/`), drawn
by WebGL behind the glass and blended exactly as the browser blends the live page; the
live page takes over once you zoom in on a screen. Both rooms do this; `?pictures` shows
it on any device and `?pictures=0` turns it off. `tools/build.mjs` warns when the pages
changed after their stills.

Measured in Chrome for Android (`tools/android_probe.py`, the Android emulator shaped like a
Galaxy S21): with the live pages, Chrome logged *"tile memory limits exceeded, some content
may not draw"* 148 times arriving in the room, 87 times while a finger looked around and 119
times on the couch, and its screenshots show the TV and computer black and arrows missing;
with the stills, 2, 0 and 0, everything drawn. (The emulator draws in software, so its frame
rates aren't a phone's; `&stay` keeps the live room there anyway.)

`?mode=live` or `?mode=tour` forces one. In both, the live pages (TV, PC,
pinboard) are mapped onto their screens with one projective CSS matrix each, which
every browser draws (Safari won't draw three.js-style CSS3D scenes).

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
cd web && node tools/pack.mjs                                            # slim_room + meshopt + WebP (full, phone and first sizes) + manifest
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

### The live room: in within the knock

Measured with `tools/perf_probe.py --gzip --mode live` (files served compressed, as
GitHub Pages does; M4 Pro, 1440x900 at 2x). *Extra wait* is how much longer than one
knock, the door and the way in (5.6 s) the visitor stood at the door; "after reading"
is `--read 2.5`, knocking once the title card has been read.

| | before | now |
|---|---:|---:|
| first model, over the wire (brotli) | 7.7 MB | **5.7 MB** |
| triangles | 919k | **591k** |
| 20 Mbps, knock at once: extra wait | 2.9 s | **1.5 s** |
| 20 Mbps, after reading | 0 s | **0 s** |
| fast 4G 9 Mbps, knock at once | 8.3 s | **4.2 s** |
| fast 4G 9 Mbps, after reading | 4.8 s | **1.7 s** (the footsteps) |
| phone (844x390 at 3x, CPU 4x slower, 9 Mbps, after reading) | 4.9 s | **2.0 s** |
| graphics memory when all is in: computer / phone | 1.26 GB / (tour) | **1.2 GB / 280 MB** |

On a line under 5 Mbps the visit goes to the pictures (slow 4G 1.6 Mbps: in the room
at 12.9 s, 1.4 MB, where the live room would take about 35 s). What changed:

- **A lighter model, closer to Blender's.** `tools/slim_room.mjs` (run by `pack.mjs`)
  drops what the shader never reads (vertex colours, and texture UVs on untextured
  surfaces) and simplifies each surface only as far as can't be seen from the closest
  any camera gets to it (every frame of every flight in `tools/moves.json`: 0.0003 rad,
  half a pixel on a Retina laptop), with surfaces locked where two materials meet. Then
  positions are stored at 16 bits instead of 14: at 14 a room-sized chunk's grid is
  0.4-1.3 mm, enough to merge the floppy disks' labels into the disks (they flickered).
  Against the Blender original over 17 views (the engine, grain off): median PSNR
  48.8 dB before, **49.8 dB now**; worst view 43.4 → 45.6 dB. Details that lie on
  another surface (the colour bands on the shelf books, dust jackets, a label, windows on
  the buildings outside, the trim on the wall) are moved just in front of it, 0.5 mm or
  three depth-buffer steps at the closest the camera gets, so they show as Cycles shows
  them instead of flickering with what's under them: `tools/zfight_scan.mjs` finds
  them (55 such pairs in the published model before, none left before compression).
- **Everything asked for at once.** The page's head knows the first files (the script,
  the model, the small light maps, the room's data) and requests them before the
  script runs, instead of one after another as the script found out about them.
- **A backup for a cold CDN** (see above) and a **warm-up behind the door**: shaders,
  textures and the render size are settled while you knock, so the way in never hitches.
- **The door opens the moment the room is there** once the footsteps have been heard,
  instead of after one more round of knocking.

### The pictures (tour)

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
$P web/tools/perf_probe.py [--net home|fast4g|slow4g] [--gzip] [--read 2.5] [--cpu 6] [--swiftshader] [--mobile] [--mode live|tour] [--page engine/index.html]
$P web/tools/flow_test.py OUT/ --mobile                     # the same visit on a phone held sideways: taps and the Back button
node web/tools/zfight_scan.mjs web/public/room.glb          # surfaces lying on each other (flicker), with the one on top
$P web/tools/screen_stills.py                               # the screens' stills for Android: after changing content or an app
$P web/tools/android_probe.py --query 'mode=live&stay'      # Chrome for Android on the emulator: tile memory, frames, a screen recording
$P web/tools/texture_needs.py        # the engine: how big each texture needs to be (before export_web.py)
$P web/tools/calibrate_look.py       # refit the grade after a rebake
$P web/tools/sharpness.py REF.png WEB.png   # detail vs a Cycles close-up
```

`flow_test.py` fails if any step ends somewhere unexpected or the console logs
an error, and records a video of the run.
