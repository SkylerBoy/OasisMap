import { describe, expect, it } from 'vitest';
import { ecotourTravel, type TrainStop } from './ecotour-travel';

// a line: stops every 10 walking minutes, A next to stop 0, B next to stop 5
const pos: Record<string, number> = { A: 0, B: 50, C: 2 };
for (let n = 0; n <= 5; n++) pos[`e${n}`] = n * 10;
const walk = (a: string, b: string) => Math.abs(pos[a] - pos[b]);
const h = (hh: number, mm = 0) => hh * 60 + mm;
const stops: TrainStop[] = [0, 1, 2, 3, 4, 5].map((n) => ({
  id: `e${n}`,
  n,
  times: (n === 5 ? [12, 13] : [12, 13, 14]).map((x) => h(x, 5 * n)),
}));

describe('ecotour travel', () => {
  // walking A→B is 50 min; the train is slower overall but spares most of the walk
  const travel = ecotourTravel(walk, stops, { walkSaved: 5, extra: 15 });
  it('takes the train when it spares walking without losing much time', () => {
    const r = travel('A', 'B', h(11, 50));
    expect(r.ride).toEqual({ from: 0, to: 5, dep: h(12), arr: h(12, 25) });
    expect(r.minutes).toBe(35);
    expect(r.walk).toBe(0);
  });
  it('walks when the wait is too long or the hop is short', () => {
    expect(travel('A', 'B', h(12, 10)).ride).toBeUndefined(); // next train at 13:00: 75 min vs 50 walking
    expect(travel('A', 'C', h(11, 58)).ride).toBeUndefined();
  });
  it('gets off earlier when the last run does not reach the end', () => {
    expect(travel('A', 'B', h(13, 50)).ride).toEqual({ from: 0, to: 4, dep: h(14), arr: h(14, 20) });
  });
});
