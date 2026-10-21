import { describe, expect, it } from 'vitest';
import { planDay, type PlanItem } from './planner';

// points on a line, 1 minute apart per unit
const X: Record<string, number> = { gate: 0, a: 2, b: 4, show: 6, c: 8, food: 10, exp: 12 };
const walk = (p: string, q: string) => Math.abs(X[p] - X[q]);
const visit = (id: string): PlanItem => ({ id, kind: 'visit', dur: 10, locs: [id] });
const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('planDay', () => {
  it('keeps exhibition times with a margin and fits visits around them', () => {
    const show: PlanItem = { id: 'show', kind: 'show', dur: 30, sessions: [h(10, 0), h(12, 0)], locs: ['show'] };
    const plan = planDay({ items: [visit('a'), visit('b'), visit('c'), show], walk, startLoc: 'gate', startTime: h(9), endTime: h(17) });
    expect(plan.skipped).toEqual([]);
    const s = plan.steps.find((x) => x.item.id === 'show')!;
    expect([h(10), h(12)]).toContain(s.start);
    expect(s.arrive).toBeLessThanOrEqual(s.start - 10);
    // no overlaps
    for (let i = 1; i < plan.steps.length; i++) expect(plan.steps[i].arrive).toBeGreaterThanOrEqual(plan.steps[i - 1].end);
  });

  it('respects opening hours and drops what does not fit', () => {
    const exp: PlanItem = { id: 'exp', kind: 'window', dur: 30, window: [h(15), h(16)], locs: ['exp'] };
    const lunch: PlanItem = { id: 'lunch', kind: 'window', dur: 45, window: [h(12, 30), h(14, 30)], locs: ['food'] };
    const plan = planDay({ items: [visit('a'), exp, lunch], walk, startLoc: 'gate', startTime: h(9), endTime: h(17) });
    const e = plan.steps.find((x) => x.item.id === 'exp')!;
    expect(e.start).toBeGreaterThanOrEqual(h(15));
    expect(plan.steps.find((x) => x.item.id === 'lunch')!.start).toBeGreaterThanOrEqual(h(12, 30));
    const late = planDay({ items: [exp], walk, startLoc: 'gate', startTime: h(16, 10), endTime: h(17) });
    expect(late.skipped.map((i) => i.id)).toEqual(['exp']);
  });

  it('never drops an exhibition to fit more animals', () => {
    const many = Array.from({ length: 30 }, (_, i) => {
      X[`q${i}`] = (i * 11) % 30;
      return visit(`q${i}`);
    });
    const show: PlanItem = { id: 'show', kind: 'show', dur: 30, sessions: [h(11)], locs: ['show'] };
    const plan = planDay({ items: [...many, show], walk, startLoc: 'gate', startTime: h(9), endTime: h(13) });
    expect(plan.steps.some((s) => s.item.id === 'show')).toBe(true);
  });

  it('is quick with many stops', () => {
    const many = Array.from({ length: 40 }, (_, i) => {
      X[`p${i}`] = (i * 7) % 30;
      return visit(`p${i}`);
    });
    const shows: PlanItem[] = [0, 1, 2].map((k) => ({ id: `s${k}`, kind: 'show', dur: 30, sessions: [h(11 + k), h(13 + k), h(15)], locs: ['show'] }));
    const t0 = performance.now();
    const plan = planDay({ items: [...many, ...shows], walk, startLoc: 'gate', startTime: h(9), endTime: h(18) });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(plan.steps.length).toBeGreaterThan(30);
  });
});

import { scheduleOrder } from './planner';

describe('scheduleOrder', () => {
  const show: PlanItem = { id: 'show', kind: 'show', dur: 30, sessions: [h(10), h(12)], locs: ['show'] };
  it('moves an exhibition to a later session when it is dragged down', () => {
    const many = ['a', 'b', 'c', 'c', 'b', 'a', 'b', 'c'].map((id) => ({ item: { ...visit(id), dur: 15 }, loc: id }));
    const r = scheduleOrder([...many, { item: show, loc: 'show' }], { walk, startLoc: 'gate', startTime: h(9), endTime: h(17) });
    expect('steps' in r && r.steps[r.steps.length - 1].start).toBe(h(12));
  });
  it('says which stop no longer fits', () => {
    const r = scheduleOrder([{ item: visit('a'), loc: 'a' }, { item: show, loc: 'show' }], { walk, startLoc: 'gate', startTime: h(11, 55), endTime: h(17) });
    expect('problem' in r && r.problem).toEqual({ index: 1, reason: 'session' });
  });
});
