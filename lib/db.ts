import fs from 'node:fs';
import path from 'node:path';
import { seedDb } from './seed';
import type { Db } from './types';

// Local JSON persistence for the demo. The whole store goes through load()/save(),
// so swapping in Supabase means replacing these two functions (schema in supabase/schema.sql).

const DATA_DIR = process.env.CARELOOP_DATA_DIR || (process.env.VERCEL ? '/tmp/careloop' : path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let memory: Db | null = null;

export function load(): Db {
  if (memory) return memory;
  try {
    memory = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Db;
  } catch {
    memory = seedDb();
    save(memory);
  }
  return memory;
}

export function save(db: Db) {
  memory = db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch {
    // read-only filesystem: keep the in-memory copy
  }
}

export function reset(): Db {
  memory = seedDb();
  save(memory);
  return memory;
}

let counter = 0;
export function newId(prefix: string) {
  counter = (counter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
