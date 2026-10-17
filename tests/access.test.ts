import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStoredName, mimeFromBytes, sniffMatches } from '../lib/files';
import { signInRequired } from '../lib/signin';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = new TextEncoder().encode('%PDF-1.7\n');

describe('upload content checks', () => {
  it('file signatures must agree with the claimed type', () => {
    assert.equal(sniffMatches('image/png', png), true);
    assert.equal(sniffMatches('application/pdf', png), false);
    assert.equal(sniffMatches('image/png', new TextEncoder().encode('<script>alert(1)</script>')), false);
    assert.equal(mimeFromBytes(pdf), 'application/pdf');
    assert.equal(sniffMatches('image/svg+xml', png), false);
  });
  it('only generated file names can be requested back', () => {
    assert.equal(isStoredName('up_mabc12.png'), true);
    assert.equal(isStoredName('../db.json'), false);
    assert.equal(isStoredName('up_x.html'), false);
    assert.equal(isStoredName('db.json'), false);
  });
});

describe('saveUpload', () => {
  it('rejects a file whose bytes do not match its type and stores one that does', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperease-up-'));
    process.env.PAPEREASE_DATA_DIR = dir;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
    const { saveUpload } = await import('../lib/uploads');
    await assert.rejects(saveUpload(new File([new TextEncoder().encode('<html>x</html>')], 'x.png', { type: 'image/png' })), /real photo/);
    const ok = await saveUpload(new File([png], 'photo.png', { type: 'image/png' }));
    assert.match(ok.url, /^\/api\/files\/up_[a-z0-9]+\.png$/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('sign-in switch', () => {
  it('is on only when Supabase Auth is configured', () => {
    assert.equal(signInRequired({} as any), false);
    assert.equal(signInRequired({ SUPABASE_URL: 'https://x.supabase.co' } as any), false);
    assert.equal(signInRequired({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' } as any), true);
  });
});
