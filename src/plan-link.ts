/**
 * Short plan links: ?p=2.<date>.<start>.<end>.<pace>.<flags>.<every>.<length>.<stops>
 * Each stop is its fixed 2-character code (Poi.code, kept in data/link-codes.json so
 * old links keep working when points are added); lunch is "-" + its restaurant, a
 * break "_" + its spot.
 */

export interface LinkPlan {
  date: string; // YYYY-MM-DD
  start: number; // minutes since midnight
  end: number;
  pace: number;
  train: boolean;
  lunch: boolean;
  every: number;
  length: number;
  stops: { id: string; loc: string }[];
}

const n36 = (n: number) => Math.round(n).toString(36);

export function encodePlan(p: LinkPlan, code: (id: string) => string): string {
  const date = p.date.slice(2).replace(/-/g, ''); // 2026-10-24 → 261024
  const stops = p.stops
    .map((s) => (s.id === 'lunch' ? `-${code(s.loc)}` : s.id.startsWith('rest-') ? `_${code(s.loc)}` : code(s.id)))
    .join('');
  return ['2', date, n36(p.start / 5), n36(p.end / 5), n36(p.pace / 5), (p.train ? 1 : 0) | (p.lunch ? 2 : 0), n36(p.every / 5), n36(p.length), stops].join('.');
}

/** Back to a plan, given the points that exist now (code → id). */
export function decodePlan(s: string, byCode: Map<string, string>): LinkPlan | null {
  const f = s.split('.');
  if (f[0] !== '2' || f.length !== 9) return null;
  const stops: { id: string; loc: string }[] = [];
  let rest = 0;
  for (let i = 0; i < f[8].length; ) {
    const kind = f[8][i] === '-' ? 'lunch' : f[8][i] === '_' ? 'rest' : 'stop';
    if (kind !== 'stop') i++;
    const loc = byCode.get(f[8].slice(i, i + 2));
    i += 2;
    if (!loc) continue; // a point that no longer exists
    stops.push({ id: kind === 'lunch' ? 'lunch' : kind === 'rest' ? `rest-${++rest}` : loc, loc });
  }
  const d = f[1];
  const flags = Number(f[5]);
  return {
    date: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`,
    start: parseInt(f[2], 36) * 5,
    end: parseInt(f[3], 36) * 5,
    pace: parseInt(f[4], 36) * 5,
    train: !!(flags & 1),
    lunch: !!(flags & 2),
    every: parseInt(f[6], 36) * 5,
    length: parseInt(f[7], 36),
    stops,
  };
}
