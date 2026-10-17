import { NextResponse } from 'next/server';
import { load } from '@/lib/db';
import { detectGaps } from '@/lib/agent';
import { payload } from '@/lib/payload';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await load();
  detectGaps(db);
  return NextResponse.json(payload(db));
}
