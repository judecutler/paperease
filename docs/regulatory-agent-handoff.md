# Regulatory agent integration and source register

Checked against live Supabase on October 17, 2026. This document describes implemented storage and current data, not a completed regulatory corpus.

Live state: 54 source entries; 34 enabled; 0 extracted candidates; 0 queued/history jobs. All current sources are discovery pages. The live corpus has no validated legal rule set yet.

## Storage contract

Table: public.reg_documents. Columns: id (text primary key), body (JSONB), revision (bigint), updated_at (timestamp). There is no separate regulations table per state.

| Record ID | JSON fields | Meaning |
| --- | --- | --- |
| reg:corpus | sources[], candidates[], jobs[], usage | Shared source catalogue and extracted rule candidates for all jurisdictions |
| snapshot:<sourceId>:<SHA256> | sourceId, url, fetchedAt, hash, textHash, sections[], rawBase64, contentType, links[], truncated | Captured evidence for a source version |
| reg:agency:<agency UUID> | profile, workers[], reviews[], adopted[], actions[], collection, audit[] | Private applicability inputs, review decisions, adopted rule IDs and evidence workflow |
| file:<agency UUID>:<file UUID> | name, mime, bytes | Private worker evidence uploaded by that agency |

Rows are indexed by ID, while state membership lives inside the JSON. A rule uses jurisdiction=CA, TX, etc.; federal rules use US. DC is separate. Each candidate includes sourceId, snapshotId, citation, quote, section, obligation, legalStatus, effectiveFrom, effectiveTo, deadline, services, roles, ownership, payers, exceptions, unresolved and scopeComplete. The candidate ID identifies a source-version extraction, not a state-wide legal bundle.

The original public.requirement_types table is not automatically synchronized with this regulatory corpus. The original app still uses its JSON demo store. Adopted regulatory obligations feed agency-specific actions and the collection object inside reg:agency:<UUID>. Do not assume the old table contains updated legal requirements.

## Teammate access

GET /api/regulatory/state accepts a Supabase Auth user access token in Authorization: Bearer <access_token>, or the application session cookie. The user needs a reg_memberships row for the same agency. The API returns sources, candidates with impact results, agency.reviews, agency.adopted and scheduler state. It does not return only approved active rules. There is currently no dedicated GET /api/regulatory/rules endpoint.

For code in this repository, readDoc(CORPUS, initialCorpus) reads the shared catalogue and readDoc(agencyKey(agencyId), emptyAgency) reads the agency state. applicable(rule, profile, worker, date) in lib/regulatory/engine.ts evaluates the implemented scope predicates. Keep those operations on the server.

A separate trusted backend may read public.reg_documents through the Supabase Data API using a server-only secret key. Browser users have no direct table grants. Access through the application API is preferable because it checks user membership; never put the project secret key in a browser or an LLM prompt.

Before a compliance agent treats a candidate as usable, check all of these:

- Exclude demo=true and discovery material.
- Require an approved agency review for that exact rule ID and its presence in agency.adopted.
- Require enacted status, valid evidence, complete scope, no unresolved items, and a current effective-date interval.
- Require an enabled, successful, fresh source with no recorded error and a snapshotId matching the candidate.
- Require an official issuing authority and authoritative document, not merely an allowed host or an aggregator.
- Re-evaluate agency/worker applicability for the current service location, role, service and date. Stored adoption alone does not guarantee current applicability or compliance.
- Return needs review if required facts, source freshness or coverage are missing. Rule discovery and evidence compliance are distinct.

Inspection SQL (not an active-rule feed):

```sql
select s->>'jurisdiction' as state, s->>'url' as source_url,
       s->>'kind' as source_kind, s->>'approved' as enabled
from public.reg_documents d
cross join lateral jsonb_array_elements(d.body->'sources') s
where d.id = 'reg:corpus' and s->>'jurisdiction' in ('CA', 'US');
```

## Official-source policy and current limitations

Use official state legislatures for enacted statutes, official administrative codes/registers for regulations and rulemaking, the responsible government regulator for licensing and notices, state Medicaid agencies for program rules, and federal government publishers for federal obligations. Nursing boards alone do not cover all nonmedical home-care agency requirements, and some states have separate RN and LPN boards.

The current network guard accepts HTTPS .gov hosts and explicitly listed regulator/directory hosts. This is a network restriction, not proof that an extracted claim is an applicable legal requirement. Source verification must also establish issuing authority, exact document, legal status and version. No law-firm blogs, vendor summaries or news articles are configured.

NCSBN is an independent nonprofit organization, not a government regulator. Its configured Nurse Practice Act page is a discovery directory only. For official-only rule evidence, follow its links and retain the law or rule from the state publisher, not the NCSBN directory page.

Non-.gov domains can belong to official state boards. Nevada explicitly identifies its board as a government agency: https://nevadanursingboard.org/board-information/. The configured North Carolina and North Dakota board domains need publisher verification retained with the source record before they are used as legal evidence; reachability alone is not that verification.

## Exact configured state starting points

Every row below is kind=discovery and topic=worker-license. Enabled means a source was allowed for fetching, not that laws were extracted or reviewed. Generic state portals are placeholders for discovery and need direct nursing/home-care/statute/administrative-code sources.

| State | Configured URL | Enabled | Inventory issue |
| --- | --- | --- | --- |
| AL: Alabama | [https://abn.alabama.gov/](https://abn.alabama.gov/) | No | Official source timed out. |
| AK: Alaska | [https://commerce.alaska.gov/](https://commerce.alaska.gov/) | No | Official source HTTP 403 |
| AZ: Arizona | [https://azbn.gov/](https://azbn.gov/) | No | Official source HTTP 403 |
| AR: Arkansas | [https://healthy.arkansas.gov/](https://healthy.arkansas.gov/) | Yes | No error recorded; legal content not reviewed |
| CA: California | [https://rn.ca.gov/](https://rn.ca.gov/) | No | Official source timed out. |
| CO: Colorado | [https://dpo.colorado.gov/](https://dpo.colorado.gov/) | No | Official source HTTP 403 |
| CT: Connecticut | [https://portal.ct.gov/](https://portal.ct.gov/) | Yes | No error recorded; legal content not reviewed |
| DE: Delaware | [https://dpr.delaware.gov/](https://dpr.delaware.gov/) | Yes | No error recorded; legal content not reviewed |
| FL: Florida | [https://floridasnursing.gov/](https://floridasnursing.gov/) | Yes | No error recorded; legal content not reviewed |
| GA: Georgia | [https://sos.ga.gov/](https://sos.ga.gov/) | No | Official source HTTP 403 |
| HI: Hawaii | [https://cca.hawaii.gov/](https://cca.hawaii.gov/) | Yes | No error recorded; legal content not reviewed |
| ID: Idaho | [https://dopl.idaho.gov/](https://dopl.idaho.gov/) | Yes | No error recorded; legal content not reviewed |
| IL: Illinois | [https://idfpr.illinois.gov/](https://idfpr.illinois.gov/) | Yes | No error recorded; legal content not reviewed |
| IN: Indiana | [https://in.gov/](https://in.gov/) | No | No readable legal text. Scanned PDF may require OCR or a different official source. |
| IA: Iowa | [https://dial.iowa.gov/](https://dial.iowa.gov/) | Yes | No error recorded; legal content not reviewed |
| KS: Kansas | [https://ksbn.kansas.gov/](https://ksbn.kansas.gov/) | Yes | No error recorded; legal content not reviewed |
| KY: Kentucky | [https://kbn.ky.gov/](https://kbn.ky.gov/) | No | No readable legal text. Scanned PDF may require OCR or a different official source. |
| LA: Louisiana | [https://lsbn.state.la.us/](https://lsbn.state.la.us/) | Yes | No error recorded; legal content not reviewed |
| ME: Maine | [https://maine.gov/](https://maine.gov/) | No | Official source HTTP 403 |
| MD: Maryland | [https://mbon.maryland.gov/](https://mbon.maryland.gov/) | No | No readable legal text. Scanned PDF may require OCR or a different official source. |
| MA: Massachusetts | [https://mass.gov/](https://mass.gov/) | Yes | No error recorded; legal content not reviewed |
| MI: Michigan | [https://michigan.gov/](https://michigan.gov/) | Yes | No error recorded; legal content not reviewed |
| MN: Minnesota | [https://mn.gov/](https://mn.gov/) | No | Use a reviewed official HTTPS government or regulator URL. |
| MS: Mississippi | [https://msbn.ms.gov/](https://msbn.ms.gov/) | Yes | No error recorded; legal content not reviewed |
| MO: Missouri | [https://pr.mo.gov/](https://pr.mo.gov/) | No | unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca |
| MT: Montana | [https://boards.bsd.dli.mt.gov/](https://boards.bsd.dli.mt.gov/) | Yes | No error recorded; legal content not reviewed |
| NE: Nebraska | [https://dhhs.ne.gov/](https://dhhs.ne.gov/) | No | No readable legal text. Scanned PDF may require OCR or a different official source. |
| NV: Nevada | [https://nevadanursingboard.org/](https://nevadanursingboard.org/) | Yes | No error recorded; legal content not reviewed |
| NH: New Hampshire | [https://oplc.nh.gov/](https://oplc.nh.gov/) | Yes | No error recorded; legal content not reviewed |
| NJ: New Jersey | [https://njconsumeraffairs.gov/](https://njconsumeraffairs.gov/) | No | No readable legal text. Scanned PDF may require OCR or a different official source. |
| NM: New Mexico | [https://bon.nm.gov/](https://bon.nm.gov/) | Yes | No error recorded; legal content not reviewed |
| NY: New York | [https://op.nysed.gov/](https://op.nysed.gov/) | No | unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca |
| NC: North Carolina | [https://ncbon.com/](https://ncbon.com/) | Yes | No error recorded; legal content not reviewed |
| ND: North Dakota | [https://ndbon.org/](https://ndbon.org/) | Yes | No error recorded; legal content not reviewed |
| OH: Ohio | [https://nursing.ohio.gov/](https://nursing.ohio.gov/) | No | Official source HTTP 404 |
| OK: Oklahoma | [https://oklahoma.gov/](https://oklahoma.gov/) | Yes | No error recorded; legal content not reviewed |
| OR: Oregon | [https://oregon.gov/](https://oregon.gov/) | Yes | No error recorded; legal content not reviewed |
| PA: Pennsylvania | [https://pa.gov/](https://pa.gov/) | Yes | No error recorded; legal content not reviewed |
| RI: Rhode Island | [https://health.ri.gov/](https://health.ri.gov/) | Yes | No error recorded; legal content not reviewed |
| SC: South Carolina | [https://llr.sc.gov/](https://llr.sc.gov/) | Yes | No error recorded; legal content not reviewed |
| SD: South Dakota | [https://doh.sd.gov/](https://doh.sd.gov/) | Yes | No error recorded; legal content not reviewed |
| TN: Tennessee | [https://tn.gov/](https://tn.gov/) | No | read ECONNRESET |
| TX: Texas | [https://bon.texas.gov/](https://bon.texas.gov/) | No | certificate has expired |
| UT: Utah | [https://dopl.utah.gov/](https://dopl.utah.gov/) | Yes | No error recorded; legal content not reviewed |
| VT: Vermont | [https://sos.vermont.gov/](https://sos.vermont.gov/) | Yes | No error recorded; legal content not reviewed |
| VA: Virginia | [https://dhp.virginia.gov/](https://dhp.virginia.gov/) | No | Official source timed out. |
| WA: Washington | [https://nursing.wa.gov/](https://nursing.wa.gov/) | Yes | No error recorded; legal content not reviewed |
| WV: West Virginia | [https://wvrn.gov/](https://wvrn.gov/) | No | getaddrinfo ENOTFOUND wvrn.gov |
| WI: Wisconsin | [https://dsps.wi.gov/](https://dsps.wi.gov/) | Yes | No error recorded; legal content not reviewed |
| WY: Wyoming | [https://wsbn.wyo.gov/](https://wsbn.wyo.gov/) | Yes | No error recorded; legal content not reviewed |
| DC: District of Columbia | [https://dchealth.dc.gov/](https://dchealth.dc.gov/) | Yes | No error recorded; legal content not reviewed |

Additional configured sources:

- US-cms-hha (US, discovery): [CMS: Home Health Agencies](https://www.cms.gov/medicare/health-safety-standards/guidance-for-laws-regulations/home-health-agencies)
- US-npa (US, discovery): [NCSBN: Nurse Practice Acts](https://ncsbn.org/policy/npa.page)
- CA-hco (CA, discovery): [California Home Care Services](https://www.cdss.ca.gov/inforesources/community-care/home-care-services)

West Virginia correction identified during this audit: the configured wvrn.gov hostname does not resolve. The official state site is https://wvrnboard.wv.gov/, corroborated by https://www.wv.gov/agencies. This audit records the correction; it has not silently substituted or enabled a source in the live corpus.

## Update process

npm run regulatory:worker periodically queues enabled due sources. Discovery pages are captured and their relevant links exposed for source registration/review. Legal documents must be registered and enabled as law/regulation sources before AI extracts obligations. New candidates are not automatically approved or adopted. A new source version does not silently replace a prior agency decision. The live worker is not currently evidenced as running: the inspected corpus contains zero jobs and no persisted snapshots.

The running presentation uses REGULATORY_LOCAL_DEMO=true and REGULATORY_DATA_DIR=/tmp/careloop-browser-qa. It stores encoded-ID JSON files there, for example reg%3Acorpus.json. The default local directory is data/regulatory, or data/regulatory-demo when using npm run demo. Its simulated policy candidates are isolated from Supabase and must not be consumed as legal rules.

## Authoritative references checked in this audit

- CMS home-health agency certification: https://www.cms.gov/medicare/health-safety-standards/certification-compliance/home-health-agencies
- NCSBN description of governmental nursing regulatory bodies: https://www.ncsbn.org/nursing-regulation/about-nursing-regulatory-bodies.page
- NCSBN identification as an independent nonprofit: https://www.ncsbn.org/public-files/2022_NCSBN_Annual_Report.pdf
- Nevada board government-agency status: https://nevadanursingboard.org/board-information/
- West Virginia official board: https://wvrnboard.wv.gov/

This register is an audit of current configuration, not a completed source validation for all 50 states.


## Notification integration added after this audit

`reg:agency:<UUID>.notices[]` holds staff change alerts; `.workerNotices[]` holds assignment-specific in-app instructions issued after review and adoption. `reg_worker_memberships` binds a Supabase Auth user to an agency and worker. `GET /api/regulatory/worker-inbox` returns only that worker's messages, and `POST /api/regulatory/worker-acknowledge` records reading without changing compliance status. A discovered candidate alerts staff first; the agent does not instruct workers to follow unreviewed rules. See `regulatory-demo.md` for the presentation flow.


## Simplified unverified rule feed

`GET /api/regulatory/rules?jurisdiction=CA` now returns non-demo California and federal candidates without requiring human review or adoption. The response explicitly says `verificationStatus=unverified` and `coverage=partial`. This supersedes the earlier statement that there was no dedicated rules endpoint. The October 17 inventory counts above describe the earlier audit, before the official-page import. Current candidates and import reports are in Supabase; consult them for up-to-date counts.

`npm run regulatory:import` captures selected real CDSS/CMS pages and stores their extracted candidates and source evidence automatically. See `regulatory-validation.md` for the implemented checks and a jury answer that does not imply independent legal validation or nationwide completeness.
