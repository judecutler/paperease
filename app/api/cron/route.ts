import { NextResponse } from 'next/server';
import { run } from '@/lib/agent';

export const dynamic = 'force-dynamic';

// Called once a day by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
// Any other scheduler can call it the same way.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret ? request.headers.get('authorization') !== `Bearer ${secret}` : process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const db = await run({ type: 'run-sweep', trigger: 'schedule' });
    const last = db.audit[db.audit.length - 1];
    return NextResponse.json({ ok: true, summary: last.detail });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
