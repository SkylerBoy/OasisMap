import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Poi } from './data';
import { VisitTimes } from './visit-times';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
const sent: unknown[] = [];
vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
  sent.push(...JSON.parse(init.body));
  return { ok: true };
});

const giraffe = { id: 'jirafas', category: 'animal', name: { es: 'J' }, coord: [-14.16, 28.18] } as Poi;
const zebra = { id: 'sabana', category: 'animal', name: { es: 'S' }, coord: [-14.159, 28.18] } as Poi; // ~100 m east
const min = 60_000;

describe('visit times', () => {
  beforeEach(() => {
    mem.clear();
    sent.length = 0;
  });

  it('measures a stay and sends it when the visitor moves on', async () => {
    const v = new VisitTimes({ url: 'https://x', key: 'k' }, [giraffe, zebra]);
    v.setConsent(true);
    v.onFix(giraffe.coord, 0);
    v.onFix(giraffe.coord, 4 * min);
    v.onFix(zebra.coord, 5 * min);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([{ poi: 'jirafas', minutes: 4 }]);
  });

  it('ignores walking past and does nothing without consent', async () => {
    const v = new VisitTimes({ url: 'https://x', key: 'k' }, [giraffe, zebra]);
    v.setConsent(true);
    v.onFix(giraffe.coord, 0);
    v.onFix(zebra.coord, 0.5 * min); // 30 s at the giraffes
    v.setConsent(false);
    v.onFix(giraffe.coord, 10 * min);
    v.onFix(zebra.coord, 20 * min);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
  });
});
