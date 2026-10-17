import { NextResponse } from 'next/server';
import { adminFromUser, authClient, authEnabled } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!authEnabled()) return NextResponse.json({ error: 'Sign-in is not set up.' }, { status: 400 });
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
  if (!adminFromUser(data.user)) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: 'This account does not have access to PaperEase. Ask your agency admin to add you.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
