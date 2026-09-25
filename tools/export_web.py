"""Stage 3 of the web export: write the baked chunks as one GLB plus a material manifest.

Every chunk mesh keeps two UV sets: TEXCOORD_0 (the objects' own texture UVs)
and TEXCOORD_1 (the light-map layout). Materials are rebuilt as plain exporter-
friendly ones and named '<kind>|<original>', where kind says how the browser
colours the surface:

  constant  a colour                    x light map
  image     the object's own texture    x light map      (full-resolution detail)
  recipe    the chunk's colour atlas    x light map
  special   the baked result as is (chunk groups special / outside)
  cutout    special, but with the texture's alpha for cut-out leaves

Emission (bulbs, screens) is kept as an emissive colour or texture and added on
top. Textures are downscaled to web sizes and embedded as WebP. The door gets its
origin on the hinge so the page can swing it. Clear glass is exported as one mesh.

  Blender --background --python web/tools/export_web.py
  then: node web/tools/pack.mjs
"""
import bpy, json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
BAKED = ROOT / 'design/export/web_baked.blend'
RAW = ROOT / 'web/build/room_raw.glb'
MANIFEST = ROOT / 'web/build/materials.json'
HINGE = Vector(json.loads((Path(__file__).with_name('prep_report.json')).read_text())['door_hinge'])
MAX_TEX = 1024          # most textures; printed art (posters, covers) gets BIG_TEX
BIG_TEX = 2048
ART = ('poster', 'art', 'cover', 'book', 'spine')
# Measured by tools/texture_needs.py: the most texels per UV unit any pixel can show,
# from every place a visitor can be, at 4K. Textures shrink to that (+25%), never grow.
NEEDS_FILE = Path(__file__).with_name('texture_needs.json')
NEEDS = json.loads(NEEDS_FILE.read_text())['needs'] if NEEDS_FILE.exists() else {}

bpy.ops.wm.open_mainfile(filepath=str(BAKED))
sc = bpy.context.scene


def principled(ma):
    if not ma or not ma.use_nodes:
        return None
    out = next((n for n in ma.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    surf = out and out.inputs['Surface'].links and out.inputs['Surface'].links[0].from_node
    return surf if surf and surf.type == 'BSDF_PRINCIPLED' else None


def linked_image(sock):
    if not sock.is_linked:
        return None
    n = sock.links[0].from_node
    return n.image if n.type == 'TEX_IMAGE' and n.image else None


def fit(img, limit):
    """Downscale to the size cap and to what can actually be seen (texture_needs.json)."""
    w, h = img.size
    k = min(1.0, limit / max(w, h))
    need = NEEDS.get(img.name, NEEDS.get(Path(img.name).stem))
    if need is not None:
        k = min(k, max(64, need * 1.25) / min(w, h))
    if k < 1:
        img.scale(max(1, round(w * k)), max(1, round(h * k)))


def rebuild(ma, kind, area):
    """A fresh material holding only what the browser needs; returns its manifest entry."""
    bs = principled(ma)
    entry = {'kind': kind, 'color': [1, 1, 1], 'emissive': [0, 0, 0]}
    new = bpy.data.materials.new(f'{kind}|{ma.name if ma else "none"}')
    new.use_nodes = True
    nt = new.node_tree
    nb = nt.nodes['Principled BSDF']
    img = None
    if bs:
        c = bs.inputs['Base Color']
        if not c.is_linked:
            entry['color'] = [round(v, 5) for v in c.default_value[:3]]
        if kind in ('image', 'cutout'):
            img = linked_image(c)
        e = bs.inputs['Emission Strength'].default_value
        ec = bs.inputs['Emission Color']
        eimg = linked_image(ec)
        if e > 0 and (eimg or any(ec.default_value[:3])):
            entry['emissive'] = [round(v * e, 5) for v in (ec.default_value[:3] if not eimg else (1, 1, 1))]
            if eimg:
                fit(eimg, MAX_TEX)
                t = nt.nodes.new('ShaderNodeTexImage')
                t.image = eimg
                nt.links.new(t.outputs['Color'], nb.inputs['Emission Color'])
                nb.inputs['Emission Strength'].default_value = 1
                entry['emissiveMap'] = True
    if img:
        fit(img, BIG_TEX if any(k in (ma.name if ma else '').lower() for k in ART) else MAX_TEX)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.links.new(t.outputs['Color'], nb.inputs['Base Color'])
        if kind == 'cutout':
            nt.links.new(t.outputs['Alpha'], nb.inputs['Alpha'])
        entry['map'] = True
    nb.inputs['Base Color'].default_value = (*entry['color'], 1)
    return new, entry


manifest = {'materials': {}, 'chunks': {}}
keep = []
cache = {}
for ob in list(sc.objects):
    if not (ob.type == 'MESH' and ob.name.startswith('B_')):
        continue
    me = ob.data
    group = ob['group']
    chunk = ob.name[2:]
    manifest['chunks'][chunk] = group
    # area per material slot, to size textures
    area = [0.0] * max(1, len(me.materials))
    for p in me.polygons:
        area[p.material_index] += p.area
    for i, ma in enumerate(list(me.materials)):
        kind = ma.get('web_kind', 'constant') if ma else 'constant'
        if group in ('special', 'outside'):
            bs = principled(ma)
            kind = 'cutout' if bs and bs.inputs['Alpha'].is_linked else 'special'
        elif kind in ('special', 'glass'):
            kind = 'constant'
        if kind == 'recipe' and group != 'detail':
            kind = 'constant'
        key = (ma.name if ma else None, kind)
        if key not in cache:
            cache[key] = rebuild(ma, kind, area[i])
        new, entry = cache[key]
        me.materials[i] = new
        manifest['materials'][new.name] = entry
    # Drop only the bake's own helper; 'material_index' and friends are attributes too.
    if 'texel' in me.attributes:
        me.attributes.remove(me.attributes['texel'])
    ob.name = chunk
    if chunk == 'door':
        me.transform(Matrix.Translation(-HINGE))
        ob.location = HINGE
    keep.append(ob)

# Clear glass, one mesh, drawn by the browser as a faint pane.
glass = [o for o in sc.objects if o.type == 'MESH' and o.get('chunk') == 'glass' or o.name == 'W_win_glass']
if glass:
    gm = bpy.data.materials.new('glass|pane')
    for o in glass:
        o.data = o.data.copy()
        o.data.materials.clear()
        o.data.materials.append(gm)
    with bpy.context.temp_override(active_object=glass[0], selected_editable_objects=glass, selected_objects=glass):
        bpy.ops.object.join()
    glass[0].name = 'glass'
    keep.append(glass[0])
    manifest['materials']['glass|pane'] = {'kind': 'glass'}

for ob in list(sc.objects):
    if ob not in keep:
        bpy.data.objects.remove(ob, do_unlink=True)

RAW.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(RAW), export_format='GLB', use_selection=False,
                          export_normals=False, export_texcoords=True, export_materials='EXPORT',  # light is baked: no normals needed
                          export_image_format='WEBP', export_image_quality=82,
                          export_apply=False, export_yup=True, export_extras=False, export_cameras=False,
                          export_lights=False)
MANIFEST.write_text(json.dumps(manifest, indent=1))
kinds = {}
for e in manifest['materials'].values():
    kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
print('EXPORTED', RAW, {o.name: len(o.data.polygons) for o in keep}, kinds)
