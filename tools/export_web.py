"""Stage 3 of the web export: write the baked chunks as one lean GLB.

Each B_<chunk> mesh keeps only its bake UVs (the browser shows the baked
atlas unlit, so normals and materials are not needed). The door gets its
origin on the hinge so the page can swing it. Window glass is exported
separately with normals so the page can draw it as faint reflective glass.

  Blender --background --python web/tools/export_web.py
  then: npx gltf-transform meshopt web/build/room_raw.glb web/public/room.glb
"""
import bpy, json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
BAKED = ROOT / 'design/export/web_baked.blend'
RAW = ROOT / 'web/build/room_raw.glb'
HINGE = Vector((3.315, 5.225, 0))

bpy.ops.wm.open_mainfile(filepath=str(BAKED))
sc = bpy.context.scene
keep = []
for ob in list(sc.objects):
    if ob.type == 'MESH' and ob.name.startswith('B_'):
        me = ob.data
        for uv in [u for u in me.uv_layers if u.name != 'bake']:
            me.uv_layers.remove(uv)
        me.materials.clear()
        for a in [a for a in me.attributes if a.name not in {'position', 'bake', '.edge_verts', '.corner_vert',
                                                             '.corner_edge', '.select_vert', '.select_edge', '.select_poly'}
                  and not a.name.startswith('.')]:
            me.attributes.remove(a)
        ob.name = ob.name[2:]
        if ob.name == 'door':
            me.transform(Matrix.Translation(-HINGE))
            ob.location = HINGE
        keep.append(ob)
    elif ob.name == 'W_win_glass':
        ob.name = 'glass'
        keep.append(ob)
for ob in list(sc.objects):
    if ob not in keep:
        bpy.data.objects.remove(ob, do_unlink=True)

RAW.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(RAW), export_format='GLB', use_selection=False,
                          export_normals=True, export_texcoords=True, export_materials='NONE',
                          export_apply=False, export_yup=True, export_extras=False, export_cameras=False,
                          export_lights=False)
print('EXPORTED', RAW, [(o.name, len(o.data.polygons)) for o in keep])
