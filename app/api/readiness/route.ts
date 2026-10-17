import { NextResponse } from 'next/server';
import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { requireAdmin } from '@/lib/auth';
import { agencyReadiness } from '@/lib/packet';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  try {
    const db = await load();
    detectGaps(db);
    return NextResponse.json(agencyReadiness(db));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
