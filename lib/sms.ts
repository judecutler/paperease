import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from './phone';

// Real text messages through Twilio, using plain fetch (no SDK). Everything is off until configured:
//
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164 number) or TWILIO_MESSAGING_SERVICE_SID
//   SMS_LIVE=true                       explicit switch, so keys in a dev .env never text real people
//   CARELOOP_AUTH=required              live texting is refused on an open workspace
//   PUBLIC_BASE_URL=https://your.app    used to verify Twilio's webhook signature
//
// Anything else runs in "simulated" mode: messages appear in the in-app thread and nothing leaves the server.

export interface SmsStatus { mode: 'live' | 'simulated'; reason?: string }

export function smsStatus(env = process.env): SmsStatus {
  const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)) return { mode: 'simulated', reason: 'Twilio is not configured.' };
  if (env.SMS_LIVE !== 'true') return { mode: 'simulated', reason: 'Set SMS_LIVE=true to send real texts.' };
  if (env.CARELOOP_AUTH !== 'required') return { mode: 'simulated', reason: 'Real texts need CARELOOP_AUTH=required so only signed-in staff can trigger them.' };
  return { mode: 'live' };
}

export class SmsError extends Error {
  constructor(public code: number | null, message: string) { super(message); }
}

/** Sends one message. Errors carry Twilio's error code and message, never the phone number or text. */
export async function sendSms(to: string, body: string, opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}) {
  const env = opts.env ?? process.env;
  const f = opts.fetchImpl ?? fetch;
  const sid = env.TWILIO_ACCOUNT_SID!, token = env.TWILIO_AUTH_TOKEN!;
  const form = new URLSearchParams({ To: normalizePhone(to), Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', env.TWILIO_FROM!);
  if (env.PUBLIC_BASE_URL) form.set('StatusCallback', `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/sms/status`);
  const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
  if (!res.ok) throw new SmsError(json.code ?? res.status, json.message ?? `Twilio returned ${res.status}`);
  return { sid: json.sid ?? '', status: json.status ?? 'queued' };
}

/* ---------- inbound webhooks ---------- */

/** Twilio's X-Twilio-Signature: base64 HMAC-SHA1 of the full URL followed by every POST parameter, sorted by name, as name+value. */
export function twilioSignature(url: string, params: Record<string, string>, token: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

export function validTwilioSignature(url: string, params: Record<string, string>, given: string | null, token: string) {
  if (!given) return false;
  const a = Buffer.from(twilioSignature(url, params, token));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The URL Twilio signed. Behind a proxy request.url can be the internal address, so PUBLIC_BASE_URL wins. */
export function webhookUrl(req: Request, env = process.env) {
  const u = new URL(req.url);
  if (env.PUBLIC_BASE_URL) return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}${u.pathname}${u.search}`;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

/** Media may only be fetched from Twilio itself, so a crafted webhook cannot make this server request arbitrary URLs. */
export function isTwilioMediaUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname === 'api.twilio.com' || u.hostname.endsWith('.twilio.com') || u.hostname.endsWith('.twiliocdn.com'));
  } catch { return false; }
}
