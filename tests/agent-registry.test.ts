// Drives the real agent (lib/agent.ts) end to end with no API keys and an empty temp data folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Db, RequirementState, Submission } from '../lib/types';

let run: typeof import('../lib/agent').run;
let setDemoRegistryStatus: typeof import('../lib/registry-providers').setDemoRegistryStatus;
let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'careloop-test-'));
  process.env.CARELOOP_DATA_DIR = dir;
  for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'RUNANYWHERE_BASE_URL', 'RUNANYWHERE_API_KEY', 'REGISTRY_PROVIDER']) delete process.env[k];
  ({ run } = await import('../lib/agent'));
  ({ setDemoRegistryStatus } = await import('../lib/registry-providers'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.REGISTRY_PROVIDER;
});

const state = (db: Db, cg: string, req: string): RequirementState => db.requirements.find((s) => s.caregiverId === cg && s.requirementId === req)!;
const openSub = (db: Db, cg: string, req: string): Submission => db.submissions.find((s) => s.id === state(db, cg, req).openSubmissionId)!;
const auditText = (db: Db, cg: string) => db.audit.filter((e) => e.caregiverId === cg).map((e) => `${e.action} ${e.detail ?? ''}`).join('\n');

/** Luis texts his HCA card (sample photo); returns the db with a prepared record. */
async function luisSendsCard(): Promise<Db> {
  let db = await run({ type: 'reset' });
  db = await run({ type: 'request-another', submissionId: openSub(db, 'luis', 'hca_registration').id });
  return run({ type: 'caregiver-reply', caregiverId: 'luis', sampleId: 'hca-luis' });
}

async function verifyAll(db: Db, subId: string): Promise<Db> {
  for (const f of db.submissions.find((s) => s.id === subId)!.fields) {
    if (f.value !== null && (f.source === 'ai' || f.source === 'caregiver')) db = await run({ type: 'verify-field', submissionId: subId, key: f.key });
  }
  return db;
}

const setNumber = (subId: string, value: string) => run({ type: 'edit-field', submissionId: subId, key: 'registration_number', value });
const reason = (db: Db, id: string) => db.submissions.find((s) => s.id === id)!.escalation;

describe('HCA registry check in the agent flow', () => {
  beforeEach(async () => {
    await run({ type: 'reset' });
  });

  it('checks the registry when the card arrives, and the record reaches review', async () => {
    const db = await luisSendsCard();
    const sub = openSub(db, 'luis', 'hca_registration');
    assert.equal(sub.registryCheck?.outcome, 'found');
    assert.equal(sub.registryCheck?.status, 'REGISTERED');
    assert.equal(sub.registryCheck?.searchedName, 'Luis Hernández'); // the caregiver on file, not text from the photo
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
    assert.match(auditText(db, 'luis'), /checked the California HCA registry[^\n]*…2290: REGISTERED \(demo registry\)/);
    assert.ok(!auditText(db, 'luis').includes('44172290'), 'the full ID is not copied into the audit log');
  });

  it('approves only after every field is verified, and the registry still passes', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    await assert.rejects(run({ type: 'approve', submissionId: id }), /Every field must be verified/);
    db = await verifyAll(db, id);
    db = await run({ type: 'approve', submissionId: id });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'approved');
  });

  it('stops a record whose number the registry shows as revoked, and holds approval', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    db = await setNumber(id, 'DEMO-REVOKED');
    assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.status, 'REVOKED');
    assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
    assert.match(reason(db, id)!, /^California HCA registry: .*Revoked/);
    db = await verifyAll(db, id);
    await assert.rejects(run({ type: 'approve', submissionId: id }), /Revoked/);
  });

  it('releases the record again when staff correct the number to a registered one', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    db = await setNumber(id, 'DEMO-REVOKED');
    assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
    db = await setNumber(id, 'HCA 4417-2290');
    const sub = db.submissions.find((s) => s.id === id)!;
    assert.equal(sub.registryCheck?.status, 'REGISTERED');
    assert.equal(sub.state, 'ready');
    assert.equal(sub.escalation, undefined);
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
    db = await verifyAll(db, id);
    db = await run({ type: 'approve', submissionId: id });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'approved');
  });

  it('treats a number that is not on the registry, or another aide’s number, as a stop', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    for (const bad of ['ZZZ99999', 'DEMO1001' /* Maria's ID, searched under Luis's name */]) {
      db = await setNumber(id, bad);
      assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.outcome, 'not-found', bad);
      assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated', bad);
      assert.match(reason(db, id)!, /No match/, bad);
    }
  });

  it('does not search a number that cannot be an ID', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    db = await setNumber(id, '12');
    assert.match(db.submissions.find((s) => s.id === id)!.registryCheck!.note!, /does not look like a registry ID/);
    assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
  });

  it('keeps a different escalation reason instead of overwriting it with the registry one', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    // another problem already stopped the record
    db.submissions.find((s) => s.id === id)!.state = 'escalated';
    db.submissions.find((s) => s.id === id)!.escalation = 'The name does not match.';
    db = await setNumber(id, 'DEMO-REVOKED');
    assert.equal(reason(db, id), 'The name does not match.');
    assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.status, 'REVOKED'); // still recorded
  });

  it('re-checks on request, and refuses on closed records or when there is no number', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    try {
      setDemoRegistryStatus('44172290', 'FORFEITED');
      db = await run({ type: 'check-registry', submissionId: id });
      assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.status, 'FORFEITED');
      assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
    } finally {
      setDemoRegistryStatus('44172290', 'REGISTERED');
    }
    db = await run({ type: 'check-registry', submissionId: id });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');

    db = await verifyAll(db, id);
    db = await run({ type: 'approve', submissionId: id });
    await assert.rejects(run({ type: 'check-registry', submissionId: id }), /closed/);

    // a fresh request has no number yet
    db = await run({ type: 'reset' });
    db = await run({ type: 'request-another', submissionId: openSub(db, 'luis', 'hca_registration').id });
    await assert.rejects(run({ type: 'check-registry', submissionId: openSub(db, 'luis', 'hca_registration').id }), /no registration number/);
  });

  it('skips the lookup when the number was read at low confidence', async () => {
    let db = await luisSendsCard();
    const sub = openSub(db, 'luis', 'hca_registration');
    sub.registryCheck = undefined;
    sub.fields.find((f) => f.key === 'registration_number')!.confidence = 0.2;
    db = await run({ type: 'check-registry', submissionId: sub.id });
    assert.equal(db.submissions.find((s) => s.id === sub.id)!.registryCheck, undefined);
    await assert.rejects(run({ type: 'approve', submissionId: sub.id }), /Every field|Check the aide/);
  });

  it('reads the number from an SMS reply when the card did not show it, then checks the registry', async () => {
    let db = await luisSendsCard();
    const sub = openSub(db, 'luis', 'hca_registration');
    // simulate a card where the number could not be read: the agent is waiting on a follow-up answer
    Object.assign(sub.fields.find((f) => f.key === 'registration_number')!, { value: null, confidence: undefined });
    sub.registryCheck = undefined;
    sub.state = 'collecting';
    state(db, 'luis', 'hca_registration').status = 'following-up';
    db = await run({ type: 'caregiver-reply', caregiverId: 'luis', text: 'my number is HCA 4417-2290, gracias' });
    const after = openSub(db, 'luis', 'hca_registration');
    const f = after.fields.find((x) => x.key === 'registration_number')!;
    assert.equal(f.source, 'caregiver');
    assert.equal(f.value, '4417-2290');
    assert.equal(after.registryCheck?.status, 'REGISTERED');
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
  });

  it('a reply with a revoked number is escalated, not prepared', async () => {
    let db = await luisSendsCard();
    const sub = openSub(db, 'luis', 'hca_registration');
    Object.assign(sub.fields.find((f) => f.key === 'registration_number')!, { value: null, confidence: undefined });
    sub.registryCheck = undefined;
    sub.state = 'collecting';
    state(db, 'luis', 'hca_registration').status = 'following-up';
    db = await run({ type: 'caregiver-reply', caregiverId: 'luis', text: 'DEMO-REVOKED' });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
    assert.match(reason(db, sub.id)!, /Revoked/);
  });

  it('does not touch other requirements: Maria’s training still flows and approves as before', async () => {
    let db = await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    db = await run({ type: 'caregiver-reply', caregiverId: 'maria', sampleId: 'training-no-hours' });
    db = await run({ type: 'caregiver-reply', caregiverId: 'maria', text: 'It was 5 hours' });
    const sub = openSub(db, 'maria', 'initial_training');
    assert.equal(sub.registryCheck, undefined);
    assert.equal(state(db, 'maria', 'initial_training').status, 'pending-review');
    db = await verifyAll(db, sub.id);
    db = await run({ type: 'approve', submissionId: sub.id });
    assert.equal(state(db, 'maria', 'initial_training').status, 'approved');
  });
});

describe('manual lookup mode', () => {
  beforeEach(async () => {
    await run({ type: 'reset' });
    process.env.REGISTRY_PROVIDER = 'manual';
  });

  it('prepares the record but holds approval until staff record a result', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.outcome, 'unavailable');
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
    db = await verifyAll(db, id);
    await assert.rejects(run({ type: 'approve', submissionId: id }), /record the result/);
    db = await run({ type: 'record-registry-check', submissionId: id, result: 'REGISTERED' });
    assert.equal(db.submissions.find((s) => s.id === id)!.registryCheck?.checkedBy, 'Dana (Admin)');
    assert.match(auditText(db, 'luis'), /recorded a California HCA registry lookup[^\n]*…2290: REGISTERED/);
    db = await run({ type: 'approve', submissionId: id });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'approved');
  });

  it('stops the record when staff record a bad result, and releases it on a corrected one', async () => {
    let db = await luisSendsCard();
    const id = openSub(db, 'luis', 'hca_registration').id;
    db = await run({ type: 'record-registry-check', submissionId: id, result: 'REVOKED' });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'escalated');
    db = await run({ type: 'record-registry-check', submissionId: id, result: 'NOT_FOUND' });
    assert.match(reason(db, id)!, /No match/);
    db = await run({ type: 'record-registry-check', submissionId: id, result: 'REGISTERED*' });
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
  });

  it('rejects a result on a record with no number, and on other requirements', async () => {
    let db = await run({ type: 'reset' });
    db = await run({ type: 'request-another', submissionId: openSub(db, 'luis', 'hca_registration').id });
    await assert.rejects(run({ type: 'record-registry-check', submissionId: openSub(db, 'luis', 'hca_registration').id, result: 'REGISTERED' }), /no registration number/);
    db = await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    await assert.rejects(run({ type: 'record-registry-check', submissionId: openSub(db, 'maria', 'initial_training').id, result: 'REGISTERED' }), /Only the Home Care Aide/);
  });

  it('a misconfigured provider degrades to manual instead of failing the caregiver’s photo', async () => {
    process.env.REGISTRY_PROVIDER = 'cdss';
    const db = await luisSendsCard();
    const sub = openSub(db, 'luis', 'hca_registration');
    assert.equal(sub.registryCheck?.outcome, 'unavailable');
    assert.match(sub.registryCheck!.note!, /Unknown REGISTRY_PROVIDER/);
    assert.equal(state(db, 'luis', 'hca_registration').status, 'pending-review');
  });
});
