import type { User } from '@supabase/supabase-js';

// Kept apart from lib/auth.ts so middleware does not pull in next/headers.

export interface Admin {
  name: string;
  email: string;
}

/** an account is an admin only when app_metadata.role is 'admin', which only the secret key can set */
export function adminFromUser(user: User | null): Admin | null {
  if (user?.app_metadata?.role !== 'admin') return null;
  return { name: String(user.app_metadata.name || user.email), email: user.email ?? '' };
}
