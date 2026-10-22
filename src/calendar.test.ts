import { describe, expect, it } from 'vitest';
import { buildIcs, parkTime } from './calendar';

describe('calendar', () => {
  it('turns park time into the right instant in summer and winter', () => {
    expect(parkTime('2026-10-24', 11 * 60 + 15).toISOString()).toBe('2026-10-24T10:15:00.000Z'); // WEST, UTC+1
    expect(parkTime('2026-12-24', 11 * 60 + 15).toISOString()).toBe('2026-12-24T11:15:00.000Z'); // WET, UTC+0
  });
  it('writes events with alarms', () => {
    const ics = buildIcs(
      [{ uid: 'a@oasis', title: 'Sea Lion Live, exhibición', date: '2026-10-24', start: 675, end: 705, alarm: 18, geo: [-14.16, 28.18] }],
      'Mi plan',
    );
    expect(ics).toContain('DTSTART:20261024T101500Z');
    expect(ics).toContain('SUMMARY:Sea Lion Live\\, exhibición');
    expect(ics).toContain('TRIGGER:-PT18M');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
