-- CareLoop AI: Postgres schema for the store in lib/db.ts.
-- Without SUPABASE_URL the app keeps the same shapes in data/db.json.

-- one row per agency; holds the compliance thresholds (Rules) too
create table agencies (
  id uuid primary key,
  name text not null,
  admin text not null,
  expiring_within_days int not null,
  min_confidence numeric not null,
  max_follow_ups int not null
);

create table requirement_types (
  id text primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  position int not null default 0,
  name text not null,
  rule text not null,
  sms_collectible boolean not null,
  valid_months int,
  min_hours numeric,
  ask text not null,
  fields jsonb not null -- [{key,label,required,kind}]
);

create table caregivers (
  id text primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  first_name text not null,
  phone text not null,
  language text not null default 'en' check (language in ('en', 'es')),
  hired_on date not null,
  sms_consent boolean not null default false,
  opted_out boolean not null default false
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
  files jsonb not null default '[]',     -- [{name,url,mime}]
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
  caregiver_id text references caregivers(id) on delete cascade,
  requirement_id text,
  actor text not null check (actor in ('agent','admin','caregiver','system')),
  who text,
  action text not null,
  detail text,
  at timestamptz not null default now()
);

create index on requirement_states (requirement_id);
create index on submissions (caregiver_id);
create index on submissions (requirement_id);
create index on submissions (supersedes);
create index on sms_messages (caregiver_id, sent_at);
create index on audit_events (caregiver_id, at);
create index on requirement_types (agency_id);
create index on caregivers (agency_id);

-- the app talks to these tables only from the server with the service role key.
-- RLS with no policies keeps them closed to the anon/publishable key.
-- add agency-scoped policies once Supabase Auth is wired (admins see only their agency_id)
alter table agencies enable row level security;
alter table caregivers enable row level security;
alter table requirement_types enable row level security;
alter table requirement_states enable row level security;
alter table submissions enable row level security;
alter table sms_messages enable row level security;
alter table audit_events enable row level security;
