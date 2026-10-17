import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffMatches, mimeFromBytes, isStoredName } from '../lib/files';
import { requireAdmin, securityPosture, authRequired } from '../lib/access';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = new TextEncoder().encode('%PDF-1.7\n');

test('file signatures must agree with the claimed type', () => {
  assert.equal(sniffMatches('image/png', png), true);
  assert.equal(sniffMatches('application/pdf', png), false);
  assert.equal(sniffMatches('image/png', new TextEncoder().encode('<script>alert(1)</script>')), false);
  assert.equal(mimeFromBytes(pdf), 'application/pdf');
  assert.equal(sniffMatches('image/svg+xml', png), false);
});

test('only generated file names can be requested back', () => {
  assert.equal(isStoredName('up_mabc12.png'), true);
  assert.equal(isStoredName('../db.json'), false);
  assert.equal(isStoredName('up_x.html'), false);
  assert.equal(isStoredName('db.json'), false);
});

test('open mode is the default and lets the demo through', async () => {
  delete process.env.CARELOOP_AUTH;
  assert.equal(authRequired(), false);
  assert.equal((await requireAdmin(new Request('http://x/api/state'))).open, true);
  assert.equal(securityPosture().auth, 'open');
});

test('required mode rejects a request with no session, and a cross-origin write', async () => {
  process.env.CARELOOP_AUTH = 'required';
  const saved = { l: process.env.REGULATORY_LOCAL_DEMO, u: process.env.SUPABASE_URL };
  process.env.REGULATORY_LOCAL_DEMO = 'false';
  try {
    await assert.rejects(requireAdmin(new Request('http://x/api/state')), (e: any) => e.status === 401 || e.status === 500 || e.status === 503);
    await assert.rejects(
      requireAdmin(new Request('http://x/api/actions', { method: 'POST', headers: { origin: 'http://evil.test', host: 'x' } }), true),
      (e: any) => e.status === 403,
    );
  } finally {
    delete process.env.CARELOOP_AUTH;
    if (saved.l === undefined) delete process.env.REGULATORY_LOCAL_DEMO; else process.env.REGULATORY_LOCAL_DEMO = saved.l;
  }
});
