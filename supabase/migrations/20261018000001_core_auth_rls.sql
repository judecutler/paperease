-- Agency-scoped row level security for the core tables.
--
-- The app server uses the service role key (it bypasses RLS) and checks sign-in itself (lib/access.ts).
-- These policies are the second lock: if a table is ever reached with a user's own JWT (or the publishable
-- key by mistake), a signed-in admin sees only their agency, a viewer can read but not change, and nobody
-- can edit or delete audit history. Membership comes from reg_memberships (20261017 regulatory migration).

-- child tables get agency_id so a policy never needs a join through another table
alter table requirement_states add column if not exists agency_id uuid references agencies(id) on delete cascade;
alter table submissions        add column if not exists agency_id uuid references agencies(id) on delete cascade;
alter table sms_messages       add column if not exists agency_id uuid references agencies(id) on delete cascade;
alter table audit_events       add column if not exists agency_id uuid references agencies(id) on delete cascade;

update requirement_states s set agency_id = c.agency_id from caregivers c where s.caregiver_id = c.id and s.agency_id is null;
update submissions        s set agency_id = c.agency_id from caregivers c where s.caregiver_id = c.id and s.agency_id is null;
update sms_messages       s set agency_id = c.agency_id from caregivers c where s.caregiver_id = c.id and s.agency_id is null;
update audit_events       s set agency_id = c.agency_id from caregivers c where s.caregiver_id = c.id and s.agency_id is null;
-- agency-wide events (rules changed, sweep ran) have no caregiver; they belong to the demo agency today
update audit_events set agency_id = '00000000-0000-0000-0000-000000000001' where agency_id is null;

-- the single-agency app writes the agency id itself; the default keeps older code paths working
alter table requirement_states alter column agency_id set default '00000000-0000-0000-0000-000000000001';
alter table submissions        alter column agency_id set default '00000000-0000-0000-0000-000000000001';
alter table sms_messages       alter column agency_id set default '00000000-0000-0000-0000-000000000001';
alter table audit_events       alter column agency_id set default '00000000-0000-0000-0000-000000000001';

create index if not exists requirement_states_agency on requirement_states (agency_id);
create index if not exists submissions_agency on submissions (agency_id);
create index if not exists sms_messages_agency on sms_messages (agency_id);
create index if not exists audit_events_agency on audit_events (agency_id);

-- helper: agencies the signed-in user belongs to, optionally only as admin
create or replace function careloop_agencies(admin_only boolean default false)
returns setof uuid language sql stable security definer set search_path = public as $$
  select agency_id from reg_memberships
  where user_id = auth.uid() and (not admin_only or role = 'admin')
$$;
revoke all on function careloop_agencies(boolean) from public, anon;
grant execute on function careloop_agencies(boolean) to authenticated;

-- members read their own agency
create policy agencies_read on agencies for select to authenticated using (id in (select careloop_agencies()));
create policy caregivers_read on caregivers for select to authenticated using (agency_id in (select careloop_agencies()));
create policy requirement_types_read on requirement_types for select to authenticated using (agency_id in (select careloop_agencies()));
create policy requirement_states_read on requirement_states for select to authenticated using (agency_id in (select careloop_agencies()));
create policy submissions_read on submissions for select to authenticated using (agency_id in (select careloop_agencies()));
create policy sms_messages_read on sms_messages for select to authenticated using (agency_id in (select careloop_agencies()));
create policy audit_events_read on audit_events for select to authenticated using (agency_id in (select careloop_agencies()));

-- admins change records; audit_events is insert-only for everyone
create policy caregivers_write on caregivers for all to authenticated
  using (agency_id in (select careloop_agencies(true))) with check (agency_id in (select careloop_agencies(true)));
create policy requirement_types_write on requirement_types for all to authenticated
  using (agency_id in (select careloop_agencies(true))) with check (agency_id in (select careloop_agencies(true)));
create policy requirement_states_write on requirement_states for all to authenticated
  using (agency_id in (select careloop_agencies(true))) with check (agency_id in (select careloop_agencies(true)));
create policy submissions_write on submissions for all to authenticated
  using (agency_id in (select careloop_agencies(true))) with check (agency_id in (select careloop_agencies(true)));
create policy sms_messages_write on sms_messages for all to authenticated
  using (agency_id in (select careloop_agencies(true))) with check (agency_id in (select careloop_agencies(true)));
create policy audit_events_insert on audit_events for insert to authenticated
  with check (agency_id in (select careloop_agencies(true)));

-- history cannot be edited in place (UPDATE). Deleting the whole agency still cascades, as reset() needs.
-- the app upserts audit rows by id; an identical re-send must stay a no-op rather than an error
create or replace function careloop_audit_guard() returns trigger language plpgsql as $$
begin
  if new is not distinct from old then return null; end if;
  raise exception 'audit_events is append-only';
end $$;
create trigger audit_events_no_update before update on audit_events
  for each row execute function careloop_audit_guard();
