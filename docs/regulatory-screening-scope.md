# Regulatory screening: initial scope and design

Research date: October 17, 2026. Baseline: main at b2cd79e.
Status: researched proposal, not an implemented agent or an exhaustive legal review.

## Existing implementation

- Next.js application with local JSON persistence (`lib/db.ts`). Supabase SQL is a migration starting point, not the active store.
- `lib/seed.ts` supplies a California HCO demonstration checklist. It is explicitly marked as requiring official verification.
- `lib/agent.ts` checks document gaps and processes collection, extraction and human approval.
- `/api/state` runs gap detection when requested; `/api/actions` processes explicit actions. No scheduler or regulatory discovery service was found.
- The current model has one shared rules list. It lacks agency operating jurisdictions, professional roles, assignment locations, authoritative legal citations and effective-dated rule versions.

## Jurisdiction findings

There is no single company-state versus worker-state switch that determines every obligation.

1. Nursing authorization follows the patient's location when care is provided. Residence is relevant to multistate license eligibility; the employer's headquarters does not establish permission to practice. NCSBN describes the Nurse Licensure Compact route for eligible RN/LPN/VN nurses. Check actual license privileges and destination implementation rather than assuming any license from a compact state suffices. [1, 2]
2. For Medicare-certified HHAs operating across state lines, CMS section 2184 requires state coordination and compliance with the receiving state's applicable agency, personnel and other requirements. This guidance concerns HHAs and should not automatically be applied to nonmedical HCOs. [3]
3. California's CDSS licenses HCOs and administers the Home Care Aide registry for nonmedical assistance with daily living. This is a different regulatory track from nursing practice. [4, 5]

These findings concern home-care licensing and practice. They do not establish a universal choice-of-law rule for employment, corporate, tax or privacy obligations. Those need separate applicability analysis.

## Agreed geographic scope and proposed product coverage

User direction: implement regulatory monitoring across all 50 U.S. states, rather than restricting the feature to California. See `regulatory-screening-implementation-plan.md` for the integration plan. Include federal overlays; propose DC as a separately tracked additional jurisdiction.

Cover nonmedical home care and skilled home health through distinct regulatory tracks. Record for-profit/nonprofit/public ownership and evaluate applicable rules and exemptions explicitly. Do not transfer the California HCO model or its terminology to other states without verification.

Track source monitoring, extraction and reviewed applicability independently for every jurisdiction/service/role/topic combination. Unknown coverage must show "coverage not established", never a compliant result.

## Onboarding inputs

| Level | Inputs | Purpose |
| --- | --- | --- |
| Organization | Legal entity, ownership, headquarters, operating branches and states, license type/number/issuer | Agency obligations and exemptions |
| Service | Nonmedical assistance versus skilled nursing; services actually delivered; Medicare/Medicaid participation and relevant programs | Select the appropriate regulatory track |
| Worker | Role, employment relationship, primary residence where relevant, registrations/licenses, issuing jurisdictions, verified privileges and expiry | Professional eligibility and worker obligations |
| Assignment | Worker, responsible branch, patient service state and locality, service type and date | Match rules to the actual service location and effective date |

Do not collect a patient's full address or clinical details merely to determine state coverage. Add locality only where an applicable local rule requires it.

## Proposed screening pipeline

1. Maintain a shared registry of official sources by jurisdiction and topic: enacted statutes, administrative regulations, regulator publications, nursing boards and applicable federal program sources. Discovery may suggest new sources for review.
2. Fetch permitted sources, retain source URL, retrieval time, content hash and version/snapshot. Distinguish failed retrieval from an unchanged source. Treat fetched documents as data, never agent instructions.
3. Detect changes and distinguish proposed legislation, enacted rules, guidance, effective dates and compliance deadlines. A newly published proposal must not become an active obligation.
4. Use AI to draft structured candidates with exact supporting sections, affected entities/roles/services, exceptions, dates, and unresolved questions. Missing evidence or ambiguous scope requires review.
5. Evaluate applicability against organization, worker and assignment profiles. Return applicable, not applicable or needs review, with reasons. Do not use the strictest text automatically to resolve conflicts or supersession.
6. Present before/after changes, evidence, impacted profiles and proposed checklist updates for human approval. Approved versions can then feed the existing document-gap workflow; preserve prior decisions and their rule versions.

Suggested entities: RegulatorySource, ScanRun, RuleVersion, ApplicabilityPredicate, AgencyProfile, WorkerCredential, ServiceAssignment and RuleReview. Keep legal obligations separate from an agency's internal policies and from document evidence requirements.

Provide both explicit scanning and periodic scanning through the same durable pipeline. The implementation plan proposes scheduling, retries and notification behavior; no scheduler is currently deployed. Use idempotent scan/change identifiers so retries cannot duplicate proposals or activate rules twice. Do not create one web crawler per customer when customers share the same sources.

## Acceptance criteria for the implementation

- Every candidate has an accessible official citation, captured evidence and a clearly stated legal status.
- A worker living in state B and employed by a company headquartered in state A is assessed against patient service state C for nursing practice; agency and residence-related requirements remain separate.
- Nursing and nonmedical aide requirements are not interchanged.
- Unsupported scope, failed source retrieval and uncertain applicability cannot produce a compliant result.
- Future-effective changes do not overwrite the presently applicable version; repeat scans are idempotent.
- Nothing changes an active checklist before review; approval records the reviewer, rule version and affected profiles.

## Sources and limits

[1] NCSBN, Nurse Licensure Guidance: https://www.ncsbn.org/nursing-regulation/licensure/nurse-licensure-guidance.page

[2] NCSBN, Nurse Licensure Compact model text, Article I(b)(5): https://www.ncsbn.org/public-files/NLC_Final_050415.pdf . This establishes the compact principle, not a current destination-state membership list.

[3] CMS, State Operations Manual, Chapter 2, section 2184 (PDF page 142): https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/Downloads/som107c02.pdf

[4] California CDSS, Home Care Services: https://cdss.ca.gov/inforesources/community-care/home-care-services

[5] California Department of Aging, Living at Home and Need Help: https://aging.ca.gov/Care_Options/Living_at_Home_and_Need_Help/

The current demo's five document requirements have not been individually audited in this note. No nationwide completeness or current compact membership verification is claimed. Federal program, employment, privacy, public-provider and local requirements need dedicated follow-up before broader coverage.
