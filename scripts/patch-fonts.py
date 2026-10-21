"""
Adds the characters the brand fonts lack (accents for es/ca/eu/fr/it/de, ñ, ç,
· ¿ ¡ – and, for Public, the capital I and +) and writes web fonts (WOFF2)
to src/assets/fonts/.

Accent marks are drawn with each font's own stem width; the dieresis reuses
the dot of the font's "i" so it matches its style.

Usage: python3 scripts/patch-fonts.py <Cinqcent.otf> <Public.ttf>
Needs: pip install fonttools brotli
"""
import math
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen, DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

MARKS = {  # char: (base, mark)
    'á': ('a', 'acute'), 'é': ('e', 'acute'), 'í': ('dotless_i', 'acute'), 'ó': ('o', 'acute'), 'ú': ('u', 'acute'),
    'à': ('a', 'grave'), 'è': ('e', 'grave'), 'ì': ('dotless_i', 'grave'), 'ò': ('o', 'grave'), 'ù': ('u', 'grave'),
    'â': ('a', 'circumflex'), 'ê': ('e', 'circumflex'), 'î': ('dotless_i', 'circumflex'), 'ô': ('o', 'circumflex'),
    'û': ('u', 'circumflex'),
    'ä': ('a', 'dieresis'), 'ë': ('e', 'dieresis'), 'ï': ('dotless_i', 'dieresis'), 'ö': ('o', 'dieresis'),
    'ü': ('u', 'dieresis'), 'ÿ': ('y', 'dieresis'),
    'ñ': ('n', 'tilde'), 'ã': ('a', 'tilde'), 'õ': ('o', 'tilde'),
    'ç': ('c', 'cedilla'),
    'Á': ('A', 'acute'), 'É': ('E', 'acute'), 'Í': ('I', 'acute'), 'Ó': ('O', 'acute'), 'Ú': ('U', 'acute'),
    'À': ('A', 'grave'), 'È': ('E', 'grave'), 'Ì': ('I', 'grave'), 'Ò': ('O', 'grave'), 'Ù': ('U', 'grave'),
    'Â': ('A', 'circumflex'), 'Ê': ('E', 'circumflex'), 'Î': ('I', 'circumflex'), 'Ô': ('O', 'circumflex'),
    'Û': ('U', 'circumflex'),
    'Ä': ('A', 'dieresis'), 'Ë': ('E', 'dieresis'), 'Ï': ('I', 'dieresis'), 'Ö': ('O', 'dieresis'), 'Ü': ('U', 'dieresis'),
    'Ñ': ('N', 'tilde'), 'Ç': ('C', 'cedilla'),
}


def contours(gs, name):
    """List of contours (each a RecordingPen value list) of a glyph, components decomposed."""
    rp = DecomposingRecordingPen(gs)
    gs[name].draw(rp)
    out, cur = [], []
    for op, args in rp.value:
        cur.append((op, args))
        if op in ('closePath', 'endPath'):
            out.append(cur)
            cur = []
    return out


def bounds_of(gs, value):
    bp = BoundsPen(gs)
    for op, args in value:
        getattr(bp, op)(*args)
    return bp.bounds


def replay(pen, value):
    for op, args in value:
        getattr(pen, op)(*args)


def poly(pen, pts):
    """Closed polygon, clockwise (TrueType outer contour)."""
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    if area > 0:  # counter-clockwise in y-up -> reverse
        pts = pts[::-1]
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


class Patcher:
    def __init__(self, path):
        self.f = TTFont(path)
        self.gs = self.f.getGlyphSet()
        self.cmap = self.f.getBestCmap()
        g = lambda ch: self.cmap[ord(ch)]
        self.name_of = g
        self.upm = self.f['head'].unitsPerEm
        b = lambda ch: BoundsPen(self.gs)
        self.xh = self.bounds(g('x'))[3]
        self.cap = self.bounds(g('H'))[3]
        # stroke: thickness of the hyphen (a clean horizontal stem in both fonts)
        hb = self.bounds(g('-'))
        self.stem = hb[3] - hb[1]
        # the dot of the i: its highest contour
        ic = contours(self.gs, g('i'))
        self.i_dot = max(ic, key=lambda c: bounds_of(self.gs, c)[1])
        self.i_stem = [c for c in ic if c is not self.i_dot]
        db = bounds_of(self.gs, self.i_dot)
        self.dot_w, self.dot_h = db[2] - db[0], db[3] - db[1]
        self.gap = max(self.upm * 0.05, (db[1] - self.xh) * 0.8)
        self.new = {}

    def bounds(self, name):
        bp = BoundsPen(self.gs)
        self.gs[name].draw(bp)
        return bp.bounds

    # --- marks, drawn centred on cx with their bottom at y0 -------------------
    def mark(self, pen, kind, cx, y0, scale=1.0, base_w=None):
        t = self.stem * 0.8 * scale  # stroke thickness
        h = self.upm * 0.16 * scale  # mark height
        half = min(t * 1.6, max((base_w or self.upm) * 0.3, t * 1.3))  # half width, about the letter's
        if kind in ('acute', 'grave'):
            d = 1 if kind == 'acute' else -1
            w = t * 1.1
            lean = min(t * 0.7, half * 0.6)
            poly(pen, [(cx - d * lean - w / 2, y0), (cx - d * lean + w / 2, y0),
                       (cx + d * lean + w / 2, y0 + h), (cx + d * lean - w / 2, y0 + h)])
        elif kind == 'circumflex':
            w = half
            tt = t * 0.95
            poly(pen, [(cx - w, y0), (cx - w + tt * 1.15, y0), (cx, y0 + h - tt * 1.1), (cx + w - tt * 1.15, y0),
                       (cx + w, y0), (cx + tt * 0.55, y0 + h), (cx - tt * 0.55, y0 + h)])
        elif kind == 'dieresis':
            sc = min(1.0, t * 0.9 / self.dot_w)
            dw = self.dot_w * sc
            off = dw / 2 + dw * 0.4
            db = bounds_of(self.gs, self.i_dot)
            dcx, dcy = (db[0] + db[2]) / 2, db[1]
            # flat dots (Cinqcent's i has a bar) are made squarer so two read as two
            scy = sc * max(1.0, 0.85 * self.dot_w / self.dot_h)
            for sx in (-off, off):
                tp = TransformPen(pen, (sc, 0, 0, scy, cx + sx - dcx * sc, y0 - dcy * scy))
                replay(tp, self.i_dot)
        elif kind == 'tilde':
            w = half
            a = h * 0.25
            tt = t * 0.8
            n = 16
            top = [(cx - w + 2 * w * k / n, y0 + tt + a + a * math.sin(math.pi * (2 * k / n - 0.5) + math.pi)) for k in range(n + 1)]
            poly(pen, top + [(x, y - tt) for x, y in top][::-1])
        elif kind == 'cedilla':
            tt = t * 0.8
            u = self.upm
            poly(pen, [(cx - tt / 2, 0), (cx + tt / 2, 0), (cx + tt / 2, -u * 0.06), (cx + tt * 1.4, -u * 0.12),
                       (cx + tt * 0.4, -u * 0.2), (cx - tt * 0.9, -u * 0.2), (cx - tt * 0.9, -u * 0.14),
                       (cx + tt * 0.1, -u * 0.14), (cx - tt / 2, -u * 0.07)])

    def add(self, uni, name, draw, width):
        pen = TTGlyphPen(None)
        draw(pen)
        self.new[name] = (uni, pen.glyph(), width)

    def base_value(self, base):
        if base == 'dotless_i':
            return [op for c in self.i_stem for op in c], self.gs[self.name_of('i')].width
        name = self.name_of(base)
        rp = DecomposingRecordingPen(self.gs)
        self.gs[name].draw(rp)
        return rp.value, self.gs[name].width

    def build(self, extra_I=False):
        f, cmap = self.f, self.cmap
        if extra_I and ord('I') not in cmap and ord('İ') in cmap:
            # capital I = dotted I without its dot
            cs = contours(self.gs, cmap[ord('İ')])
            body = [c for c in cs if c is not max(cs, key=lambda c: bounds_of(self.gs, c)[1])]
            self.add(ord('I'), 'I', lambda pen: [replay(pen, c) for c in body], self.gs[cmap[ord('İ')]].width)
            self._commit()
        for ch, (base, kind) in MARKS.items():
            if ord(ch) in self.cmap:
                continue
            if base != 'dotless_i' and ord(base) not in self.cmap:
                continue
            value, width = self.base_value(base)
            bb = bounds_of(self.gs, value)
            cx = (bb[0] + bb[2]) / 2
            upper = ch.isupper()
            top = self.cap if upper else self.xh
            y0 = top + self.gap * (0.8 if upper else 1.0)

            def draw(pen, value=value, kind=kind, cx=cx, y0=y0, upper=upper, bw=bb[2] - bb[0]):
                replay(pen, value)
                self.mark(pen, kind, cx, y0, 0.85 if upper else 1.0, bw)

            self.add(ord(ch), f'uni{ord(ch):04X}', draw, width)
        # · from the period, raised to mid x-height
        if ord('·') not in cmap:
            v, w = self.base_value('.')
            bb = bounds_of(self.gs, v)
            dy = self.xh / 2 - (bb[1] + bb[3]) / 2
            self.add(ord('·'), 'periodcentered', lambda pen: replay(TransformPen(pen, (1, 0, 0, 1, 0, dy)), v), w)
        # ¿ ¡ as ? ! turned upside down
        for ch, src in (('¿', '?'), ('¡', '!')):
            if ord(ch) not in cmap and ord(src) in cmap:
                v, w = self.base_value(src)
                bb = bounds_of(self.gs, v)
                cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                shift = -(bb[3] - bb[1]) * 0.25  # sits a little below the baseline, like Spanish ¿ ¡
                self.add(ord(ch), f'uni{ord(ch):04X}',
                         lambda pen, v=v, cx=cx, cy=cy, shift=shift: replay(TransformPen(pen, (-1, 0, 0, -1, 2 * cx, 2 * cy + shift)), v), w)
        # – from the hyphen, wider
        if ord('–') not in cmap and ord('-') in cmap:
            v, w = self.base_value('-')
            self.add(ord('–'), 'endash', lambda pen: replay(TransformPen(pen, (1.3, 0, 0, 1, 0, 0)), v), int(w * 1.3))
        # + from two hyphen-thick bars
        if ord('+') not in cmap and ord('-') in cmap:
            v, w = self.base_value('-')
            bb = bounds_of(self.gs, v)
            t = bb[3] - bb[1]
            L = (bb[2] - bb[0]) * 0.9
            cx, cy = w / 2, (bb[1] + bb[3]) / 2

            def plus(pen):
                poly(pen, [(cx - L / 2, cy - t / 2), (cx + L / 2, cy - t / 2), (cx + L / 2, cy + t / 2), (cx - L / 2, cy + t / 2)])
                poly(pen, [(cx - t / 2, cy - L / 2), (cx + t / 2, cy - L / 2), (cx + t / 2, cy + L / 2), (cx - t / 2, cy + L / 2)])
            # overlapping contours are fine in TrueType (non-zero fill)
            self.add(ord('+'), 'plus', plus, w)
        self._commit()

    def _commit(self):
        f = self.f
        glyf, hmtx = f['glyf'], f['hmtx']
        order = f.getGlyphOrder()
        for name, (uni, glyph, width) in self.new.items():
            if name in glyf.glyphs:
                name = name + '.patch'
            glyph.recalcBounds(glyf)
            glyf.glyphs[name] = glyph
            order.append(name)
            hmtx.metrics[name] = (int(round(width)), int(round(getattr(glyph, 'xMin', 0) or 0)))
            for table in f['cmap'].tables:
                if table.isUnicode():
                    table.cmap[uni] = name
        f.setGlyphOrder(order)
        glyf.glyphOrder = order
        if 'post' in f and f['post'].formatType == 2.0:
            f['post'].extraNames = []
            f['post'].mapping = {}
        self.new = {}
        self.gs = f.getGlyphSet()
        self.cmap = f.getBestCmap()
        # make room for capital accents
        need = int(self.cap + self.gap + self.upm * 0.2)
        if f['hhea'].ascent < need:
            f['hhea'].ascent = need
            f['OS/2'].sTypoAscender = max(f['OS/2'].sTypoAscender, need)
            f['OS/2'].usWinAscent = max(f['OS/2'].usWinAscent, need)

    def save(self, path):
        self.f.flavor = 'woff2'
        self.f.save(path)


def main(cinq, public):
    for src, out, extra in ((cinq, 'src/assets/fonts/cinqcent.woff2', False), (public, 'src/assets/fonts/public.woff2', True)):
        p = Patcher(src)
        before = len(p.cmap)
        p.build(extra_I=extra)
        p.save(out)
        print(f'{out}: {before} -> {len(p.cmap)} characters')


if __name__ == '__main__':
    main(*sys.argv[1:3])
