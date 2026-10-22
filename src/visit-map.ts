import type { ParkData } from './data';
import type { LngLat } from './geo';

/**
 * A small drawn map of today's visit, for the summary and the picture to share:
 * the park's paths, where you walked (in red) and the drawings of the animals
 * you saw at their places (the others faded).
 */
export interface VisitMapOptions {
  data: ParkData;
  seen: Set<string>;
  track: LngLat[];
  /** Map colours. */
  ground: string;
  path: string;
  route: string;
  /** Size of the drawings: the biggest one is about this many px wide. */
  art: number;
}

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

/** The park turned so its long side lies across (or along, if `tall`), and its bounds. */
function layout(data: ParkData, tall: boolean) {
  const animals = data.pois.filter((p) => p.category === 'animal' && p.art);
  // The park is long and diagonal: turn it so its long side lies across the
  // box (the drawings stay upright), then fit it in.
  const all: LngLat[] = [...data.paths.flat(), ...animals.map((p) => p.coord)];
  const lat0 = all.reduce((a, c) => a + c[1], 0) / all.length;
  const lon0 = all.reduce((a, c) => a + c[0], 0) / all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  let [sxx, syy, sxy] = [0, 0, 0];
  for (const [x, y] of all) {
    const dx = (x - lon0) * kx;
    const dy = y - lat0;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy) + (tall ? Math.PI / 2 : 0);
  const [cos, sin] = [Math.cos(-angle), Math.sin(-angle)];
  const turn = ([x, y]: LngLat): [number, number] => {
    const dx = (x - lon0) * kx;
    const dy = y - lat0;
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  };
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of all) {
    const [x, y] = turn(c);
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return { turn, w, s, e, n };
}

/** Height / width of the drawn park (without the padding). */
export function visitMapAspect(data: ParkData): number {
  const { w, s, e, n } = layout(data, false);
  return (n - s) / (e - w);
}

export async function drawVisitMap(
  g: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number; r: number },
  o: VisitMapOptions,
) {
  const animals = o.data.pois.filter((p) => p.category === 'animal' && p.art);
  const { turn, w, s, e, n } = layout(o.data, box.h > box.w);
  const pad = o.art * 0.4;
  const scale = Math.min((box.w - 2 * pad) / (e - w), (box.h - 2 * pad) / (n - s));
  const ox = box.x + (box.w - (e - w) * scale) / 2;
  const oy = box.y + (box.h - (n - s) * scale) / 2;
  const at = (c: LngLat): [number, number] => {
    const [x, y] = turn(c);
    return [ox + (x - w) * scale, oy + (n - y) * scale];
  };

  g.save();
  g.beginPath();
  g.roundRect(box.x, box.y, box.w, box.h, box.r);
  g.clip();
  g.fillStyle = o.ground;
  g.fillRect(box.x, box.y, box.w, box.h);

  const line = (coords: LngLat[]) => {
    coords.forEach((c, i) => (i ? g.lineTo(...at(c)) : g.moveTo(...at(c))));
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = o.path;
  g.lineWidth = Math.max(2, o.art * 0.07);
  g.beginPath();
  o.data.paths.forEach(line);
  g.stroke();

  if (o.track.length > 1) {
    g.strokeStyle = o.route;
    g.lineWidth = Math.max(3, o.art * 0.11);
    g.beginPath();
    line(o.track);
    g.stroke();
  }

  // the animals not seen are small dots; the ones you saw, their drawings
  g.fillStyle = o.path;
  for (const p of animals) {
    if (o.seen.has(p.id)) continue;
    const [cx, cy] = at(p.coord);
    g.beginPath();
    g.arc(cx, cy, Math.max(3, o.art * 0.06), 0, 2 * Math.PI);
    g.fill();
  }
  const seen = animals.filter((p) => o.seen.has(p.id));
  const biggest = Math.max(...animals.map((p) => p.artSize?.[0] ?? 1));
  const imgs = await Promise.all(seen.map((p) => loadImage(`${import.meta.env.BASE_URL}${p.art}`)));
  g.shadowColor = 'rgba(40,30,10,0.25)';
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
