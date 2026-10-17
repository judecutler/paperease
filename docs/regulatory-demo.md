# Regulatory watch demo

## Present it

Use Node 24 or later. From the repository root:

```sh
npm install
npm run demo
```

Open http://127.0.0.1:3000/regulatory and click **Reset guided demo**. No account or API credit is needed for this scenario. It is explicitly labelled as a simulated company-policy change, not an actual legislative amendment. It runs in an isolated local store; Supabase team data is not reset.

1. **Changes:** show the simulated change from three to five training hours, the source text and the previous version.
2. Explain the profile: the fictional agency has headquarters in New York, Maria resides in Nevada, and her service assignment is in California. The impact preview matches the California service assignment.
3. Add review notes, check the source-review confirmation, and click **Approve version**.
4. Click **Adopt applicable obligations**. Adoption creates a worker action and a versioned document checklist.
5. Open **Checklist**, expand **Submit new evidence**, and upload `public/samples/training-transcript-maria.png`. Choose an evidence date and explain how it meets the simulated obligation.
6. Submit, verify all three fields against the original, and **Approve evidence**. Document approval and action completion remain distinct.
7. A prominent alert banner appears as soon as the simulated change is detected. Open **Notifications** to see persistent staff alerts and mark them as read.
8. After adoption, the PaperEase agent publishes one targeted in-app message for Maria. The agency can preview it in **Notifications**. Click **Open worker inbox** to show the worker-facing page with the requirement, assignment-specific reason, next action, citation and dates.
9. In the worker inbox, click **I have read this update**. The agency preview then shows **Acknowledged**. Reading a message does not approve evidence or establish compliance.
10. Open **Operations** for the audit log; **Coverage** shows all 50 states plus DC and federal sources.

Use **Reset guided demo** to repeat the presentation. The original dashboard and California document-collection demonstration remain accessible. In local demo mode, their persistence also stays local; the shared Supabase store and daily-sweep implementation from main remain available in normal mode.

## Live integration

Run `npm run dev` without local-demo mode to use Supabase. The additive migration `supabase/migrations/20261017000007_regulatory.sql` has been applied to the configured project. Do not run the old `supabase/schema.sql` over the team's existing database.

Sign in with an application user from **Supabase Authentication**, not the Supabase dashboard account. The first sign-in can create that user's private regulatory workspace. An administrator can add teammates to the same agency through `reg_memberships`; never share the project's secret key in the browser.

Required server settings:

```dotenv
SUPABASE_URL=
SUPABASE_SECRET_KEY=
RUNANYWHERE_BASE_URL=
RUNANYWHERE_API_KEY=
RUNANYWHERE_MODEL=
```

Optional controls are documented in `.env.example`. `REGULATORY_CURATOR_IDS` contains Supabase Auth user UUIDs permitted to enable shared sources. Agency admins may review and adopt rules only in their own agency. The initial corpus and source registry are shared; worker information and uploaded evidence are private.

```sh
npm run regulatory:check       # live storage + small AI request + official capture
npm run regulatory:inventory   # checks official state discovery starting points
npm run regulatory:worker      # persistent scheduler/worker; keep this running
npm run regulatory:once        # one bounded stage for diagnostics
```

The worker automatically queues enabled sources when due. Capturing a legal source and extracting all sections can require multiple ticks. Each tick resumes from a durable checkpoint; failures are visible with bounded retries. Discovery links are registered for review through the Sources screen. A source registered as discovery is never converted directly into an obligation.

The optional scheduler endpoint is `POST /api/regulatory/worker` with bearer `REGULATORY_CRON_SECRET` (at least 32 random characters). Each call performs one stage. It requires a reachable deployed app and an external scheduler. The persistent worker does not require that endpoint or secret.

For a VM/container host, build `worker.Dockerfile` and supply runtime secrets through the host's secret manager. This repository does not contain a paid Freestyle deployment or a Freestyle credential. No scheduler is claimed to run after the local machine stops.

## Implemented boundaries

- Source capture: HTTPS official-host restriction, public-IP checks, redirect validation, response limits, raw snapshot retention, HTML/PDF parsing and explicit unreadable-PDF errors. OCR and browser-based source retrieval are follow-ups.
- AI: RunAnywhere only for regulatory extraction; schema checks and verbatim evidence validation; conservative daily request/token ceilings. No automatic paid provider fallback.
- Review: unknown dates, proposals, unresolved conditions, stale/failed sources and incomplete scope prevent adoption. Future-effective changes stay in the inbox until applicable.
- Applicability: agency type, service track, worker role, payer and service state. Medicaid program details, local rules and unresolved exceptions require manual follow-up. The system does not independently verify license privileges.
- Checklists: agency actions are separate from worker documents. Worker evidence is mapped to an exact rule version and reviewed manually; legal renewal schedules and training thresholds are not inferred from a generic evidence date.
- Isolation: verified Supabase Auth sessions, server-only secret, tenant document keys, CAS writes and an additive SQL migration with RLS and no anonymous/authenticated direct table grants.
- Persistence: JSON documents in Postgres provide transactional compare-and-swap for this hackathon. A normalized, paginated corpus and object storage should replace document aggregation for large production workloads.

All states are represented, but initial discovery pages do not constitute a complete legal corpus. The first live inventory verified 31 of 51 state/DC starting pages; other sources require parser/link/access follow-up. The UI exposes those gaps. No claim of nationwide legal completeness is made.

## Verification and rollback

`npm test`, `npm run typecheck`, `npm run build`; `npm run regulatory:live-test` creates two confirmed technical Auth users, checks authenticated API isolation, and deletes the users, memberships and technical agency records. No email is sent by this script.

Stop the worker to pause new monitoring. Revert the feature branch/UI to remove access; retain the additive regulatory tables and snapshots until their data is intentionally retired. Existing PaperEase tables are not changed by the migration. `.env.local` stays untracked and is excluded from Docker builds.


## Worker accounts and alerts

The additive migration `20261017000008_worker_inbox.sql` creates `reg_worker_memberships`. A trusted administrator maps a Supabase Auth user ID to one agency UUID and worker profile ID. The worker endpoint ignores user-supplied worker IDs in hosted mode and uses that mapping. Demo mode permits selecting the fictional worker for presentation.

- `GET /api/regulatory/alerts`: authenticated agency unread alert count.
- `GET /api/regulatory/worker-inbox`: current worker's messages only.
- `POST /api/regulatory/worker-acknowledge`: records acknowledgment of that worker's own message.
- `/regulatory/worker`: worker sign-in/inbox, separate from the agency dashboard.

Messages are persisted under `workerNotices[]` and staff alerts under `notices[]` in `reg:agency:<UUID>`. Notification text is deterministically composed by the PaperEase agent from the exact reviewed obligation and the worker's assignment; no additional model call is needed to invent or paraphrase legal requirements. No SMS or email delivery is configured. Acknowledgment is logged separately from task completion and document approval.

The worker fans out detected-change alerts to agency records; visible agency/worker pages poll every ten seconds. Worker instructions are created transactionally upon approval plus adoption, not merely after an unreviewed extraction. Notifications are idempotent per rule version and worker.
