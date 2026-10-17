import { createHash, timingSafeEqual } from 'node:crypto';

// API keys for scheduling software. ELIGIBILITY_API_KEYS="acme-scheduler:<secret>,other:<secret>"
// Secrets must be at least 32 characters. With none configured the API is off (fails closed).

export interface ApiClient { name: string }

const digest = (s: string) => createHash('sha256').update(s).digest();

export function configuredKeys(env = process.env.ELIGIBILITY_API_KEYS): { name: string; hash: Buffer }[] {
  return (env ?? '').split(',').map((x) => x.trim()).filter(Boolean).flatMap((entry) => {
    const i = entry.indexOf(':');
    const name = entry.slice(0, i).trim();
    const secret = entry.slice(i + 1).trim();
    return i > 0 && name && secret.length >= 32 ? [{ name, hash: digest(secret) }] : [];
  });
}

export function apiConfigured() { return configuredKeys().length > 0; }

/** Returns the client name for a valid `Authorization: Bearer <secret>`; null otherwise. Compares every key in constant time. */
export function authenticate(req: Request): ApiClient | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return null;
  const given = digest(m[1]);
  let found: ApiClient | null = null;
  for (const k of configuredKeys()) if (timingSafeEqual(k.hash, given)) found = { name: k.name };
  return found;
}

// Best-effort limiter (per server instance). Protects against runaway schedulers, not against a determined attacker.
const hits = new Map<string, number[]>();
export function rateLimited(client: string, limit = 120, windowMs = 60_000, now = Date.now()) {
  const recent = (hits.get(client) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(client, recent);
  return recent.length > limit;
}
