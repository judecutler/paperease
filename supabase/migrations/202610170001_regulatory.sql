-- Additive migration: does not modify or seed the existing CareLoop tables.
begin;
create table if not exists public.reg_documents (
 id text primary key, body jsonb not null, revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.reg_memberships (
 user_id uuid not null references auth.users(id), agency_id uuid not null,
 role text not null check(role in ('admin','viewer')), created_at timestamptz not null default now(),
 primary key(user_id,agency_id)
);
alter table public.reg_documents enable row level security;
alter table public.reg_memberships enable row level security;
revoke all on public.reg_documents, public.reg_memberships from anon,authenticated;
grant all on public.reg_documents, public.reg_memberships to service_role;
create or replace function public.reg_compare_and_swap(p_id text,p_body jsonb,p_revision bigint)
returns bigint language plpgsql security invoker set search_path = public as $$
declare result bigint;
begin
 if p_revision = 0 then
  insert into reg_documents(id,body,revision) values(p_id,p_body,1) on conflict do nothing returning revision into result;
 else
  update reg_documents set body=p_body,revision=revision+1,updated_at=now() where id=p_id and revision=p_revision returning revision into result;
 end if;
 return result;
end $$;
revoke all on function public.reg_compare_and_swap(text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.reg_compare_and_swap(text,jsonb,bigint) to service_role;
commit;
