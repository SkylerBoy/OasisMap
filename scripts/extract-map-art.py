"""Cut the animal drawings out of the official park map PDF as small SVGs.

    pip install pymupdf
    python3 scripts/extract-map-art.py mapa_es.pdf

Each drawing on the map is a run of vector paths (outline first, then fills).
Consecutive small paths that touch are grouped, and the group under each point
in ART is written to public/img/map-art/<id>.svg. The points are PDF
coordinates (pt) of the middle of each drawing; if the map changes, render it
and update them. Then run gen-park-data.py so the points pick up their art.
"""
import os
import sys

import pymupdf

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img', 'map-art')
LAYER = 'MAPA BASE LINK'
FIRST_PATH = 60000  # the drawings come after the base map (paths, trees, buildings)

ART = {
    'titi-plateado': (138, 974), 'tamarino-algodon': (152, 1014), 'tucan': (118, 1055),
    'tunel-lemures': (75, 1044), 'grulla-damisela': (53, 1024), 'serval': (104, 968),
    'mono-arana': (185, 935), 'flamencos': (247, 917), 'titi-pigmeo': (281, 862),
    'puercoespin': (307, 827), 'capuchino': (342, 826), 'crias-cocodrilo': (369, 852),
    'fenec': (409, 826), 'talapoin': (419, 799), 'nutria': (489, 771),
    'canguro-pelicano': (569, 701), 'camello-ovejas': (623, 704), 'hipopotamo': (682, 730),
    'capibara': (679, 771), 'aves-zancudas': (633, 769), 'niala-calao-grulla': (701, 695),
    'llamas-guanacos': (791, 654), 'sabana': (881, 718), 'watusi': (973, 765),
    'dromedarios': (981, 869), 'jirafas': (905, 840), 'elefantes': (956, 967),
    'cueva-reptiles': (788, 616), 'iguanas-tortugas': (944, 449), 'aligator': (994, 415),
    'lagartos': (893, 384), 'cocodrilo-nilo': (920, 323), 'autillo': (1056, 611),
    'grullas-tortuga-emu': (643, 651), 'emu-ualabi-cisne': (626, 627),
    'macaco-bonnet': (587, 662), 'armadillo': (510, 730), 'titi-pincel': (480, 730),
    'titi-geoffroy': (376, 802), 'saki-goeldi-emperador': (541, 733),
    # exhibitions and experiences
    'sea-lion-live': (704, 542), 'birds-live': (1145, 595), 'fauna-live': (864, 363),
    'sabana-splash': (700, 616), 'camel-experience': (266, 784), 'lemur-experience': (75, 1044),
}


def groups(drawings):
    out, cur = [], None
    for x in drawings[FIRST_PATH:]:
        if x['type'] not in ('f', 's', 'fs') or 'rect' not in x or x.get('layer') != LAYER:
            continue
        r = pymupdf.Rect(x['rect'])
        if r.width > 150 or r.height > 150:
            continue
        if cur and r.intersects(cur['bb'] + (-2, -2, 2, 2)):
            cur['paths'].append(x)
            cur['bb'] |= r
        else:
            cur = {'paths': [x], 'bb': r}
            out.append(cur)
    return [g for g in out if len(g['paths']) >= 8 and 10 < g['bb'].width < 110 and 10 < g['bb'].height < 110]


def colour(c):
    return 'none' if c is None else '#%02x%02x%02x' % tuple(round(v * 255) for v in c)


def path_d(items, ox, oy):
    d, last = [], None
    n = lambda p: f'{p.x - ox:.1f} {p.y - oy:.1f}'
    for it in items:
        op = it[0]
        if op == 're':
            r = it[1]
            d.append(f'M{r.x0 - ox:.1f} {r.y0 - oy:.1f}h{r.width:.1f}v{r.height:.1f}h{-r.width:.1f}Z')
            last = None
            continue
        if op == 'qu':
            q = it[1]
            d.append(f'M{n(q.ul)}L{n(q.ur)}L{n(q.lr)}L{n(q.ll)}Z')
            last = None
            continue
        start = it[1]
        if last is None or abs(start.x - last.x) > 0.01 or abs(start.y - last.y) > 0.01:
            d.append(f'M{n(start)}')
        if op == 'l':
            d.append(f'L{n(it[2])}')
            last = it[2]
        elif op == 'c':
            d.append(f'C{n(it[2])} {n(it[3])} {n(it[4])}')
            last = it[4]
    return ''.join(d)


def svg(group):
    pad = 1.5
    bb = group['bb'] + (-pad, -pad, pad, pad)
    parts = []
    for x in group['paths']:
        d = path_d(x['items'], bb.x0, bb.y0)
        if x.get('closePath'):
            d += 'Z'
        a = [f'd="{d}"']
        a.append(f'fill="{colour(x.get("fill")) if "f" in x["type"] else "none"}"')
        if x.get('even_odd') and 'f' in x['type']:
            a.append('fill-rule="evenodd"')
        if (x.get('fill_opacity') or 1) < 1:
            a.append(f'fill-opacity="{x["fill_opacity"]:.1f}"')
        if 's' in x['type']:
            a.append(f'stroke="{colour(x.get("color"))}" stroke-width="{x.get("width") or 1:.2f}"')
            a.append('stroke-linejoin="round" stroke-linecap="round"')
        parts.append(f'<path {" ".join(a)}/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {bb.width:.1f} {bb.height:.1f}">'
            + ''.join(parts) + '</svg>')


def main(pdf):
    page = pymupdf.open(pdf)[0]
    gs = groups(page.get_drawings(extended=True))
    os.makedirs(OUT, exist_ok=True)
    for pid, (x, y) in ART.items():
        hits = [g for g in gs if pymupdf.Point(x, y) in g['bb'] + (-1, -1, 1, 1)]
        if not hits:
            print(f'{pid}: no drawing at {x},{y}')
            continue
        g = max(hits, key=lambda g: len(g['paths']))
        open(os.path.join(OUT, f'{pid}.svg'), 'w').write(svg(g))
    print(f'{len(os.listdir(OUT))} drawings in {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main(sys.argv[1])
