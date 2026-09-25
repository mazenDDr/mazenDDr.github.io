import bpy,re,json
from mathutils import Vector
def bb(objs):
    pts=[o.matrix_world@Vector(c) for o in objs if o.type=='MESH' for c in o.bound_box]
    if not pts:return None
    return [[round(min(p[i] for p in pts)*100,1) for i in range(3)],[round(max(p[i] for p in pts)*100,1) for i in range(3)]]
pat=re.compile(r'door|screen|crt|tv|monitor|memo|cork|pin|board|bed|chair|couch|sofa|desk|CERT|window|pc9801|computer|keyboard|mouse|rug|table',re.I)
out=[]
for o in bpy.context.scene.objects:
    if o.parent is None and pat.search(o.name):
        kids=[o]+list(o.children_recursive)
        out.append((o.name,o.type,len(kids),bb(kids),[c.name for c in o.users_collection]))
for r in sorted(out):print(r)
for c in ('styled_camera_hero','styled_camera_tv','styled_camera_couch','styled_camera_desk','styled_camera_bed','certificates_camera'):
    cam=bpy.data.objects[c];print(c,[round(v*100,1) for v in cam.location],[round(v,3) for v in cam.rotation_euler],round(cam.data.lens,1))
