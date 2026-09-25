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
import realism
realism_report = realism.add_realism()
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

def box(name, lo, hi, color, strength=0.0, rough=.8, cols='hallway'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector([lo[i] + (v.co[i] + .5) * (hi[i] - lo[i]) for i in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
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

# ---- 3. a real door, closed in its frame
# The scene's door was two floating panels and a flat plane, so build one:
# a painted slab with raised panels and brass knobs on both faces, hinged on
# the x=332 side. The page swings it DOOR_OPEN_DEG into the room.
DOOR_OPEN_DEG = 72.0
for o in [o for o in made if o['src'] in DOOR]:
    made.remove(o)
    bpy.data.objects.remove(o, do_unlink=True)
paint, brass = (.72, .64, .53), (.62, .45, .2)
X0, X1, Y0, Y1 = 2.565, 3.315, 5.205, 5.245        # slab: 75 x 4 cm, 2.02 m tall
parts = [box('door_slab', (X0, Y0, 0.005), (X1, Y1, 2.025), paint, rough=.45, cols='door')]
for side, (y0, y1) in (('in', (Y0 - .006, Y0)), ('out', (Y1, Y1 + .006))):
    for i, (z0, z1) in enumerate(((.16, .90), (1.04, 1.88))):
        parts.append(box(f'door_panel_{side}_{i}', (X0 + .09, y0, z0), (X1 - .09, y1, z1), paint, rough=.5, cols='door'))
    yk = (y0 - .045, y0) if side == 'in' else (y1, y1 + .045)
    parts.append(box(f'door_knob_{side}', (X0 + .055, yk[0], 1.0), (X0 + .105, yk[1], 1.05), brass, rough=.3, cols='door'))
for o in parts:
    o['door'] = True
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

# ---- 5. hallway outside the door (seen during the knock intro)
plaster = (.55, .47, .38)
# A 1.14 m corridor that seals against the door wall (x 2.38-3.52) under the room's 2.3 m ceiling.
box('hall_floor', (2.38, 5.32, -.02), (3.52, 7.6, 0), (.16, .09, .05))
box('hall_ceiling', (2.38, 5.32, 2.3), (3.52, 7.6, 2.32), plaster)
box('hall_wall_l', (2.36, 5.32, 0), (2.38, 7.6, 2.3), plaster)
box('hall_wall_r', (3.52, 5.32, 0), (3.54, 7.6, 2.3), plaster)
box('hall_wall_back', (2.38, 7.6, 0), (3.52, 7.62, 2.3), plaster)
box('hall_runner', (2.62, 5.4, 0), (3.28, 7.4, .006), (.28, .07, .05))
box('hall_lamp', (2.84, 5.98, 2.26), (3.04, 6.18, 2.3), (1, .75, .45), strength=3)
lamp = bpy.data.lights.new('hall_light', 'POINT')
lamp.energy = 40
lamp.color = (1, .78, .52)
lamp.shadow_soft_size = .12
lo = bpy.data.objects.new('hall_light', lamp)
lo.location = (2.94, 6.08, 2.18)
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
          'door_open_angle_deg': math.degrees(open_angle), 'realism': realism_report,
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
    if ob['group'] in ('special', 'outside', 'door', 'glass'):
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
