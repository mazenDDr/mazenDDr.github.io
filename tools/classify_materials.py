"""How is each material's colour made? Decides which surfaces can keep their own
textures in the browser and which need their colour baked.

  Blender --background design/export/web_prep.blend --python web/tools/classify_materials.py
"""
import bpy, json, collections
from pathlib import Path


def kind(ma):
    if not ma or not ma.use_nodes:
        return 'constant', None
    out = next((n for n in ma.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    surf = out and out.inputs['Surface'].links and out.inputs['Surface'].links[0].from_node
    if not surf or surf.type != 'BSDF_PRINCIPLED':
        return 'complex-shader', surf.type if surf else None
    bc = surf.inputs['Base Color']
    if not bc.is_linked:
        return 'constant', None
    src = bc.links[0].from_node
    if src.type == 'TEX_IMAGE' and src.image:
        vec = src.inputs['Vector']
        simple_uv = not vec.is_linked or vec.links[0].from_node.type in ('UVMAP', 'TEX_COORD')
        return ('image' if simple_uv else 'image-mapped'), src.image.size[0]
    return 'complex-color', src.type


area = collections.Counter(); objs = collections.Counter(); examples = collections.defaultdict(list)
for ob in bpy.data.collections['WEB'].objects:
    if ob.type != 'MESH':
        continue
    me = ob.data
    per = collections.Counter()
    for p in me.polygons:
        per[p.material_index] += p.area
    for i, a in per.items():
        ma = me.materials[i] if i < len(me.materials) else None
        k, info = kind(ma)
        if ob.get('outside'):
            k = 'outside:' + k
        area[k] += a; objs[k] += 1
        if len(examples[k]) < 8:
            examples[k].append(f'{ma.name if ma else None} ({info})')
tot = sum(v for k, v in area.items() if not k.startswith('outside'))
for k, v in area.most_common():
    print(f'CLS {k:<22} {v:8.1f} m2  {100 * v / tot if not k.startswith("outside") else 0:5.1f}%  slots={objs[k]:5d}  e.g. {examples[k][:5]}')
