import bpy,json,collections
sc=bpy.context.scene
dg=bpy.context.evaluated_depsgraph_get()
meshes=[o for o in sc.objects if o.type=='MESH' and o.visible_get()]
tris=0;per=[]
for o in meshes:
    e=o.evaluated_get(dg);m=e.to_mesh()
    t=sum(len(p.vertices)-2 for p in m.polygons);tris+=t;per.append((t,o.name,[s.material.name if s.material else None for s in o.material_slots][:3]))
    e.to_mesh_clear()
per.sort(reverse=True)
lights=collections.Counter(l.data.type for l in sc.objects if l.type=='LIGHT')
imgs=[(i.name,i.size[0],i.size[1]) for i in bpy.data.images if i.users]
print(json.dumps({'meshes':len(meshes),'tris':tris,'materials':len([m for m in bpy.data.materials if m.users]),'lights':lights,'images':len(imgs),
 'big_images':sorted(imgs,key=lambda x:-x[1]*x[2])[:15],'top_tris':per[:40],
 'cameras':[c.name for c in sc.objects if c.type=='CAMERA'],
 'collections':[(c.name,len(c.all_objects)) for c in bpy.data.collections][:80],
 'mods':collections.Counter(m.type for o in meshes for m in o.modifiers)},indent=1,default=str))
