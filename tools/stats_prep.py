import bpy,collections
obs=[o for o in bpy.data.collections['WEB'].objects]
def tris(o):return sum(len(p.vertices)-2 for p in o.data.polygons)
def area(o):return sum(p.area for p in o.data.polygons)
print('BIG AREA');[print(' ',round(area(o),1),tris(o),o.name,o['src_cols']) for o in sorted(obs,key=area,reverse=True)[:12]]
print('BIG TRIS');[print(' ',tris(o),round(area(o),3),o.name,o['src_cols']) for o in sorted(obs,key=tris,reverse=True)[:25]]
by=collections.Counter();n=collections.Counter()
for o in obs:
    k=o['src_cols'].split(',')[0];by[k]+=tris(o);n[k]+=1
print('BY COL',[(k,v,n[k]) for k,v in by.most_common()])
# tris density: tris per m2
import statistics
