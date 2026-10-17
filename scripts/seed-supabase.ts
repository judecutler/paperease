// Copies data/db.json (or the seed data when it is missing) into Supabase, then reads it back to check the round trip.
// npm run db:seed
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { load, save, storage } from '../lib/db';
import { seedDb } from '../lib/seed';
import type { Db } from '../lib/types';

if (storage() !== 'supabase') throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');

async function main() {
  const file = 'data/db.json';
  const db: Db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : seedDb();
  await save(db);
  const json = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(json(await load()), json(db));
  console.log(`Copied ${fs.existsSync(file) ? file : 'seed data'} to Supabase: ${db.caregivers.length} caregivers, ${db.requirements.length} requirement states, ${db.submissions.length} submissions, ${db.messages.length} messages, ${db.audit.length} audit events.`);
}

main();
