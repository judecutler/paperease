# Regulatory validation: demo scope

The prototype stores extracted candidates in Supabase without human approval. `verificationStatus=unverified` is separate from `evidenceValid=true`: matching a quotation establishes its presence in the captured document, not legal correctness or completeness.

## Implemented automated checks

- HTTPS government/regulator source restriction, public-IP checks, safe redirects and capture limits.
- Saved source URL, content hash, retrieval timestamp, sections and original content.
- Rejection of recognized access-block/CAPTCHA pages, including HTTP 200 challenges.
- Structured extraction schema, date format/interval checks and verbatim supporting-quote validation.
- Explicit unresolved scope, missing dates, truncated captures and ingestion errors.
- Candidate storage independent of agency review/adoption. No human approval is needed to save a candidate.

`GET /api/regulatory/rules?jurisdiction=CA` returns non-demo candidates for California plus federal candidates, with explicit unverified/partial coverage labels. It requires an authenticated workspace user. It is a candidate feed, not a certification of applicable law.

The first live import stored **13 unverified candidates from three official pages**: six California CDSS candidates and seven federal CMS candidates. All have matching captured quotations; none received legal verification.

Run `npm run regulatory:import` to import the selected official California CDSS and federal CMS pages. The command stores snapshots and an `import:<timestamp>` record with successes/failures. This is a bounded example corpus, not all 50 states. Failed source or model requests are not presented as complete results.

## What two agents would add

A second model can independently extract from the original source without seeing the first answer. Compare obligation sets, evidence, dates, exceptions and applicability; flag differences. Agreement is supporting evidence, not proof: both models can share a mistake or miss the same document. No independent second-agent verification is implemented or claimed for this demo.

Completeness also requires a source inventory and section/page manifest, cross-reference handling, detection of failed/unreadable sources, and evaluation against an independently labelled benchmark. Quotation checks measure grounding, not recall. No measured nationwide recall or accuracy percentage is available.

## Human involvement

Per-rule human approval is not technically necessary for ingestion or preliminary alerts. It is separate from evaluating the product's legal reliability. For deployment, a practical proposal is automated processing for ordinary cases plus expert evaluation of benchmarks, ambiguous cases and new regulatory regimes. Whether a particular regulated use imposes an approval obligation has not been legally assessed here.

## Jury answer

“Our prototype collects official government publications, keeps the source evidence and checks that extracted quotations match the captured text. Rules are stored automatically as unverified candidates. This makes the results traceable, but we do not claim that quote matching proves legal interpretation or that the current corpus contains every applicable rule. Independent model cross-checking and benchmark-based completeness evaluation are proposed next steps.”

Reference: NIST AI 600-1, especially MS-2.5-001 and MS-2.5-003, cautions against extrapolating performance from narrow assessments and recommends source/citation verification: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
