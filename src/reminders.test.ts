import { describe, expect, it } from 'vitest';
import type { Poi } from './data';
import { dueReminders, nextSession, toggleReminder } from './reminders';

const m = (hhmm: string) => {
  const [h, mm] = hhmm.split(':').map(Number);
  return h * 60 + mm;
};
const show = { id: 'fauna', category: 'show', name: { es: 'Fauna Live' }, coord: [0, 0], times: ['12:20', '13:15', '15:15'], timesKind: 'show' } as Poi;

describe('reminders', () => {
  it('picks the next session still ahead', () => {
    expect(nextSession(show, m('12:30'))).toBe('13:15');
    expect(nextSession(show, m('16:00'))).toBeNull();
  });
  it('fires once, when it is time to walk there with a margin', () => {
    const r = toggleReminder(show, m('12:30'));
    expect(r).not.toBeNull();
    const at = m(r!.at);
    const walk = () => 6;
    expect(dueReminders(walk, at - 17)).toEqual([]); // 6 min walk + 10 margin = leave at -16
    expect(dueReminders(walk, at - 16).map((x) => x.poi)).toEqual(['fauna']);
    expect(dueReminders(walk, at - 10)).toEqual([]);
  });
});
