import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { seedDb } from '../lib/seed';
import { checkEligibility } from '../lib/eligibility';
import { configuredKeys, rateLimited } from '../lib/apikeys';

const SECRET = 'k'.repeat(40);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('checkEligibility', () => {
  it('a fully approved caregiver is eligible and reports when it runs out', () => {
    const d = checkEligibility(seedDb(), { caregiverId: 'grace', shiftStart: day(1) });
    assert.equal(d.decision, 'eligible', JSON.stringify(d.reasons));
    assert.ok(d.validThrough);
    assert.equal(d.evidence.tb_test, 'verified-record');
    assert.equal(checkEligibility(seedDb(), { caregiverId: 'james', shiftStart: day(1) }).evidence.tb_test, 'status-only');
  });
  it('a caregiver with a missing requirement is ineligible, with the reason', () => {
    const d = checkEligibility(seedDb(), { caregiverId: 'maria', shiftStart: day(1) });
    assert.equal(d.eligible, false);
    assert.ok(d.reasons.some((r) => r.requirementId === 'initial_training' && r.code === 'missing'));
  });
  it('unknown caregiver is "unknown", never eligible', () => {
    const d = checkEligibility(seedDb(), { caregiverId: 'nope', shiftStart: day(1) });
    assert.deepEqual([d.decision, d.eligible], ['unknown', false]);
  });
  it('expiry is judged on the shift date, not today', () => {
    const db = seedDb();
    const st = db.requirements.find((s) => s.caregiverId === 'grace' && s.requirementId === 'tb_test')!;
    st.expiresOn = day(10);
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(5) }).eligible, true);
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(11) }).reasons[0].code, 'expired-before-shift');
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(9), shiftEnd: day(11) }).reasons[0].code, 'expires-during-shift');
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(10) }).eligible, true, 'valid through the expiry day itself');
  });
  it('accepts full timestamps and rejects an end before the start', () => {
    assert.equal(checkEligibility(seedDb(), { caregiverId: 'grace', shiftStart: `${day(2)}T08:00:00-07:00` }).eligible, true);
    assert.throws(() => checkEligibility(seedDb(), { caregiverId: 'grace', shiftStart: day(3), shiftEnd: day(2) }));
  });
  it('a stored HCA record needs a passing registry lookup; strict mode refuses status-only approvals', () => {
    const db = seedDb();
    db.submissions.push({ id: 's1', caregiverId: 'grace', requirementId: 'hca_registration', files: [], extractedBy: 'claude', createdAt: new Date().toISOString(), state: 'approved', followUps: 0, fields: [{ key: 'registration_number', label: 'n', value: 'HCA 4417-2290', required: true, source: 'verified' }] });
    db.requirements.find((s) => s.caregiverId === 'grace' && s.requirementId === 'hca_registration')!.approvedSubmissionId = 's1';
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(1) }).reasons[0].code, 'registry-unchecked');
    const strict = checkEligibility(seedDb(), { caregiverId: 'james', shiftStart: day(1) }, { strict: true });
    assert.equal(strict.eligible, false);
    assert.ok(strict.reasons.every((r) => r.code === 'unverified-record'));
  });
  it('an open escalation or pending review is not eligible', () => {
    const db = seedDb();
    db.requirements.find((s) => s.caregiverId === 'grace' && s.requirementId === 'tb_test')!.status = 'pending-review';
    assert.equal(checkEligibility(db, { caregiverId: 'grace', shiftStart: day(1) }).reasons[0].code, 'not-approved');
  });
});

describe('api keys', () => {
  it('ignores short or malformed entries', () => {
    assert.equal(configuredKeys('a:short,b,:' + SECRET).length, 0);
    assert.deepEqual(configuredKeys(`ok:${SECRET}`).map((k) => k.name), ['ok']);
  });
  it('rate limiter trips after the limit and recovers after the window', () => {
    for (let i = 0; i < 5; i++) assert.equal(rateLimited('c1', 5, 1000, 1000 + i), false);
    assert.equal(rateLimited('c1', 5, 1000, 1010), true);
    assert.equal(rateLimited('c1', 5, 1000, 5000), false);
  });
});

describe('/api/v1 routes', () => {
  let dir: string;
  let single: typeof import('../app/api/v1/eligibility/route');
  let batch: typeof import('../app/api/v1/eligibility/batch/route');
  let list: typeof import('../app/api/v1/caregivers/route');
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'careloop-api-'));
    process.env.CARELOOP_DATA_DIR = dir;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) delete process.env[k];
    process.env.ELIGIBILITY_API_KEYS = `sched:${SECRET}`;
    single = await import('../app/api/v1/eligibility/route');
    batch = await import('../app/api/v1/eligibility/batch/route');
    list = await import('../app/api/v1/caregivers/route');
  });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.ELIGIBILITY_API_KEYS; });
  const post = (body: unknown, key: string | null = SECRET) =>
    new Request('http://x/api/v1/eligibility', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('rejects missing and wrong keys', async () => {
    assert.equal((await single.POST(post({}, null))).status, 401);
    assert.equal((await single.POST(post({}, 'x'.repeat(40)))).status, 401);
    assert.equal((await list.GET(new Request('http://x/api/v1/caregivers'))).status, 401);
  });
  it('is off when no keys are configured', async () => {
    const saved = process.env.ELIGIBILITY_API_KEYS;
    delete process.env.ELIGIBILITY_API_KEYS;
    assert.equal((await single.POST(post({ caregiverId: 'grace', shiftStart: day(1) }))).status, 503);
    process.env.ELIGIBILITY_API_KEYS = saved;
  });
  it('answers for a known and an unknown caregiver', async () => {
    const ok = await single.POST(post({ caregiverId: 'grace', shiftStart: day(1), ref: 'shift-9' }));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.eligible, true);
    assert.equal(body.ref, 'shift-9');
    assert.ok(!JSON.stringify(body).includes('Grace'), 'no names in decisions');
    const missing = await single.POST(post({ caregiverId: 'ghost', shiftStart: day(1) }));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).eligible, false);
  });
  it('validates input', async () => {
    assert.equal((await single.POST(post({ caregiverId: 'grace' }))).status, 400);
    assert.equal((await single.POST(post({ caregiverId: 'grace', shiftStart: 'tomorrow' }))).status, 400);
    assert.equal((await single.POST(post({ caregiverId: 'grace', shiftStart: day(1), extra: 1 }))).status, 400);
    assert.equal((await single.POST(post('not json'))).status, 400);
  });
  it('batch keeps one result per row and never lets a bad row pass', async () => {
    const res = await batch.POST(new Request('http://x/api/v1/eligibility/batch', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ shifts: [
      { caregiverId: 'grace', shiftStart: day(1), ref: 'a' }, { caregiverId: 'maria', shiftStart: day(1), ref: 'b' }, { caregiverId: 'grace', shiftStart: day(3), shiftEnd: day(2), ref: 'c' },
    ] }) }));
    const { results } = await res.json();
    assert.deepEqual(results.map((r: any) => [r.ref, r.eligible]), [['a', true], ['b', false], ['c', false]]);
  });
  it('lists caregivers for mapping', async () => {
    const res = await list.GET(new Request('http://x/api/v1/caregivers', { headers: { authorization: `Bearer ${SECRET}` } }));
    assert.ok((await res.json()).caregivers.length >= 5);
  });
});
