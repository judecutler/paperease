import { z } from 'zod';
import { apiConfigured, authenticate, rateLimited } from './apikeys';

// Shared plumbing for /api/v1 routes: key check, rate limit, JSON errors with stable shapes.
export function apiError(status: number, error: string, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function gate(req: Request): { client: string } | Response {
  if (!apiConfigured()) return apiError(503, 'The eligibility API is not enabled. Set ELIGIBILITY_API_KEYS.');
  const client = authenticate(req);
  if (!client) return apiError(401, 'Invalid or missing API key.', { 'www-authenticate': 'Bearer' });
  if (rateLimited(client.name)) return apiError(429, 'Too many requests.', { 'retry-after': '60' });
  return { client: client.name };
}

const instant = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) && !Number.isNaN(Date.parse(s)), 'Use an ISO date or timestamp.');
export const ShiftSchema = z.object({
  caregiverId: z.string().min(1).max(100),
  shiftStart: instant,
  shiftEnd: instant.optional(),
  ref: z.string().max(100).optional(),
}).strict();
export const SingleSchema = ShiftSchema.extend({ strict: z.boolean().optional() }).strict();
export const BatchSchema = z.object({ shifts: z.array(ShiftSchema).min(1).max(200), strict: z.boolean().optional() }).strict();

export async function readJson(req: Request) {
  const text = await req.text();
  if (text.length > 100_000) throw new Error('Request body too large.');
  try { return JSON.parse(text); } catch { throw new Error('Body must be JSON.'); }
}

/** Log line a scheduler integration can trace; carries ids and the decision only, never names or document values. */
export function logCheck(client: string, d: { caregiverId: string; decision: string; reasons: { code: string }[] }) {
  console.info(JSON.stringify({ evt: 'eligibility', client, caregiverId: d.caregiverId, decision: d.decision, codes: d.reasons.map((r) => r.code) }));
}
