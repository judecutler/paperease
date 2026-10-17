// Creates an admin account, or turns an existing account into one, and prints a new password once.
// npm run admin:add -- <email> "<Full name>"
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) throw new Error('Usage: npm run admin:add -- <email> "<Full name>"');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');

  const auth = createClient(url, key, { auth: { persistSession: false } }).auth.admin;
  const password = crypto.randomBytes(12).toString('base64url');
  const app_metadata = { role: 'admin', name };

  const created = await auth.createUser({ email, password, email_confirm: true, app_metadata });
  if (created.error) {
    // already registered: find the account and grant access with a fresh password
    const { data, error } = await auth.listUsers({ perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) throw created.error;
    const updated = await auth.updateUserById(user.id, { password, app_metadata: { ...user.app_metadata, ...app_metadata } });
    if (updated.error) throw updated.error;
  }
  console.log(`${name} <${email}> can now sign in to PaperEase.`);
  console.log(`Password (shown once): ${password}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
