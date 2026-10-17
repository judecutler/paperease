# Security and privacy posture

PaperEase holds names, phone numbers, registration IDs and photos of test results. This page says what protects them today, what does not, and what to do before real caregivers are involved. It is an engineering description, not a compliance certification: nothing here makes a deployment HIPAA-compliant or CCPA-ready by itself.

## What is in place

| Area | What happens | Where |
| --- | --- | --- |
| Admin sign-in | With `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` set, every page and API route needs a signed-in admin. Caregiver upload links, the cron endpoint, regulatory watch, the scheduler API and the Twilio webhooks are the only exceptions, and each checks its own credential. | `middleware.ts`, `lib/auth.ts` |
| Database access | The app server uses the secret key. Row level security is on for every table. Migration `20261018000001` adds agency-scoped policies for signed-in users (members read their agency, only admins write), and makes `audit_events` insert-only for users and uneditable by UPDATE for everyone. Tested against a real Postgres engine in `tests/rls.test.ts`. | `supabase/migrations` |
| Uploaded files | Type allowlist, 5 MB cap, and a check that the file's first bytes match its declared type (a script renamed `.png` is refused). Files are served only to signed-in admins, only by names the app generated, with `no-store` and `nosniff`. Photos from texts are fetched only from Twilio hosts, with the same checks. | `lib/uploads.ts`, `lib/files.ts`, `lib/sms-inbound.ts` |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, HSTS, `frame-ancestors 'none'`, and `no-store` on every API response. | `next.config.mjs` |
| Text messages | Real sending needs Twilio keys, `SMS_LIVE=true` and admin sign-in; otherwise nothing leaves the server. Inbound webhooks must carry a valid Twilio signature (constant-time compare). Repeated deliveries of the same message are processed once. STOP, including a carrier-level STOP, opts the caregiver out and removes their wallet records. | `lib/sms.ts` |
| Scheduler API | Off until `ELIGIBILITY_API_KEYS` is set. Keys are 32+ characters, compared in constant time, rate limited, and answers carry ids and reason codes only. | `lib/apikeys.ts`, `docs/ELIGIBILITY_API.md` |
| Credential wallet | Phone numbers are stored only as a keyed hash (`WALLET_PEPPER`). Photos never enter the wallet. Sharing and receiving each need the caregiver's reply by text. Imported values stay "unconfirmed" until a person at the receiving agency confirms them, and the registry is checked again. Every publish, import, decline and withdrawal is logged against the holder. | `lib/wallet.ts` |
| Logs | Registry IDs are masked in the audit trail. Scheduler checks log ids and codes, not names. Webhook errors never include message text or numbers. | |

## What is not in place

* **One agency per deployment.** The data layer holds a single agency. The database now has the columns and policies a second agency needs, but the app does not yet route requests per agency, so do not host two agencies in one deployment.
* **No script CSP.** Next.js injects inline scripts, so a `script-src` policy needs a nonce setup that has not been done.
* **No malware scanning** of uploads, and PDFs are accepted as-is.
* **No retention or deletion tooling.** Records and photos are kept until someone deletes them in Supabase. A caregiver who leaves, or asks for deletion, needs a manual process today.
* **No field-level encryption.** Supabase encrypts storage at rest; anyone with the secret key or database access can read photos and values.
* **Wallet is not a registry of record.** It carries what one agency confirmed; the receiving agency still decides. Rotating `WALLET_PEPPER` orphans every wallet entry.
* **Rate limiting is per server instance** and in memory.
* **Machine-drafted translations** (Tagalog, Vietnamese, Chinese) have not been reviewed by native speakers.
* **The caregiver upload page** is written in English and Spanish; other languages see English there.
* **Not verified against live services from the build environment:** Twilio, Supabase and the CDSS registry. They are covered by stubs and an in-process Postgres.

## Before real caregivers

1. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`; create admins with `npm run admin:add`; apply every migration.
2. Set `CRON_SECRET`, `PAPEREASE_LINK_SECRET` and (if you use the wallet) `WALLET_PEPPER`, each a long random value.
3. Sign business associate agreements where the data qualifies as protected health information (Supabase, Twilio, Anthropic if document photos go to Claude). Check with counsel whether TB test results make an agency's records PHI in your case.
4. Register the Twilio number for A2P 10DLC and keep the opt-in record: the app logs consent, but the carrier registration is separate.
5. Decide how long photos are kept and who can delete them.
6. Have native speakers review any non-English message copy you enable.
