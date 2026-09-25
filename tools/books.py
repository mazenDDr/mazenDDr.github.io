"""Mazen's books on the couch-wall shelves, built from real covers.

Replaces the generic books there (books_a, the Fluent Python face-out and the
blank O'Reilly spines) with his own: nine standing spine-out on the lower shelf,
with Hands-On Machine Learning face-out where Fluent Python stood and Designing
Data-Intensive Applications face-out beside the row. Real sizes from
design/assets/books/tex/books.json (make_book_textures.py).

Blender cm: the couch wall is x = 0, shelves run along y, spines face +x.
"""
import bpy, bmesh, json, math
from pathlib import Path
from mathutils import Vector, Matrix

TEX = Path(__file__).resolve().parents[2] / 'design/assets/books/tex'
REMOVE_ROOTS = ('books_a_root', 'Fluent_Python_display', 'Fluent_Python_display_body')
REMOVE_PREFIX = ('oreilly_upper_',)
LOWER_Z, UPPER_Z = 1.384, 1.784        # shelf tops (m)
SPINE_X = 0.21                         # spines line up near the shelf's front edge
FACE_OUT = {'hands-on-ml': (LOWER_Z, 3.40), 'ddia2': (LOWER_Z, 2.61)}   # shelf, centre y (m)


def image_material(name, path):
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    nt = ma.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(str(path), check_existing=True)
    bs = nt.nodes['Principled BSDF']
    nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = .45       # laminated covers have a soft sheen
    return ma


def plain_material(name, rgb, rough=.8):
    ma = bpy.data.materials.new(name)
    ma.use_nodes = True
    bs = ma.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Roughness'].default_value = rough
    return ma


def make_book(b, pages_ma, col):
    """A book in local space: spine on the +x face at x = 0, fore-edge at x = -w,
    thickness along +y (front cover on +y), height along +z."""
    w, h, t = b['w_cm'] / 100, b['h_cm'] / 100, b['thick_cm'] / 100
    cover = image_material(f"book_cover_{b['id']}", TEX / f"{b['id']}_cover.jpg")
    spine = image_material(f"book_spine_{b['id']}", TEX / f"{b['id']}_spine.png")
    back = plain_material(f"book_back_{b['id']}", (0.72, 0.70, 0.66), .6)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    v = {}
    for sx, x in (('s', 0.0), ('f', -w)):
        for sy, y in (('b', 0.0), ('c', t)):
            for sz, z in (('d', 0.0), ('u', h)):
                v[sx + sy + sz] = bm.verts.new((x, y, z))

    def face(keys, mat, uvs):
        f = bm.faces.new([v[k] for k in keys])
        f.material_index = mat
        for loop, co in zip(f.loops, uvs):
            loop[uv].uv = co
    # 0 spine (+x): u along +y, v along +z
    face(('sbd', 'scd', 'scu', 'sbu'), 0, ((0, 0), (1, 0), (1, 1), (0, 1)))
    # 1 front cover (+y): spine on the left, so u runs from x = 0 to x = -w
    face(('scd', 'fcd', 'fcu', 'scu'), 1, ((0, 0), (1, 0), (1, 1), (0, 1)))
    # 2 back (-y), 3 page edges: top, bottom, fore-edge
    face(('fbd', 'sbd', 'sbu', 'fbu'), 2, ((0, 0), (1, 0), (1, 1), (0, 1)))
    face(('sbu', 'scu', 'fcu', 'fbu'), 3, ((0, 0), (1, 0), (1, 1), (0, 1)))
    face(('sbd', 'fbd', 'fcd', 'scd'), 3, ((0, 0), (1, 0), (1, 1), (0, 1)))
    face(('fbd', 'fbu', 'fcu', 'fcd'), 3, ((0, 0), (1, 0), (1, 1), (0, 1)))
    me = bpy.data.meshes.new('book_' + b['id'])
    bm.to_mesh(me)
    bm.free()
    for m in (spine, cover, back, pages_ma):
        me.materials.append(m)
    ob = bpy.data.objects.new('book_' + b['id'], me)
    col.objects.link(ob)
    bev = ob.modifiers.new('rounded', 'BEVEL')     # soft board edges
    bev.width, bev.segments = .0015, 2
    return ob


def add_books():
    sc = bpy.context.scene
    removed = []
    for o in list(sc.objects):
        root = o
        while root.parent:
            root = root.parent
        if root.name in REMOVE_ROOTS or root.name.startswith(REMOVE_PREFIX):
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    col = bpy.data.collections.new('19_mazen_books')
    sc.collection.children.link(col)
    pages = plain_material('book_pages', (0.93, 0.90, 0.82), .9)
    books = json.loads((TEX / 'books.json').read_text())
    y = 2.21
    placed = []
    for b in books:
        ob = make_book(b, pages, col)
        if b['id'] in FACE_OUT:
            z, cy = FACE_OUT[b['id']]
            # Cover facing the room, leaning back 9 degrees against the wall.
            # After the turn the book spans x 0..thickness and y 0..width; lean its top to the wall.
            ob.matrix_world = (Matrix.Translation((0.04, cy - b['w_cm'] / 200, z))
                               @ Matrix.Rotation(math.radians(-9), 4, 'Y') @ Matrix.Rotation(math.radians(-90), 4, 'Z'))
        else:
            ob.matrix_world = Matrix.Translation((SPINE_X, y, LOWER_Z))
            y += b['thick_cm'] / 100 + 0.0015
        placed.append(ob.name)
    # A dark metal bookend holding the row upright.
    bm = bmesh.new()
    for lo, hi in (((0.03, 0.0, 0.0), (0.2, 0.004, 0.16)), ((0.03, -0.09, 0.0), (0.2, 0.0, 0.003))):
        r = bmesh.ops.create_cube(bm, size=1)['verts']
        for vv in r:
            vv.co = Vector([lo[i] + (vv.co[i] + .5) * (hi[i] - lo[i]) for i in range(3)])
    me = bpy.data.meshes.new('bookend')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(plain_material('bookend_iron', (0.05, 0.05, 0.05), .5))
    end = bpy.data.objects.new('bookend', me)
    end.location = (0, y + 0.004, LOWER_Z)
    col.objects.link(end)
    return {'removed': len(removed), 'books': placed, 'row_ends_y_cm': round(y * 100, 1)}
