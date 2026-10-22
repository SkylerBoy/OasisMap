import { describe, expect, it, vi } from 'vitest';
import type { Poi } from './data';
import { VisitLog } from './visit-log';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });

const giraffe = { id: 'jirafas', category: 'animal', name: { es: 'J' }, coord: [-14.16, 28.18] } as Poi;
const toilet = { id: 'aseo-1', category: 'service', name: { es: 'A' }, coord: [-14.1595, 28.18] } as Poi;
const min = 60_000;

describe('visit log', () => {
  it('counts walking and animals seen, ignoring GPS jumps', () => {
    const log = new VisitLog([giraffe, toilet], () => '2026-10-24');
    let t = 0;
    // walk 10 m steps east towards the giraffes, then stay
    for (let i = 10; i >= 0; i--) log.onFix([-14.16 + i * 0.0001, 28.18], 10, (t += 10_000));
    log.onFix([-14.16, 28.18], 10, (t += 2 * min));
    log.onFix([-14.15, 28.19], 10, (t += 5000)); // a 1.4 km jump: noise
    expect(Math.round(log.visit.meters)).toBeGreaterThan(90);
    expect(log.visit.meters).toBeLessThan(120);
    expect(Object.keys(log.visit.seen)).toEqual(['jirafas']);
  });

  it('a new day is a new visit', () => {
    let day = '2026-10-24';
    const log = new VisitLog([giraffe], () => day);
    log.markSeen('jirafas');
    expect(log.hasVisit).toBe(true);
    day = '2026-10-25';
    expect(log.hasVisit).toBe(false);
  });
});
