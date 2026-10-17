import { NextResponse } from 'next/server';
import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { failure, requireAdmin } from '@/lib/access';
import { agencyReadiness } from '@/lib/packet';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = await load();
    detectGaps(db);
    return NextResponse.json(agencyReadiness(db));
  } catch (err) {
    return failure(err);
  }
}
