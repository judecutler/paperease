import { NextResponse } from 'next/server';
import { run, type Action } from '@/lib/agent';
import { requireAdmin } from '@/lib/auth';
import { payload } from '@/lib/payload';
import { hcoScope, scopeDb } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  try {
    const action = (await request.json()) as Action;
    const db = await run(action, { origin: new URL(request.url).origin, me });
    return NextResponse.json(payload(scopeDb(db, hcoScope(db, me)), me));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
