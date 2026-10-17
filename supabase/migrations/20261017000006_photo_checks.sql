-- Existing installations need this additive migration as well as fresh databases.
alter table public.sms_messages
  add column if not exists photo_check jsonb;

comment on column public.sms_messages.photo_check is
  'Preliminary per-attachment photo-check snapshot. NULL for older messages or messages without a photo check; final staff approval is stored separately.';
