import bpy
from mathutils import Vector
for c in ('styled_camera_hero','styled_camera_tv','styled_camera_couch','styled_camera_desk','styled_camera_bed','certificates_camera'):
    cam=bpy.data.objects[c];d=cam.matrix_world.to_quaternion()@Vector((0,0,-1))
    print('CAM',c,[round(v*100,1) for v in cam.matrix_world.translation],'dir',[round(v,2) for v in d],'lens',round(cam.data.lens,1))
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        n=(o.name+' '+' '.join(s.material.name for s in o.material_slots if s.material)).lower()
        if any(k in n for k in ('screen','pc9801','crt','glass','emit','monitor')):
            pts=[o.matrix_world@Vector(c) for c in o.bound_box]
            print('OBJ',o.name,'|',[s.material.name for s in o.material_slots if s.material][:4],'| parent',o.parent.name if o.parent else None,[[round(min(p[i] for p in pts)*100,1) for i in range(3)],[round(max(p[i] for p in pts)*100,1) for i in range(3)]])
