import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePlan, encodePlan } from './plan-link';

const pois: { id: string; code: string }[] = JSON.parse(readFileSync('public/data/pois.geojson', 'utf8')).features.map(
  (f: { properties: { id: string; code: string } }) => f.properties,
);
const codeOf = new Map(pois.map((p) => [p.id, p.code]));
const byCode = new Map(pois.map((p) => [p.code, p.id]));

describe('plan links', () => {
  it('every point has its own 2-character code', () => {
    expect(pois.every((p) => /^[0-9a-z]{2}$/.test(p.code))).toBe(true);
    expect(byCode.size).toBe(pois.length);
  });

  it('comes back the same and stays short', () => {
    const stops = [
      ...pois.filter((p) => !p.id.startsWith('aseo')).slice(0, 50).map((p) => ({ id: p.id, loc: p.id })),
      { id: 'lunch', loc: 'oasis-market' },
      { id: 'rest-1', loc: 'snack-fauna' },
    ];
    const p = { date: '2026-10-24', start: 545, end: 1080, pace: 135, train: true, lunch: true, every: 120, length: 15, stops };
    const s = encodePlan(p, (id) => codeOf.get(id)!);
    expect(s.length).toBeLessThan(140);
    expect(decodePlan(s, byCode)).toEqual(p);
  });
});
