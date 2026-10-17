# Unified company and worker demo

Implemented on `codex/unified-demo`, based on `origin/main` at `4cea1d9`.
The original checkout under `Documents/etudes/Berkeley/hackathons` is unchanged.

## Start

Use Node 24+ as declared by the repository. Node 22.23.2 was used for the successful build in this session; Node 21 caused development-server errors.

```sh
cd "/Users/arnaudhollender/Documents/ChatGPT/hackathon compiled/careloop-main"
npm install
env PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npm run demo
```

Open http://127.0.0.1:3000/regulatory for Company and http://127.0.0.1:3000/regulatory/worker for Worker. Regulatory watch is at `/regulatory/watch`; the historical dashboard remains at `/`.
Do not run `next build` while the development server is running against the same `.next` directory.

## Present

1. The local scenario has been initialized with one fictional California company, Maria Lopez, and two adopted fictional policies. No shared Supabase data was changed.
2. To start over, choose **More → Activity & demo → Reset demo** in Regulatory watch, then open **Changes**, open **Review rule**, approve the review, then adopt each of the two active fictional rules. Do not adopt the expired training version.
3. Open Worker. The request explains the document, the adopted obligation and the deadline (unspecified in this fixture).
4. Open **Fictional examples for the presentation** and select **Incomplete document**. The missing hours are shown. Select **Complete document** to prepare a replacement for human review. These are simulated text documents and simulated results, not real AI calls.
5. Open Company, select Maria and **Review document**. Download the original, inspect the fields, check the attestation and **Approve**. Refresh Worker: the same requirement is **Approved**. Earlier files remain in **My documents**.
6. Repeat the company insurance obligation in **Company obligations**. It cannot be completed by acknowledging a notice or marking an action done.
7. **Expired document** and **Analysis unavailable** illustrate conservative outcomes. A real PDF upload is retained with an unverified analysis; a person may inspect and approve it manually after supplying and verifying the required fields.

## Configuration and storage

No new SQL migration is needed. Contracts, submissions, rule version IDs, analysis snapshots and review identity are stored in the existing versioned agency JSON with compare-and-swap writes. File bodies stay in the existing private regulatory document store.
Local demo data persists in `data/regulatory-demo`, separate from hosted workspaces. Hosted use requires the existing regulatory migrations (including worker memberships), Supabase server credentials, and an Auth user linked in `reg_worker_memberships`. Worker IDs are resolved from the authenticated membership, ignoring client input. Local loopback demo alone allows selecting fictional identities.
Real image analysis uses `ANTHROPIC_API_KEY` and the existing `PAPEREASE_MODEL`; it receives stored image bytes, confirmed fields and the cited rule version. No real provider call was verified in this session. Requests time out after 25 seconds without retries; missing configuration, unsupported PDFs and provider failures remain explicitly unverified. Human review is always required.

## Validation and limits

The full test suite passed: 97 tests, including the unified lifecycle, persisted reads, expiration, version replacement, worker filtering and a hosted-identity HTTP download test rejecting a foreign file even with a forged workerId. Typecheck and production build passed before the final English-copy changes; typecheck was repeated after translation. Live local API requests exercised adoption, both spaces and incomplete/complete submissions.

Hosted Supabase and a live AI provider were not tested. This does not establish production security or regulatory compliance. Patient visit notes, national coverage, advanced filters and a deployed weekly scheduler are deferred. New rule adoption invalidates old active evidence and retains history; it requires a fresh submission and confirmed criteria, rather than silently treating an earlier approval as valid for the new version. The UI contract editor deliberately covers the bounded demo (name, optional hours and expiration); the API also supports custom text/date/number fields.

## English-only interface

Company, Worker, the topbar, navigation, routes, document statuses, errors, demo fixtures, comments and documentation use English. The historical caregiver upload page and newly generated SMS messages also use English. Existing personal names and historical user-supplied records are preserved.

## Current main integration

Updated to `4cea1d9` (staff document entry and attachments). Its staff-record and attach-file actions, SMS consent restrictions, caregiver review panel and shared UI updates are preserved. Regulatory review reuses the updated ExtractedField component and its manual-entry missing-value label. Regulatory evidence continues to use its private storage and rule-version checks.
