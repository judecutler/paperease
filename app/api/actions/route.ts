import { NextResponse } from 'next/server';
import { run, type Action } from '@/lib/agent';
import { payload } from '@/lib/payload';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const action = (await request.json()) as Action;
    const db = await run(action);
    return NextResponse.json(payload(db));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
