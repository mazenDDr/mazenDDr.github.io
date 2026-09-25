"""Measure the interactive anchors in the Blender room and write web/public/anchors.json.

Screens and boards are fitted as planes from their real geometry (centre, normal,
width, height); cameras keep their pose and field of view. Everything is written
in three.js coordinates (Y up, metres): (x, y, z)_blender -> (x, z, -y).

  Blender --background design/blender/room_polished.blend --python web/tools/anchors.py
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/public/anchors.json'
PREP = Path(__file__).with_name('prep_report.json')
dg = bpy.context.evaluated_depsgraph_get()


def three(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def plane(name):
    ob = bpy.data.objects[name]
    me = ob.evaluated_get(dg).to_mesh()
    mw = ob.matrix_world
    # Only faces that look into the room, so a board's back doesn't cancel its front.
    room = Vector((1.7, 2.6, 1.3))
    n = Vector()
    for p in me.polygons:
        fn = (mw.to_3x3() @ p.normal).normalized()
        if fn.dot(room - mw @ p.center) > 0:
            n += fn * p.area
    n.normalize()
    pts = [mw @ v.co for v in me.vertices]
    up = Vector((0, 0, 1))
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n)
    c = sum(pts, Vector()) / len(pts)
    us = [(p - c).dot(right) for p in pts]
    vs = [(p - c).dot(up) for p in pts]
    ds = [(p - c).dot(n) for p in pts]
    centre = c + right * (max(us) + min(us)) / 2 + up * (max(vs) + min(vs)) / 2 + n * max(ds)
    ob.evaluated_get(dg).to_mesh_clear()
    return {'center': three(centre), 'normal': three(n), 'right': three(right), 'up': three(up),
            'width': round(max(us) - min(us), 4), 'height': round(max(vs) - min(vs), 4)}


def camera(name):
    cam = bpy.data.objects[name]
    d = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    hfov = 2 * math.atan(cam.data.sensor_width / 2 / cam.data.lens)
    return {'position': three(cam.matrix_world.translation), 'target': three(cam.matrix_world.translation + d),
            'hfov_deg': round(math.degrees(hfov), 2)}


prep = json.loads(PREP.read_text())
out = {
    'units': 'metres, three.js axes (Y up)',
    'screens': {'tv': plane('meshId3'), 'pc': plane('Monitor'), 'memo': plane('memo_board')},
    'door': {'hinge': three(Vector((3.315, 5.225, 0))), 'open_angle_deg': round((prep['door_open_angle_deg'] + 180) % 360 - 180, 2),
             'nodes': ['B_door']},
    'certificate_wall': {'center': three(Vector((3.395, 1.035, 1.465))), 'normal': three(Vector((-1, 0, 0))),
                         'width': 1.47, 'height': 1.03},
    'cameras': {n.replace('styled_camera_', '').replace('_camera', ''): camera(n) for n in
                ('styled_camera_hero', 'styled_camera_tv', 'styled_camera_couch', 'styled_camera_desk',
                 'styled_camera_bed', 'certificates_camera')},
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, indent=1))
print('ANCHORS', json.dumps(out['screens']))
