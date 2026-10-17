# CareLoop AI (Hackathon MVP)

Less chasing. More caring. A caregiver document collection agent for California HCOs. The full P0 flow from the PRD (gap detection, SMS requests, photo collection, AI extraction, follow-up questions, admin approval, audit log) runs end to end, even without API keys.

## Running

```bash
npm install
npm run dev        # http://localhost:3000
```

Data is stored in `data/db.json` and seeded with 6 sample caregivers on first run. To reset, use **Reset demo data** on the Rules screen or run `npm run reset`.

### Supabase

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local` and the app reads and writes Supabase instead of `data/db.json`, and stores uploaded photos in the private `uploads` Storage bucket instead of `data/uploads`. The key stays on the server: every table has RLS on with no policies, and files are served through `/api/files`.

```bash
npx supabase link --project-ref <ref>
npx supabase db push      # tables from supabase/migrations
npm run db:seed           # copies data/db.json (or the seed data) into Supabase
```

With Supabase on, **Reset demo data** resets the Supabase tables; `npm run reset` only deletes the local JSON file.

## Demo scenario (PRD section 7, Maria)

1. On the dashboard, Maria Lopez's Entry training is **Missing**. Click the row to open the detail view.
2. **Ask agent to request** → the agent sends an SMS and the status becomes **Requested**.
3. On the phone at the right, send the **Training certificate, hours not shown (Maria)** photo as Maria → the AI extracts 4 fields, asks a follow-up because the hours are missing, and the status becomes **Following up**.
4. Reply with the `It was 5 hours` chip → the agent reads the hours from the reply and prepares the record; the status becomes **Pending review**.
5. **Verify** or **Correct** each field → once all are confirmed, **Approve record** is enabled → **Approved**. The audit log records the entire process in chronological order.

Exception handling (FR-07) can be shown right away too:
- Luis: already **Escalated** because of a blurry photo. Request again, then send "HCA registration, clear photo".
- Sending a document with someone else's name → escalated for name mismatch.
- `I did 3 hours` → escalated for falling short of the 5-hour minimum.
- The wrong document (a TB result instead of a training certificate) → the agent asks for the correct document again.
- `STOP` → opt-out is processed and open requests are handed off to staff.
- Ana and Luis converse in Spanish (P1 multilingual).

## AI integration

Add keys to `.env.local` to use real models (see `.env.example`). If no key is set or a call fails, it always falls back to deterministic behavior.

| Feature | With keys | Without keys |
| --- | --- | --- |
| Document extraction | Claude (`claude-opus-5-5`) vision + structured output. Actually reads the sample PNGs and uploaded photos | Predefined extraction results for each sample document. Photos you upload yourself are escalated for a human to read |
| SMS wording | Written by Claude based on templates | English/Spanish templates |
| Follow-up question wording | RunAnywhere when configured (OpenAI-compatible), otherwise Claude | Templates |
| Reply interpretation | Claude | Number/date rules |

SMS is simulated. To hook up Twilio, send from the single `Ctx.sms()` in `lib/agent.ts` and pass the inbound webhook to the `caregiver-reply` action.

## Structure

- `lib/agent.ts`: agent workflow and all actions (gap detection, requests, reply handling, verification, approval, rejection, rule changes)
- `lib/llm.ts`: Claude / RunAnywhere calls and fallbacks
- `lib/seed.ts`: California HCO checklist (for demo use; verify against official requirements) and sample data
- `lib/db.ts`: `load()`/`save()` for the whole store and `writeUpload()`/`readUpload()` for photos, backed by Supabase when configured (`supabase/migrations`) or local files
- `scripts/seed-supabase.ts`: copies the JSON store into Supabase and checks the round trip
- `components/ui.tsx`: TSX port of the design system reference components
- `app/tokens.css`, `app/components.css`: tokens and component CSS copied from `/design-system`
- `scripts/make-samples.mjs`: generates sample document images (Playwright)

## Principles

- The approve button stays disabled until a human has confirmed every field. The agent never approves a record on its own.
- AI-extracted values and SMS reply values use the blue (agent) style; only human-verified values are green.
- Background checks (Live Scan) are never requested over SMS. Sensitive identifiers are never asked for by text.
- Original documents and previous submissions are kept, never deleted.
