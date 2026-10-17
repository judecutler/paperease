import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { checkEligibility } from '@/lib/eligibility';
import { BatchSchema, apiError, gate, json, logCheck, readJson } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

// POST /api/v1/eligibility/batch  { shifts: [{ caregiverId, shiftStart, shiftEnd?, ref? }], strict? }
export async function POST(request: Request) {
  const g = gate(request);
  if (g instanceof Response) return g;
  try {
    const parsed = BatchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    const db = await load();
    detectGaps(db);
    const results = parsed.data.shifts.map(({ ref, ...input }) => {
      try {
        const d = checkEligibility(db, input, { strict: parsed.data.strict });
        logCheck(g.client, d);
        return { ...d, ...(ref ? { ref } : {}) };
      } catch (err) {
        // one bad row must not hide the others; an unreadable row is never "eligible"
        return { caregiverId: input.caregiverId, decision: 'unknown', eligible: false, reasons: [], error: (err as Error).message, ...(ref ? { ref } : {}) };
      }
    });
    return json({ results });
  } catch (err) {
    return apiError(400, (err as Error).message);
  }
}
