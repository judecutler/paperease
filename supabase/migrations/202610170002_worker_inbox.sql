-- Worker identities are mapped by a trusted administrator. Workers cannot select their own tenant/worker ID.
begin;
create table if not exists public.reg_worker_memberships (
 user_id uuid primary key references auth.users(id),
 agency_id uuid not null,
 worker_id text not null,
 created_at timestamptz not null default now()
);
alter table public.reg_worker_memberships enable row level security;
revoke all on public.reg_worker_memberships from anon,authenticated;
grant all on public.reg_worker_memberships to service_role;
commit;
