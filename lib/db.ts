import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_RULES, seedDb } from './seed';
import type { AuditEvent, Caregiver, Db, RequirementState, RequirementType, SmsMessage, Submission } from './types';

// The whole store goes through load()/save(), uploads through writeUpload()/readUpload(). With SUPABASE_URL and
// SUPABASE_SECRET_KEY set they live in Supabase (tables and the uploads bucket in supabase/migrations);
// otherwise in a local JSON file and folder for the demo.

const DATA_DIR = process.env.PAPEREASE_DATA_DIR || (process.env.VERCEL ? '/tmp/paperease' : path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BUCKET = 'uploads';

// the demo runs a single agency
const AGENCY_ID = '00000000-0000-0000-0000-000000000001';

let client: SupabaseClient | null | undefined;
function supabase() {
  if (process.env.REGULATORY_LOCAL_DEMO === 'true' && process.env.NODE_ENV !== 'production') return null;
  if (client === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  }
  return client;
}

export function storage(): 'supabase' | 'json' {
  return supabase() ? 'supabase' : 'json';
}

let memory: Db | null = null;

export async function load(): Promise<Db> {
  const sb = supabase();
  if (sb) {
    const db = await loadSupabase(sb);
    if (db) return db;
    const seeded = seedDb();
    await saveSupabase(sb, seeded);
    return seeded;
  }
  if (memory) return memory;
  try {
    memory = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Db;
    // stores written before a rule existed pick up its default
    memory.rules = { ...DEFAULT_RULES, ...memory.rules };
  } catch {
    memory = seedDb();
    await save(memory);
  }
  return memory;
}

export async function save(db: Db) {
  const sb = supabase();
  if (sb) return saveSupabase(sb, db);
  memory = db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch {
    // read-only filesystem: keep the in-memory copy
  }
}

export async function reset(): Promise<Db> {
  const db = seedDb();
  const sb = supabase();
  if (sb) {
    // the agency row cascades to every other table
    check(await sb.from('agencies').delete().eq('id', AGENCY_ID));
  }
  await save(db);
  return db;
}

export async function writeUpload(name: string, bytes: Buffer, mime: string) {
  const sb = supabase();
  if (sb) {
    check(await sb.storage.from(BUCKET).upload(name, bytes, { contentType: mime }));
    return;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
}

export async function readUpload(name: string): Promise<Buffer | null> {
  const sb = supabase();
  if (sb) {
    const { data } = await sb.storage.from(BUCKET).download(name);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }
  const file = path.join(UPLOAD_DIR, name);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

let counter = 0;
export function newId(prefix: string) {
  counter = (counter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

// ---- Supabase mapping (camelCase app types <-> snake_case columns) ----

function check<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res;
}

const iso = (t: string) => new Date(t).toISOString();
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

async function loadSupabase(sb: SupabaseClient): Promise<Db | null> {
  const rows = async (q: PromiseLike<{ data: any[] | null; error: { message: string } | null }>) => check(await q).data ?? [];
  const [agencies, reqTypes, caregivers, states, subs, msgs, audit] = await Promise.all([
    rows(sb.from('agencies').select('*').eq('id', AGENCY_ID)),
    rows(sb.from('requirement_types').select('*').eq('agency_id', AGENCY_ID).order('position')),
    rows(sb.from('caregivers').select('*').eq('agency_id', AGENCY_ID).order('position')),
    rows(sb.from('requirement_states').select('*').order('seq')),
    rows(sb.from('submissions').select('*').order('seq')),
    rows(sb.from('sms_messages').select('*').order('seq')),
    rows(sb.from('audit_events').select('*').order('seq')),
  ]);
  const a = agencies[0];
  if (!a) return null;
  return {
    version: 1,
    agency: { name: a.name, admin: a.admin },
    rules: {
      expiringWithinDays: a.expiring_within_days,
      minConfidence: Number(a.min_confidence),
      maxFollowUps: a.max_follow_ups,
      autoRequest: a.auto_request,
      reminderAfterDays: a.reminder_after_days,
      maxReminders: a.max_reminders,
      requirements: reqTypes.map((r): RequirementType => ({
        id: r.id,
        name: r.name,
        rule: r.rule,
        smsCollectible: r.sms_collectible,
        validMonths: r.valid_months,
        ...(r.min_hours !== null && { minHours: Number(r.min_hours) }),
        fields: r.fields,
        ask: r.ask,
      })),
    },
    caregivers: caregivers.map((c): Caregiver => ({
      id: c.id,
      name: c.name,
      firstName: c.first_name,
      phone: c.phone,
      language: c.language,
      hiredOn: c.hired_on,
      smsConsent: c.sms_consent,
      ...(c.opted_out && { optedOut: true }),
    })),
    requirements: states.map((s): RequirementState => ({
      caregiverId: s.caregiver_id,
      requirementId: s.requirement_id,
      status: s.status,
      explanation: s.explanation,
      expiresOn: opt(s.expires_on),
      approvedSubmissionId: opt(s.approved_submission_id),
      openSubmissionId: opt(s.open_submission_id),
    })),
    submissions: subs.map((s): Submission => ({
      id: s.id,
      caregiverId: s.caregiver_id,
      requirementId: s.requirement_id,
      files: s.files,
      fields: s.fields,
      extractedBy: s.extracted_by,
      createdAt: iso(s.created_at),
      state: s.state,
      escalation: opt(s.escalation),
      followUps: s.follow_ups,
      supersedes: opt(s.supersedes),
      registryCheck: opt(s.registry_check),
    })),
    messages: msgs.map((m): SmsMessage => ({
      id: m.id,
      caregiverId: m.caregiver_id,
      from: m.sender,
      text: opt(m.body),
      attachment: opt(m.attachment),
      photoCheck: opt(m.photo_check),
      time: iso(m.sent_at),
    })),
    audit: audit.map((e): AuditEvent => ({
      id: e.id,
      caregiverId: opt(e.caregiver_id),
      requirementId: opt(e.requirement_id),
      actor: e.actor,
      who: opt(e.who),
      action: e.action,
      detail: opt(e.detail),
      time: iso(e.at),
    })),
  };
}

// upserts every row; the app never deletes rows outside reset()
async function saveSupabase(sb: SupabaseClient, db: Db) {
  check(await sb.from('agencies').upsert({
    id: AGENCY_ID,
    name: db.agency.name,
    admin: db.agency.admin,
    expiring_within_days: db.rules.expiringWithinDays,
    min_confidence: db.rules.minConfidence,
    max_follow_ups: db.rules.maxFollowUps,
    auto_request: db.rules.autoRequest,
    reminder_after_days: db.rules.reminderAfterDays,
    max_reminders: db.rules.maxReminders,
  }));
  const upsert = async (table: string, rows: object[], onConflict = 'id') => {
    if (rows.length) check(await sb.from(table).upsert(rows, { onConflict }));
  };
  await upsert('requirement_types', db.rules.requirements.map((r, i) => ({
    id: r.id,
    agency_id: AGENCY_ID,
    position: i,
    name: r.name,
    rule: r.rule,
    sms_collectible: r.smsCollectible,
    valid_months: r.validMonths,
    min_hours: r.minHours ?? null,
    ask: r.ask,
    fields: r.fields,
  })));
  await upsert('caregivers', db.caregivers.map((c, i) => ({
    id: c.id,
    agency_id: AGENCY_ID,
    position: i,
    name: c.name,
    first_name: c.firstName,
    phone: c.phone,
    language: c.language,
    hired_on: c.hiredOn,
    sms_consent: c.smsConsent,
    opted_out: c.optedOut ?? false,
  })));
  await upsert('submissions', db.submissions.map((s) => ({
    id: s.id,
    caregiver_id: s.caregiverId,
    requirement_id: s.requirementId,
    files: s.files,
    fields: s.fields,
    extracted_by: s.extractedBy,
    state: s.state,
    escalation: s.escalation ?? null,
    follow_ups: s.followUps,
    supersedes: s.supersedes ?? null,
    registry_check: s.registryCheck ?? null,
    created_at: s.createdAt,
  })));
  await Promise.all([
    upsert('requirement_states', db.requirements.map((s) => ({
      caregiver_id: s.caregiverId,
      requirement_id: s.requirementId,
      status: s.status,
      explanation: s.explanation,
      expires_on: s.expiresOn ?? null,
      approved_submission_id: s.approvedSubmissionId ?? null,
      open_submission_id: s.openSubmissionId ?? null,
    })), 'caregiver_id,requirement_id'),
    upsert('sms_messages', db.messages.map((m) => ({
      id: m.id,
      caregiver_id: m.caregiverId,
      sender: m.from,
      body: m.text ?? null,
      attachment: m.attachment ?? null,
      photo_check: m.photoCheck ?? null,
      sent_at: m.time,
    }))),
    upsert('audit_events', db.audit.map((e) => ({
      id: e.id,
      caregiver_id: e.caregiverId ?? null,
      requirement_id: e.requirementId ?? null,
      actor: e.actor,
      who: e.who ?? null,
      action: e.action,
      detail: e.detail ?? null,
      at: e.time,
    }))),
  ]);
}
