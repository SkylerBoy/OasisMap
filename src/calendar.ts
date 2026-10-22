/**
 * The plan as a calendar file (.ics) the phone's calendar can import, with
 * alarms when it is time to leave: they ring even with the web closed.
 */

export interface CalEvent {
  uid: string;
  title: string;
  description?: string;
  /** Park date YYYY-MM-DD and minutes since midnight, Canary Islands time. */
  date: string;
  start: number;
  end: number;
  /** Alarm this many minutes before the start (none if missing). */
  alarm?: number;
  geo?: [number, number]; // lng, lat
}

const PARK_TZ = 'Atlantic/Canary';
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARK_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A park date and time as a real instant (handles summer/winter time). */
export function parkTime(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  // what the park's clock says at that UTC instant, and how far off that is
  const p = Object.fromEntries(parts.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess - (shown - guess));
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** Lines longer than 75 bytes are folded, as the format asks. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) {
      out.push(cur);
      cur = ' ';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(events: CalEvent[], name: string): string {
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oasis Wildlife//Mapa//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(parkTime(e.date, e.start))}`,
      `DTEND:${stamp(parkTime(e.date, e.end))}`,
      `SUMMARY:${esc(e.title)}`,
      'LOCATION:Oasis Wildlife Fuerteventura',
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.geo) lines.push(`GEO:${e.geo[1].toFixed(6)};${e.geo[0].toFixed(6)}`);
    if (e.alarm != null)
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${Math.max(0, Math.round(e.alarm))}M`, `DESCRIPTION:${esc(e.title)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
