"""Lived-in details for the web room, added to the scene copy by prep_web.py.

Photoscanned CC0 props from Poly Haven (design/assets/realism/, see SOURCES.json)
are placed where a person would leave them and dropped onto whatever is below
them with a downward ray, so everything rests on a real surface. Things no asset
library has but every real room does (curtains, a light switch, outlets, cables)
are modelled here. Returns a report of placements and any overlaps.

Positions are Blender cm: x toward the TV wall (340), y from the window (0) to
the door (520), z up.
"""
import bpy, bmesh, glob, math
from pathlib import Path
from mathutils import Vector, Matrix

ASSETS = Path(__file__).resolve().parents[2] / 'design/assets/realism'
cm = lambda *v: Vector(v) / 100

# name, parts to keep (None = all), position (x, y) cm or (x, y, z) to skip the drop,
# rotation about z (deg; the models face -y), extra tilt, where it sits
PROPS = [
    ('alarm_clock_01', None, (214, 40), 180 + 20, None, 'nightstand, angled toward the bed'),
    ('round_spectacles', None, (193, 45), 180 - 35, None, 'nightstand, folded by the lamp'),
    ('Ukulele_01', None, (168, 17, 0), 180, ('x', -14), 'leaning on the window wall between desk and nightstand'),
    ('wicker_basket_02', ['wicker_basket_02_base'], (252, 212), 12, None, 'on the floor at the foot of the bed'),
    ('office_notepads', ['office_notepads_yellow_pad'], (150, 62), 180 + 8, None, 'yellow pad on the desk'),
    ('office_notepads', ['office_notepads_sticky_stack'], (133, 30), 180 - 12, None, 'sticky notes by the PC'),
    ('stationery_supplies', ['stationery_supplies_pencilcup'], (40, 51), 0, None, 'pencil cup on the desk, by the reference books'),
    ('stationery_supplies', ['stationery_supplies_pen_blue'], (146, 62), 180 + 30, None, 'a pen on the pad'),
    ('wall_clock', None, (1.2, 462, 168), 90, None, 'couch wall, between the poster and the door'),
]


def import_prop(name, keep):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glob.glob(str(ASSETS / name / '*.gltf'))[0])
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == 'MESH' and keep and o.name.split('.')[0] not in keep]:
        new.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in new if o.type == 'MESH']
    root = bpy.data.objects.new('real_' + name + ('_' + keep[0].split('_')[-1] if keep else ''), None)
    bpy.context.scene.collection.objects.link(root)
    bpy.context.view_layer.update()
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = mw
    for o in [o for o in new if o.type != 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    # recentre on the footprint, base at z = 0
    bpy.context.view_layer.update()
    lo, hi = bounds(meshes)
    for o in meshes:
        o.matrix_world = Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))) @ o.matrix_world
    root['meshes'] = [o.name for o in meshes]
    return root, meshes


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def surface_below(x, y, half, ignore, start):
    """Highest surface under the footprint (5 rays cast down from `start` m), in metres."""
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for dx, dy in ((0, 0), (half.x, half.y), (-half.x, half.y), (half.x, -half.y), (-half.x, -half.y)):
        o = Vector((x + dx * .8, y + dy * .8, start))
        hit, loc, _n, _i, ob, _m = bpy.context.scene.ray_cast(dg, o, Vector((0, 0, -1)))
        while hit and ob in ignore:
            hit, loc, _n, _i, ob, _m = bpy.context.scene.ray_cast(dg, loc - Vector((0, 0, 1e-4)), Vector((0, 0, -1)))
        zs.append(loc.z if hit else 0.0)
    return max(zs)


def material(name, color, rough=.6, metal=0.0, sheen=0.0, translucent=0.0):
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    nt = ma.node_tree
    bs = nt.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Sheen Weight'].default_value = sheen
    if translucent:
        # Curtains let the window light through: mix in a translucent lobe.
        tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
        tr.inputs['Color'].default_value = (*color, 1)
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = translucent
        out = nt.nodes['Material Output']
        nt.links.new(bs.outputs['BSDF'], mix.inputs[1])
        nt.links.new(tr.outputs['BSDF'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return ma


def mesh_object(name, bm, ma, col):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(ma)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def curtain(name, x0, x1, z_top, z_bot, y_wall, ma, col, gathered):
    """A hanging linen panel with soft vertical folds, fuller where it is gathered."""
    bm = bmesh.new()
    nx, nz = 64, 28
    width = x1 - x0
    folds = 7 if gathered else 5
    grid = []
    for j in range(nz + 1):
        z = z_top + (z_bot - z_top) * j / nz
        row = []
        for i in range(nx + 1):
            u = i / nx
            # deeper folds lower down, a gentle hem sway, a little randomness
            amp = (0.022 if gathered else 0.016) * (0.8 + 0.4 * j / nz)
            y = y_wall + 0.05 + amp * math.sin(u * folds * 2 * math.pi + 0.7 * math.sin(j * 0.35)) + 0.004 * math.sin(u * 23 + j)
            row.append(bm.verts.new((x0 + width * u, y, z)))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object(name, bm, ma, col)
    sol = ob.modifiers.new('thickness', 'SOLIDIFY')
    sol.thickness = 0.004
    return ob


def box(name, lo, hi, ma, col, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector([lo[i] + (v.co[i] + .5) * (hi[i] - lo[i]) for i in range(3)])
    ob = mesh_object(name, bm, ma, col)
    if bevel:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 3
    return ob


def cable(name, points, radius, ma, col):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.materials.append(ma)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    return ob


def add_realism():
    sc = bpy.context.scene
    col = bpy.data.collections.new('18_realism')
    sc.collection.children.link(col)
    report = {'props': [], 'overlaps': []}

    for name, keep, pos, rot, tilt, where in PROPS:
        root, meshes = import_prop(name, keep)
        for o in meshes:
            for c in o.users_collection:
                c.objects.unlink(o)
            col.objects.link(o)
        root.rotation_euler.z = math.radians(rot)
        if tilt:
            setattr(root.rotation_euler, tilt[0], math.radians(tilt[1]))
        root.location = (0, 0, -5)          # out of the way while we look for a surface
        bpy.context.view_layer.update()
        lo, hi = bounds(meshes)
        half = (hi - lo) / 2
        x, y = pos[0] / 100, pos[1] / 100
        # Cast from just above the furniture it should rest on (never from the ceiling).
        start = 1.55 if 'bookshelf' in where else 0.95
        z = pos[2] / 100 if len(pos) > 2 else surface_below(x, y, half, set(meshes), start)
        root.location = (x, y, z)
        bpy.context.view_layer.update()
        lo, hi = bounds(meshes)
        if len(pos) == 2:                   # settle exactly onto the surface
            root.location.z += z - lo.z
            bpy.context.view_layer.update()
            lo, hi = bounds(meshes)
        report['props'].append({'name': root.name, 'where': where, 'min_cm': [round(v * 100, 1) for v in lo],
                                'max_cm': [round(v * 100, 1) for v in hi]})

    # ---- modelled: curtains on a rod, light switch, outlets, cables
    linen = material('real_linen_curtain', (.80, .74, .64), rough=.92, sheen=.4, translucent=.35)
    brass = material('real_brass', (.72, .52, .26), rough=.32, metal=1.0)
    plastic = material('real_switch_plastic', (.86, .84, .80), rough=.45)
    rubber = material('real_cable', (.05, .05, .05), rough=.55)
    rod_y = 0.075
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=.011, radius2=.011, depth=1.62)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(1.70, rod_y, 2.06))
    mesh_object('real_curtain_rod', bm, brass, col)
    for sx in (0.89, 2.51):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=.022)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(sx, rod_y, 2.06))
        mesh_object('real_rod_finial', bm, brass, col)
    curtain('real_curtain_left', 0.93, 1.31, 2.04, 0.99, 0.0, linen, col, True)
    curtain('real_curtain_right', 2.09, 2.47, 2.04, 0.99, 0.0, linen, col, True)

    # light switch beside the door (door wall faces -y at y = 5.20)
    box('real_switch_plate', cm(232, 519, 104), cm(240, 520, 116), plastic, col, bevel=.002)
    box('real_switch_toggle', cm(235, 518.2, 108.5), cm(237, 519, 111.5), plastic, col, bevel=.001)
    # outlets: TV wall behind the stand, couch wall by the floor lamp
    for name, lo, hi in (('real_outlet_tv', cm(339, 349, 24), cm(340, 357, 36)),
                         ('real_outlet_couch', cm(0, 424, 24), cm(1, 432, 36))):
        box(name, lo, hi, plastic, col, bevel=.002)
    cable('real_cable_tv', [cm(334, 318, 40), cm(337, 332, 12), cm(338.6, 346, 1), cm(339.2, 353, 28)], .003, rubber, col)
    cable('real_cable_lamp', [cm(52, 440, 1), cm(20, 436, 0.4), cm(4, 430, 0.4), cm(0.8, 428, 28)], .003, rubber, col)

    # ---- overlap check: every prop against every other visible mesh (bounding boxes, 1 cm tolerance)
    bpy.context.view_layer.update()
    added = set(col.objects)
    others = [o for o in sc.objects if o.type == 'MESH' and o.visible_get() and o not in added]
    boxes = [(o.name, *bounds([o])) for o in others]
    for p in report['props']:
        plo, phi = Vector(p['min_cm']) / 100, Vector(p['max_cm']) / 100
        for n, lo, hi in boxes:
            ov = [min(phi[i], hi[i]) - max(plo[i], lo[i]) for i in range(3)]
            if min(ov) > 0.01 and 'plank' not in n and not n.startswith(('floor', 'wall', 'rug')):
                report['overlaps'].append([p['name'], n, [round(v * 100, 1) for v in ov]])
    return report


# The landing outside the door (prep_web.py builds its walls and paintings):
# a bench under a painting and two plants, so it reads as a lived-in home.
LANDING = [
    ('painted_wooden_bench', (4.25, 5.62), 180, 'under the wheat-field painting, against the wall'),
    ('potted_plant_02', (5.35, 5.62), 30, 'past the bench, framing the view on the left'),
    ('potted_plant_01', (0.78, 5.62), 0, 'past the starry night, framing the view on the right'),
]


def add_landing():
    """Floor props on the landing, in the 'hallway' collection (its own light-map chunk)."""
    sc = bpy.context.scene
    col = bpy.data.collections.new('hallway')
    sc.collection.children.link(col)
    report = []
    for name, (x, y), rot, where in LANDING:
        root, meshes = import_prop(name, None)
        for o in meshes:
            for c in o.users_collection:
                c.objects.unlink(o)
            col.objects.link(o)
        root.rotation_euler.z = math.radians(rot)
        root.location = (x, y, 0)
        bpy.context.view_layer.update()
        lo, hi = bounds(meshes)
        if lo.y < 5.345:                    # keep it off the wall and its skirting
            root.location.y += 5.345 - lo.y
            bpy.context.view_layer.update()
            lo, hi = bounds(meshes)
        report.append({'name': root.name, 'where': where, 'min_cm': [round(v * 100, 1) for v in lo],
                       'max_cm': [round(v * 100, 1) for v in hi]})
    return report
