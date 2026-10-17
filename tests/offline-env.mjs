// Keep every test worker offline even when the shell has production credentials.
for (const key of [
  'ANTHROPIC_API_KEY',
  'RUNANYWHERE_API_KEY',
  'RUNANYWHERE_BASE_URL',
  'RUNANYWHERE_MODEL',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
]) {
  process.env[key] = '';
}
process.env.NODE_ENV = 'test';
