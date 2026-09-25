"""Stage 1 of the web export: turn room_polished.blend into a bake-ready scene.

Lived-in props and details are added (realism.py), every visible renderable
object becomes a real mesh (modifiers applied, heavy meshes decimated), a real
door and a hallway are built for the intro, the diploma is framed, and objects
are grouped into bake chunks by how their colour is made:

  plain    colour is a constant or the object's own image -> bake light only
  detail   colour comes from a node recipe -> bake light + a colour atlas
  special  translucent, metal, cut-out leaves or odd shaders -> bake everything together
  glass    clear glass -> not baked; the browser draws a faint reflective pane
  outside  the city through the window -> bake everything, low resolution
  door     moves, so it gets its own small chunk

Output: design/export/web_prep.blend + web/tools/prep_report.json.

  Blender --background --python web/tools/prep_web.py
"""
import bpy, bmesh, json, math, sys, time
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'design/blender/room_polished.blend'
OUT = ROOT / 'design/export/web_prep.blend'
REPORT = Path(__file__).with_name('prep_report.json')

TRI_CAP = 20000         # per-object triangle ceiling after decimation
TRI_PER_SQRT_M2 = 16000 # smaller objects get proportionally fewer: cap = k*sqrt(area)
TRI_FLOOR = 200
PLAIN_CHUNKS = 8        # light-only atlases
DETAIL_CHUNKS = 2       # light + colour atlases
DOOR = ('door_leaf', 'door_panel_0_0', 'door_panel_1_0', 'door_knob')
# Texel weight per collection: the room shell is large and plain, props carry detail.
WEIGHT = {'01_shell': .35, '02_openings': .5, '08_floor': .6}
OUTSIDE_WEIGHT = .08    # the city seen through the window

t0 = time.time()
bpy.ops.wm.open_mainfile(filepath=str(SRC))
sys.path.insert(0, str(Path(__file__).parent))
import realism, books
realism_report = realism.add_realism()
realism_report['books'] = books.add_books()
realism_report['landing'] = realism.add_landing()
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def has_alpha(ma):
    if not ma or not ma.use_nodes:
        return False
    bs = next((n for n in ma.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    return bool(bs and (bs.inputs['Alpha'].is_linked or bs.inputs['Alpha'].default_value < .99))


# ---- 1. bake every visible renderable object into a standalone world-space mesh
src = [o for o in sc.objects if o.type in {'MESH', 'CURVE', 'FONT', 'SURFACE', 'META'}
       and o.visible_get() and not o.hide_render]
col = bpy.data.collections.new('WEB')
sc.collection.children.link(col)
made, tris_before = [], 0
for o in src:
    e = o.evaluated_get(dg)
    try:
        me = bpy.data.meshes.new_from_object(e, preserve_all_data_layers=True, depsgraph=dg)
    except RuntimeError:
        continue
    if not me.polygons:
        bpy.data.meshes.remove(me)
        continue
    me.transform(o.matrix_world)
    tris_before += tri_count(me)
    ob = bpy.data.objects.new('W_' + o.name, me)
    ob['src'] = o.name
    ob['src_cols'] = ','.join(c.name for c in o.users_collection)
    col.objects.link(ob)
    made.append(ob)

# Drop the originals; lights stay for baking.
for o in list(sc.objects):
    if o.type in {'MESH', 'CURVE', 'FONT', 'SURFACE', 'META', 'EMPTY', 'ARMATURE'} and o.name not in col.objects:
        bpy.data.objects.remove(o, do_unlink=True)

# Cycles draws a mesh with no material as plain white clay, but a bake only
# writes where a material points at the target image, so give those the same default.
clay = bpy.data.materials.new('web_default_clay')
clay.use_nodes = True
clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.8, .8, .8, 1)
for ob in made:
    if not ob.data.materials or any(m is None for m in ob.data.materials):
        if not ob.data.materials:
            ob.data.materials.append(clay)
        for i, m in enumerate(ob.data.materials):
            if m is None:
                ob.data.materials[i] = clay

# ---- 2. decimate heavy meshes
for ob in made:
    n = tri_count(ob.data)
    area = sum(p.area for p in ob.data.polygons)
    cap = max(TRI_FLOOR, min(TRI_CAP, TRI_PER_SQRT_M2 * math.sqrt(area)))
    if n > cap:
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = cap / n
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier='dec')
tris_after = sum(tri_count(o.data) for o in made)

# Cycles shades both sides of a face, so a shell modelled inside out looks fine in
# Blender but disappears in the browser (and bakes its light from the inside).
FLIP = {'styled_teapot_lid'}
for ob in made:
    if ob['src'] in FLIP:
        ob.data.flip_normals()

def box(name, lo, hi, color, strength=0.0, rough=.8, cols='hallway', mat=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector([lo[i] + (v.co[i] + .5) * (hi[i] - lo[i]) for i in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ma = mat
    if ma is None:
        ma = bpy.data.materials.new(name)
        ma.use_nodes = True
        bs = ma.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value = (*color, 1)
        bs.inputs['Roughness'].default_value = rough
        if strength:
            bs.inputs['Emission Color'].default_value = (*color, 1)
            bs.inputs['Emission Strength'].default_value = strength
    me.materials.append(ma)
    ob = bpy.data.objects.new(name, me)
    ob['src'] = name
    ob['src_cols'] = cols
    col.objects.link(ob)
    made.append(ob)
    return ob

# ---- 3. Mazen's door (design/assets/door, "Door with Doorframe"), closed in its frame
# The model is 2.6 m tall and the room 2.3 m, so it is scaled uniformly to a
# normal 2.04 m door, and the doorway walls are rebuilt around its opening.
# The page swings the leaf DOOR_OPEN_DEG into the room around its hinge.
DOOR_OPEN_DEG = 72.0
DOOR_GLB = ROOT / 'design/assets/door/source/Door with Doorframe.glb'
DOOR_SCALE = 0.805
DOOR_CX, WALL_Y0, WALL_Y1 = 2.90, 5.20, 5.32
LEAF = {'Door', 'Door plank', 'Plane', 'Plane.001', 'Plane.002', 'Plane.003', 'Circle.003'}
OLD_DOORWAY = ('door_leaf', 'door_panel', 'door_knob', 'door_arch', 'door_lining', 'wall_door_')
wall_ma = next((o.data.materials[0] for o in made if o['src'] == 'wall_door_a' and o.data.materials), None)
for o in [o for o in made if o['src'].startswith(OLD_DOORWAY)]:
    made.remove(o)
    bpy.data.objects.remove(o, do_unlink=True)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(DOOR_GLB))
new = [o for o in bpy.data.objects if o not in before]
place = Matrix.Translation((DOOR_CX, (WALL_Y0 + WALL_Y1) / 2, 0)) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(DOOR_SCALE, 4)
bpy.context.view_layer.update()
leaf_pts = []
for o in new:
    if o.type != 'MESH':
        continue
    me = o.data.copy()
    me.transform(place @ o.matrix_world)
    ob = bpy.data.objects.new('W_door_' + o.name.replace(' ', '_'), me)
    ob['src'] = 'door_' + o.name
    ob['src_cols'] = 'door'
    col.objects.link(ob)
    made.append(ob)
    if o.name in LEAF:
        ob['door'] = True
        leaf_pts += [v.co.copy() for v in me.vertices]
for o in new:
    bpy.data.objects.remove(o, do_unlink=True)
lo = Vector([min(v[i] for v in leaf_pts) for i in range(3)])
hi = Vector([max(v[i] for v in leaf_pts) for i in range(3)])
# The handle sits on the low-x side after the turn, so the hinge is the high-x edge,
# on the room-side face so the leaf swings into the room without cutting the frame.
door_leaf = [o for o in made if o.get('door') and o['src'] in ('door_Door', 'door_Door plank')]
leaf_lo = Vector([min((v.co[i] for o in door_leaf for v in o.data.vertices)) for i in range(3)])
leaf_hi = Vector([max((v.co[i] for o in door_leaf for v in o.data.vertices)) for i in range(3)])
hinge = Vector((leaf_hi.x, leaf_lo.y, 0))
opening = (leaf_lo.x, leaf_hi.x, leaf_hi.z)
# Rebuild the doorway walls around the opening, in the wall's own plaster.
if wall_ma is None:
    wall_ma = bpy.data.materials.new('plaster_door_wall')
for name, lo_, hi_ in (('wall_door_left', (0.0, WALL_Y0, 0.0), (opening[0], WALL_Y1, 2.30)),
                       ('wall_door_right', (opening[1], WALL_Y0, 0.0), (3.40, WALL_Y1, 2.30)),
                       ('wall_door_top', (opening[0], WALL_Y0, opening[2]), (opening[1], WALL_Y1, 2.30))):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector([lo_[i] + (v.co[i] + .5) * (hi_[i] - lo_[i]) for i in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(wall_ma)
    ob = bpy.data.objects.new('W_' + name, me)
    ob['src'], ob['src_cols'] = name, '01_shell'
    col.objects.link(ob)
    made.append(ob)
open_angle = math.radians(DOOR_OPEN_DEG)

# ---- 4. the diploma on the certificate wall (x = 3.40 m, facing the room)
def framed(name, image, y, z, width):
    im = bpy.data.images.load(str(image))
    h = width * im.size[1] / im.size[0]
    wall, mat_b, fr = 3.40, .06, .025
    box(name + '_frame', (wall - .03, y - width / 2 - mat_b - fr, z - h / 2 - mat_b - fr),
        (wall, y + width / 2 + mat_b + fr, z + h / 2 + mat_b + fr), (.09, .055, .035), rough=.4, cols='certificates')
    box(name + '_mat', (wall - .033, y - width / 2 - mat_b, z - h / 2 - mat_b),
        (wall - .03, y + width / 2 + mat_b, z + h / 2 + mat_b), (.86, .82, .74), rough=.9, cols='certificates')
    bm = bmesh.new()
    x = wall - .034
    vs = [bm.verts.new(v) for v in ((x, y + width / 2, z - h / 2), (x, y - width / 2, z - h / 2),
                                    (x, y - width / 2, z + h / 2), (x, y + width / 2, z + h / 2))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):   # seen from the room, +u runs toward -y
        loop[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if me.polygons[0].normal.x > 0:
        me.flip_normals()
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    nt = ma.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = im
    bs = nt.nodes['Principled BSDF']
    nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = .7
    me.materials.append(ma)
    ob = bpy.data.objects.new(name, me)
    ob['src'], ob['src_cols'] = name, 'certificates'
    col.objects.link(ob)
    made.append(ob)

framed('cert_bsc', ROOT / 'design/assets/certificates/bsc_datascience_ai_2026.png', y=1.04, z=1.48, width=.50)

# ---- 5. the landing outside the door (seen during the knock intro)
# Not a corridor: the door sits in one long wall of a wide, taller landing, with
# paintings on either side under warm picture lights. Everything here is its own
# light-map chunk ('hall'), so it never takes texture space from the room.
plaster = (.55, .47, .38)
HX0, HX1, HY1, HZ = -3.2, 8.6, 9.2, 2.9           # landing extent (x, back wall y) and ceiling height
FRAME_X = (2.438, 3.362)                           # the door frame; the skirting stops at it
# One continuous plaster face over the whole landing wall, 1 cm proud of the room's
# wall, with the doorway cut out: everything seen here is one surface in one light
# map, so no seam shows where the room's own wall would meet the landing's.
HY0 = WALL_Y1 + .01
box('hall_wall_w', (HX0, WALL_Y1, 0), (FRAME_X[0], HY0, HZ), plaster, mat=wall_ma)
box('hall_wall_e', (FRAME_X[1], WALL_Y1, 0), (HX1, HY0, HZ), plaster, mat=wall_ma)
box('hall_wall_over', (FRAME_X[0], WALL_Y1, 2.099), (FRAME_X[1], HY0, HZ), plaster, mat=wall_ma)
box('hall_floor', (HX0, HY0, -.02), (HX1, HY1, 0), (.13, .075, .04), rough=.5)
box('hall_ceiling', (HX0, HY0, HZ), (HX1, HY1, HZ + .02), (.62, .56, .48))
box('hall_wall_back', (HX0, HY1, 0), (HX1, HY1 + .02, HZ), plaster, mat=wall_ma)
box('hall_end_w', (HX0 - .02, HY0, 0), (HX0, HY1, HZ), plaster, mat=wall_ma)
box('hall_end_e', (HX1, HY0, 0), (HX1 + .02, HY1, HZ), plaster, mat=wall_ma)
for k, (x0, x1) in enumerate(((HX0, FRAME_X[0]), (FRAME_X[1], HX1))):
    box(f'hall_skirting_{k}', (x0, HY0, 0), (x1, HY0 + .015, .11), (.78, .74, .68), rough=.5)
box('hall_runner', (2.45, 5.45, 0), (3.35, 8.4, .006), (.30, .08, .05))


def hall_painting(name, image, cx, cz, width):
    """A framed canvas on the landing wall, facing the hall (+y), with a brass picture light."""
    im = bpy.data.images.load(str(image))
    h = width * im.size[1] / im.size[0]
    y, fr, d = HY0, .045, .035
    box(name + '_frame', (cx - width / 2 - fr, y, cz - h / 2 - fr), (cx + width / 2 + fr, y + d, cz + h / 2 + fr),
        (.07, .045, .03), rough=.35)
    bm = bmesh.new()
    yy = y + d + .002
    vs = [bm.verts.new(v) for v in ((cx - width / 2, yy, cz - h / 2), (cx + width / 2, yy, cz - h / 2),
                                    (cx + width / 2, yy, cz + h / 2), (cx - width / 2, yy, cz + h / 2))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for loop, uv in zip(f.loops, ((1, 0), (0, 0), (0, 1), (1, 1))):   # seen from the hall, +u runs toward -x
        loop[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if me.polygons[0].normal.y < 0:
        me.flip_normals()
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    nt = ma.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = im
    bs = nt.nodes['Principled BSDF']
    nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = .6
    me.materials.append(ma)
    ob = bpy.data.objects.new(name, me)
    ob['src'], ob['src_cols'] = name, 'hallway'
    col.objects.link(ob)
    made.append(ob)
    # the picture light: a brass bar over the frame, and the spot it throws down the canvas
    top = cz + h / 2 + fr
    box(name + '_lamp', (cx - .16, y + .02, top + .07), (cx + .16, y + .10, top + .11), (.55, .38, .16), rough=.3)
    L = bpy.data.lights.new(name + '_spot', 'SPOT')
    L.energy, L.color, L.spot_size, L.spot_blend, L.shadow_soft_size = 60, (1, .80, .56), math.radians(95), .8, .05
    lo = bpy.data.objects.new(name + '_spot', L)
    lo.location = (cx, y + .16, top + .08)
    lo.rotation_euler = (math.radians(-28), 0, 0)            # points down, tipped toward the wall (-y)
    sc.collection.objects.link(lo)


P = ROOT / 'design/assets/paintings'
for name, file, cx, width in (
        ('art_milkmaid', 'Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.jpg', -1.35, .62),
        ('art_wave', 'Tsunami_by_hokusai_19th_century.jpg', .15, .95),
        ('art_starry', 'Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg', 1.55, .88),
        ('art_wheat', 'Vincent_van_Gogh_-_Wheat_Field_with_Cypresses_-_Google_Art_Project.jpg', 4.25, .88),
        ('art_wanderer', 'Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg', 5.6, .58),
        ('art_lilies', 'Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg', 6.95, .78)):
    hall_painting(name, P / file, cx, 1.55, width)
# soft ceiling light over where you stand, so the landing reads warm, not dark
for k, (x, y) in enumerate(((2.9, 7.6), (0.2, 7.0), (5.6, 7.0))):
    box(f'hall_downlight_{k}', (x - .07, y - .07, HZ - .01), (x + .07, y + .07, HZ), (1, .82, .6), strength=4)
    L = bpy.data.lights.new(f'hall_light_{k}', 'SPOT')
    L.energy, L.color, L.spot_size, L.spot_blend, L.shadow_soft_size = (260 if k == 0 else 182), (1, .78, .52), math.radians(110), 1, .1
    lo = bpy.data.objects.new(f'hall_light_{k}', L)
    lo.location = (x, y, HZ - .03)
    sc.collection.objects.link(lo)
# a soft wash down the long wall (levels matched to the room's walls in Cycles previews)
L = bpy.data.lights.new('hall_wash', 'AREA')
L.shape, L.size, L.size_y, L.energy, L.color = 'RECTANGLE', 6.0, .4, 350, (1, .8, .58)
lo = bpy.data.objects.new('hall_wash', L)
lo.location, lo.rotation_euler = (2.9, 6.3, 2.82), (math.radians(-40), 0, 0)
sc.collection.objects.link(lo)

# ---- 6. classify and chunk
def colour_kind(ma):
    """How a material makes its colour: constant | image | recipe | special | glass."""
    if not ma or not ma.use_nodes:
        return 'constant'
    nt = ma.node_tree
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    surf = out and out.inputs['Surface'].links and out.inputs['Surface'].links[0].from_node
    if not surf or surf.type != 'BSDF_PRINCIPLED':
        return 'special'
    val = lambda k: surf.inputs[k].default_value
    # Clear glass (picture frames, the clock face) is drawn as a faint pane, not baked,
    # so it can never cover the poster behind it.
    if val('Transmission Weight') > .5 or (not surf.inputs['Alpha'].is_linked and val('Alpha') < .5):
        return 'glass'
    # A metallic *map* is normal on downloaded PBR models and is mostly zero there;
    # only a truly metallic value makes a surface metal.
    if (val('Metallic') > .5 and not surf.inputs['Metallic'].is_linked) or val('Transmission Weight') > .05 \
            or surf.inputs['Alpha'].is_linked or val('Alpha') < .99:
        return 'special'
    bc = surf.inputs['Base Color']
    if not bc.is_linked:
        return 'constant'
    src = bc.links[0].from_node
    if src.type == 'TEX_IMAGE' and src.image:
        vec = src.inputs['Vector']
        if not vec.is_linked or vec.links[0].from_node.type in ('UVMAP', 'TEX_COORD'):
            return 'image'
    return 'recipe'


report = {'objects': len(made), 'tris_before': tris_before, 'tris_after': tris_after,
          'door_open_angle_deg': math.degrees(open_angle), 'door_hinge': [round(v, 4) for v in hinge],
          'doorway': [round(v, 4) for v in opening], 'realism': realism_report,
          'groups': {}, 'chunks': []}
items = []
for ob in made:
    area = sum(p.area for p in ob.data.polygons)
    cols = ob['src_cols']
    w = next((v for k, v in WEIGHT.items() if k in cols), 1.0)
    c = sum((Vector(b) for b in ob.bound_box), Vector()) / 8
    kinds = {colour_kind(s.material) for s in ob.material_slots}
    for s_ in ob.material_slots:
        if s_.material:
            s_.material['web_kind'] = colour_kind(s_.material)
    if ob.get('door'):
        group = 'door'
    elif cols == 'hallway' and not kinds & {'special', 'glass'}:   # (leaves with cut-outs bake as 'special')
        group = 'hall'
    elif c.y < -.2:                    # beyond the window wall: sky and city
        group = 'outside'
    elif kinds == {'glass'}:
        group = 'glass'
    elif 'special' in kinds or 'glass' in kinds:
        group = 'special'
    elif 'recipe' in kinds:
        group = 'detail'
    else:
        group = 'plain'
    ob['group'] = group
    report['groups'][group] = report['groups'].get(group, 0) + 1
    items.append((ob, area * w, c))


def split(group, n, prefix):
    """Equal-weight chunks, swept along the room so each chunk stays compact."""
    rows = sorted([i for i in items if i[0]['group'] == group], key=lambda i: (round(i[2].y * 2), i[2].x))
    total = sum(i[1] for i in rows) or 1
    k, acc = 0, 0.0
    for ob, wa, _ in rows:
        if acc > total * (k + 1) / n and k < n - 1:
            k += 1
        ob['chunk'] = f'{prefix}{k}'
        acc += wa


split('plain', PLAIN_CHUNKS, 'p')
split('detail', DETAIL_CHUNKS, 'd')
for ob, _, _ in items:
    if ob['group'] in ('special', 'outside', 'door', 'glass', 'hall'):
        ob['chunk'] = ob['group']

for name in sorted({o['chunk'] for o in made}):
    obs = [o for o in made if o['chunk'] == name]
    report['chunks'].append({'name': name, 'group': obs[0]['group'], 'objects': len(obs),
                             'tris': sum(tri_count(o.data) for o in obs),
                             'area_m2': round(sum(p.area for o in obs for p in o.data.polygons), 2)})

report['seconds'] = round(time.time() - t0, 1)
REPORT.write_text(json.dumps(report, indent=1))
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=False)
print('PREP DONE', json.dumps({k: v for k, v in report.items() if k != 'realism'}))
