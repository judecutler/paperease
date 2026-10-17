import { NextResponse } from 'next/server';
import { authClient, authEnabled } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (authEnabled()) await (await authClient()).auth.signOut();
  return NextResponse.json({ ok: true });
}
