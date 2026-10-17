import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDb } from '../lib/seed';
import { agencyReadiness, buildPacket, renderPacketHtml } from '../lib/packet';
import { manualRegistryCheck } from '../lib/registry-providers';
import type { Db, Submission } from '../lib/types';

const asOf = new Date();

function withApproved(db: Db, caregiverId: string, requirementId: string, over: Partial<Submission> = {}) {
  const sub: Submission = {
    id: `sub_t_${requirementId}`, caregiverId, requirementId, createdAt: new Date().toISOString(), state: 'approved', followUps: 0, extractedBy: 'claude',
    files: [{ name: 'doc.png', url: '/samples/hca-card-luis.png', mime: 'image/png' }],
    fields: [{ key: 'name', label: 'Name', value: 'X', required: true, source: 'verified', verifiedBy: 'Dana' }],
    ...over,
  };
  db.submissions.push(sub);
  const st = db.requirements.find((s) => s.caregiverId === caregiverId && s.requirementId === requirementId)!;
  st.status = 'approved'; st.approvedSubmissionId = sub.id;
  return sub;
}

test('a seeded "approved" item with no record behind it is not audit ready', () => {
  const db = seedDb();
  const p = buildPacket(db, 'grace', asOf);
  assert.equal(p.readiness.auditReady, false);
  assert.ok(p.items.some((i) => i.issues.some((x) => x.code === 'no-record')));
});

test('a fully confirmed record with its original is ready', () => {
  const db = seedDb();
  withApproved(db, 'grace', 'tb_test');
  const item = buildPacket(db, 'grace', asOf).items.find((i) => i.requirementId === 'tb_test')!;
  assert.equal(item.ready, true, JSON.stringify(item.issues));
});

test('fields nobody confirmed block readiness and say which', () => {
  const db = seedDb();
  withApproved(db, 'grace', 'tb_test', { fields: [{ key: 'test_date', label: 'Test date', value: '2026-01-01', required: true, source: 'ai', confidence: 0.9 }] });
  const item = buildPacket(db, 'grace', asOf).items.find((i) => i.requirementId === 'tb_test')!;
  assert.ok(item.issues.some((x) => x.code === 'unverified-fields' && x.text.includes('test date')));
});

test('missing original blocks SMS-collected items but not staff-collected ones', () => {
  const db = seedDb();
  withApproved(db, 'grace', 'tb_test', { files: [] });
  withApproved(db, 'grace', 'background_check', { files: [] });
  const p = buildPacket(db, 'grace', asOf);
  assert.ok(p.items.find((i) => i.requirementId === 'tb_test')!.issues.some((x) => x.code === 'no-original'));
  assert.ok(!p.items.find((i) => i.requirementId === 'background_check')!.issues.some((x) => x.code === 'no-original'));
});

test('an expired record is flagged using the audit date, not today', () => {
  const db = seedDb();
  withApproved(db, 'grace', 'tb_test');
  db.requirements.find((s) => s.caregiverId === 'grace' && s.requirementId === 'tb_test')!.expiresOn = '2026-01-10';
  const later = buildPacket(db, 'grace', new Date('2026-02-01T00:00:00Z'));
  assert.ok(later.items.find((i) => i.requirementId === 'tb_test')!.issues.some((x) => x.code === 'expired'));
  const earlier = buildPacket(db, 'grace', new Date('2026-01-01T00:00:00Z'));
  assert.ok(!earlier.items.find((i) => i.requirementId === 'tb_test')!.issues.some((x) => x.code === 'expired'));
});

test('HCA registration needs a passing registry lookup', () => {
  const db = seedDb();
  const fields = [{ key: 'registration_number', label: 'HCA registration number', value: 'HCA 4417-2290', required: true, source: 'verified' as const, verifiedBy: 'Dana' }];
  const sub = withApproved(db, 'luis', 'hca_registration', { fields });
  assert.ok(buildPacket(db, 'luis', asOf).items.find((i) => i.requirementId === 'hca_registration')!.issues.some((x) => x.code === 'registry'));
  sub.registryCheck = manualRegistryCheck('Luis Hernández', 'HCA 4417-2290', 'REGISTERED', 'Dana');
  const item = buildPacket(db, 'luis', asOf).items.find((i) => i.requirementId === 'hca_registration')!;
  assert.equal(item.registry?.verdict, 'pass');
  assert.ok(!item.issues.some((x) => x.code === 'registry'));
  sub.registryCheck = manualRegistryCheck('Luis Hernández', 'HCA 4417-2290', 'REVOKED', 'Dana');
  assert.ok(buildPacket(db, 'luis', asOf).items.find((i) => i.requirementId === 'hca_registration')!.issues.some((x) => x.code === 'registry'));
});

test('score and fingerprint', () => {
  const db = seedDb();
  const a = buildPacket(db, 'grace', asOf);
  assert.equal(a.readiness.score, Math.round((a.readiness.ready / a.readiness.total) * 100));
  assert.equal(buildPacket(db, 'grace', asOf).fingerprint, a.fingerprint);
  db.requirements.find((s) => s.caregiverId === 'grace')!.explanation = 'x';
  withApproved(db, 'grace', 'tb_test');
  assert.notEqual(buildPacket(db, 'grace', asOf).fingerprint, a.fingerprint);
  assert.throws(() => buildPacket(db, 'nobody', asOf));
});

test('agency view covers every caregiver', () => {
  const db = seedDb();
  const r = agencyReadiness(db, asOf);
  assert.equal(r.rows.length, db.caregivers.length);
  assert.equal(r.total, db.caregivers.length);
});

test('rendered file escapes caregiver-controlled text and embeds hashes', () => {
  const db = seedDb();
  db.caregivers[0].name = 'Evil <script>alert(1)</script>';
  const sub = withApproved(db, db.caregivers[0].id, 'tb_test', { fields: [{ key: 'x', label: 'L<b>', value: '"><img src=x onerror=1>', required: true, source: 'verified', verifiedBy: 'Dana' }] });
  const p = buildPacket(db, db.caregivers[0].id, asOf);
  const html = renderPacketHtml(p, { [sub.files[0].url]: { sha256: 'abc123', bytes: 4, dataUri: 'data:image/png;base64,AAAA' } });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('abc123'));
  assert.ok(html.includes(p.fingerprint));
});
