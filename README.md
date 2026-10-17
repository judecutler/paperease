# CareLoop AI

**Less chasing. More caring.**

CareLoop is an AI agent that collects compliance documents from home care caregivers over SMS. It is built for California home care organizations (HCOs). The agent finds missing or expiring documents, texts the caregiver, reads the photo they send back, and asks follow-up questions. It then prepares a record for a person to verify and approve.

Built as a hackathon MVP. The full flow runs end to end with no API keys and no database.

![Dashboard](docs/dashboard.png)

## Features

- **Gap detection:** checks every caregiver against the requirement checklist and flags documents that are missing or expiring.
- **SMS outreach:** the agent requests documents in the caregiver's language (English or Spanish) and sends reminders.
- **AI extraction:** reads the photo the caregiver sends and fills in each field with a confidence score and a pointer to where on the document it was found.
- **Photo checks in messages:** shows each attachment's preliminary result and next step, with a detailed checklist available in the conversation.
- **Follow-ups:** when a required field is missing, the agent asks the caregiver and reads the answer from their reply.
- **Daily sweep:** every morning the agent re-checks expiry dates and reminds caregivers who have not replied. Requests that stay silent go to a person. It can also request new gaps on its own if you turn that on.
- **Exception handling:** escalates to a person for blurry photos, name mismatches, too few training hours, wrong documents and opt-outs.
- **Human approval:** a person verifies or corrects every field before a record can be approved.
- **Audit trail:** every action by the agent, the admin and the caregiver is logged in order.

![Reviewing a record](docs/maria-review.png)

## Quick start

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # http://localhost:3000
```

On first run the app creates `data/db.json` with 6 sample caregivers. To start over, click **Reset demo data** on the Rules screen or run `npm run reset`.

## Demo walkthrough

1. On the dashboard, Maria Lopez's **Entry training** is **Missing**. Click her row.
2. Click **Ask agent to request**. The agent texts Maria and the status becomes **Requested**.
3. On the simulated phone at the right, choose **Entry training** under **Check document for**, then send the **Training certificate, hours not shown (Maria)** sample photo. Its message shows **More information needed** and a suggested next step. Expand **View checks** to inspect the detailed result. The agent sees the hours are missing and asks a follow-up. The status becomes **Following up**.
4. Reply with the **It was 5 hours** chip. The agent reads the hours from the reply and prepares the record. The status becomes **Pending review**.
5. **Verify** or **Correct** each field. Once every field is confirmed, **Approve record** turns on. Approve it, then check the audit trail.

Other cases to try:

| Try this | What happens |
| --- | --- |
| Luis is already **Escalated** for a blurry photo. Request again and send **HCA registration, clear photo** | The agent extracts the registration |
| Send a document with someone else's name | Escalated for a name mismatch |
| Reply `I did 3 hours` | Escalated for falling short of the 5-hour minimum |
| Send a TB result instead of a training certificate | The agent asks for the right document |
| Reply `STOP` | The caregiver is opted out and open requests go to staff |
| Open Ana or Luis | The conversation is in Spanish |

## Configuration

Everything is optional. Copy `.env.example` to `.env.local` and fill in what you need.

| Variable | Used for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude reads documents, writes SMS copy and interprets replies |
| `CARELOOP_MODEL` | Claude model (default `claude-opus-5-5`) |
| `RUNANYWHERE_BASE_URL`, `RUNANYWHERE_API_KEY`, `RUNANYWHERE_MODEL` | Follow-up question copy through RunAnywhere (OpenAI-compatible) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Store data and uploads in Supabase instead of local files |
| `CRON_SECRET` | Protects `/api/cron`, the daily sweep endpoint. Required in production |
| `CARELOOP_DATA_DIR` | Where the local JSON store and uploads live (default `./data`) |

### AI

Each AI feature falls back to deterministic behavior when no key is set or a call fails.

| Feature | With keys | Without keys |
| --- | --- | --- |
| Document extraction | Claude vision with structured output reads sample and uploaded photos | Preset results for each sample document. Your own uploads are escalated for a person to read |
| SMS copy | Claude, based on templates | English and Spanish templates |
| Follow-up questions | RunAnywhere if configured, otherwise Claude | Templates |
| Reply interpretation | Claude | Number and date rules |

SMS is simulated. To connect Twilio, send from `Ctx.sms()` in `lib/agent.ts` and route inbound webhooks to the `caregiver-reply` action.

### Photo checks in messages

Choose an open document request and use **Send sample photo** for a sample, or **Upload your own photo** for an image (up to 5 MB). Upload and analysis progress appear in the composer, followed by the result and a suggested next step beside that attachment. Expand **View checks** to see the detailed checklist. Each result is saved with its message; later replies do not rewrite the earlier photo's result.

The checks cover readability, requested document type, caregiver name, reading confidence, required information and training hours where applicable. The outcome is one of **Ready for staff review**, **More information needed**, **Staff review needed** or **Not checked**. A pass means that a preliminary check passed; it does not establish document authenticity or final approval.

Real image analysis uses the existing Anthropic configuration. Sample fallbacks are explicitly labeled **Demo result**. An uploaded image with no configured AI, an analysis failure, or an unsupported PDF is marked **Not checked** and left for staff; it is never treated as a successful check. PDFs remain available as original attachments for manual review.

The `caregiver-reply` action accepts `requirementId` to route the reply to an open request. When several requests are open, this is required: the agent does not guess which record a photo belongs to. Closed or invalid targets are left unassessed. SMS opt-out and consent also apply to photo collection. Photo checks are preliminary; a person still verifies the fields and approves the record.

Photo-check cases to try without AI keys:

| Sample or action | Photo-check result |
| --- | --- |
| Maria's **Training transcript with hours** for Entry training | **Ready for staff review**; every extracted field still needs a person's verification |
| Maria's **Training certificate, hours not shown** | **More information needed**; provide the missing training hours |
| A document with another caregiver's name, or a blurry sample | **Staff review needed**; mismatches or unreadable content are flagged |
| A TB result for an Entry training request | **More information needed**; send the requested document |
| Upload your own image without an AI key, or upload a PDF | **Not checked**; staff must read the original attachment |

### Daily sweep

Once a day the agent:

1. Re-checks expiry dates and flags documents that are expiring or expired.
2. If **automatic requests** are on in Rules, texts caregivers about new gaps. They are off by default, so the agent only texts about gaps an admin has asked it to collect.
3. Sends a reminder for any open request with no reply after the configured number of days.
4. Escalates to a person once the reminder limit is reached. A caregiver's reply restarts the count.

`vercel.json` runs it through Vercel Cron at 16:00 UTC (9 AM in California during daylight saving time). Vercel sends `Authorization: Bearer $CRON_SECRET`; any other scheduler can call `GET /api/cron` the same way. To run it by hand, click **Run daily sweep now** on the dashboard.

### Supabase

With `SUPABASE_URL` and `SUPABASE_SECRET_KEY` set, the app stores its data in Supabase tables. Uploaded photos go to a private `uploads` Storage bucket. The secret key is only used on the server. Every table has RLS turned on with no policies, and files are served through `/api/files`.

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push      # creates the tables and bucket from supabase/migrations
npm run db:seed           # copies data/db.json (or the sample data) into Supabase
```

With Supabase on, **Reset demo data** resets the Supabase tables. `npm run reset` only deletes the local JSON file.

## Validation

```bash
npm test
npm run typecheck
npm run build
```

`npm test` runs 31 offline photo-check and workflow cases, including document routing, missing fields, mismatches, unavailable analysis, manual approval and a mocked Supabase message roundtrip. The tests use deterministic fixtures, disable provider and Supabase keys and network requests, and use a separate temporary data directory. They do not make model calls or change the demo's saved records. The `tsx` development dependency runs TypeScript tests and the database seeding script.

## Project structure

| Path | What it does |
| --- | --- |
| `lib/agent.ts` | Agent workflow and every action: gap detection, requests, replies, verification, approval, rejection, rule changes |
| `lib/llm.ts` | Claude and RunAnywhere calls with fallbacks |
| `lib/photo-check.ts` | Per-attachment checks and preliminary outcomes |
| `lib/db.ts` | Storage for data (`load()`/`save()`) and uploads (`writeUpload()`/`readUpload()`), in Supabase or local files |
| `lib/seed.ts` | Requirement checklist and sample data |
| `app/` | Next.js pages (dashboard, caregiver detail, audit trail, rules) and API routes, including `api/cron` for the daily sweep |
| `components/` | UI components and the client data hook |
| `components/PhotoCheckCard.tsx` | Compact message-thread result with expandable check details |
| `supabase/migrations/` | Postgres tables and the Storage bucket |
| `scripts/seed-supabase.ts` | Copies the local store into Supabase and checks the round trip |
| `scripts/make-samples.mjs` | Generates the sample document images with Playwright |
| `tests/` | Offline photo-check and persisted workflow tests |

## Design principles

- **A person approves every record.** The approve button stays off until a person has verified every field. The agent never approves on its own.
- **AI values look different from verified ones.** Values from AI extraction or SMS replies are shown in blue. Only values a person has verified turn green.
- **No sensitive data over SMS.** Background checks (Live Scan) are handled by staff, and the agent never asks for sensitive identifiers by text.
- **Nothing is overwritten.** Original documents and earlier submissions are kept.

## Disclaimer

The requirement checklist in `lib/seed.ts` is a simplified demo version. Check it against current California Home Care Services Bureau requirements before using it for real compliance work. All people, phone numbers and documents in the sample data are fictional.
