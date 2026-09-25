import bpy
sc=bpy.context.scene;v=sc.view_settings
print('CM',sc.display_settings.display_device,v.view_transform,v.look,v.exposure,v.gamma,sc.render.use_compositing, 'curve',v.use_curve_mapping)
nt=sc.compositing_node_group if hasattr(sc,'compositing_node_group') else sc.node_tree
if nt:
    for n in nt.nodes:
        vals={i.name:(tuple(i.default_value) if hasattr(i.default_value,'__len__') else i.default_value) for i in n.inputs if hasattr(i,'default_value') and not i.is_linked}
        print('NODE',n.bl_idname,n.name,vals)
    for l in nt.links:print('LINK',l.from_node.name,'->',l.to_node.name)
print('FILM',sc.cycles.film_exposure if hasattr(sc.cycles,'film_exposure') else None, sc.render.film_transparent)
