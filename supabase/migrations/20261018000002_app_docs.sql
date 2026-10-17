-- Named JSON documents used beside the main tables (credential wallet: key "wallet").
-- Server-only: RLS on with no policies keeps it closed to the anon and authenticated keys.
create table if not exists app_docs (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_docs enable row level security;
