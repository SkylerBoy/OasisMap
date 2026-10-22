import type { ParkData } from './data';
import type { LngLat } from './geo';
import { mapSnapshot, type BaseLayer } from './map';

/**
 * A small drawn map of today's visit, for the summary and the picture to share:
 * the park in colour, its paths with soft turns, where you walked (in red) and
 * the drawings of the animals you saw at their places. North is up.
 */
export interface MapColors {
  /** Outside the park. */
  ground: string;
  /** The park itself and its edge. */
  park: string;
  edge: string;
  path: string;
  route: string;
}

export const LIGHT_MAP: MapColors = {
  ground: '#f1e4c6',
  park: '#cfe5b3',
  edge: '#b5d495',
  path: '#fffaf0',
  route: '#a71d2f',
};

export const DARK_MAP: MapColors = {
  ground: '#26251d',
  park: '#2f4128',
  edge: '#3a5131',
  path: '#59614c',
  route: '#e0475b',
};

export interface VisitMapOptions {
  data: ParkData;
  seen: Set<string>;
  track: LngLat[];
  colors: MapColors;
  /** Size of the drawings: the biggest one is about this many px wide. */
  art: number;
  /** For the picture of the real map: its base layer, box px per CSS px and render pixel ratio. */
  base?: BaseLayer;
  dark?: boolean;
  density?: number;
  pixelRatio?: number;
}

const artScale = (zoom: number) => Math.min(1.4, Math.max(0.6, 0.85 * 2 ** ((zoom - 17) * 0.6)));

const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

const drawn = (data: ParkData) => data.pois.filter((p) => p.category === 'animal' && p.art);

/** The park's bounds; longitude is scaled by kx (cos of the latitude) to keep its shape. */
function bounds(data: ParkData) {
  const all: LngLat[] = [...data.paths.flat(), ...drawn(data).map((p) => p.coord)];
  const lat0 = all.reduce((a, c) => a + c[1], 0) / all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of all) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return { w, s, e, n, kx };
}

/** Height / width of the drawn park (without the margin). */
export function visitMapAspect(data: ParkData): number {
  const b = bounds(data);
  return (b.n - b.s) / ((b.e - b.w) * b.kx);
}

/** A line through the points with its corners gently rounded. */
function smoothLine(g: CanvasRenderingContext2D, pts: [number, number][], radius: number) {
  if (!pts.length) return;
  g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(radius, 0.45 * Math.hypot(b[0] - a[0], b[1] - a[1]), 0.45 * Math.hypot(c[0] - b[0], c[1] - b[1]));
    g.arcTo(b[0], b[1], c[0], c[1], r);
  }
  g.lineTo(...pts[pts.length - 1]);
}

export async function drawVisitMap(
  g: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number; r: number },
  o: VisitMapOptions,
) {
  const animals = drawn(o.data);
  if (o.base) {
    // a picture of the map as the app shows it, with the drawings on top
    const density = o.density ?? 1;
    const snap = await mapSnapshot(o.data, {
      width: Math.round(box.w / density),
      height: Math.round(box.h / density),
      pixelRatio: o.pixelRatio ?? density,
      base: o.base,
      dark: o.dark,
      track: o.track,
      points: animals,
    });
    if (snap) {
      const imgs = await Promise.all(animals.map((p) => loadImage(`${import.meta.env.BASE_URL}${p.art}`)));
      const k = artScale(snap.zoom) * 1.3 * density;
      g.save();
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, box.r);
      g.clip();
      g.drawImage(snap.canvas, box.x, box.y, box.w, box.h);
      const order = animals.map((p, i) => ({ p, img: imgs[i], on: o.seen.has(p.id) })).sort((a, b) => +a.on - +b.on);
      for (const { p, img, on } of order) {
        const pos = snap.at.get(p.id);
        if (!img || !pos) continue;
        const [aw, ah] = p.artSize ?? [img.width / 4, img.height / 4];
        const f = on ? 1.15 : 1;
        const [dw, dh] = [aw * k * f, ah * k * f];
        const [cx, cy] = [box.x + pos[0] * density, box.y + pos[1] * density];
        g.globalAlpha = on ? 1 : 0.5;
        if (on) {
          g.shadowColor = 'rgba(40,30,10,0.35)';
          g.shadowBlur = 8 * density;
          g.shadowOffsetY = 2 * density;
        }
        g.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        g.shadowColor = 'transparent';
      }
      g.restore();
      return;
    }
  }
  const { w, s, e, n, kx } = bounds(o.data);
  const pad = o.art * 0.58;
  const scale = Math.min((box.w - 2 * pad) / ((e - w) * kx), (box.h - 2 * pad) / (n - s));
  const ox = box.x + (box.w - (e - w) * kx * scale) / 2;
  const oy = box.y + (box.h - (n - s) * scale) / 2;
  const at = ([x, y]: LngLat): [number, number] => [ox + (x - w) * kx * scale, oy + (n - y) * scale];
  const c = o.colors;

  g.save();
  g.beginPath();
  g.roundRect(box.x, box.y, box.w, box.h, box.r);
  g.clip();
  g.fillStyle = c.ground;
  g.fillRect(box.x, box.y, box.w, box.h);

  g.lineCap = 'round';
  g.lineJoin = 'round';
  const paths = o.data.paths.map((p) => p.map(at));
  const corner = o.art * 0.3;
  const strokePaths = (color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (const p of paths) smoothLine(g, p, corner);
    g.stroke();
  };
  const blobs = (color: string, radius: number) => {
    g.fillStyle = color;
    g.beginPath();
    for (const p of animals) {
      const [x, y] = at(p.coord);
      g.moveTo(x + radius, y);
      g.arc(x, y, radius, 0, 2 * Math.PI);
    }
    g.fill();
  };

  // the park: a wide green band along every path and around every enclosure
  const band = o.art * 0.62;
  const edge = Math.max(3, o.art * 0.05);
  strokePaths(c.edge, band + 2 * edge);
  blobs(c.edge, band * 0.62 + edge);
  strokePaths(c.park, band);
  blobs(c.park, band * 0.62);

  // the paths
  strokePaths(c.path, Math.max(2, o.art * 0.075));

  // where you walked
  if (o.track.length > 1) {
    g.strokeStyle = c.route;
    g.lineWidth = Math.max(3, o.art * 0.1);
    g.beginPath();
    smoothLine(g, o.track.map(at), corner);
    g.stroke();
  }

  // the animals you saw
  const seen = animals.filter((p) => o.seen.has(p.id));
  const biggest = Math.max(...animals.map((p) => p.artSize?.[0] ?? 1));
  const imgs = await Promise.all(seen.map((p) => loadImage(`${import.meta.env.BASE_URL}${p.art}`)));
  g.shadowColor = 'rgba(40,30,10,0.3)';
  g.shadowBlur = o.art * 0.08;
  g.shadowOffsetY = o.art * 0.03;
  seen.forEach((p, i) => {
    const img = imgs[i];
    if (!img) return;
    const [aw, ah] = p.artSize ?? [img.width, img.height];
    const k = (o.art * 0.55 + (o.art * 0.45 * aw) / biggest) / aw;
    const [cx, cy] = at(p.coord);
    g.drawImage(img, cx - (aw * k) / 2, cy - (ah * k) / 2, aw * k, ah * k);
  });
  g.restore();
}
