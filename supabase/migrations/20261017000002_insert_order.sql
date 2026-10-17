-- the app keeps these lists in insertion order and several rows can share a timestamp
alter table requirement_states add column seq bigint generated always as identity;
alter table submissions add column seq bigint generated always as identity;
alter table sms_messages add column seq bigint generated always as identity;
alter table audit_events add column seq bigint generated always as identity;
