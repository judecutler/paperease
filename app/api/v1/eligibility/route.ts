import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { checkEligibility } from '@/lib/eligibility';
import { SingleSchema, apiError, gate, json, logCheck, readJson } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

// POST /api/v1/eligibility  { caregiverId, shiftStart, shiftEnd?, strict?, ref? }
export async function POST(request: Request) {
  const g = gate(request);
  if (g instanceof Response) return g;
  try {
    const parsed = SingleSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    const { strict, ref, ...input } = parsed.data;
    const db = await load();
    detectGaps(db); // an expiry that passed since the last sweep still counts
    const d = checkEligibility(db, input, { strict });
    logCheck(g.client, d);
    return json({ ...d, ...(ref ? { ref } : {}) }, d.decision === 'unknown' ? 404 : 200);
  } catch (err) {
    return apiError(400, (err as Error).message);
  }
}
