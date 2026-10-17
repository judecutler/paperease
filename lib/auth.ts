import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminFromUser, type Admin } from './adminRole';

export { adminFromUser, type Admin };

// Admin sign-in through Supabase Auth. An account is an admin only when app_metadata.role is 'admin',
// which only the secret key can set (npm run admin:add), so a self-made Supabase account gets nothing.
// Without SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the local JSON demo) there is no sign-in.

export const authEnabled = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);

/** Supabase client bound to the request's session cookies (route handlers and server components) */
export async function authClient() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}

export async function currentAdmin(): Promise<Admin | null> {
  if (!authEnabled()) return null;
  const { data } = await (await authClient()).auth.getUser();
  return adminFromUser(data.user);
}

/**
 * For admin API routes, on top of the middleware: the signed-in admin, `undefined` when sign-in is off
 * (demo mode), or a 401 response to return.
 */
export async function requireAdmin(): Promise<Admin | undefined | NextResponse> {
  if (!authEnabled()) return undefined;
  return (await currentAdmin()) ?? NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
}
