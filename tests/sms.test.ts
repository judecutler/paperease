import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { SmsError, isTwilioMediaUrl, sendSms, smsStatus, twilioSignature, validTwilioSignature, webhookUrl } from '../lib/sms';

const TOKEN = 'tok_' + 'a'.repeat(28);
const ENV = { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006', SMS_LIVE: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk_test', PUBLIC_BASE_URL: 'https://app.example.com' };

describe('twilio signature', () => {
  it('matches the worked example in Twilio\'s documentation', () => {
    const sig = twilioSignature('https://mycompany.com/myapp.php?foo=1&bar=2', { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' }, '12345');
    assert.equal(sig, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });
  it('accepts a correct signature and rejects tampering', () => {
    const params = { From: '+13105550100', Body: 'hello', MessageSid: 'SM1' };
    const sig = twilioSignature('https://app.example.com/api/sms/inbound', params, TOKEN);
    assert.ok(validTwilioSignature('https://app.example.com/api/sms/inbound', params, sig, TOKEN));
    assert.ok(!validTwilioSignature('https://app.example.com/api/sms/inbound', { ...params, Body: 'hi' }, sig, TOKEN));
    assert.ok(!validTwilioSignature('https://evil.example.com/api/sms/inbound', params, sig, TOKEN));
    assert.ok(!validTwilioSignature('https://app.example.com/api/sms/inbound', params, null, TOKEN));
    assert.ok(!validTwilioSignature('https://app.example.com/api/sms/inbound', params, 'x', TOKEN));
  });
  it('builds the signed URL from PUBLIC_BASE_URL, else forwarded headers', () => {
    const req = new Request('http://internal:3000/api/sms/inbound?x=1', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'a.b' } });
    assert.equal(webhookUrl(req, { PUBLIC_BASE_URL: 'https://app.example.com/' } as any), 'https://app.example.com/api/sms/inbound?x=1');
    assert.equal(webhookUrl(req, {} as any), 'https://a.b/api/sms/inbound?x=1');
  });
});

describe('sending', () => {
  it('stays simulated unless every safeguard is on', () => {
    assert.equal(smsStatus({} as any).mode, 'simulated');
    assert.equal(smsStatus({ ...ENV, SMS_LIVE: undefined } as any).mode, 'simulated');
    assert.match(smsStatus({ ...ENV, SUPABASE_PUBLISHABLE_KEY: undefined } as any).reason!, /sign-in/);
    assert.equal(smsStatus(ENV as any).mode, 'live');
  });
  it('posts the right form with basic auth and normalizes the number', async () => {
    let seen: any;
    const fetchImpl = (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 }); }) as any;
    const r = await sendSms('(310) 555-0100', 'hello', { env: ENV as any, fetchImpl });
    assert.equal(r.sid, 'SM1');
    assert.equal(seen.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    assert.equal(seen.init.headers.authorization, `Basic ${Buffer.from(`ACtest:${TOKEN}`).toString('base64')}`);
    const form = seen.init.body as URLSearchParams;
    assert.equal(form.get('To'), '+13105550100');
    assert.equal(form.get('From'), '+15005550006');
    assert.equal(form.get('StatusCallback'), 'https://app.example.com/api/sms/status');
  });
  it('maps Twilio errors without echoing the number or text', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ code: 21610, message: 'Attempt to send to unsubscribed recipient' }), { status: 400 })) as any;
    await assert.rejects(sendSms('(310) 555-0100', 'secret body', { env: ENV as any, fetchImpl }), (e: any) => e instanceof SmsError && e.code === 21610 && !e.message.includes('555'));
  });
  it('only trusts twilio hosts for media', () => {
    assert.ok(isTwilioMediaUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME'));
    assert.ok(!isTwilioMediaUrl('http://api.twilio.com/x'));
    assert.ok(!isTwilioMediaUrl('https://evil.test/api.twilio.com'));
    assert.ok(!isTwilioMediaUrl('https://twilio.com.evil.test/x'));
    assert.ok(!isTwilioMediaUrl('https://169.254.169.254/latest'));
  });
});

describe('end to end with a stubbed Twilio', () => {
  let dir: string;
  let run: typeof import('../lib/agent').run;
  let inbound: typeof import('../app/api/sms/inbound/route');
  let status: typeof import('../app/api/sms/status/route');
  const realFetch = globalThis.fetch;
  const sent: { to: string; body: string }[] = [];
  const saved: Record<string, string | undefined> = {};
  let failWith: { code: number; message: string } | null = null;
  let mediaBytes: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperease-sms-'));
    for (const k of [...Object.keys(ENV), 'PAPEREASE_DATA_DIR', 'SUPABASE_SECRET_KEY', 'ANTHROPIC_API_KEY']) saved[k] = process.env[k];
    Object.assign(process.env, ENV, { PAPEREASE_DATA_DIR: dir });
    delete process.env.SUPABASE_SECRET_KEY; delete process.env.ANTHROPIC_API_KEY; // URL + publishable key stay: they are the sign-in switch; no secret key keeps the JSON store
    ({ run } = await import('../lib/agent'));
    inbound = await import('../app/api/sms/inbound/route');
    status = await import('../app/api/sms/status/route');
  });
  after(() => {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    sent.length = 0; failWith = null;
    fs.rmSync(path.join(dir, 'sms_seen.json'), { force: true });
    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url);
      if (u.startsWith('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')) {
        if (failWith) return new Response(JSON.stringify(failWith), { status: 400 });
        sent.push({ to: init.body.get('To'), body: init.body.get('Body') });
        return new Response(JSON.stringify({ sid: 'SM' + sent.length, status: 'queued' }), { status: 201 });
      }
      if (u.includes('/Media/')) return new Response(new Uint8Array(mediaBytes), { headers: { 'content-type': 'image/png' } });
      throw new Error('unexpected fetch ' + u);
    }) as any;
    await run({ type: 'reset' });
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const signed = (pathname: string, params: Record<string, string>, token = TOKEN) => {
    const body = new URLSearchParams(params);
    return new Request(`https://app.example.com${pathname}`, { method: 'POST', headers: { 'x-twilio-signature': twilioSignature(`https://app.example.com${pathname}`, params, token), 'content-type': 'application/x-www-form-urlencoded' }, body });
  };

  it('an agent action sends the text to the caregiver\'s real number', async () => {
    await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '+12135550142');
    assert.match(sent[0].body, /Maria/);
  });

  it('a failed send is kept in the thread and recorded, and the action still succeeds', async () => {
    failWith = { code: 30006, message: 'Landline or unreachable carrier' };
    const db = await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    assert.ok(db.audit.some((e) => e.action === 'a text could not be sent' && e.detail!.includes('30006')));
    assert.equal(db.requirements.find((s) => s.caregiverId === 'maria' && s.requirementId === 'initial_training')!.status, 'requested');
  });

  it('a carrier-level STOP (21610) marks the caregiver opted out', async () => {
    failWith = { code: 21610, message: 'unsubscribed' };
    const db = await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    assert.equal(db.caregivers.find((c) => c.id === 'maria')!.optedOut, true);
  });

  it('inbound: rejects a bad signature and a missing token', async () => {
    const params = { From: '+12135550142', Body: 'hi', MessageSid: 'SM9' };
    assert.equal((await inbound.POST(signed('/api/sms/inbound', params, 'wrong-token'))).status, 403);
    const t = process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_AUTH_TOKEN;
    assert.equal((await inbound.POST(signed('/api/sms/inbound', params))).status, 503);
    process.env.TWILIO_AUTH_TOKEN = t;
  });

  it('inbound: a signed text with a photo becomes a caregiver reply with a stored, sniffed upload', async () => {
    await run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' });
    const res = await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', Body: '', MessageSid: 'SM10', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1' }));
    assert.equal(res.status, 200);
    const { load } = await import('../lib/db');
    const db = await load();
    const msg = db.messages.filter((m) => m.caregiverId === 'maria' && m.from === 'caregiver').at(-1)!;
    assert.match(msg.attachment!.url, /^\/api\/files\/up_[a-z0-9]+\.png$/);
  });

  it('inbound: ignores a non-image attachment, an untrusted media host, an unknown sender and a repeated MessageSid', async () => {
    const { load } = await import('../lib/db');
    const count = async () => (await load()).messages.filter((m) => m.from === 'caregiver').length;
    const base = await count();
    mediaBytes = Buffer.from('<html>not an image</html>');
    await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', MessageSid: 'SM11', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1' }));
    await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', MessageSid: 'SM12', NumMedia: '1', MediaUrl0: 'https://evil.test/x' }));
    await inbound.POST(signed('/api/sms/inbound', { From: '+19999999999', Body: 'hello', MessageSid: 'SM13' }));
    assert.equal(await count(), base, 'none of these created a caregiver message');
    await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', Body: 'first', MessageSid: 'SM14' }));
    await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', Body: 'first', MessageSid: 'SM14' }));
    assert.equal(await count(), base + 1, 'a retry of the same MessageSid is processed once');
    mediaBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  });

  it('inbound STOP opts the caregiver out; the confirmation is still attempted', async () => {
    await inbound.POST(signed('/api/sms/inbound', { From: '+12135550142', Body: 'STOP', MessageSid: 'SM15' }));
    const { load } = await import('../lib/db');
    assert.equal((await load()).caregivers.find((c) => c.id === 'maria')!.optedOut, true);
    assert.equal(sent.length, 1);
  });

  it('status callback: failures are audited, successes ignored', async () => {
    const ok = await status.POST(signed('/api/sms/status', { To: '+12135550142', MessageStatus: 'delivered', MessageSid: 'SM1' }));
    assert.equal(ok.status, 204);
    await status.POST(signed('/api/sms/status', { To: '+12135550142', MessageStatus: 'undelivered', ErrorCode: '30003', MessageSid: 'SM1' }));
    const { load } = await import('../lib/db');
    assert.ok((await load()).audit.some((e) => e.action === 'a text was not delivered' && e.detail!.includes('30003')));
  });

  it('does not text a caregiver who has no consent', async () => {
    const { load, save } = await import('../lib/db');
    const db = await load();
    db.caregivers.find((c) => c.id === 'maria')!.smsConsent = false;
    await save(db);
    await assert.rejects(run({ type: 'authorize-outreach', caregiverId: 'maria', requirementId: 'initial_training' }));
    assert.equal(sent.length, 0);
  });
});
