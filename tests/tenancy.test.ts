// HCOs are isolated: signed-in staff see and change only their own HCO's caregivers. No API keys, temp data folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Admin } from '../lib/adminRole';
import type { Db } from '../lib/types';

let run: typeof import('../lib/agent').run;
let tenancy: typeof import('../lib/tenancy');
let dir: string;

const dana: Admin = { name: 'Dana Park', email: 'admin1@paperease.test' }; // Sunrise Home Care
const sam: Admin = { name: 'Sam Lee', email: 'admin3@paperease.test' }; // Golden Bay Home Care
const stranger: Admin = { name: 'New Person', email: 'nobody@paperease.test' }; // no HCO yet

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperease-tenancy-'));
  process.env.PAPEREASE_DATA_DIR = dir;
  for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'RUNANYWHERE_BASE_URL', 'RUNANYWHERE_API_KEY']) delete process.env[k];
  ({ run } = await import('../lib/agent'));
  tenancy = await import('../lib/tenancy');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let db: Db;
beforeEach(async () => {
  db = await run({ type: 'reset' });
});

const view = (me?: Admin) => tenancy.scopeDb(db, tenancy.hcoScope(db, me));
const openSub = (cg: string, req: string) => db.submissions.find((s) => s.id === db.requirements.find((r) => r.caregiverId === cg && r.requirementId === req)!.openSubmissionId)!;

describe('what staff can see', () => {
  it('shows only their own HCO', () => {
    const v = view(dana);
    assert.deepEqual(v.caregivers.map((c) => c.id).sort(), ['ana', 'david', 'james', 'maria']);
    assert.deepEqual(v.hcos.map((h) => h.id), ['sunrise']);
    assert.deepEqual(v.staff.map((s) => s.name).sort(), ['Alex Kim', 'Dana Park']);
    const ids = new Set(v.caregivers.map((c) => c.id));
    for (const list of [v.requirements, v.submissions, v.messages]) assert.ok(list.every((x) => ids.has(x.caregiverId)));
    const text = JSON.stringify(v);
    for (const other of ['Luis', 'Grace', 'Golden Bay', 'Sam Lee', 'Jordan Cho']) assert.ok(!text.includes(other), `${other} leaked`);
  });

  it('shows nothing to an account with no HCO, and everything without sign-in', () => {
    assert.equal(view(stranger).caregivers.length, 0);
    assert.equal(view(stranger).audit.filter((e) => e.caregiverId).length, 0);
    assert.equal(view(undefined).caregivers.length, db.caregivers.length);
  });

  it('keeps shared sweep summaries but drops their detail, which covers every HCO', async () => {
    db = await run({ type: 'run-sweep', trigger: 'schedule' });
    const sweep = view(dana).audit.at(-1)!;
    assert.equal(sweep.action, 'ran the scheduled daily sweep');
    assert.equal(sweep.detail, undefined);
  });

  it('serves a file only to the HCO whose records hold it', () => {
    const file = path.basename(openSub('luis', 'hca_registration').files[0].url);
    db.submissions.find((s) => s.files.some((f) => f.url.endsWith(file)))!.files[0].url = `/api/files/${file}`;
    assert.equal(tenancy.ownsFile(db, tenancy.hcoScope(db, sam), file), true);
    assert.equal(tenancy.ownsFile(db, tenancy.hcoScope(db, dana), file), false);
  });
});

describe('what staff can change', () => {
  it('refuses actions on another HCO’s caregiver as if they did not exist', async () => {
    await assert.rejects(run({ type: 'request-another', submissionId: openSub('luis', 'hca_registration').id }, { me: dana }), /Not found/);
    await assert.rejects(run({ type: 'authorize-outreach', caregiverId: 'luis', requirementId: 'initial_training' }, { me: dana }), /Not found/);
    await assert.rejects(run({ type: 'caregiver-reply', caregiverId: 'grace', text: 'hi' }, { me: dana }), /Not found/);
  });

  it('assigns only to colleagues from the caregiver’s HCO', async () => {
    await assert.rejects(run({ type: 'assign-caregiver', caregiverId: 'maria', email: sam.email }, { me: dana }), /HCO/);
    db = await run({ type: 'assign-caregiver', caregiverId: 'maria', email: 'admin2@paperease.test' }, { me: dana });
    assert.equal(db.caregivers.find((c) => c.id === 'maria')!.assignedTo, 'admin2@paperease.test');
  });

  it('edits only their own HCO and cannot reset everyone’s data', async () => {
    const details = { name: 'Golden Bay', license: '', address: '', phone: '' };
    await assert.rejects(run({ type: 'update-hco', hcoId: 'goldenbay', hco: details }, { me: dana }), /own HCO/);
    await assert.rejects(run({ type: 'reset' }, { me: dana }), /every HCO/);
    await assert.rejects(run({ type: 'run-sweep' }, { me: stranger }), /not linked/);
  });

  it('puts a new caregiver in the adder’s HCO and keeps the bulk request inside it', async () => {
    db = await run({ type: 'add-caregiver', name: 'Rosa Martinez', phone: '(213) 555-0100', language: 'en' }, { me: sam });
    const rosa = db.caregivers.at(-1)!;
    assert.equal(rosa.hcoId, 'goldenbay');
    assert.equal(rosa.assignedTo, sam.email);
    const before = new Set(db.requirements.filter((s) => s.status === 'requested').map((s) => `${s.caregiverId}/${s.requirementId}`));
    db = await run({ type: 'authorize-all' }, { me: sam });
    const added = db.requirements.filter((s) => s.status === 'requested' && !before.has(`${s.caregiverId}/${s.requirementId}`)).map((s) => s.caregiverId);
    assert.ok(added.includes(rosa.id));
    assert.ok(added.every((id) => db.caregivers.find((c) => c.id === id)!.hcoId === 'goldenbay'), `requested outside Golden Bay: ${added}`);
  });
});
