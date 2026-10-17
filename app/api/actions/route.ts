import { NextResponse } from 'next/server';
import { run, type Action } from '@/lib/agent';
import { payload } from '@/lib/payload';
import { requireAdmin, failure } from '@/lib/access';
import { HttpError } from '@/lib/regulatory/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireAdmin(request, true);
    const action = (await request.json()) as Action;
    const db = await run(action);
    return NextResponse.json(payload(db));
  } catch (err) {
    return err instanceof HttpError ? failure(err) : NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
