-- HCOs become the unit of isolation: staff and caregivers belong to one, and staff see only their own HCO's data.
-- The HCO details move out of staff into their own table; the app refills the demo HCOs on load.
create table hcos (
  id text primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  position int not null default 0,
  name text not null,
  license text not null default '',
  address text not null default '',
  phone text not null default ''
);
alter table hcos enable row level security;

alter table staff drop column hco;
alter table staff add column hco_id text references hcos(id);
alter table caregivers add column hco_id text references hcos(id);
create index on staff (hco_id);
create index on caregivers (hco_id);
