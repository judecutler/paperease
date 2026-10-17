import { load } from '@/lib/db';
import { gate, json } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

// GET /api/v1/caregivers → ids and names, so a scheduler integration can map its workers to PaperEase ids once.
export async function GET(request: Request) {
  const g = gate(request);
  if (g instanceof Response) return g;
  const db = await load();
  return json({ caregivers: db.caregivers.map((c) => ({ id: c.id, name: c.name })) });
}
