"""Stage 2 of the web export: bake the room's lighting into one atlas per chunk.

Each chunk is joined into one mesh, given a fresh non-overlapping 'bake' UV
layout, and baked with Cycles (diffuse direct + indirect + colour, emission and
transmission; no glossy, since reflections depend on where you stand). The raw
linear bake is kept as EXR; the web copy is written through the scene's view
transform so it matches the Cycles renders. Resumable: finished chunks skip.

  Blender --background --python web/tools/bake_web.py -- --chunks c1 --res 2048 --samples 64
"""
import bpy, os, sys, json, time, argparse
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREP = ROOT / 'design/export/web_prep.blend'
BAKED = ROOT / 'design/export/web_baked.blend'
RAW = ROOT / 'design/export/lightmaps'
WEB = ROOT / 'web/public/bake'
LOG = Path(__file__).with_name('bake_report.json')
NO_BAKE = {'W_win_glass'}   # transparent in the browser
GAIN = '1.15,1.15,1.28'     # linear r,g,b gain before the grade; measured to match the Cycles hero

ap = argparse.ArgumentParser()
ap.add_argument('--chunks', default='')
ap.add_argument('--res', type=int, default=4096)
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--force', action='store_true')
ap.add_argument('--png-only', action='store_true', help='re-grade existing EXRs without baking')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

RAW.mkdir(parents=True, exist_ok=True)
WEB.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BAKED if BAKED.exists() else PREP))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'GPU'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = True
cy.samples = args.samples
cy.use_denoising = False
bk = sc.render.bake
bk.margin = 8
bk.margin_type = 'EXTEND'
bk.use_pass_direct = bk.use_pass_indirect = True
bk.use_pass_diffuse = bk.use_pass_emit = bk.use_pass_transmission = True
bk.use_pass_glossy = True  # metals have no diffuse; a head-on reflection beats black

report = json.loads(LOG.read_text()) if LOG.exists() else {}
col = bpy.data.collections['WEB']
names = sorted({o['chunk'] for o in col.objects if 'chunk' in o})
todo = [n for n in names if (not args.chunks or n in args.chunks.split(','))]
RES = {'outside': 2048, 'door': 1024, 'c6': 2048, 'c7': 2048}  # c6/c7: bare walls and ceiling
DETAIL = ('poster', 'art', 'book', 'spine', 'cover', 'title', 'frame', 'figure', 'collectible')


def join_chunk(name):
    """Join a chunk's objects into one mesh named B_<chunk> (idempotent)."""
    ob = bpy.data.objects.get('B_' + name)
    if ob:
        return ob
    parts = [o for o in col.objects if o.get('chunk') == name and o.name not in NO_BAKE]
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
    with bpy.context.temp_override(active_object=parts[0], selected_editable_objects=parts, selected_objects=parts):
        bpy.ops.object.join()
    ob = parts[0]
    ob.name = 'B_' + name
    ob['chunk'] = name
    # A fresh layout just for the bake; the object's other UVs stay for textures.
    uv = ob.data.uv_layers.new(name='bake')
    ob.data.uv_layers.active = uv
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode='EDIT')
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
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=0.003, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


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
        ma.use_nodes = True
        nt = ma.node_tree
        n = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake__'
        n.image = img
        nt.nodes.active = n


def save_exr(img, path):
    img.filepath_raw = str(path)
    img.file_format = 'OPEN_EXR'
    img.save()


def graded_png(name):
    """Denoise the raw bake (guided by albedo + normal) and write it through the
    scene's own grade: the compositor's colour balance and saturation, then the
    AgX view transform. The vignette and glow are screen-space, so the browser does those."""
    imgs = {k: bpy.data.images.load(str(RAW / ('%s%s.exr' % (name, k))), check_existing=False)
            for k in ('', '_albedo', '_normal')}
    grade = sc.compositing_node_group
    tree = grade.copy()
    nodes, links = tree.nodes, tree.links
    for n in list(nodes):
        if n.bl_idname in {'CompositorNodeRLayers', 'CompositorNodeEllipseMask', 'CompositorNodeBlur',
                           'ShaderNodeMixRGB', 'CompositorNodeGlare'}:
            nodes.remove(n)
    src = {}
    for k, im in imgs.items():
        n = nodes.new('CompositorNodeImage')
        n.image = im
        src[k] = n
    dn = nodes.new('CompositorNodeDenoise')
    links.new(src[''].outputs['Image'], dn.inputs['Image'])
    links.new(src['_albedo'].outputs['Image'], dn.inputs['Albedo'])
    links.new(src['_normal'].outputs['Image'], dn.inputs['Normal'])
    # Match the web view to the Cycles renders: a per-channel gain in linear light,
    # measured with design/scripts/measure.py (see "Colour match" in web/README.md).
    gain = [float(v) for v in os.environ.get('WEB_GAIN', GAIN).split(',')]
    wb = nodes.new('CompositorNodeColorBalance')
    wb.inputs['Type'].default_value = 'Offset/Power/Slope (ASC-CDL)'   # Blender 5: the mode is a menu socket
    next(i for i in wb.inputs if i.name == 'Slope' and i.bl_idname == 'NodeSocketColor').default_value = (*gain, 1)
    links.new(dn.outputs['Image'], wb.inputs['Image'])
    links.new(wb.outputs['Image'], nodes['Color Balance'].inputs['Image'])
    links.new(nodes['Hue/Saturation/Value'].outputs['Image'], nodes['Group Output'].inputs[0])
    sc.compositing_node_group = tree
    r = sc.render
    keep = (r.resolution_x, r.resolution_y, r.resolution_percentage, r.image_settings.file_format)
    r.resolution_x = r.resolution_y = imgs[''].size[0]
    r.resolution_percentage = 100
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_depth = '8'
    r.filepath = str(WEB / ('%s.png' % name))
    bpy.ops.render.render(write_still=True)
    sc.compositing_node_group = grade
    bpy.data.node_groups.remove(tree)
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.image_settings.file_format = keep
    for im in imgs.values():
        bpy.data.images.remove(im)


def bake(name):
    res = RES.get(name, args.res)
    ob = join_chunk(name)
    ob.data.uv_layers.active = ob.data.uv_layers['bake']
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    t = time.time()
    img = target('bake_' + name, res)
    aim(ob, img)
    bpy.ops.object.bake(type='COMBINED', use_clear=True, margin=8)
    save_exr(img, RAW / ('%s.exr' % name))
    secs = round(time.time() - t, 1)
    # Denoiser guides: surface colour and normal, cheap at a few samples.
    cy.samples = 4
    for kind, kw in (('_albedo', dict(type='DIFFUSE', pass_filter={'COLOR'})), ('_normal', dict(type='NORMAL', normal_space='OBJECT'))):
        g = target('bake_' + name + kind, res)
        aim(ob, g)
        bpy.ops.object.bake(use_clear=True, margin=8, **kw)
        save_exr(g, RAW / ('%s%s.exr' % (name, kind)))
    cy.samples = args.samples
    graded_png(name)
    report[name] = {'res': res, 'samples': args.samples, 'seconds': secs,
                    'tris': sum(len(p.vertices) - 2 for p in ob.data.polygons)}
    LOG.write_text(json.dumps(report, indent=1))
    print('BAKED', name, report[name], flush=True)


if args.png_only:
    for name in todo:
        graded_png(name)
        print('GRADED', name, flush=True)
    todo = []
for name in todo:
    if name in report and not args.force and (WEB / ('%s.png' % name)).exists():
        print('skip', name)
        continue
    bake(name)
    bpy.ops.wm.save_as_mainfile(filepath=str(BAKED), compress=False)
print('BAKE DONE', flush=True)
