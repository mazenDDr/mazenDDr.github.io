"""Stage 2 of the web export: bake the room's light into atlases, one set per chunk.

Colour and light are kept apart, as in a game engine, so fine printed detail
(book spines, posters, figurines) keeps its own full-resolution textures and the
atlases only have to hold light, which is smooth:

  plain / door    light only: diffuse direct + indirect, no colour ("irradiance")
  detail          light only, plus a colour atlas for node-recipe materials
  special         everything together (translucent shades, metal, cut-out leaves)
  outside         everything together, low resolution

Each chunk is joined into one mesh with a fresh non-overlapping 'bake' UV layout
(small objects and printed art get extra texels). Light is denoised (OIDN, guided
by normals) and stored log-encoded in 8-bit PNGs with its measured range, so the
browser can decode it back to linear light and grade it exactly like Blender.
Raw EXRs are kept in design/export/lightmaps. Resumable: finished chunks skip.

  Blender --background --python web/tools/bake_web.py -- [--chunks p0,d1] [--samples 256] [--force]
  Blender --background --python web/tools/bake_web.py -- --encode-only   # re-encode saved EXRs
"""
import bpy, sys, json, time, argparse
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREP = ROOT / 'design/export/web_prep.blend'
BAKED = ROOT / 'design/export/web_baked.blend'
RAW = ROOT / 'design/export/lightmaps'
WEB = ROOT / 'web/public/bake'
LOG = Path(__file__).with_name('bake_report.json')
NO_BAKE = {'W_win_glass'}   # transparent in the browser
RES = {'plain': 2048, 'detail': 4096, 'special': 2048, 'outside': 1024, 'door': 1024, 'hall': 2048}
DETAIL = ('poster', 'art', 'book', 'spine', 'cover', 'title', 'frame', 'figure', 'collectible')

ap = argparse.ArgumentParser()
ap.add_argument('--chunks', default='')
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--force', action='store_true')
ap.add_argument('--encode-only', action='store_true', help='re-denoise and re-encode saved EXRs without baking')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

RAW.mkdir(parents=True, exist_ok=True)
WEB.mkdir(parents=True, exist_ok=True)
# Resume only a bake of the current prep: after prep_web.py runs again, the old
# web_baked.blend holds the previous scene and must not be picked up.
resume = BAKED.exists() and BAKED.stat().st_mtime > PREP.stat().st_mtime
bpy.ops.wm.open_mainfile(filepath=str(BAKED if resume else PREP))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'GPU'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = True
cy.use_denoising = False
bk = sc.render.bake
bk.margin = 8
bk.margin_type = 'EXTEND'

report = json.loads(LOG.read_text()) if LOG.exists() and resume else {}
col = bpy.data.collections['WEB']
names = sorted({o['chunk'] for o in col.objects if 'chunk' in o})
todo = [n for n in names if n != 'glass' and (not args.chunks or n in args.chunks.split(','))]


def join_chunk(name):
    """Join a chunk's objects into one mesh named B_<chunk> (idempotent)."""
    ob = bpy.data.objects.get('B_' + name)
    if ob:
        return ob
    parts = [o for o in col.objects if o.get('chunk') == name and o.name not in NO_BAKE]
    group = parts[0]['group']
    for o in parts:
        o.data = o.data.copy() if o.data.users > 1 else o.data
        # Small things and printed art get more texels than their size alone
        # would earn: x1 for a wall, up to x3 for a book spine.
        area = sum(p.area for p in o.data.polygons) or 1e-6
        f = min(3.0, max(1.0, (0.5 / area) ** 0.25))
        if any(k in (o['src'] + ' ' + ' '.join(m.name for m in o.data.materials if m)).lower() for k in DETAIL):
            f = min(3.0, f * 1.8)
        a = o.data.attributes.new('texel', 'FLOAT', 'FACE')
        a.data.foreach_set('value', [f] * len(o.data.polygons))
        # Keep each object's own texture UVs under one name, so they survive the join.
        if o.data.uv_layers:
            o.data.uv_layers[0].name = 'UVMap'
        else:
            o.data.uv_layers.new(name='UVMap')
    with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts, selected_objects=parts):
        bpy.ops.object.join()
    ob = parts[0]
    ob.name = 'B_' + name
    ob['chunk'] = name
    ob['group'] = group
    me = ob.data
    for uv in [u for u in me.uv_layers if u.name != 'UVMap']:
        me.uv_layers.remove(uv)
    me.uv_layers.new(name='bake')
    unwrap(ob)
    return ob


def uv_area(ob):
    """Total area the faces cover in the bake layout (0 means the unwrap did nothing)."""
    me = ob.data
    co = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers['bake'].data.foreach_get('uv', co)
    co = co.reshape(-1, 2)
    start = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_start', start)
    total = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', total)
    area = 0.0
    for n in np.unique(total):              # shoelace per polygon size
        idx = start[total == n][:, None] + np.arange(n)
        x, y = co[idx, 0], co[idx, 1]
        area += np.abs((x * np.roll(y, -1, 1) - y * np.roll(x, -1, 1)).sum(1)).sum() / 2
    return area


def unwrap(ob):
    """Smart-project the bake layout, weight islands by 'texel', then pack. Faces
    hidden in a source object are skipped by the unwrap, so reveal everything
    first, and check the layout really covers area (one chunk once came out empty)."""
    me = ob.data
    me.uv_layers.active = me.uv_layers['bake']
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = ob.data
    uvl = me.uv_layers['bake']  # handles go stale across edit-mode switches
    tex = np.empty(len(me.polygons), np.float32)
    me.attributes['texel'].data.foreach_get('value', tex)
    sizes = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', sizes)
    co = np.empty(len(me.loops) * 2, np.float32)
    uvl.data.foreach_get('uv', co)
    co = (co.reshape(-1, 2) * np.repeat(tex, sizes)[:, None]).ravel()
    uvl.data.foreach_set('uv', co)
    try:
        pack(ob)
    except RuntimeError as e:
        print(e, flush=True)
    area = weighted = uv_area(ob)
    keep = None
    if area < 0.3:
        co = np.empty(len(me.loops) * 2, np.float32)
        ob.data.uv_layers['bake'].data.foreach_get('uv', co)
        keep = co
    if area < 0.3:
        # The island packer can collapse a chunk (one odd island wrecks its scaling:
        # 0.72 -> 0.00002 on one chunk). Fall back to smart-project's own packing,
        # which is sound, at uniform detail.
        print('unwrap', ob.name, f'weighted pack covers only {area:.4f}; trying smart-project layout', flush=True)
        # Thousands of tiny islands (thread curves) make margins expensive: measured
        # coverage 0.76 with none, 0.30 at 0.001, 0.07 at 0.003. Use a hair-thin one.
        for margin in (0.0003, 0.0):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin, area_weight=0.0, scale_to_bounds=True)
            bpy.ops.object.mode_set(mode='OBJECT')
            area = uv_area(ob)
            if area > 0.4:
                break
        if keep is not None and weighted > area:        # the weighted layout was better after all
            ob.data.uv_layers['bake'].data.foreach_set('uv', keep)
            area = weighted
    if area < 0.05:
        raise RuntimeError(f'{ob.name}: bake layout covers only {area:.4f} of the atlas')
    print('unwrap', ob.name, f'covers {area:.2f} of the atlas', flush=True)


def uv_bounds(ob):
    co = np.empty(len(ob.data.loops) * 2, np.float32)
    ob.data.uv_layers['bake'].data.foreach_get('uv', co)
    co = co.reshape(-1, 2)
    return co.min(), co.max()


def pack(ob):
    """Pack the bake islands into 0..1. The concave packer can give up silently on
    chunks with very many islands (it left one at 0..2.04, which baked black), so
    check the result and fall back to box packing."""
    bpy.context.view_layer.objects.active = ob
    for shape in ('CONCAVE', 'AABB'):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.003, shape_method=shape)
        bpy.ops.object.mode_set(mode='OBJECT')
        lo, hi = uv_bounds(ob)
        if lo >= -1e-4 and hi <= 1 + 1e-4:
            return
        if lo >= -1e-4 and hi <= 1.05:
            # A sliver over the edge: shrink the whole layout to fit (costs ~1% of texels).
            uvl = ob.data.uv_layers['bake']
            co = np.empty(len(ob.data.loops) * 2, np.float32)
            uvl.data.foreach_get('uv', co)
            uvl.data.foreach_set('uv', co / hi)
            print('pack', shape, f'overflow {hi:.4f}, scaled to fit', flush=True)
            return
        print('pack', shape, 'left islands outside 0..1:', lo, hi, flush=True)
    raise RuntimeError(f'{ob.name}: bake islands do not fit 0..1 ({lo}, {hi})')


def target(name, res):
    img = bpy.data.images.get(name)
    if img and tuple(img.size) != (res, res):
        bpy.data.images.remove(img)
        img = None
    return img or bpy.data.images.new(name, res, res, float_buffer=True, alpha=False)


def aim(ob, img):
    """Every material on the chunk targets the same image, as the active node."""
    for slot in ob.material_slots:
        ma = slot.material
        if not ma:
            continue
        nt = ma.node_tree
        n = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake__'
        n.image = img
        nt.nodes.active = n


def save_exr(img, path):
    img.filepath_raw = str(path)
    img.file_format = 'OPEN_EXR'
    img.save()


def bake_into(ob, name, res, samples, **kw):
    img = target(name, res)
    aim(ob, img)
    cy.samples = samples
    bpy.ops.object.bake(use_clear=True, margin=8, **kw)
    return img


def denoise(name, res):
    """OIDN through the compositor, guided by the normal bake; returns float pixels (H, W, 3)."""
    tree = bpy.data.node_groups.new('denoise', 'CompositorNodeTree')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    src = tree.nodes.new('CompositorNodeImage')
    src.image = bpy.data.images.load(str(RAW / f'{name}.exr'), check_existing=False)
    nrm = tree.nodes.new('CompositorNodeImage')
    nrm.image = bpy.data.images.load(str(RAW / f'{name}_normal.exr'), check_existing=False)
    dn = tree.nodes.new('CompositorNodeDenoise')
    outn = tree.nodes.new('NodeGroupOutput')
    tree.links.new(src.outputs['Image'], dn.inputs['Image'])
    tree.links.new(nrm.outputs['Image'], dn.inputs['Normal'])
    tree.links.new(dn.outputs['Image'], outn.inputs[0])
    keep_tree, keep_vt = sc.compositing_node_group, sc.view_settings.view_transform
    r = sc.render
    keep = (r.resolution_x, r.resolution_y, r.resolution_percentage)
    sc.compositing_node_group = tree
    r.resolution_x = r.resolution_y = res
    r.resolution_percentage = 100
    r.image_settings.file_format = 'OPEN_EXR'
    r.image_settings.color_depth = '32'
    sc.view_settings.view_transform = 'Standard'
    out = RAW / f'{name}_dn.exr'
    r.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    sc.compositing_node_group, sc.view_settings.view_transform = keep_tree, keep_vt
    r.resolution_x, r.resolution_y, r.resolution_percentage = keep
    for n in (src, nrm):
        bpy.data.images.remove(n.image)
    bpy.data.node_groups.remove(tree)
    im = bpy.data.images.load(str(out), check_existing=False)
    px = np.empty(res * res * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(res, res, 4)[..., :3]


def write_png(rgb01, path):
    """8-bit PNG written exactly as given (no colour management)."""
    h, w, _ = rgb01.shape
    im = bpy.data.images.new('__png__', w, h, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([np.clip(rgb01, 0, 1), np.ones((h, w, 1), np.float32)], axis=2)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = str(path)
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def encode_light(name, res):
    """Linear light -> log2 in [lo, hi] -> 8 bits. The range is measured, not guessed."""
    px = denoise(name, res)
    peak = px.max(axis=2)
    lum = np.log2(peak[peak > 1e-7])            # surfaces only; empty atlas space is exactly black
    lo, hi = np.percentile(lum, 0.5) - 0.3, np.percentile(lum, 99.95) + 0.3
    lo = max(lo, hi - 16)                       # at most 16 stops -> ~6% per step before dithering
    enc = (np.log2(np.maximum(px, 2.0 ** lo)) - lo) / (hi - lo)
    write_png(enc, WEB / f'{name}.png')
    return [round(float(lo), 4), round(float(hi), 4)]


def encode_albedo(name, res):
    img = bpy.data.images.load(str(RAW / f'{name}_albedo.exr'), check_existing=False)
    px = np.empty(res * res * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    lin = np.clip(px.reshape(res, res, 4)[..., :3], 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    write_png(srgb, WEB / f'{name}_albedo.png')


def bake(name):
    ob = join_chunk(name)
    if uv_area(ob) < 0.3:                # joined by an earlier run with a failed or poor layout
        unwrap(ob)
    group = ob['group']
    res = RES[group]
    ob.data.uv_layers.active = ob.data.uv_layers['bake']
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    t = time.time()
    if group in ('special', 'outside'):
        bk.use_pass_direct = bk.use_pass_indirect = True
        bk.use_pass_diffuse = bk.use_pass_glossy = bk.use_pass_emit = bk.use_pass_transmission = True
        img = bake_into(ob, 'bake_' + name, res, args.samples, type='COMBINED')
    else:
        img = bake_into(ob, 'bake_' + name, res, args.samples, type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    save_exr(img, RAW / f'{name}.exr')
    secs = round(time.time() - t, 1)
    g = bake_into(ob, 'bake_' + name + '_normal', res, 4, type='NORMAL', normal_space='OBJECT')
    save_exr(g, RAW / f'{name}_normal.exr')
    if group == 'detail':
        g = bake_into(ob, 'bake_' + name + '_albedo', res, 16, type='DIFFUSE', pass_filter={'COLOR'})
        save_exr(g, RAW / f'{name}_albedo.exr')
        encode_albedo(name, res)
    rng = encode_light(name, res)
    report[name] = {'group': group, 'res': res, 'samples': args.samples, 'seconds': secs, 'range': rng,
                    'albedo': group == 'detail', 'tris': sum(len(p.vertices) - 2 for p in ob.data.polygons)}
    LOG.write_text(json.dumps(report, indent=1))
    print('BAKED', name, report[name], flush=True)


if args.encode_only:
    for name in todo:
        ob = bpy.data.objects['B_' + name]
        res = RES[ob['group']]
        report[name]['range'] = encode_light(name, res)
        if ob['group'] == 'detail':
            encode_albedo(name, res)
        LOG.write_text(json.dumps(report, indent=1))
        print('ENCODED', name, report[name]['range'], flush=True)
    todo = []
for name in todo:
    if name in report and not args.force and (WEB / f'{name}.png').exists():
        print('skip', name)
        continue
    bake(name)
    bpy.ops.wm.save_as_mainfile(filepath=str(BAKED), compress=False)
print('BAKE DONE', flush=True)
