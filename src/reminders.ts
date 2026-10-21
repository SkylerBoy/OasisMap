import type { Poi } from './data';
import { parkMinutes, parkWeekday, toMinutes } from './status';

/**
 * "Remind me" for exhibitions and the Ecotour. There is no push server, so the
 * app checks the clock while it is open (also in the background, as long as the
 * browser keeps it alive) and shows a notification in time to walk there.
 */
export interface Reminder {
  poi: string;
  /** Session start, park time "HH:MM". */
  at: string;
  /** Park date "YYYY-MM-DD"; reminders from other days are dropped. */
  day: string;
  done?: boolean;
}

const KEY = 'oasis.reminders';
const MARGIN = 10; // minutes to spare on top of the walk
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' });

export function parkDate(now = new Date()): string {
  return date.format(now);
}

function load(): Reminder[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Reminder[];
    return all.filter((r) => r.day === parkDate());
  } catch {
    return [];
  }
}

function save(list: Reminder[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: reminders only last this visit */
  }
}

let list = load();

/** Next session of a point that can still be reached today, or null. */
export function nextSession(p: Poi, now = parkMinutes()): string | null {
  if (!p.times?.length) return null;
  if (p.days && !p.days.includes(parkWeekday())) return null;
  return p.times.find((t) => toMinutes(t) > now) ?? null;
}

export function reminderFor(poiId: string): Reminder | undefined {
  return list.find((r) => r.poi === poiId && !r.done);
}

/** Turn the reminder for the next session on or off. Returns the new one, or null if removed / none. */
export function toggleReminder(p: Poi, now = parkMinutes()): Reminder | null {
  const existing = reminderFor(p.id);
  list = list.filter((r) => r.poi !== p.id);
  if (existing) {
    save(list);
    return null;
  }
  const at = nextSession(p, now);
  if (!at) return null;
  const r: Reminder = { poi: p.id, at, day: parkDate() };
  list.push(r);
  save(list);
  return r;
}

export function activeReminders(): Reminder[] {
  return list.filter((r) => !r.done);
}

/**
 * Reminders whose time to leave has come: the walk plus a margin before the start.
 * They are marked as done and returned once.
 */
export function dueReminders(walkMinutes: (poiId: string) => number, now = parkMinutes()): Reminder[] {
  const due: Reminder[] = [];
  for (const r of list) {
    if (r.done) continue;
    const start = toMinutes(r.at);
    if (now >= start + 5) r.done = true; // missed (app was closed)
    else if (now >= start - walkMinutes(r.poi) - MARGIN) {
      r.done = true;
      due.push(r);
    }
  }
  if (due.length || list.some((r) => r.done)) save(list);
  return due;
}

export async function askPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** System notification (through the service worker, as Android requires). */
export async function notify(title: string, body: string, poiId: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag: `remind-${poiId}`, data: { poi: poiId }, icon: 'icon.svg', badge: 'icon.svg' };
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}
