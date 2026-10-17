import crypto from 'node:crypto';

// Secure upload links (PRD FR04): short-lived and scoped to one open submission. The token is
// `<submission id>.<expiry>.<signature>`; it stops working when it expires or when the case moves on.

const TTL_MS = 72 * 3_600_000;

function secret() {
  return process.env.PAPEREASE_LINK_SECRET || (process.env.NODE_ENV !== 'production' ? 'paperease-dev-link-secret' : null);
}

const sign = (key: string, body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 32);

export function linkToken(submissionId: string, now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const body = `${submissionId}.${(now + TTL_MS).toString(36)}`;
  return `${body}.${sign(key, body)}`;
}

export function linkUrl(origin: string, submissionId: string) {
  const token = linkToken(submissionId);
  return token ? `${origin}/u/${token}` : null;
}

/** the submission id a token was issued for, or null when it is forged, malformed or expired */
export function readLinkToken(token: string): string | null {
  const key = secret();
  const parts = token.split('.');
  if (!key || parts.length !== 3) return null;
  const [submissionId, expiry, sig] = parts;
  const want = sign(key, `${submissionId}.${expiry}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (parseInt(expiry, 36) < Date.now()) return null;
  return submissionId;
}
