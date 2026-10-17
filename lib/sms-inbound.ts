import { newId, readDoc, writeDoc, writeUpload } from './db';
import { mimeFromBytes } from './files';
import { samePhone } from './phone';
import { isTwilioMediaUrl, validTwilioSignature, webhookUrl } from './sms';
import type { Db } from './types';

// Shared steps for the two Twilio webhooks: verify the signature, read the form, find the caregiver.

export class WebhookError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function verifiedParams(req: Request): Promise<Record<string, string>> {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) throw new WebhookError(503, 'Texting is not configured.');
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;
  if (!validTwilioSignature(webhookUrl(req), params, req.headers.get('x-twilio-signature'), token)) throw new WebhookError(403, 'Bad signature.');
  return params;
}

export const caregiverByPhone = (db: Db, phone: string) => db.caregivers.find((c) => samePhone(c.phone, phone));

/** Twilio retries a webhook it thinks failed; the same MessageSid must not be processed twice. */
export async function firstTimeSeen(sid: string): Promise<boolean> {
  if (!sid) return true;
  const seen = (await readDoc<string[]>('sms_seen')) ?? [];
  if (seen.includes(sid)) return false;
  await writeDoc('sms_seen', [...seen, sid].slice(-500));
  return true;
}

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const MAX_BYTES = 5 * 1024 * 1024;

/** Downloads the first attachment (photo or PDF) from Twilio and stores it like any other upload. Returns null if unusable. */
export async function storeMedia(params: Record<string, string>, fetchImpl: typeof fetch = fetch) {
  if (Number(params.NumMedia || 0) < 1) return null;
  const url = params.MediaUrl0;
  if (!url || !isTwilioMediaUrl(url)) return null;
  const auth = `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;
  // Twilio redirects media to a CDN; follow manually so the credentials only ever go to twilio hosts
  let res = await fetchImpl(url, { headers: { authorization: auth }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get('location');
    if (!next || !isTwilioMediaUrl(next)) return null;
    res = await fetchImpl(next, { signal: AbortSignal.timeout(15_000) });
  }
  if (!res.ok) return null;
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return null;
  const mime = mimeFromBytes(bytes);
  if (!mime) return null;
  const stored = `${newId('up')}${EXT[mime]}`;
  await writeUpload(stored, bytes, mime);
  return { name: `photo${EXT[mime]}`, url: `/api/files/${stored}`, mime };
}
