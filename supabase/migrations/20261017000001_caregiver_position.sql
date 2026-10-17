-- keep caregivers in the order the agency added them
alter table caregivers add column position int not null default 0;
