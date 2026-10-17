/** US-centric E.164: 10 digits get +1; anything else must already carry its country code. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const n = d.length === 10 ? `1${d}` : d;
  if (n.length < 10 || n.length > 15) throw new Error('That phone number cannot be used.');
  return `+${n}`;
}
export function samePhone(a: string, b: string) {
  try { return normalizePhone(a) === normalizePhone(b); } catch { return false; }
}
