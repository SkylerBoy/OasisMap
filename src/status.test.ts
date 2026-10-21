import { describe, expect, it } from 'vitest';
import type { Poi } from './data';
import { ecotourRun, parkMinutes, poiStatus } from './status';

const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(':').map(Number);
  return h * 60 + mm;
};
const base = { category: 'food', name: { es: 'X' }, coord: [0, 0] } as const;
const restaurant = { ...base, id: 'r', hours: ['9:00', '17:30'] } as Poi;
const show = { ...base, id: 's', category: 'show', times: ['11:15', '15:40'], timesKind: 'show' } as Poi;
const stops = [0, 1, 2, 3, 4, 5].map(
  (n) =>
    ({
      ...base,
      id: `ecotour-${n}`,
      category: 'service',
      name: { es: `Ecotour – parada ${n}: S${n}` },
      times: (n === 5 ? [12, 13, 14, 15] : [12, 13, 14, 15, 16]).map((h) => `${h}:${String(5 * n).padStart(2, '0')}`),
      timesKind: 'train',
    }) as Poi,
);

describe('opening hours', () => {
  it('goes from closed to open to closing soon to closed', () => {
    expect(poiStatus(restaurant, m('7:00'))?.tone).toBe('closed');
    expect(poiStatus(restaurant, m('8:30'))?.tone).toBe('soon');
    expect(poiStatus(restaurant, m('12:00'))?.tone).toBe('open');
    expect(poiStatus(restaurant, m('17:10'))?.tone).toBe('soon');
    expect(poiStatus(restaurant, m('17:30'))?.tone).toBe('closed');
  });
});

describe('exhibitions', () => {
  it('counts down, shows it running, then the next one', () => {
    expect(poiStatus(show, m('9:00'))?.tone).toBe('later');
    expect(poiStatus(show, m('10:45'))?.tone).toBe('soon');
    expect(poiStatus(show, m('11:30'))?.tone).toBe('live');
    expect(poiStatus(show, m('15:00'))?.tone).toBe('soon');
    expect(poiStatus(show, m('16:30'))?.tone).toBe('closed');
  });
});

describe('ecotour', () => {
  it('lists the run that reaches the stop next', () => {
    const run = ecotourRun(stops, 2, m('13:03'));
    expect(run.map((r) => r.at)).toEqual(['13:00', '13:05', '13:10', '13:15', '13:20', '13:25']);
    expect(run[2].min).toBe(7);
  });
  it('the last run ends at stop 4', () => {
    expect(ecotourRun(stops, 4, m('16:10')).map((r) => r.at)).toEqual(['16:00', '16:05', '16:10', '16:15', '16:20']);
    expect(ecotourRun(stops, 5, m('16:00'))).toEqual([]);
  });
  it('uses Canary Islands time', () => {
    expect(parkMinutes(new Date('2026-07-01T12:00:00Z'))).toBe(13 * 60); // WEST = UTC+1 in summer
    expect(parkMinutes(new Date('2026-01-01T12:00:00Z'))).toBe(12 * 60);
  });
});
