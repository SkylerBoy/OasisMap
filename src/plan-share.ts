/**
 * Short shared-plan links (?plan=K7XQ2M): the packed plan is kept in Supabase
 * until the day after the plan (see supabase/shared-plans.sql). Without a
 * connection the caller falls back to the long, self-contained ?p=… link.
 */

export interface ShareConfig {
  url: string;
  key: string;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export const SHORT_CODE = /^[A-HJ-NP-Z2-9]{6}$/i;

function headers(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`;
  return h;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function withTimeout(ms: number, run: (signal: AbortSignal) => Promise<Response>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Store a packed plan; returns its short code, or null (no connection, not set up…). */
export async function storePlan(cfg: ShareConfig | undefined, packed: string, expires: string): Promise<string | null> {
  if (!cfg?.url || !cfg.key) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newCode();
    const res = await withTimeout(4000, (signal) =>
      fetch(`${cfg.url}/rest/v1/shared_plans`, {
        method: 'POST',
        headers: { ...headers(cfg.key), Prefer: 'return=minimal' },
        body: JSON.stringify({ code, plan: packed, expires }),
        signal,
      }),
    );
    if (res?.ok) return code;
    if (res?.status !== 409) return null; // only a clash of codes is worth another try
  }
  return null;
}

/** The packed plan behind a short code, or null (expired, unknown, offline). */
export async function loadPlan(cfg: ShareConfig | undefined, code: string): Promise<string | null> {
  if (!cfg?.url || !cfg.key) return null;
  const res = await withTimeout(6000, (signal) =>
    fetch(`${cfg.url}/rest/v1/rpc/get_plan`, {
      method: 'POST',
      headers: headers(cfg.key),
      body: JSON.stringify({ c: code.toUpperCase() }),
      signal,
    }),
  );
  if (!res?.ok) return null;
  const v = (await res.json()) as string | null;
  return typeof v === 'string' && v ? v : null;
}
