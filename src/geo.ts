/** [longitude, latitude] — same order as GeoJSON. */
export type LngLat = [number, number];
/** Local planar coordinates in metres (x = east, y = north). */
export type XY = [number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0–360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * RAD;
  const φ2 = b[1] * RAD;
  const Δλ = (b[0] - a[0]) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(Math.atan2(y, x) / RAD);
}

export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed smallest difference b - a in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normalizeDeg(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Equirectangular projection around an origin. Error is negligible at park
 * scale (a few km) and it makes segment maths simple and fast.
 */
export class LocalProjection {
  private readonly kx: number;
  private readonly ky = R * RAD;
  constructor(readonly origin: LngLat) {
    this.kx = Math.cos(origin[1] * RAD) * R * RAD;
  }
  toXY(p: LngLat): XY {
    return [(p[0] - this.origin[0]) * this.kx, (p[1] - this.origin[1]) * this.ky];
  }
  toLngLat(p: XY): LngLat {
    return [p[0] / this.kx + this.origin[0], p[1] / this.ky + this.origin[1]];
  }
}

export interface SegmentProjection {
  /** Position along the segment, 0 = a, 1 = b. */
  t: number;
  point: XY;
  dist: number;
}

/** Closest point to p on segment ab. */
export function projectOnSegment(p: XY, a: XY, b: XY): SegmentProjection {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: XY = [a[0] + t * dx, a[1] + t * dy];
  return { t, point, dist: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}

export function lineLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distance(coords[i - 1], coords[i]);
  return total;
}

/** Point at `d` metres along a polyline (clamped to its ends). */
export function pointAlong(coords: LngLat[], d: number): LngLat {
  if (coords.length === 0) throw new Error('empty line');
  if (d <= 0) return coords[0];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = distance(coords[i - 1], coords[i]);
    if (walked + seg >= d) {
      const t = seg === 0 ? 0 : (d - walked) / seg;
      const [a, b] = [coords[i - 1], coords[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

/** Polygon approximating a circle, for the GPS accuracy halo. */
export function circlePolygon(center: LngLat, radius: number, steps = 48): LngLat[] {
  const proj = new LocalProjection(center);
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push(proj.toLngLat([Math.cos(a) * radius, Math.sin(a) * radius]));
  }
  return ring;
}
