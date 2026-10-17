import { NextResponse } from 'next/server';
import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { payload } from '@/lib/payload';
import { requireAdmin, failure } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (err) { return failure(err); }
  const db = await load();
  detectGaps(db);
  return NextResponse.json(payload(db));
}
