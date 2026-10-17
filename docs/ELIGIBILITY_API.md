# Compliance gate API

Scheduling software asks PaperEase one question before it assigns a shift: **is this caregiver allowed to work it?**
PaperEase answers from what a person has approved. It never guesses: anything it cannot confirm is a "no".

## Turn it on

```
ELIGIBILITY_API_KEYS="acme-scheduler:<random secret, 32+ chars>,other-tool:<secret>"
```

Generate a secret with `openssl rand -base64 36`. With no keys set the API returns `503`. In production the API also
requires `CARELOOP_AUTH=required`, so a key never exposes an open demo workspace. Send the secret as
`Authorization: Bearer <secret>`. Keys are compared in constant time; limit is 120 requests/minute per key per server instance.

## Ask about one shift

`POST /api/v1/eligibility`

```json
{ "caregiverId": "grace", "shiftStart": "2026-11-03T08:00:00-08:00", "shiftEnd": "2026-11-03T16:00:00-08:00", "ref": "shift-881", "strict": false }
```

`shiftEnd`, `ref` (echoed back) and `strict` are optional. Dates are compared as calendar dates in the offset you send:
a document is valid through its expiry date inclusive, and a requirement that expires before the shift *ends* is reported
as `expires-during-shift`.

```json
{
  "decision": "ineligible", "eligible": false, "caregiverId": "maria", "shiftDate": "2026-11-03",
  "reasons": [{ "requirementId": "initial_training", "requirement": "Entry-level training", "code": "missing", "text": "No current approved record." }],
  "evidence": { "tb_test": "status-only" }, "checkedAt": "2026-10-17T18:00:00.000Z", "ref": "shift-881"
}
```

* `decision` is `eligible`, `ineligible`, or `unknown` (the caregiver id is not recognized; HTTP 404). Only `eligible: true` means assign.
* `reason.code`: `missing`, `not-approved`, `expired-before-shift`, `expires-during-shift`, `registry-not-active`, `registry-unchecked`, `unverified-record`.
* `validThrough` (when eligible) is the earliest expiry across requirements, for renewal planning.
* `evidence`: `verified-record` means a person confirmed a stored record. `status-only` means the system shows it approved but no stored record backs it
  (older or imported data). Pass `"strict": true` to treat `status-only` as not eligible.
* Responses carry ids and codes only: no names, phone numbers, ID numbers or document contents.

## Ask about many shifts

`POST /api/v1/eligibility/batch` with `{ "shifts": [ {…same fields…}, … ], "strict": false }` (up to 200). Returns `{ "results": [...] }` in order.
A row that cannot be evaluated comes back `unknown` with an `error`; it never blocks the other rows.

## Map your workers to PaperEase ids

`GET /api/v1/caregivers` returns `{ "caregivers": [{ "id", "name" }] }`.

## Behaviour to rely on

* **Fail closed.** If your integration cannot reach the API or gets a non-200 that is not `404`, treat the caregiver as not eligible and show a human why.
* Checks read live data and re-evaluate expiry at request time, so a document that lapsed overnight is caught before the next sweep.
* Every check writes a structured log line (`evt: "eligibility"`, client, caregiver id, decision, reason codes) to server logs. Decisions are not written to the
  caregiver audit trail, to avoid a database write on every scheduler call.

## Not built yet

* Per-agency keys: the current store holds one agency, so every key sees that agency.
* Push notifications (webhook when a caregiver becomes ineligible) and ready-made connectors for specific scheduling products. The API is the integration surface they would use.
