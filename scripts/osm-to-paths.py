"""
Builds public/data/paths.geojson from OpenStreetMap data (data/osm/oasis.json,
fetched by the "Fetch OpenStreetMap data" workflow).

- Keeps walkable ways (footway, path, steps, service…) inside the zoo area.
- Joins small disconnected pieces to the main network when the gap is short.
- Adds a short straight connector for any point of interest that is far from
  every path, so routing still reaches it.
- Prints the named places OSM knows in the zoo, to help pin more points.

Run: python3 scripts/osm-to-paths.py
"""
import json
import math

OSM = 'data/osm/oasis.json'
POIS = 'public/data/pois.geojson'
OUT = 'public/data/paths.geojson'
MAP_PATHS = 'data/map-paths.geojson'  # traced from the printed map (gen-park-data.py)
COVER_M = 35  # map-traced path parts closer than this to an OSM path are dropped
SPLICE_M = 80  # a kept map-traced run is spliced to the OSM network if its end is this close

WALKABLE = {'footway', 'path', 'pedestrian', 'steps', 'track', 'service', 'living_street', 'corridor', 'cycleway', 'bridleway'}
NO_ACCESS = {'private', 'no'}
JOIN_GAP_M = 30  # connect a stray piece to the main network if this close
POI_CONNECT_M = 25  # points farther than this from a path get a connector

ORIGIN = (-14.1590, 28.1858)
KX = math.cos(math.radians(ORIGIN[1])) * 6371008.8 * math.pi / 180
KY = 6371008.8 * math.pi / 180


def xy(p):
    return ((p[0] - ORIGIN[0]) * KX, (p[1] - ORIGIN[1]) * KY)


def ll(q):
    return [round(ORIGIN[0] + q[0] / KX, 7), round(ORIGIN[1] + q[1] / KY, 7)]


def seg_closest(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    c = (a[0] + t * dx, a[1] + t * dy)
    return math.dist(p, c), c


def inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def geom(el):
    return [(g['lon'], g['lat']) for g in el.get('geometry', []) if g]


def zoo_rings(elements):
    rings = []
    for el in elements:
        if el.get('tags', {}).get('tourism') != 'zoo':
            continue
        if el['type'] == 'way':
            rings.append([xy(p) for p in geom(el)])
        elif el['type'] == 'relation':
            for m in el.get('members', []):
                if m.get('role') == 'outer' and m.get('geometry'):
                    rings.append([xy((g['lon'], g['lat'])) for g in m['geometry']])
    return [r for r in rings if len(r) >= 3]


def with_geometry(els):
    """OSM API JSON lists ways by node ids: attach coordinates like Overpass 'out geom'."""
    nodes = {e['id']: e for e in els if e['type'] == 'node' and 'lat' in e}
    ways = {}
    for e in els:
        if e['type'] == 'way' and 'geometry' not in e and 'nodes' in e:
            e['geometry'] = [{'lon': nodes[n]['lon'], 'lat': nodes[n]['lat']} for n in e['nodes'] if n in nodes]
        if e['type'] == 'way':
            ways[e['id']] = e
    for e in els:
        if e['type'] == 'relation':
            for m in e.get('members', []):
                if m.get('type') == 'way' and 'geometry' not in m and m.get('ref') in ways:
                    m['geometry'] = ways[m['ref']].get('geometry', [])
    return els


def main():
    data = json.load(open(OSM))
    els = with_geometry(data['elements'])
    rings = zoo_rings(els)
    in_zoo = (lambda q: any(inside(q, r) for r in rings)) if rings else (lambda q: True)
    print(f'zoo outline: {len(rings)} ring(s)' if rings else 'no zoo outline in OSM: using the whole area')

    lines = []
    for el in els:
        t = el.get('tags', {})
        if el['type'] != 'way' or t.get('highway') not in WALKABLE or t.get('access') in NO_ACCESS:
            continue
        pts = [xy(p) for p in geom(el)]
        if len(pts) < 2:
            continue
        share = sum(in_zoo(q) for q in pts) / len(pts)
        if share >= 0.5:
            lines.append({'id': el['id'], 'hw': t.get('highway'), 'pts': pts})
    print(f'walkable ways inside the zoo: {len(lines)}')
    if not lines:
        raise SystemExit('no paths found')

    # connected pieces (ways sharing a node position)
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, ln in enumerate(lines):
        for q in ln['pts']:
            k = (round(q[0], 1), round(q[1], 1))
            if k in owner:
                parent[find(i)] = find(owner[k])
            else:
                owner[k] = i
    groups = {}
    for i in range(len(lines)):
        groups.setdefault(find(i), []).append(i)
    pieces = sorted(groups.values(), key=lambda g: -sum(len(lines[i]['pts']) for i in g))
    print(f'connected pieces: {len(pieces)}')

    def segs(idx):
        for i in idx:
            p = lines[i]['pts']
            for a, b in zip(p, p[1:]):
                yield a, b

    connectors = []
    main_idx = list(pieces[0])
    for piece in pieces[1:]:
        best = None
        for i in piece:
            for q in lines[i]['pts']:
                for a, b in segs(main_idx):
                    d, c = seg_closest(q, a, b)
                    if best is None or d < best[0]:
                        best = (d, q, c)
        if best and best[0] <= JOIN_GAP_M:
            connectors.append([best[1], best[2]])
            main_idx += piece
    kept = main_idx
    dropped = len(lines) - len(kept)
    print(f'joined pieces with {len(connectors)} connector(s); dropped {dropped} stray way(s)')

    # Fill areas OSM has no paths for (e.g. the botanic garden) with the
    # map-traced paths, spliced onto the OSM network.
    osm_segs = list(segs(kept))

    def near_osm(q):
        return min(seg_closest(q, a, b)[0] for a, b in osm_segs)

    extra = []
    try:
        traced = [[xy(p) for p in f['geometry']['coordinates']] for f in json.load(open(MAP_PATHS))['features']]
    except FileNotFoundError:
        traced = []
    for line in traced:
        dense = []
        for a, b in zip(line, line[1:]):
            n = max(1, int(math.dist(a, b) // 10))
            dense += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n)]
        dense.append(line[-1])
        run = []
        for q in dense + [None]:
            if q is not None and near_osm(q) > COVER_M:
                run.append(q)
                continue
            if len(run) >= 2:
                for end in (run[0], run[-1]):  # splice both ends onto OSM when close
                    d, c = min((seg_closest(end, a, b) for a, b in osm_segs), key=lambda r: r[0])
                    if d <= SPLICE_M:
                        connectors.append([end, c])
                extra.append(run)
            run = []
    print(f'map-traced runs added where OSM has no paths: {len(extra)}')

    pois = json.load(open(POIS))['features']
    poi_links = 0
    for f in pois:
        q = xy(f['geometry']['coordinates'])
        all_segs = osm_segs + [(a, b) for r in extra for a, b in zip(r, r[1:])]
        best = min((seg_closest(q, a, b) for a, b in all_segs), key=lambda r: r[0])
        if best[0] > POI_CONNECT_M:
            connectors.append([q, best[1]])
            poi_links += 1
            print(f"  connector for {f['properties']['id']}: {best[0]:.0f} m")
    print(f'point connectors: {poi_links}')

    feats = [{'type': 'Feature', 'properties': {'source': 'osm', 'osm_id': lines[i]['id'], 'highway': lines[i]['hw']},
              'geometry': {'type': 'LineString', 'coordinates': [ll(q) for q in lines[i]['pts']]}} for i in kept]
    feats += [{'type': 'Feature', 'properties': {'source': 'map'},
               'geometry': {'type': 'LineString', 'coordinates': [ll(q) for q in r]}} for r in extra]
    feats += [{'type': 'Feature', 'properties': {'source': 'connector'},
               'geometry': {'type': 'LineString', 'coordinates': [ll(q) for q in c]}} for c in connectors]
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}: {len(feats)} lines')

    print('\nnamed places in OSM inside the zoo:')
    for el in els:
        t = el.get('tags', {})
        name = t.get('name')
        if not name or 'highway' in t:
            continue
        if el['type'] == 'node':
            p = (el['lon'], el['lat'])
        elif 'center' in el:
            p = (el['center']['lon'], el['center']['lat'])
        else:
            g = geom(el)
            if not g:
                continue
            p = (sum(a for a, _ in g) / len(g), sum(b for _, b in g) / len(g))
        if in_zoo(xy(p)):
            kind = t.get('amenity') or t.get('tourism') or t.get('leisure') or t.get('natural') or ''
            print(f'  {name} [{kind}] {p[0]:.7f}, {p[1]:.7f}')


if __name__ == '__main__':
    main()
