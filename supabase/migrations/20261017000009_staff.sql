-- staff: each admin account's profile and the HCO caregivers hear from; caregivers get a responsible staff member
create table staff (
  email text primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  position int not null default 0,
  name text not null,
  hco jsonb not null -- {name, license, address, phone}
);
alter table staff enable row level security;

alter table caregivers add column assigned_to text;
create index on caregivers (assigned_to);
