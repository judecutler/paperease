-- CareLoop AI: Postgres schema for moving the demo store (lib/db.ts) to Supabase.
-- The app currently keeps the same shapes in data/db.json.

create table caregivers (
  id text primary key,
  agency_id uuid not null,
  name text not null,
  first_name text not null,
  phone text not null,
  language text not null default 'en' check (language in ('en', 'es')),
  hired_on date not null,
  sms_consent boolean not null default false,
  opted_out boolean not null default false
);

create table requirement_types (
  id text primary key,
  agency_id uuid not null,
  name text not null,
  rule text not null,
  sms_collectible boolean not null,
  valid_months int,
  min_hours numeric,
  fields jsonb not null -- [{key,label,required,kind}]
);

create table requirement_states (
  caregiver_id text references caregivers(id) on delete cascade,
  requirement_id text references requirement_types(id),
  status text not null check (status in ('missing','requested','following-up','pending-review','escalated','expiring','approved')),
  explanation text not null,
  expires_on date,
  approved_submission_id text,
  open_submission_id text,
  primary key (caregiver_id, requirement_id)
);

-- every submission is kept (versions); approval never overwrites the original
create table submissions (
  id text primary key,
  caregiver_id text references caregivers(id) on delete cascade,
  requirement_id text references requirement_types(id),
  files jsonb not null default '[]',     -- [{name,url,mime}] -> Supabase Storage paths
  fields jsonb not null default '[]',    -- [{key,label,value,required,source,confidence,sourceRef,verifiedBy}]
  extracted_by text not null,
  state text not null check (state in ('collecting','ready','escalated','approved','rejected')),
  escalation text,
  follow_ups int not null default 0,
  supersedes text references submissions(id),
  created_at timestamptz not null default now()
);

create table sms_messages (
  id text primary key,
  caregiver_id text references caregivers(id) on delete cascade,
  sender text not null check (sender in ('agent','admin','caregiver')),
  body text,
  attachment jsonb,
  sent_at timestamptz not null default now()
);

-- append-only
create table audit_events (
  id text primary key,
  caregiver_id text references caregivers(id),
  requirement_id text,
  actor text not null check (actor in ('agent','admin','caregiver','system')),
  who text,
  action text not null,
  detail text,
  at timestamptz not null default now()
);

alter table caregivers enable row level security;
alter table requirement_types enable row level security;
alter table requirement_states enable row level security;
alter table submissions enable row level security;
alter table sms_messages enable row level security;
alter table audit_events enable row level security;
-- add agency-scoped policies once Supabase Auth is wired (admins see only their agency_id)
