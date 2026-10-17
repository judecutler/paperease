-- More SMS languages: Tagalog, Vietnamese, Chinese (Simplified). Matches LangCode in lib/types.ts.
alter table caregivers drop constraint if exists caregivers_language_check;
alter table caregivers add constraint caregivers_language_check check (language in ('en', 'es', 'tl', 'vi', 'zh'));
