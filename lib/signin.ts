// True when admin sign-in is on (Supabase Auth configured; see lib/auth.ts). Kept free of next/headers so
// plain modules and tests can ask. Anything that reaches real people or real records is refused when it is false.
export const signInRequired = (env = process.env) => !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
