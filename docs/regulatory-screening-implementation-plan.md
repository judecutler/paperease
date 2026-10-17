# Nationwide regulatory screening: implementation plan

Date: October 17, 2026. Verified integration baseline: main / origin/main at b2cd79e40addb5b1aa41fe33e176eb4dce92402c.
Feature branch: arnaud/regulatory-screening. Status: plan only; no monitoring infrastructure has been deployed.

## 1. Outcome and scope

Deliver periodic regulatory discovery, change detection, applicability screening, reviewer approval and checklist updates for home-care employers and workers across all 50 states, with federal overlays. Include DC as a proposed additional jurisdiction, tracked separately from the 50-state acceptance gate. Territories require an explicit subsequent coverage decision.

Support distinct tracks for nonmedical home care/personal care and skilled home health/nursing. Start with home care aides, home health aides, RN and LPN/LVN roles; map state-specific titles, agency categories and exemptions. Other clinical roles need their own coverage records, never automatic inheritance of nursing requirements.

Capture private for-profit, nonprofit and public ownership in the same profile model. Public-provider requirements and exemptions need explicit source-backed predicates. An unresolved public-provider regime remains visibly incomplete, not silently excluded or presumed equivalent.

Core topics: agency licensing/renewal, worker authorization/registration, background checks, training/competency, health screening, supervision/delegation, recordkeeping and reporting. Track applicable Medicare/Medicaid enrollment, provider and program requirements separately. Add relevant employment/safety, privacy and local requirements as explicit coverage topics; do not represent a state licensing corpus as all business compliance. General corporate and tax compliance are outside this feature unless separately scoped.

The system must answer: what changed, what is legally effective, who may be affected, why, when action is due, and what evidence or action is needed. It must also expose what it has not established.

## 2. Integration constraints from main

- Keep the Next.js UI and existing collection workflow in `lib/agent.ts`.
- Replace the single hard-coded global checklist as the applicability authority. Preserve `lib/seed.ts` as clearly labelled demo data.
- `lib/db.ts` currently uses a process-local JSON store. Use transactional Postgres for real scheduled work; the existing Supabase schema lacks agencies, authentication policies, regulatory versions and jobs.
- `lib/types.ts` has no jurisdiction, worker role or assignment. Add these without guessing them for existing records.
- `app/api/state/route.ts` and `lib/payload.ts` currently expose a whole demo store. Production reads and new endpoints must be authenticated and tenant-scoped.
- Retain the existing human approval of extracted worker documents. Legal-rule approval is a separate review action.

## 3. Architecture

A shared source corpus serves all customers. Per-agency screening runs against that corpus and each agency's profiles.

Official source registry -> durable fetch jobs -> immutable snapshots -> normalized sections and diffs -> AI candidate extraction -> evidence validation -> regulatory review -> versioned rule catalogue -> deterministic applicability -> impact preview -> agency adoption -> existing document collection.

Use Next.js for UI/API, Supabase Postgres for transactional data, private object storage for snapshots, and a separate background worker. A protected scheduled trigger enqueues due work; it must not crawl or call models inside a long-running page/API request. Select the worker host and scheduler during the first implementation step according to the team's deployment target. Do not add another agent framework unless the pipeline requires it.

Use explicit, retryable stages. AI interprets source evidence and drafts predicates; approved structured predicates are evaluated by code. Avoid an autonomous agent that searches the web and directly rewrites customer obligations.

## 4. Data model

| Group | Proposed entities and essential fields |
| --- | --- |
| Profiles | Agency, AgencyMembership, Branch, ServiceProfile, WorkerProfile, WorkerCredential, ServiceAssignment; operating states, ownership, services, role, residence where relevant, license privileges, payer/program, service locality and dates |
| Coverage | Jurisdiction, CoverageCell; jurisdiction x service x role/entity x topic, reviewed sources, reviewer, freshness, known gaps |
| Sources | RegulatorySource, SourceSnapshot, SourceSection; issuing authority, URL, document type, fetch policy, hash, captured bytes, parser version, source publication/version dates |
| Rules | Rule, RuleVersion, RuleEvidence, RuleRelationship; legal citation, obligation, exceptions, predicates, effective interval, compliance deadline, proposed/adopted/repealed status, supersession and dependencies |
| Screening | ApplicabilityEvaluation, ImpactAssessment; tenant/profile/assignment, rule version, evaluation date, result, reasons and missing facts |
| Reviews | RuleReview, AgencyRuleAdoption, RequirementBinding; reviewer, decision, timestamp, approved version, agency effective date and mapping to evidence/action |
| Operations | ScanRun, Job, ScanError, NotificationOutbox, AuditEvent; locks, attempts, idempotency key, source/model/prompt versions, cost and delivery status |

Separate published_at, effective_from/to, compliance_due_at, observed_at and approved_at. Retain what was known when an earlier decision was made. Separate legal obligations from company policies. Store unknown, not-applicable and not-reviewed as distinct states.

RLS isolates agency profiles, screening results and worker documents. A global corpus has controlled publication/read access; worker credentials never enter source discovery prompts. Privileged worker operations remain server-side. Establish authentication/membership checks before exposing production mutations.

## 5. Nationwide source acquisition

Create a registry with 50 explicit state entries, federal entries and a separate DC entry. No placeholder URL counts as a monitored source.

For each state, identify and review official sources for: statutes, administrative code/register, agency home-care/home-health regulator, relevant professional boards and state Medicaid provider/program materials. Add official notices and compact implementation sources where relevant. Discover sources with search, then validate issuing authority, scope, canonical URL and update mechanism before enabling unattended ingestion.

Prefer official feeds/APIs, then HTML, then PDFs with page/section anchors; add OCR for scanned documents. Store original bytes, extraction output and evidence locations. Handle amended pages, moved links, pagination and attachment changes. Navigation/footer changes should not generate legal changes.

Initial inventory establishes current rules; change detection alone cannot construct the existing legal baseline. Follow cross-references, exceptions and incorporated standards. Where evidence cannot be retrieved or a source is only an unofficial mirror, create a review task and record the coverage gap.

Coverage statuses: not inventoried -> inventoried -> fetching -> extracted -> reviewed, plus stale/blocked. Source monitoring coverage and legal-content review coverage are reported separately. "50 states registered" does not mean "50 states fully covered".

## 6. Scheduling and AI processing

Proposed operating defaults, configurable by source: check established update feeds daily; reconcile full monitored source documents weekly; allow manual scans and urgent rescans. These are product defaults, not claims of regulator publishing frequency. Add jitter, conditional requests where supported, per-domain limits, bounded retries and quarantine/dead-letter handling.

Persist checkpoints; prevent overlapping jobs with leases. Make source/version/stage processing idempotent. Deduplicate the same amendment across multiple official publications. A fetch failure, empty parse or unexpected layout change must not be recorded as no change or as repeal.

AI output is schema-validated: rule text, exact evidence identifiers/quotes, legal status, dates, covered entities/services/roles, predicates, exemptions, required action and unresolved references. Verify quotations against captured text. Unsupported fields remain unknown; confidence never substitutes for evidence. Record extraction model and prompt versions.

Treat source documents as untrusted data. Restrict fetching to reviewed hosts, validate redirects, block private-network destinations, and cap size/time. Do not execute instructions or downloaded code found in source material. Reserve browser/OCR fallback for reviewed sources requiring it.

## 7. Applicability and onboarding

Onboarding collects agency operating branches/states, service types, ownership, license categories, payer/program participation, worker roles/licenses/privileges and assignment location/date. Residence, headquarters and service location are separate fields. Existing demo profiles require explicit completion before real screening.

Evaluate each obligation as applicable, not applicable or needs review. Missing facts must not count as false predicates. Evaluate federal and state layers separately, and local/program layers when relevant. Do not resolve conflicts by automatically choosing the strictest rule; model exceptions, preemption and supersession and route unresolved conflicts to review.

Nursing authorization uses the service/patient jurisdiction with verified destination privileges. Residence supports compact eligibility; it is not a replacement for service location. Re-evaluate on profile change, assignment change, rule publication/approval, effective-date transition or coverage degradation. Keep historical assignment evaluations.

Not all obligations are documents. Map obligations to document evidence, training, renewal, supervision, reporting or an agency-level action. Do not attach agency licensing obligations to every worker's checklist.

## 8. User interface and API

- Extend onboarding with organization, services, workers and service jurisdictions.
- Add a Regulatory watch page with states, topic coverage, source freshness, scan status and failures.
- Add a Changes inbox with old/new text, citation and captured evidence, legal status, dates, affected agency/worker counts and proposed actions.
- Add a rule detail view with scope, exceptions, version history, reviewer decisions and unresolved references.
- Extend Rules with separate agency and worker obligations, jurisdiction filters and demo/internal-policy labels.
- Extend worker views with assignment-specific applicability and missing profile facts; preserve current collection and approval interactions.

Suggested routes: GET `/api/regulatory/coverage`, GET `/api/regulatory/changes`, GET `/api/regulatory/rules/[id]`, POST `/api/regulatory/scans`, POST `/api/regulatory/reviews/[id]`, POST `/api/regulatory/adoptions`, POST `/api/regulatory/screenings`, and a separately authenticated scheduler endpoint. Validate request bodies, permissions, legal state transitions and idempotency. Paginate corpus and result reads rather than extending the whole-store payload.

Global rule publication requires a regulatory reviewer. Agency adoption is separately authorized and previews affected requirements. Approval must bind the exact rule and impact versions, rejecting stale previews. New obligations are committed transactionally, then sent to the existing workflow through an adapter. Preserve old submissions and their original rule versions; recheck evidence against changed obligations instead of simply relabelling previous approvals.

## 9. Notifications and operations

Persist in-app alerts for material changes, approaching effective dates, affected obligations and coverage failures. Propose email delivery as an optional later channel; no automatic worker SMS is triggered by discovering a legal change. An outbox prevents duplicate notifications; unchanged scans stay quiet.

Expose source freshness, job backlog/failures, extraction/review backlog, evidence validation failures, coverage gaps, AI token/cost usage and impacted tenants. Budgets cap model calls and place overflow in a visible backlog. A source outage preserves prior versions but marks freshness degraded and prevents a false "up to date" claim.

## 10. Delivery sequence into main

All implementation branches use `arnaud/*`. Keep main stable; deliver reviewed PRs with migrations and feature flags. This plan does not authorize direct edits or a merge into main.

| PR | Branch suffix | Deliverable | Acceptance gate |
| --- | --- | --- | --- |
| 1 | regulatory-foundation | Tenant/auth foundations, migrations, profile and rule types, flags, storage/job interfaces | Existing demo runs; unauthenticated and cross-tenant access rejected |
| 2 | regulatory-source-registry | 50-state registry plus federal/DC, source provenance, coverage matrix and inventory tooling | Every state explicitly tracked; missing sources visible; no invented coverage |
| 3 | regulatory-ingestion | Worker, snapshots, HTML/PDF normalization, retries and scheduler | Real fetching demonstrated; restart/retry does not duplicate snapshots or jobs |
| 4 | regulatory-rule-extraction | Baseline extraction, meaningful diffs, evidence validation, legal status and dates | Proposals cannot become effective rules; missing evidence blocks review completion |
| 5 | regulatory-onboarding | Organization/worker/assignment forms and migrations | Unknown fields stay unknown; headquarters/residence/service state remain separate |
| 6 | regulatory-applicability | Predicate evaluator, profile-triggered screening, temporal evaluation and impact previews | Interstate, role, ownership, payer, exception and future-date scenarios pass |
| 7 | regulatory-review | Reviewer UI/API, version approval, agency adoption and audit | Unauthorized/stale approval fails; no checklist changes before authorized adoption |
| 8 | regulatory-checklists | Adapter to existing gap detection and agency-level actions | Existing document flow survives; historical approvals remain attributable |
| 9 | regulatory-observability | Coverage UI, alerts, budgets, operational controls and runbook | Failures and staleness visible; duplicate jobs do not duplicate alerts |
| 10 | regulatory-nationwide-validation | Complete source onboarding and baseline review across all states, deploy and validate | Nationwide coverage report and live scheduled-run evidence meet the gates below |

Source inventory/review proceeds throughout implementation. Pilot ingestion on representative HTML/PDF/feed sources to validate adapters, then expand all 50 states. Piloting is an engineering sequence, not a reduction of the final geographic target.

## 11. Verification and release gates

- Unit tests: three-valued predicates, dates/deadlines, exceptions, roles, interstate cases, version selection, diffs and idempotency.
- Integration tests: ingestion through review/adoption to existing collection, retries, concurrent workers, transactions, tenant boundaries, stale approvals and migrations.
- Evidence evaluation set: captured official sections with human-labelled obligations and applicability. Measure unsupported claims, citation fidelity, missed obligations and false applicability by topic/state. Set numerical release thresholds after labelling the set; do not invent an accuracy percentage.
- UI checks: onboarding, state coverage, evidence review, inaccessible sources, rejected changes, future rules and unchanged existing caregiver flow.
- Local checks: `npm run typecheck`, `npm run build` and new pipeline tests with synthetic fixtures labelled as such.
- Live checks: fetch registered official sources, execute a real scheduled scan, demonstrate recovery after a controlled failure, and validate end-to-end adoption using isolated technical data and cleanup. Live legal applicability still requires qualified review.

Final scope gate: all 50 states have reviewed authoritative source inventories for the agreed tracks/topics, successful baseline fetch/extraction and an explicit reviewed-content/gaps report. Block claims of complete legal coverage where gaps remain. Scheduler operation, functioning software and legal review are three separate acceptance records.

Deploy migrations first, then the worker, read-only regulatory UI, review and finally checklist adoption behind separate flags. Preserve the existing demo mode until verified. Rollback disables adoption/scheduling and preserves snapshots, reviews, active historical versions and audit events; no destructive down-migration of collected evidence.

## 12. Sources informing the plan

- NCSBN, state Nurse Practice Acts and regulations: https://ncsbn.org/policy/npa.page
- NCSBN, Nurse Licensure Guidance: https://www.ncsbn.org/nursing-regulation/licensure/nurse-licensure-guidance.page
- CMS, State Operations Manual section 2184: https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/Downloads/som107c02.pdf
- Medicaid, HCBS authorities, requiring program-specific source acquisition: https://www.medicaid.gov/medicaid/home-community-based-services/home-community-based-services-authorities
- California CDSS, existing demo's distinct HCO/HCA track: https://cdss.ca.gov/inforesources/community-care/home-care-services

These sources establish regulatory structure and discovery starting points. This plan is not a completed 50-state legal inventory. Scheduling, schema, architecture and PR sequence above are engineering proposals.
