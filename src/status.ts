import type { Poi } from './data';
import { t } from './i18n';

/** Live status of a place or exhibition, shown as a badge. */
export type Tone = 'open' | 'soon' | 'closed' | 'live' | 'later';
export interface Status {
  tone: Tone;
  text: string;
}

const PARK_TZ = 'Atlantic/Canary';
const SHOW_MINUTES = 30; // exhibitions last about half an hour
const TRAIN_STOP_MINUTES = 2; // the Ecotour waits a moment at each stop
const SOON = 60; // "opens / starts in N min" from this far
const CLOSING_SOON = 30;

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: PARK_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const weekday = new Intl.DateTimeFormat('en-US', { timeZone: PARK_TZ, weekday: 'short' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day of the week in the park, 0 = Sunday. */
export function parkWeekday(now = new Date()): number {
  return WEEKDAYS.indexOf(weekday.format(now));
}

/** Minutes since midnight in the park (Canary Islands time), whatever the phone's time zone. */
export function parkMinutes(now = new Date()): number {
  const [h, m] = clock.format(now).split(':').map(Number);
  return h * 60 + m;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function poiStatus(p: Poi, now = parkMinutes(), today = parkWeekday()): Status | null {
  if (p.days) {
    // Weekly session: the schedule already names the day, so only a countdown or "on now" on that day.
    if (!p.days.includes(today)) return null;
    const st = poiStatus({ ...p, days: undefined }, now);
    if (!st || st.tone === 'closed') return null;
    if (st.tone === 'later') {
      const next = p.times!.map(toMinutes).find((x) => x > now)!;
      const d = next - now;
      return { tone: 'later', text: t('status.startsInH', { h: Math.floor(d / 60), m: d % 60 }) };
    }
    return st;
  }
  if (p.hours) {
    const [open, close] = p.hours.map(toMinutes);
    if (now < open) {
      return open - now <= SOON
        ? { tone: 'soon', text: t('status.opensIn', { n: open - now }) }
        : { tone: 'closed', text: t('status.opensAt', { t: p.hours[0] }) };
    }
    if (now < close) {
      return close - now <= CLOSING_SOON
        ? { tone: 'soon', text: t('status.closesIn', { n: close - now }) }
        : { tone: 'open', text: t('status.open') };
    }
    return { tone: 'closed', text: t('status.closed') };
  }
  if (p.times?.length) {
    const train = p.timesKind === 'train';
    const dur = train ? TRAIN_STOP_MINUTES : SHOW_MINUTES;
    const starts = p.times.map(toMinutes);
    if (starts.some((s) => now >= s && now < s + dur)) {
      return { tone: 'live', text: t(train ? 'status.trainHere' : 'status.live') };
    }
    const next = starts.find((s) => s > now);
    if (next === undefined) return { tone: 'closed', text: t(train ? 'status.noMoreTrains' : 'status.noMore') };
    const at = p.times[starts.indexOf(next)];
    if (next - now <= SOON) {
      return { tone: 'soon', text: t(train ? 'status.trainIn' : 'status.startsIn', { n: next - now }) };
    }
    return { tone: 'later', text: t(train ? 'status.trainAt' : 'status.startsAt', { t: at }) };
  }
  return null;
}

/** Ecotour: times of the next train at each stop, from the run that reaches `fromStop` next. */
export function ecotourRun(stops: Poi[], fromStop: number, now = parkMinutes()): { stop: Poi; at: string; min: number }[] {
  const byNum = (n: number) => stops.find((s) => s.id === `ecotour-${n}`);
  const here = byNum(fromStop);
  const next = here?.times?.map(toMinutes).find((s) => s + TRAIN_STOP_MINUTES > now);
  if (here === undefined || next === undefined) return [];
  const run = next - fromStop * 5; // departure from stop 0
  const out: { stop: Poi; at: string; min: number }[] = [];
  for (let n = 0; n <= 5; n++) {
    const stop = byNum(n);
    const m = run + n * 5;
    if (!stop?.times?.map(toMinutes).includes(m)) continue;
    out.push({ stop, at: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, min: m - now });
  }
  return out;
}
