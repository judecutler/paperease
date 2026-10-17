import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { seedDb } from '../lib/seed';
import { agencyIdOf, availableFor, emptyWallet, holderKey, importCredentials, normalizePhone, publish, snapshotCredentials, takePending, addPending, isYes, isNo, walletSms } from '../lib/wallet';
import type { Db, Submission } from '../lib/types';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function approve(db: Db, cg: string, reqId: string, fields: Record<string, string>, over: Partial<Submission> = {}) {
  const req = db.rules.requirements.find((r) => r.id === reqId)!;
  const sub: Submission = {
    id: `sub_${cg}_${reqId}`, caregiverId: cg, requirementId: reqId, files: [{ name: 'p.png', url: '/samples/p.png', mime: 'image/png' }], extractedBy: 'claude', createdAt: new Date().toISOString(), state: 'approved', followUps: 0,
    fields: req.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, value: fields[f.key] ?? null, source: 'verified' as const, verifiedBy: 'Dana' })), ...over,
  };
  db.submissions.push(sub);
  const st = db.requirements.find((s) => s.caregiverId === cg && s.requirementId === reqId)!;
  Object.assign(st, { status: 'approved', approvedSubmissionId: sub.id, openSubmissionId: undefined });
  return sub;
}

describe('wallet primitives', () => {
  it('normalizes phones and keys by a hash, never the number', () => {
    assert.equal(normalizePhone('(909) 555-0131'), '+19095550131');
    assert.equal(normalizePhone('+1 909-555-0131'), '+19095550131');
    assert.throws(() => normalizePhone('123'));
    const k = holderKey('(909) 555-0131');
    assert.equal(k, holderKey('1-909-555-0131'));
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.ok(!k.includes('5550131'));
  });
  it('snapshot includes only approved, confirmed, unexpired, non-staff records and no photos', () => {
    const db = seedDb();
    approve(db, 'grace', 'tb_test', { name: 'Grace Okafor', test_date: day(-30), result: 'Negative' });
    approve(db, 'grace', 'background_check', { name: 'Grace Okafor', clearance_date: day(-300) });
    const unconfirmed = approve(db, 'grace', 'annual_training', { name: 'Grace Okafor' });
    unconfirmed.fields[0].source = 'ai';
    const snap = snapshotCredentials(db, 'grace');
    assert.deepEqual(snap.map((s) => s.requirementId), ['tb_test']);
    assert.ok(!JSON.stringify(snap).includes('p.png'));
    db.requirements.find((s) => s.caregiverId === 'grace' && s.requirementId === 'tb_test')!.expiresOn = day(-1);
    assert.equal(snapshotCredentials(db, 'grace').length, 0);
  });
  it('another agency sees the newest unexpired record; the publisher does not see its own', () => {
    const doc = emptyWallet();
    const mk = (agencyId: string, confirmedAt: string, expiresOn?: string) => ({ agencyId, agencyName: agencyId, requirementId: 'tb_test', name: 'TB', fields: [], confirmedBy: 'x', confirmedAt, publishedAt: confirmedAt, ...(expiresOn ? { expiresOn } : {}) });
    publish(doc, 'k', [mk('a', '2026-01-01T00:00:00Z', day(100))], { id: 'a', name: 'a' });
    publish(doc, 'k', [mk('b', '2026-03-01T00:00:00Z', day(100))], { id: 'b', name: 'b' });
    publish(doc, 'k', [mk('c', '2026-05-01T00:00:00Z', day(-5))], { id: 'c', name: 'c' });
    assert.equal(availableFor(doc, 'k', 'z')[0].agencyId, 'b');
    assert.equal(availableFor(doc, 'k', 'b')[0].agencyId, 'a');
    assert.equal(availableFor(doc, 'other', 'z').length, 0);
  });
  it('pending questions expire and are consumed once', () => {
    const doc = emptyWallet();
    const t0 = new Date('2026-01-01T00:00:00Z');
    addPending(doc, { kind: 'share', agencyId: 'a', agencyName: 'A', caregiverId: 'c' }, t0);
    assert.equal(takePending(doc, 'a', 'c', new Date('2026-01-10T00:00:00Z')), undefined);
    addPending(doc, { kind: 'share', agencyId: 'a', agencyName: 'A', caregiverId: 'c' }, t0);
    assert.ok(takePending(doc, 'a', 'c', new Date('2026-01-03T00:00:00Z')));
    assert.equal(takePending(doc, 'a', 'c', new Date('2026-01-03T00:00:00Z')), undefined);
  });
  it('import never approves, skips name mismatches and things already in progress', () => {
    const db = seedDb();
    const luis = db.caregivers.find((c) => c.id === 'luis')!;
    const cred = (over = {}) => ({ agencyId: 'x', agencyName: 'X', requirementId: 'initial_training', name: 'Entry', fields: [{ key: 'name', label: 'n', value: 'Luis Hernandez' }, { key: 'hours', label: 'h', value: '6' }, { key: 'completion_date', label: 'c', value: '2026-01-01' }, { key: 'course', label: 'c', value: 'Intro' }], confirmedBy: 'Priya', confirmedAt: '2026-01-02T00:00:00Z', publishedAt: '2026-01-02T00:00:00Z', ...over });
    const r = importCredentials(db, luis, [cred(), cred({ requirementId: 'background_check' }), cred({ requirementId: 'tb_test' })], (p) => `${p}_t`);
    assert.equal(r.imported.length, 1);
    assert.equal(r.skipped.length, 2);
    const st = db.requirements.find((s) => s.caregiverId === 'luis' && s.requirementId === 'initial_training')!;
    assert.equal(st.status, 'pending-review');
    const sub = db.submissions.find((s) => s.id === st.openSubmissionId)!;
    assert.ok(sub.fields.filter((f) => f.value).every((f) => f.source === 'imported'));
    const wrong = importCredentials(seedDb(), seedDb().caregivers.find((c) => c.id === 'maria')!, [cred()], (p) => p + '_t');
    assert.match(wrong.skipped[0].why, /name/i);
  });
  it('yes/no parsing and copy', () => {
    assert.ok(isYes('YES') && isYes('sí') && isYes(' Yes! ') && !isYes('yes please send the photo'));
    assert.ok(isNo('No') && !isNo('nope not now'));
    assert.match(walletSms('share-ask', { firstName: 'Ana', language: 'es' }, 'Sunrise'), /SI/);
    assert.ok(walletSms('import-ask', { firstName: 'Ana', language: 'en' }, 'Sunrise').length <= 320);
  });
  it('agency ids are stable slugs', () => assert.equal(agencyIdOf(seedDb()), 'sunrise-home-care'));
});

describe('wallet through the agent (two agencies)', () => {
  let dir: string;
  let run: typeof import('../lib/agent').run;
  let load: typeof import('../lib/db').load;
  let save: typeof import('../lib/db').save;
  let readDoc: typeof import('../lib/db').readDoc;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'careloop-wallet-'));
    process.env.CARELOOP_DATA_DIR = dir;
    for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'REGISTRY_PROVIDER', 'CARELOOP_AUTH']) delete process.env[k];
    ({ run } = await import('../lib/agent'));
    ({ load, save, readDoc } = await import('../lib/db'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  beforeEach(async () => { fs.rmSync(path.join(dir, 'wallet.json'), { force: true }); await run({ type: 'reset' }); });

  it('demo: the sample other agency pre-fills Luis after he says YES, and a person must still confirm', async () => {
    let db = await run({ type: 'wallet-request', caregiverId: 'luis' });
    assert.match(db.messages.at(-1)!.text!, /SI/);
    db = await run({ type: 'caregiver-reply', caregiverId: 'luis', text: 'SI' });
    const st = db.requirements.find((s) => s.caregiverId === 'luis' && s.requirementId === 'initial_training')!;
    assert.equal(st.status, 'pending-review');
    const sub = db.submissions.find((s) => s.id === st.openSubmissionId)!;
    assert.equal(sub.fields.find((f) => f.key === 'hours')!.value, '6');
    assert.match(sub.fields.find((f) => f.key === 'hours')!.sourceRef!, /Harbor Home Health/);
    await assert.rejects(run({ type: 'approve', submissionId: sub.id }), /verified by a person/);
    for (const f of sub.fields.filter((x) => x.value)) await run({ type: 'verify-field', submissionId: sub.id, key: f.key });
    const done = await run({ type: 'approve', submissionId: sub.id });
    assert.equal(done.requirements.find((s) => s.caregiverId === 'luis' && s.requirementId === 'initial_training')!.status, 'approved');
    const wallet = (await readDoc<any>('wallet'))!;
    assert.ok(Object.values<any>(wallet.holders)[0].access.some((a: any) => a.action === 'imported'));
  });

  it('nothing is imported without a YES; NO declines and is logged', async () => {
    await run({ type: 'wallet-request', caregiverId: 'luis' });
    let db = await run({ type: 'caregiver-reply', caregiverId: 'luis', text: 'no' });
    assert.equal(db.requirements.find((s) => s.caregiverId === 'luis' && s.requirementId === 'initial_training')!.status, 'missing');
    assert.ok(db.audit.some((e) => e.action.includes('replied NO')));
    db = await run({ type: 'caregiver-reply', caregiverId: 'luis', text: 'yes' });
    assert.equal(db.requirements.find((s) => s.caregiverId === 'luis' && s.requirementId === 'initial_training')!.status, 'missing', 'the question was consumed');
  });

  it('asking about a caregiver with no wallet looks identical to the admin and sends no text', async () => {
    const before = (await load()).messages.length;
    const db = await run({ type: 'wallet-request', caregiverId: 'grace' });
    assert.equal(db.messages.length, before);
    assert.ok(db.audit.at(-1)!.action.includes('checked the credential wallet'));
  });

  it('sharing needs a YES, then publishes confirmed values only; STOP takes them back out', async () => {
    let db = await load();
    const grace = db.caregivers.find((c) => c.id === 'grace')!;
    approve(db, 'grace', 'tb_test', { name: 'Grace Okafor', test_date: day(-30), result: 'Negative' });
    await save(db);
    db = await run({ type: 'wallet-offer-share', caregiverId: 'grace' });
    assert.equal(Object.keys(((await readDoc<any>('wallet')).holders)).includes(holderKey(grace.phone)), false, 'nothing published before YES');
    db = await run({ type: 'caregiver-reply', caregiverId: 'grace', text: 'YES' });
    let w = (await readDoc<any>('wallet'))!;
    const creds = w.holders[holderKey(grace.phone)].credentials;
    assert.deepEqual(creds.map((c: any) => c.requirementId), ['tb_test']);
    assert.ok(!JSON.stringify(w).includes('p.png') && !JSON.stringify(w).includes('555-0108'), 'no files and no phone number in the wallet');
    db = await run({ type: 'caregiver-reply', caregiverId: 'grace', text: 'STOP' });
    w = (await readDoc<any>('wallet'))!;
    assert.equal(w.holders[holderKey(grace.phone)].credentials.length, 0);
    assert.ok(db.audit.some((e) => e.action === 'removed records from the credential wallet'));
  });

  it('refuses to offer when there is nothing confirmed to share, or no SMS consent', async () => {
    await assert.rejects(run({ type: 'wallet-offer-share', caregiverId: 'maria' }), /Nothing to share/);
    const db = await load();
    db.caregivers.find((c) => c.id === 'grace')!.smsConsent = false;
    await save(db);
    await assert.rejects(run({ type: 'wallet-request', caregiverId: 'grace' }), /agreed to receive texts/);
  });
});
