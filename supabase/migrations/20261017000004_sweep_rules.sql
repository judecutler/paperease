-- rules for the daily sweep (lib/agent.ts sweep())
alter table agencies
  add column auto_request boolean not null default false,
  add column reminder_after_days int not null default 1,
  add column max_reminders int not null default 2;
