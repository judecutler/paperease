import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { payload } from '@/lib/payload';
import { hcoScope, scopeDb } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const db = await load();
  detectGaps(db);
  return NextResponse.json(payload(scopeDb(db, hcoScope(db, me)), me));
}
